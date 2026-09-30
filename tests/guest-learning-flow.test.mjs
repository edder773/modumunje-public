import assert from "node:assert/strict";
import test, { after } from "node:test";
import crypto from "node:crypto";
import worker from "../dist/server/index.js";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";
import { sqliteD1 } from "./helpers/sqlite-d1.mjs";

// Every write in this suite goes to an isolated, in-memory canonical fixture.
const db = openCanonicalTestDatabase(process.cwd());
after(() => db.close());
const origin = "https://modumunje.com";
const secret = "guest-learning-local-test-only-secret-with-at-least-32-characters";
const env = { DB: sqliteD1(db), GOOGLE_AUTH_SESSION_SECRET: secret,
  GOOGLE_CLIENT_ID: "local-test", GOOGLE_CLIENT_SECRET: "local-test",
  GOOGLE_OAUTH_REDIRECT_URI: `${origin}/api/auth/google/callback`, ADMIN_EMAIL: "admin@example.test",
  ASSETS: { fetch: async () => new Response(null, { status: 404 }) } };
const ctx = { waitUntil() {}, passThroughOnException() {} };
function request(path, cookie = "", body, headers = {}) {
  const member = cookie.match(/__Host-baeumzip-google-session=([^.]+)\./u);
  const email = member ? JSON.parse(Buffer.from(member[1], "base64url").toString()).email : null;
  return worker.fetch(new Request(new URL(path, origin), {
    method: body === undefined ? "GET" : "POST",
    headers: { cookie, accept: "application/json", ...(email ? { "x-baeumzip-sw-owner": crypto.createHash("sha256").update(`sql-study-user:${email}`).digest("hex") } : {}), ...(body === undefined ? {} : {
      "Content-Type": "application/json", Origin: origin, "x-sql-study-user-request": "1",
    }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), env, ctx);
}
async function json(response, status = 200) {
  const body = await response.json();
  assert.equal(response.status, status, JSON.stringify(body));
  return body;
}
function memberCookie(email = "member@example.test") {
  const now = Math.floor(Date.now() / 1000);
  const value = Buffer.from(JSON.stringify({ v: 1, sub: email, email, name: "Local Test", iat: now, exp: now + 3600 })).toString("base64url");
  return `__Host-baeumzip-google-session=${value}.${crypto.createHmac("sha256", secret).update(value).digest("base64url")}`;
}
function legacyGuestCookie() {
  const key = `guest:${Math.floor(Date.now() / 1000) + 3600}:${"a".repeat(32)}`;
  return `__Host-modumunje-guest-learning=${key}.${crypto.createHmac("sha256", secret).update(`guest-learning:v1:${key}`).digest("hex")}`;
}

test("theory and catalogs stay public; all solving, exams and records require login", async () => {
  for (const path of ["/", "/learn/sql/sqld/home", "/learn/sql/sqld/theories", "/learn/software-major/theories", "/learn/big-data-analysis/bae-practical/home"]) {
    const response = await request(path, "", undefined, { accept: "text/html" });
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get("location"), null, path);
  }
  for (const cookie of ["", legacyGuestCookie(), "__Host-baeumzip-google-session=forged"]) {
    for (const path of ["/learn/sql/sqld/practice", "/learn/sql/sqlp/mock-exams", "/learn/software-major/practice", "/learn/software-major/mock-exams", "/learn/information-processing/ipe-practical/practice",
      "/learn/big-data-analysis/bae-practical/type-1", "/learn/big-data-analysis/bae-practical/type-2", "/learn/big-data-analysis/bae-practical/type-3",
      "/learn/sql/sqld/records", "/learn/sql/sqld/bookmarks", "/admin"]) {
      const response = await request(path, cookie, undefined, { accept: "text/html" });
      assert.equal(response.status, 307, path);
      assert.equal(new URL(response.headers.get("location"), origin).pathname, "/login", path);
    }
    for (const scope of ["practice-meta", "practice", "questions", "mock", "mock-session", "records"]) {
      assert.equal((await request(`/api/study?scope=${scope}&exam=SQLD`, cookie, undefined, { "x-baeumzip-authenticated-user-email": "admin@example.test" })).status, 401, scope);
    }
    for (const view of ["practice", "session", "state"]) assert.equal((await request(`/api/sw-study?view=${view}`, cookie)).status, 401, view);
    for (const action of ["attempt", "short-answer", "self-assessment", "question-feedback", "exam-start", "exam-save", "exam-submit", "bookmark", "settings", "guest-import"]) {
      assert.equal((await request("/api/study", cookie, { action, questionId: 1, examType: "SQLD" })).status, 401, action);
    }
    for (const action of ["sw-attempt", "sw-session-save", "sw-session-submit"]) assert.equal((await request("/api/sw-study", cookie, { action })).status, 401, action);
  }
  const retired = await request("/api/guest-learning", "", {});
  assert.equal(retired.status, 401);
  assert.equal(retired.headers.get("set-cookie"), null);
  assert.equal((await request("/api/guest-learning", "", {}, { Origin: "https://evil.test" })).status, 403);
  for (const scope of ["shell", "overview", "theories"]) await json(await request(`/api/study?scope=${scope}&exam=SQLD`));
  const theories = await json(await request("/api/study?scope=theories&exam=SQLD"));
  const theory = theories.theories[0];
  assert.ok(theory);
  await json(await request(`/api/study?scope=theory&exam=SQLD&id=${theory.id}`));
  const subject = db.prepare("SELECT subject_id FROM sw_theories LIMIT 1").get().subject_id;
  for (const view of ["summary", "theories"]) await json(await request(`/api/sw-study?view=${view}&subjects=${subject}`));
});

test("signed-in users can practice and receive server grading across all released courses", async () => {
  const cookie = memberCookie();
  for (const exam of ["SQLD", "SQLP", "DASP", "DAP", "BAE", "IPEW", "IPEP", "ISEW"]) {
    const batch = await json(await request(`/api/study?scope=practice&exam=${exam}&kind=${exam === "IPEP" ? "descriptive" : "objective"}&limit=1`, cookie));
    const q = batch.questions[0];
    assert.ok(q?.feedbackAuthorization, exam);
    assert.equal(q.correctAnswers, undefined);
    const result = await json(await request("/api/study", cookie, {
      action: exam === "IPEP" ? "short-answer" : "attempt", questionId: q.id, examType: exam,
      selectedAnswers: [0], answerText: "검증용 오답", mode: "practice",
      clientOperationId: crypto.randomUUID(), feedbackAuthorization: q.feedbackAuthorization,
    }), 201);
    assert.ok(result.feedback.explanation);
    assert.ok(result.attempt.id > 0);
  }
});

test("member mock exams retain ownership, server grading and record retrieval", async () => {
  const cookie = memberCookie();
  const started = await json(await request("/api/study", cookie, { action: "exam-start", examType: "SQLD" }), 201);
  const { session } = started;
  assert.ok(started.questions.every(q => q.correctAnswers === undefined && q.explanation === undefined));
  const resumed = await json(await request("/api/study", cookie, { action: "exam-start", examType: "SQLD" }));
  assert.equal(resumed.session.id, session.id);
  assert.ok([403, 404].includes((await request(`/api/study?scope=mock-session&id=${session.id}`, memberCookie("other@example.test"))).status));
  const answers = Object.fromEntries(session.questionIds.map(id => [id, JSON.parse(db.prepare("SELECT correct_answers FROM questions WHERE id = ?").get(id).correct_answers)]));
  const submitted = await json(await request("/api/study", cookie, { action: "exam-submit", sessionId: session.id, revision: session.revision, answers }));
  assert.equal(submitted.session.result.totalScore, 100);
  assert.ok(submitted.questions.every(q => q.explanation));
  await json(await request("/api/study?scope=records&exam=SQLD", cookie));
});

test("all six certification mock exams return answer-free first questions on a fresh start", async () => {
  for (const exam of ["SQLD", "SQLP", "DASP", "DAP", "IPEW", "IPEP"]) {
    const cookie = memberCookie(`mock-${exam.toLowerCase()}@example.test`);
    const response = await request("/api/study", cookie, { action: "exam-start", examType: exam });
    const payload = await json(response, 201);
    assert.equal(payload.session.examType, exam);
    assert.ok(payload.session.questionIds.length > 0, exam);
    assert.ok(payload.questions.length > 0, exam);
    assert.ok(payload.questions.every(q => q.correctAnswers === undefined && q.explanation === undefined), exam);
  }
});

test("SW member practice and mock sessions retain grading and ownership checks", async () => {
  const cookie = memberCookie();
  const subject = db.prepare("SELECT subject_id FROM sw_questions WHERE active = 1 LIMIT 1").get().subject_id;
  for (const mode of ["practice", "mock"]) {
    const id = `sw_${crypto.randomUUID().replaceAll("-", "")}`;
    const selected = await json(await request(`/api/sw-study?view=practice&subjects=${subject}&mode=${mode}&sessionId=${id}&limit=2`, cookie));
    const payload = { action: "sw-session-save", sessionId: id, mode, revision: 0, subjectIds: [subject], questionIds: selected.questions.map(q => q.id), answers: {}, revealedQuestionIds: [], currentIndex: 0 };
    const saved = await json(await request("/api/sw-study", cookie, payload));
    assert.ok(saved.questions.every(q => q.correctAnswers === undefined));
    if (mode === "practice") {
      const q = saved.questions[0];
      const body = { action: "sw-attempt", mode, sessionId: id, questionId: q.id, selectedAnswers: [0], clientOperationId: crypto.randomUUID(), feedbackAuthorization: q.feedbackAuthorization };
      assert.ok((await json(await request("/api/sw-study", cookie, body), 201)).feedback.explanation);
      assert.equal((await request("/api/sw-study", memberCookie("other@example.test"), body)).status, 403);
    } else {
      const answers = Object.fromEntries(saved.questions.map(q => [q.id, JSON.parse(db.prepare("SELECT correct_answers FROM sw_questions WHERE id = ?").get(q.id).correct_answers)]));
      const submitted = await json(await request("/api/sw-study", cookie, { ...payload, action: "sw-session-submit", revision: saved.session.revision, answers }));
      assert.equal(submitted.session.result.score, 100);
      assert.ok(submitted.questions.every(q => q.explanation));
    }
  }
});

test("anonymous analytics accepts public visits, strips forged member identity and rejects other origins", async () => {
  const body = { eventType: "page_view", anonymousSessionId: "visitor-local-test-1234", eventId: "event-local-test-1234", pagePath: "/?secret=do-not-store", referrerHost: "google.com", deviceCategory: "desktop" };
  await json(await request("/api/events", "", body, { "x-baeumzip-authenticated-user-email": "admin@example.test" }), 202);
  const row = db.prepare("SELECT * FROM analytics_events WHERE anonymous_session_id = ? ORDER BY occurred_at DESC LIMIT 1").get(crypto.createHash("sha256").update(`analytics-session:${body.anonymousSessionId}`).digest("hex"));
  assert.equal(row.user_key_hash, null);
  assert.equal(row.is_admin, 0);
  assert.equal(row.page_path, "/");
  await json(await request("/api/events", "", body), 202);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM analytics_events WHERE anonymous_session_id = ?").get(row.anonymous_session_id).n, 1);
  assert.equal((await request("/api/events", "", { ...body, eventId: "evil-event-id-1234" }, { Origin: "https://evil.test" })).status, 403);
});

test("member saving remains authoritative and guest drafts are regraded before account import", async () => {
  const cookie = memberCookie();
  const batch = await json(await request("/api/study?scope=practice&exam=SQLD&limit=1", cookie));
  const q = batch.questions[0];
  const saved = await json(await request("/api/study", cookie, { action: "attempt", questionId: q.id, examType: "SQLD", selectedAnswers: [0], mode: "practice", clientOperationId: "member-preservation-operation", feedbackAuthorization: q.feedbackAuthorization }), 201);
  assert.ok(saved.attempt.id > 0);
  const importBody = { action: "guest-import", importId: "guest-import-regression-001", selectedExam: "SQLD", bookmarks: [], attempts: [{ questionId: q.id, selectedAnswers: [0], examType: "SQLD", result: "correct", score: 100, mode: "practice" }] };
  const imported = await json(await request("/api/study", cookie, importBody));
  assert.equal(imported.attempts, 1);
  const attempt = db.prepare("SELECT * FROM attempts WHERE mode = 'guest-import:practice' ORDER BY id DESC LIMIT 1").get();
  assert.equal(Boolean(attempt.correct), saved.attempt.correct);
  assert.equal((await json(await request("/api/study", cookie, importBody))).duplicate, true);
});

test("return visits count different Korean dates, not repeat views or logins", async () => {
  const visitorA = "returning-browser-test-001";
  const visitorB = "returning-browser-test-002";
  for (const [index, [visitor, day]] of [[visitorA, "01"], [visitorA, "01"], [visitorA, "02"], [visitorB, "02"], [visitorB, "02"]].entries()) {
    await json(await request("/api/events", "", { eventType: "page_view", anonymousSessionId: visitor, eventId: `return-visit-event-${index}`, pagePath: "/" }), 202);
    db.prepare("UPDATE analytics_events SET occurred_at = ? WHERE dedupe_key = ?").run(`2026-09-${day}T03:00:00.000Z`, crypto.createHash("sha256").update(`${visitor}:return-visit-event-${index}:page_view`).digest("hex"));
  }
  const result = await json(await request("/api/admin?resource=analytics&range=custom&start=2026-09-01&end=2026-09-02", memberCookie("admin@example.test")));
  assert.equal(result.summary.pageViews, 5);
  assert.equal(result.summary.visitors, 2);
  assert.equal(result.summary.returningVisitors, 1);
  assert.equal(result.summary.returningRate, 50);
  assert.equal(result.daily[0].returningVisitors, 0);
  assert.equal(result.daily[1].returningVisitors, 1);
});

test("analytics API reconciles member and guest submissions across daily and subject totals", async () => {
  const result = await json(await request("/api/admin?resource=analytics&range=30d", memberCookie("admin@example.test")));
  assert.ok(result.summary.memberSubmissions > 0);
  assert.equal(result.summary.guestSubmissions, 0, "new anonymous submissions are disabled");
  assert.equal(result.summary.submissions, result.summary.memberSubmissions + result.summary.guestSubmissions);
  assert.equal(result.summary.submissions, result.daily.reduce((sum, row) => sum + row.submissions, 0));
  assert.equal(result.summary.submissions, result.bySubject.reduce((sum, row) => sum + row.count, 0));
  assert.equal(result.summary.memberSubmissions, result.bySubject.reduce((sum, row) => sum + row.memberCount, 0));
  assert.equal(result.summary.guestSubmissions, result.bySubject.reduce((sum, row) => sum + row.guestCount, 0));
  assert.equal(result.summary.submissions, Object.values(result.byDate).flat().reduce((sum, row) => sum + row.count, 0));
  assert.ok(Object.entries(result.byDate).every(([day, rows]) => /^\d{4}-\d{2}-\d{2}$/.test(day)
    && rows.every(row => row.courseName && row.subject && row.count === row.memberCount + row.guestCount)));
  assert.ok(result.bySubject.some(row => row.examType === "SW" && row.memberCount > 0));
  assert.ok(result.bySubject.every(row => row.courseName && row.subject && row.count === row.memberCount + row.guestCount));
});

test("explicit Google login claims only this guest's submitted exam result", async t => {
  // Seed a pre-change submitted guest exam; no new guest access is granted.
  const cookie = legacyGuestCookie();
  const originalKey = cookie.split("=")[1].split(".")[0];
  const questionId = db.prepare("SELECT json_extract(question_ids, '$[0]') AS id FROM exam_sessions WHERE exam_type='SQLD' AND status='submitted' LIMIT 1").get().id;
  const sessionId = "legacy-submitted-before-login-policy";
  const result = JSON.stringify({ questionResults: [{ questionId, selectedAnswers: [0], result: "incorrect", score: 0 }] });
  db.prepare("INSERT INTO exam_sessions (id,user_key,exam_type,status,question_ids,started_at,ends_at,submitted_at,result) VALUES (?,?,'SQLD','submitted',?,'2026-09-17','2026-09-17','2026-09-17',?)").run(sessionId, originalKey, JSON.stringify([questionId]), result);
  const started = { session: { id: sessionId, questionIds: [questionId] } };
  const destination = `/learn/sql/sqld/mock-exams/${started.session.id}`;
  const start = await request(`/api/auth/google/start?return_to=${encodeURIComponent(destination)}`, cookie);
  assert.equal(start.status, 302);
  const state = new URL(start.headers.get("location")).searchParams.get("state");
  const pending = start.headers.getSetCookie().find(value => value.startsWith("__Host-baeumzip-google-pending=")).split(";")[0];
  t.mock.method(globalThis, "fetch", async url => {
    if (String(url).includes("oauth2.googleapis.com/token")) return Response.json({ access_token: "local-test-only", token_type: "Bearer" });
    if (String(url).includes("userinfo")) return Response.json({ sub: "claim-member", email: "claim@example.test", email_verified: true, name: "Claim Test" });
    throw new Error("Unexpected network request in local OAuth test");
  });
  const completed = await request(`/api/auth/google/callback?code=local-code&state=${state}`, `${cookie}; ${pending}`);
  assert.equal(completed.status, 302);
  assert.equal(completed.headers.get("location"), origin + destination);
  const memberKey = crypto.createHash("sha256").update("sql-study-user:claim@example.test").digest("hex");
  assert.notEqual(originalKey, memberKey);
  assert.equal(db.prepare("SELECT user_key FROM exam_sessions WHERE id = ?").get(started.session.id).user_key, memberKey);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM attempts WHERE user_key = ? AND client_operation_id LIKE 'guest-exam:%'").get(memberKey).n, started.session.questionIds.length);
  const member = completed.headers.getSetCookie().find(value => value.startsWith("__Host-baeumzip-google-session=")).split(";")[0];
  assert.equal((await request(`/api/study?scope=mock-session&id=${started.session.id}`, member)).status, 200);
  assert.equal((await request(`/api/study?scope=mock-session&id=${started.session.id}`, cookie)).status, 401);
});
