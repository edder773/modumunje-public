import { getD1, getRuntimeEnv } from "@backend/infrastructure/database";
import { authorizeLearnerRequest, type LearnerAuthorization } from "./admin-auth";
import { googleUserFromRequest, randomBase64Url } from "./google-session";

// A temporary exam owner, never a member or an administrator. The fixed expiry
// is also encoded in its key so maintenance can remove abandoned session rows.
const MAX_AGE = 24 * 60 * 60;
const SECURE_COOKIE = "__Host-modumunje-guest-learning";
const LOCAL_COOKIE = "modumunje-guest-learning";
const encoder = new TextEncoder();

async function signingKey() {
  const secret = String(getRuntimeEnv().GOOGLE_AUTH_SESSION_SECRET ?? "").trim();
  if (secret.length < 32) throw new Error("Learning session signing is unavailable");
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export function isGuestLearningKey(key: string | undefined): boolean {
  return Boolean(key && /^guest:\d{10}:[A-Za-z0-9_-]{32}$/u.test(key));
}

export async function guestLearningKey(request: Request): Promise<string | null> {
  const name = new URL(request.url).protocol === "https:" ? SECURE_COOKIE : LOCAL_COOKIE;
  const value = (request.headers.get("cookie") ?? "").split(";")
    .map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
  if (!value || value.length > 200) return null;
  const [key, signature, extra] = value.split(".");
  if (extra || !isGuestLearningKey(key) || !/^[0-9a-f]{64}$/u.test(signature ?? "")) return null;
  const expires = Number(key.split(":")[1]);
  const now = Math.floor(Date.now() / 1000);
  if (expires <= now || expires > now + MAX_AGE + 60) return null;
  const bytes = Uint8Array.from(signature.match(/../gu)!, (pair) => parseInt(pair, 16));
  const valid = await crypto.subtle.verify("HMAC", await signingKey(), bytes, encoder.encode(`guest-learning:v1:${key}`));
  return valid ? key : null;
}

export async function initializeGuestLearningSession(request: Request): Promise<Response> {
  if (await googleUserFromRequest(request)) {
    return Response.json({ ok: true, temporary: false }, { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
  }
  const existing = await guestLearningKey(request);
  const headers = new Headers({ "Cache-Control": "private, no-store", Vary: "Cookie" });
  if (!existing) {
    const key = `guest:${Math.floor(Date.now() / 1000) + MAX_AGE}:${randomBase64Url(24)}`;
    const bytes = await crypto.subtle.sign("HMAC", await signingKey(), encoder.encode(`guest-learning:v1:${key}`));
    const signature = Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const secure = new URL(request.url).protocol === "https:";
    headers.set("Set-Cookie", `${secure ? SECURE_COOKIE : LOCAL_COOKIE}=${key}.${signature}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE}${secure ? "; Secure" : ""}`);
  }
  return Response.json({ ok: true, temporary: true, maxAgeSeconds: MAX_AGE }, { headers });
}

/** Only completed, server-graded results can move to an explicitly signed-in account. */
export async function claimGuestExamResults(request: Request, memberKey: string, isAdmin: boolean) {
  const guestKey = await guestLearningKey(request);
  if (!guestKey || isGuestLearningKey(memberKey)) return;
  const db = getD1();
  await db.batch([
    db.prepare(`
      INSERT OR IGNORE INTO attempts (question_id, selected_answers, correct, mode, user_key,
        exam_type, result, score, answer_text, review_status, is_admin, client_operation_id, created_at)
      SELECT q.id, COALESCE(json_extract(item.value, '$.selectedAnswers'), '[]'),
        json_extract(item.value, '$.result') = 'correct', 'mock-exam', ?, s.exam_type,
        CASE WHEN json_extract(item.value, '$.result') IN ('correct', 'partial')
          THEN json_extract(item.value, '$.result') ELSE 'incorrect' END,
        COALESCE(json_extract(item.value, '$.score'), 0),
        COALESCE(json_extract(item.value, '$.answerText'), ''),
        CASE WHEN json_extract(item.value, '$.result') = 'correct' THEN 'mastered' ELSE 'pending' END,
        ?, 'guest-exam:' || s.id || ':' || item.key, COALESCE(s.submitted_at, s.updated_at)
      FROM exam_sessions s, json_each(s.result, '$.questionResults') item
      JOIN questions q ON q.id = json_extract(item.value, '$.questionId')
      WHERE s.user_key = ? AND s.status = 'submitted'
    `).bind(memberKey, isAdmin ? 1 : 0, guestKey),
    db.prepare(`
      INSERT OR IGNORE INTO sw_attempts (user_key, question_id, selected_answers, correct,
        mode, client_operation_id, created_at)
      SELECT ?, q.id, json_extract(s.answers, '$."' || q.id || '"'),
        json_array_length(json_extract(s.answers, '$."' || q.id || '"')) = json_array_length(q.correct_answers)
        AND NOT EXISTS (
          SELECT value FROM json_each(json_extract(s.answers, '$."' || q.id || '"'))
          EXCEPT SELECT value FROM json_each(q.correct_answers)
        ), s.mode, 'guest-session:' || s.id || ':' || item.key, s.updated_at
      FROM sw_learning_sessions s, json_each(s.question_ids) item
      JOIN sw_questions q ON q.id = item.value
      WHERE s.user_key = ? AND s.status = 'submitted'
        AND json_array_length(json_extract(s.answers, '$."' || q.id || '"')) > 0
    `).bind(memberKey, guestKey),
    db.prepare("UPDATE exam_sessions SET user_key = ?, is_admin = ? WHERE user_key = ? AND status = 'submitted'")
      .bind(memberKey, isAdmin ? 1 : 0, guestKey),
    db.prepare("UPDATE sw_learning_sessions SET user_key = ? WHERE user_key = ? AND status = 'submitted'")
      .bind(memberKey, guestKey),
  ]);
}

export async function guestExamQuotaReached(key: string, engine: "sql" | "sw") {
  if (!isGuestLearningKey(key)) return false;
  const table = engine === "sql" ? "exam_sessions" : "sw_learning_sessions";
  const row = await getD1().prepare(`SELECT COUNT(*) AS count FROM (SELECT id FROM ${table} WHERE user_key = ? LIMIT 30)`)
    .bind(key).first<{ count: number }>();
  return Number(row?.count ?? 0) >= 30;
}

export async function authorizeLearningSession(
  request: Request,
  options: { createIfMissing?: boolean; respectMaintenance?: boolean } = {},
): Promise<LearnerAuthorization> {
  // Legacy guest cookies are retained only for recovering old records at sign-in.
  // They never authorize new practice, grading or exam access.
  return authorizeLearnerRequest(request, options);
}
