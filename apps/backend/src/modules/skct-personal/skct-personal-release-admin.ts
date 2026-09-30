import { authorizeAdminRequest, verifyAdminMutationRequest } from "@backend/common/auth/admin-auth";
import { getD1 } from "@backend/infrastructure/database";
import { readBoundedJsonBody } from "@shared/http/bounded-json-body.mjs";

// This release identity binds the private owner package to the reviewed 300 items.
// The package, answers, and explanations are never bundled into the application.
const RELEASE = "skct-personal-300-20260927-r1";
const CONTENT_SHA = "849c5d1d1ebbffbf60c6b5aad016b4ad76ba56305872573ffcb9b56fd19512a9";
const PROVENANCE_SHA = "83ebff920c5abb0bc7e3a3e3674883b3480b5da766576b070444b5dfa89883af";
const ARCHIVES: Record<string, string> = {
  B01: "0f0e4e9ce08c06415d279ed891bf072a33b71cc3d119d3fc224ff16b9d86c24b",
  B02: "bbbee0d1cad25b31d897c614c5c69edaeea41b141a8a3561067d7d690a3ec1c5",
  B03: "325ce4327f96d7c5383512cf0ed446be0a40d2bd0abbd90e3a6eed542ff23a16",
  U01: "2a777970346c40e2c837de9299b4650df2224f87f795305d5b343f22adf67e08",
};
const PUBLIC_KEYS = ["sourceItemId", "unitId", "passage", "question", "stimulus", "conditions",
  "insertionSentence", "judgmentItems", "choiceHasSourceLabel", "displayChoices", "assetUrls", "assetDescriptions"];
const ROW_KEYS = ["sourceItemId", "unitId", "sourceBatch", "sourceArchiveSha256", "sourceFile",
  "sourceFileSha256", "sourceOrdinal", "sourceSchemaVersion", "publicJson", "publicSha256",
  "secretJson", "secretSha256"];
type ImportRow = { sourceItemId: string; unitId: string; sourceBatch: string; sourceArchiveSha256: string;
  sourceFile: string; sourceFileSha256: string; sourceOrdinal: number; sourceSchemaVersion: string;
  publicJson: string; publicSha256: string; secretJson: string; secretSha256: string };
type Secret = { answerIndex: number; rawAnswer: unknown; explanation: string;
  distractorExplanations: unknown; rawSource: unknown };
type DbRow = Record<string, unknown>;
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
function json(data: unknown, status = 200) { return Response.json(data, { status, headers }); }
function fail(message: string, status = 400) { return json({ error: message }, status); }
function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function hash(value: unknown) { return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value); }
async function sha256(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}
function publicSafe(value: unknown): boolean {
  if (Array.isArray(value)) return value.every(publicSafe);
  if (object(value)) return Object.entries(value).every(([key, child]) =>
    !/answer|correct|explanation|solution|secret|정답|해설/iu.test(key) && publicSafe(child));
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}
function parsed(value: string): unknown { try { return JSON.parse(value); } catch { return null; } }
function validRow(value: unknown): value is ImportRow {
  if (!object(value) || !exactKeys(value, ROW_KEYS)) return false;
  const row = value as unknown as ImportRow;
  const unit = row.unitId;
  const batch = row.sourceBatch;
  if (typeof unit !== "string" || !/^U0[1-5]$/u.test(unit) ||
      typeof row.sourceItemId !== "string" || !new RegExp(`^${unit}_[A-Za-z0-9_]+$`, "u").test(row.sourceItemId) ||
      typeof batch !== "string" || !(unit === "U01" ? /^P0[1-3]$/u : /^B0[1-3]$/u).test(batch) ||
      row.sourceArchiveSha256 !== ARCHIVES[unit === "U01" ? "U01" : batch] ||
      row.sourceFile !== (unit === "U01" ? "new_language_60.json" : `${unit}/unit.json`) ||
      !hash(row.sourceFileSha256) || !hash(row.publicSha256) || !hash(row.secretSha256) ||
      !Number.isInteger(row.sourceOrdinal) || Number(row.sourceOrdinal) < 1 || Number(row.sourceOrdinal) > (unit === "U01" ? 60 : 20) ||
      typeof row.sourceSchemaVersion !== "string" || row.sourceSchemaVersion.length > 100 ||
      typeof row.publicJson !== "string" || row.publicJson.length > 40_000 ||
      typeof row.secretJson !== "string" || row.secretJson.length > 80_000) return false;
  const pub = parsed(row.publicJson);
  const sec = parsed(row.secretJson);
  if (!object(pub) || !exactKeys(pub, PUBLIC_KEYS) || !publicSafe(pub) ||
      pub.sourceItemId !== row.sourceItemId || pub.unitId !== unit ||
      !Array.isArray(pub.displayChoices) || pub.displayChoices.length !== 5 ||
      !pub.displayChoices.every(choice => typeof choice === "string" && choice.length > 0) ||
      !Array.isArray(pub.assetUrls) || !pub.assetUrls.every(url =>
        typeof url === "string" && /^\/skct-personal\/(B01|B02|B03|U01_REPLACEMENT)\/U0[1-5]\/[A-Za-z0-9_.-]+\.svg$/u.test(url)) ||
      !object(sec) || !exactKeys(sec, ["answerIndex", "rawAnswer", "explanation", "distractorExplanations", "rawSource"]) ||
      !Number.isInteger(sec.answerIndex) || Number(sec.answerIndex) < 1 || Number(sec.answerIndex) > 5 ||
      typeof sec.explanation !== "string" || sec.explanation.length < 1 ||
      !object(sec.rawSource) || sec.rawSource.id !== row.sourceItemId) return false;
  return true;
}
async function checkedRow(row: unknown) {
  if (!validRow(row) || await sha256(row.publicJson as string) !== row.publicSha256 ||
      await sha256(row.secretJson as string) !== row.secretSha256) return null;
  const sec = parsed(row.secretJson) as Secret;
  return { ...row, sec, publicAssets: JSON.stringify((parsed(row.publicJson as string) as Record<string, unknown>).assetUrls) };
}
async function release() {
  return getD1().prepare("SELECT id,status,content_sha256,item_count FROM skct_personal_releases WHERE id=?")
    .bind(RELEASE).first<{ id: string; status: string; content_sha256: string; item_count: number }>();
}
function releaseMatches(value: Awaited<ReturnType<typeof release>>) {
  return value?.id === RELEASE && value.content_sha256 === CONTENT_SHA && Number(value.item_count) === 300;
}
async function verifyComplete() {
  const result = await getD1().prepare(`SELECT p.source_item_id,p.unit_id,p.source_batch,p.source_archive_sha256,
    p.source_file,p.source_file_sha256,p.source_ordinal,p.source_schema_version,p.public_sha256,s.secret_sha256
    FROM skct_personal_public_items p LEFT JOIN skct_personal_secret_items s
      ON s.release_id=p.release_id AND s.source_item_id=p.source_item_id
    WHERE p.release_id=? ORDER BY p.unit_id,p.source_batch,p.source_ordinal,p.source_item_id`)
    .bind(RELEASE).all<DbRow>();
  const items = result.results ?? [];
  const counts = Object.fromEntries(["U01","U02","U03","U04","U05"].map(unit =>
    [unit,items.filter(item => item.unit_id === unit).length]));
  if (items.length !== 300 || Object.values(counts).some(count => count !== 60) ||
      items.some(item => !hash(item.secret_sha256))) return { ready: false, counts };
  const content = items.map(item => [item.source_item_id,item.public_sha256,item.secret_sha256]);
  const provenance = items.map(item => [item.source_item_id,item.unit_id,item.source_batch,
    item.source_archive_sha256,item.source_file,item.source_file_sha256,item.source_ordinal,
    item.source_schema_version,item.public_sha256,item.secret_sha256]);
  return { ready: await sha256(JSON.stringify(content)) === CONTENT_SHA &&
    await sha256(JSON.stringify(provenance)) === PROVENANCE_SHA, counts };
}

export async function GET(request: Request): Promise<Response> {
  const auth = await authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;
  try {
    const current = await release();
    const checked = current && releaseMatches(current) ? await verifyComplete() : null;
    return json({ releaseId: RELEASE, contentSha256: CONTENT_SHA, status: current?.status ?? "NOT_IMPORTED",
      counts: checked?.counts ?? { U01:0,U02:0,U03:0,U04:0,U05:0 }, verified: checked?.ready ?? false });
  } catch { return fail("릴리스 상태를 불러오지 못했습니다.", 503); }
}

export async function POST(request: Request): Promise<Response> {
  const auth = await authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;
  const mutationError = verifyAdminMutationRequest(request);
  if (mutationError) return mutationError;
  let body: Record<string, unknown>;
  try {
    const input = await readBoundedJsonBody(request, 240_000);
    if (!object(input)) return fail("릴리스 요청 형식이 올바르지 않습니다.");
    body = input;
  } catch { return fail("릴리스 요청 크기 또는 형식이 올바르지 않습니다.", 413); }
  if (body.releaseId !== RELEASE || body.contentSha256 !== CONTENT_SHA) return fail("승인된 릴리스가 아닙니다.", 409);
  try {
    const db = getD1();
    if (body.action === "prepare") {
      if (!exactKeys(body,["action","releaseId","contentSha256"])) return fail("릴리스 요청 형식이 올바르지 않습니다.");
      await db.batch([
        db.prepare("INSERT OR IGNORE INTO skct_personal_releases(id,status,content_sha256,item_count) VALUES(?,'STAGED',?,300)").bind(RELEASE,CONTENT_SHA),
        db.prepare("INSERT OR IGNORE INTO skct_personal_release_audit(id,release_id,event_type,actor,evidence_sha256) VALUES(? ,?,'import',?,?)")
          .bind(`${RELEASE}-admin-import`,RELEASE,auth.identity.hash,CONTENT_SHA),
      ]);
      const current = await release();
      return releaseMatches(current) ? json({ status: current?.status }) : fail("릴리스 식별자가 충돌합니다.",409);
    }
    const current = await release();
    if (!releaseMatches(current)) return fail("먼저 정해진 릴리스를 준비해 주세요.",409);
    if (body.action === "batch") {
      if (!exactKeys(body,["action","releaseId","contentSha256","rows"]) ||
          !Array.isArray(body.rows) || body.rows.length < 1 || body.rows.length > 5 || current?.status !== "STAGED")
        return fail("문항 묶음 또는 릴리스 상태가 올바르지 않습니다.",409);
      const batch = [];
      for (const row of body.rows) {
        const checked = await checkedRow(row);
        if (!checked) return fail("원본 문항 해시 또는 구조가 일치하지 않습니다.",400);
        batch.push(checked);
      }
      if (new Set(batch.map(item => item.sourceItemId)).size !== batch.length)
        return fail("묶음에 중복 문항이 있습니다.");
      const statements = batch.flatMap(item => [
        db.prepare(`INSERT OR IGNORE INTO skct_personal_public_items
          (release_id,source_item_id,unit_id,source_batch,source_archive_sha256,source_file,source_file_sha256,
           source_ordinal,source_schema_version,public_json,public_sha256,asset_refs_json)
          SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS
            (SELECT 1 FROM skct_personal_releases WHERE id=? AND status='STAGED')`).bind(RELEASE,item.sourceItemId,item.unitId,item.sourceBatch,
            item.sourceArchiveSha256,item.sourceFile,item.sourceFileSha256,item.sourceOrdinal,item.sourceSchemaVersion,
            item.publicJson,item.publicSha256,item.publicAssets,RELEASE),
        db.prepare(`INSERT OR IGNORE INTO skct_personal_secret_items
          (release_id,source_item_id,answer_index,raw_answer_json,explanation,distractor_explanations_json,
           source_raw_json,normalization_version,secret_sha256)
          SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS
            (SELECT 1 FROM skct_personal_releases WHERE id=? AND status='STAGED')`)
          .bind(RELEASE,item.sourceItemId,item.sec.answerIndex,JSON.stringify(item.sec.rawAnswer),item.sec.explanation,
            JSON.stringify(item.sec.distractorExplanations),JSON.stringify(item.sec.rawSource),"skct-personal-v1",item.secretSha256,RELEASE),
      ]);
      await db.batch(statements);
      const existing = (await db.prepare(`SELECT p.source_item_id,p.unit_id,p.source_batch,p.source_archive_sha256,
        p.source_file,p.source_file_sha256,p.source_ordinal,p.source_schema_version,p.public_json,p.public_sha256,
        p.asset_refs_json,s.answer_index,s.raw_answer_json,s.explanation,s.distractor_explanations_json,
        s.source_raw_json,s.normalization_version,s.secret_sha256 FROM skct_personal_public_items p
        JOIN skct_personal_secret_items s ON s.release_id=p.release_id AND s.source_item_id=p.source_item_id
        WHERE p.release_id=? AND p.source_item_id IN (${batch.map(() => "?").join(",")})`)
        .bind(RELEASE,...batch.map(item => item.sourceItemId)).all<DbRow>()).results ?? [];
      const found = new Map(existing.map(item => [item.source_item_id,item]));
      const same = batch.every(item => {
        const stored = found.get(item.sourceItemId);
        return stored && stored.unit_id === item.unitId && stored.source_batch === item.sourceBatch &&
          stored.source_archive_sha256 === item.sourceArchiveSha256 && stored.source_file === item.sourceFile &&
          stored.source_file_sha256 === item.sourceFileSha256 && Number(stored.source_ordinal) === item.sourceOrdinal &&
          stored.source_schema_version === item.sourceSchemaVersion && stored.public_json === item.publicJson &&
          stored.public_sha256 === item.publicSha256 && stored.asset_refs_json === item.publicAssets &&
          Number(stored.answer_index) === item.sec.answerIndex &&
          stored.raw_answer_json === JSON.stringify(item.sec.rawAnswer) && stored.explanation === item.sec.explanation &&
          stored.distractor_explanations_json === JSON.stringify(item.sec.distractorExplanations) &&
          stored.source_raw_json === JSON.stringify(item.sec.rawSource) &&
          stored.normalization_version === "skct-personal-v1" && stored.secret_sha256 === item.secretSha256;
      });
      return same ? json({ stored: batch.length }) : fail("기존 문항과 원본이 충돌합니다. 활성화하지 마세요.",409);
    }
    if (body.action === "activate") {
      if (!exactKeys(body,["action","releaseId","contentSha256"])) return fail("릴리스 요청 형식이 올바르지 않습니다.");
      const verified = await verifyComplete();
      if (!verified.ready) return fail("300문항의 내용·출처·단원별 건수 검증이 완료되지 않았습니다.",409);
      if (current?.status === "ACTIVE") return json({ status:"ACTIVE", verified:true });
      if (current?.status !== "STAGED" || await db.prepare("SELECT id FROM skct_personal_releases WHERE status='ACTIVE' AND id<>?").bind(RELEASE).first())
        return fail("기존 활성 릴리스가 있어 자동 교체하지 않습니다.",409);
      await db.batch([
        db.prepare("INSERT OR IGNORE INTO skct_personal_release_audit(id,release_id,event_type,actor,evidence_sha256) VALUES(?,?,'validate',?,?)")
          .bind(`${RELEASE}-admin-validate`,RELEASE,auth.identity.hash,PROVENANCE_SHA),
        db.prepare("UPDATE skct_personal_releases SET status='ACTIVE',activated_at=CURRENT_TIMESTAMP WHERE id=? AND status='STAGED'").bind(RELEASE),
        db.prepare("INSERT OR IGNORE INTO skct_personal_release_audit(id,release_id,event_type,actor,evidence_sha256) VALUES(?,?,'activate',?,?)")
          .bind(`${RELEASE}-admin-activate`,RELEASE,auth.identity.hash,CONTENT_SHA),
      ]);
      return (await release())?.status === "ACTIVE" ? json({ status:"ACTIVE", verified:true }) : fail("활성화 상태를 확인하지 못했습니다.",409);
    }
    if (body.action === "retire") {
      if (!exactKeys(body,["action","releaseId","contentSha256","confirmation"]) ||
          body.confirmation !== RELEASE) return fail("릴리스 ID를 정확히 확인해 주세요.");
      if (current?.status === "RETIRED") return json({ status:"RETIRED" });
      if (current?.status !== "ACTIVE") return fail("활성 릴리스만 중단할 수 있습니다.",409);
      await db.batch([
        db.prepare("UPDATE skct_personal_releases SET status='RETIRED' WHERE id=? AND status='ACTIVE'").bind(RELEASE),
        db.prepare("INSERT OR IGNORE INTO skct_personal_release_audit(id,release_id,event_type,actor,evidence_sha256) VALUES(?,?,'rollback',?,?)")
          .bind(`${RELEASE}-admin-retire`,RELEASE,auth.identity.hash,CONTENT_SHA),
      ]);
      return (await release())?.status === "RETIRED" ? json({ status:"RETIRED" }) : fail("중단 상태를 확인하지 못했습니다.",409);
    }
    return fail("지원하지 않는 릴리스 작업입니다.",404);
  } catch { return fail("릴리스 저장에 실패했습니다. 상태를 다시 조회해 주세요.",503); }
}
