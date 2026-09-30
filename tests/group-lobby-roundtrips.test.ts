import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";
import { sqliteD1 } from "./helpers/sqlite-d1.mjs";
import { GET, POST } from "../apps/backend/src/modules/group-exams/group-exam.service";
import { activateSkctBank, previewSkctBankActivation } from "../apps/backend/src/modules/admin/admin-skct-bank-use-cases";

const origin = "https://example.test";
const email = "group-lobby-budget@example.test";
const headers = { origin, "content-type": "application/json", "x-baeumzip-authenticated-user-email": email,
  "x-sql-study-user-request": "1" };

async function activateApprovedBank(db: ReturnType<typeof openCanonicalTestDatabase>) {
  assert.equal(db.prepare("SELECT migration_version FROM app_schema_state WHERE id=1").get()?.migration_version, "0563");
  const bankPath = process.env.SKCT_GROUP_ACTIVATION_BANK?.trim();
  assert.ok(bankPath && existsSync(bankPath), "SKCT_GROUP_ACTIVATION_BANK must name the private approved new300 fixture");
  const bank = JSON.parse(readFileSync(bankPath, "utf8")) as Record<string, unknown>;
  const preview = await previewSkctBankActivation(bank);
  assert.equal(preview.eligibleCount, 300);
  db.prepare(`INSERT INTO backup_snapshots
    (id,backup_type,status,schema_version,app_version,included_data,counts,checksum,payload,byte_size,created_by_hash,created_at,error_message)
    VALUES ('budget-backup','full','completed','admin-9','test','[]','{}',?,'{}',2,'test-admin',?,'')`)
    .run("a".repeat(64), new Date().toISOString());
  const activated = await activateSkctBank({ email: "admin@example.invalid", hash: "test-admin" }, bank, preview.confirmation);
  assert.equal(activated.activated, true);
}

test("authenticated idle sync, current, answer, and terminal mutations meet the D1 roundtrip budget", async () => {
  const db = openCanonicalTestDatabase(process.cwd());
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(db) as unknown as D1Database, SKCT_GROUP_SERVICE_ENABLED: "1", SKCT_GROUP_V2_ENABLED: "1" };
  try {
    await activateApprovedBank(db);
    const created = await POST(new Request(`${origin}/api/group-exams`, { method: "POST", headers,
      body: JSON.stringify({ action: "group-create", name: "예산 그룹", publicName: "대표", memberLimit: 4, idempotencyKey: "budget-create-001" }) }));
    assert.equal(created.status, 201);
    const groupId = String((await created.json() as { group: { id: string } }).group.id);
    const lobby = await GET(new Request(`${origin}/api/group-exams?scope=lobby`, { headers }));
    assert.equal(lobby.status, 200);
    assert.equal(Number(lobby.headers.get("X-Group-DB-Ops")), 2);
    const initial = await lobby.json() as Record<string, unknown>;
    assert.equal(initial.selectedGroupId, groupId);
    assert.equal((initial.detail as { group: { id: string } }).group.id, groupId);
    assert.equal((initial.sync as { groupId: string }).groupId, groupId);
    const detail = await GET(new Request(`${origin}/api/group-exams?scope=group&groupId=${groupId}`, { headers }));
    assert.equal(detail.status, 200);
    assert.equal(Number(detail.headers.get("X-Group-DB-Ops")), 2);
    const sync = await GET(new Request(`${origin}/api/group-exams?scope=sync&groupId=${groupId}`, { headers }));
    assert.equal(sync.status, 200);
    assert.equal(Number(sync.headers.get("X-Group-DB-Ops")), 2);
    const full = await sync.json() as Record<string, unknown>;
    const heartbeat = await POST(new Request(`${origin}/api/group-exams`, { method: "POST", headers,
      body: JSON.stringify({ action: "presence-heartbeat", groupId, sessionId: "presence:budget-test-1", pageContext: "lobby",
        visible: true, includeSync: true, stateVersion: full.stateVersion, presenceVersion: full.presenceVersion }) }));
    assert.equal(heartbeat.status, 200);
    assert.equal(Number(heartbeat.headers.get("X-Group-DB-Ops")), 3);
    const changed = await heartbeat.json() as Record<string, unknown>;
    assert.equal(changed.unchanged, true);
    assert.ok(Array.isArray(changed.presence));
    const repeat = await GET(new Request(`${origin}/api/group-exams?scope=sync&groupId=${groupId}&stateVersion=${full.stateVersion}&presenceVersion=${changed.presenceVersion}`, { headers }));
    assert.equal(repeat.status, 200);
    assert.equal(Number(repeat.headers.get("X-Group-DB-Ops")), 2);
    const light = await repeat.json() as Record<string, unknown>;
    assert.equal(light.unchanged, true);
    assert.equal(Object.hasOwn(light, "presence"), false);
    const started = await POST(new Request(`${origin}/api/group-exams`, { method: "POST", headers,
      body: JSON.stringify({ action: "run-start", groupId, mode: "immediate", idempotencyKey: "budget-start-001" }) }));
    assert.equal(started.status, 201);
    const runId = String((await started.json() as { run: { id: string } }).run.id);
    assert.equal((db.prepare("SELECT connected_at_utc FROM study_group_exam_participant_progress WHERE run_id=?").get(runId) as { connected_at_utc: string | null }).connected_at_utc, null);
    const firstCurrent = await GET(new Request(`${origin}/api/group-exams?scope=current&runId=${runId}`, { headers }));
    assert.equal(firstCurrent.status, 200);
    assert.equal(Number(firstCurrent.headers.get("X-Group-DB-Ops")), 2);
    const firstConnected = (db.prepare("SELECT connected_at_utc FROM study_group_exam_participant_progress WHERE run_id=?").get(runId) as { connected_at_utc: string | null }).connected_at_utc;
    assert.ok(firstConnected);
    const secondCurrent = await GET(new Request(`${origin}/api/group-exams?scope=current&runId=${runId}`, { headers }));
    assert.equal(secondCurrent.status, 200);
    assert.equal(Number(secondCurrent.headers.get("X-Group-DB-Ops")), 2);
    assert.equal((db.prepare("SELECT connected_at_utc FROM study_group_exam_participant_progress WHERE run_id=?").get(runId) as { connected_at_utc: string | null }).connected_at_utc, firstConnected);
    const now = Date.now();
    db.prepare("UPDATE study_group_exam_runs SET actual_started_at_utc=?,final_deadline_at_utc=? WHERE id=?")
      .run(new Date(now-1000).toISOString(),new Date(now+900000).toISOString(),runId);
    db.prepare("UPDATE study_group_exam_participant_progress SET current_opened_at_utc=?,current_deadline_at_utc=? WHERE run_id=?")
      .run(new Date(now-1000).toISOString(),new Date(now+40000).toISOString(),runId);
    const answer = await POST(new Request(`${origin}/api/group-exams`, { method: "POST", headers,
      body: JSON.stringify({ action: "answer-save", runId, position: 0, answers: [0], operationId: "budget-answer-001",
        expectedProgressRevision: 0, expectedRevision: 0 }) }));
    assert.equal(answer.status, 200);
    assert.equal(Number(answer.headers.get("X-Group-DB-Ops")), 3);
    const advance = await POST(new Request(`${origin}/api/group-exams`, { method: "POST", headers,
      body: JSON.stringify({ action: "question-advance", runId, position: 0, expectedProgressRevision: 1,
        idempotencyKey: "budget-advance-001" }) }));
    assert.equal(advance.status, 200);
    assert.equal(Number(advance.headers.get("X-Group-DB-Ops")), 3);
    const submit = await POST(new Request(`${origin}/api/group-exams`, { method: "POST", headers,
      body: JSON.stringify({ action: "run-submit", runId, position: 1, expectedProgressRevision: 2,
        idempotencyKey: "budget-submit-001" }) }));
    assert.equal(submit.status, 200);
    assert.ok(Number(submit.headers.get("X-Group-DB-Ops")) <= 3);
    assert.equal(db.prepare("SELECT status FROM study_group_exam_runs WHERE id=?").get(runId)?.status, "completed");
  } finally {
    db.close();
    globalThis.__BAEUMZIP_ENV__ = previous;
  }
});
