import assert from "node:assert/strict";
import test from "node:test";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";
import { sqliteD1 } from "./helpers/sqlite-d1.mjs";
import { activateApprovedGroupBank } from "./helpers/approved-group-bank";
import { GET, POST } from "../apps/backend/src/modules/group-exams/group-exam.service";

const origin = "https://example.test";
const owner = "mm052-owner@example.test";
let serial = 0;
async function post(body: Record<string, unknown>) {
  const response = await POST(new Request(`${origin}/api/group-exams`, {
    method: "POST",
    headers: { origin, "content-type": "application/json", "x-sql-study-user-request": "1", "x-baeumzip-authenticated-user-email": owner },
    body: JSON.stringify({ idempotencyKey: `mm052-request-${++serial}`, ...body }),
  }));
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}
async function get(query: string) {
  const response = await GET(new Request(`${origin}/api/group-exams?${query}`, {
    headers: { "x-baeumzip-authenticated-user-email": owner },
  }));
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

test("MM-052 next question prompt and choices remain sealed until successful advance", async () => {
  const db = openCanonicalTestDatabase(process.cwd());
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = {
    DB: sqliteD1(db) as unknown as D1Database,
    SKCT_GROUP_SERVICE_ENABLED: "1",
    SKCT_GROUP_V2_ENABLED: "1",
    SKCT_GROUP_REPEAT_IDENTITY_VERIFIED: "1",
  };
  try {
    await activateApprovedGroupBank(db);
    const created = await post({ action: "group-create", name: "문항 공개 검증 그룹", publicName: "대표" });
    assert.equal(created.status, 201, JSON.stringify(created));
    const groupId = String((created.body.group as { id: string }).id);
    db.prepare("UPDATE study_groups SET admin_question_count_override=3 WHERE id=?").run(groupId);
    const started = await post({ action: "run-start", mode: "immediate", groupId });
    assert.equal(started.status, 201);
    const runId = String((started.body.run as { id: string }).id);
    const prompt = "MM052_NEXT_PROMPT_SENTINEL";
    const choice = "MM052_NEXT_CHOICE_SENTINEL";
    db.prepare("UPDATE study_group_exam_question_public SET prompt_snapshot=?, choices_snapshot_json=? WHERE run_id=? AND position=1")
      .run(prompt, JSON.stringify([choice, "다른 보기", "또 다른 보기", "마지막 보기"]), runId);
    const assertSealed = (value: unknown) => {
      const text = JSON.stringify(value);
      assert.equal(text.includes(prompt), false);
      assert.equal(text.includes(choice), false);
      assert.equal(/correct_answers|explanation_snapshot/u.test(text), false);
    };

    const countdown = await get(`scope=current&groupId=${groupId}&runId=${runId}`);
    assert.equal(countdown.status, 200);
    assertSealed(countdown.body);
    const startAt = Date.now() - 1000;
    db.prepare("UPDATE study_group_exam_runs SET actual_started_at_utc=?,final_deadline_at_utc=? WHERE id=?")
      .run(new Date(startAt).toISOString(), new Date(startAt + 135000).toISOString(), runId);
    db.prepare("UPDATE study_group_exam_participant_progress SET current_opened_at_utc=?,current_deadline_at_utc=?,started_at_utc=? WHERE run_id=?")
      .run(new Date(startAt).toISOString(), new Date(startAt + 45000).toISOString(), new Date(startAt).toISOString(), runId);
    const current = await get(`scope=current&groupId=${groupId}&runId=${runId}`);
    assert.equal(current.status, 200);
    assertSealed(current.body);
    assert.ok((current.body.question as { prompt_snapshot?: string })?.prompt_snapshot);
    const sync = await get(`scope=sync&includeCurrent=1&groupId=${groupId}`);
    assert.equal(sync.status, 200);
    assertSealed(sync.body);
    const saved = await post({ action: "answer-save", runId, position: 0, answers: [0], expectedRevision: 0, expectedProgressRevision: 0, operationId: "mm052-save-1" });
    assert.equal(saved.status, 200);
    assertSealed(saved.body);
    const advance = await post({ action: "question-advance", runId, position: 0, expectedProgressRevision: 1 });
    assert.equal(advance.status, 200);
    assert.match(JSON.stringify(advance.body), /MM052_NEXT_PROMPT_SENTINEL/u);
    assert.match(JSON.stringify(advance.body), /MM052_NEXT_CHOICE_SENTINEL/u);
    const next = await get(`scope=current&groupId=${groupId}&runId=${runId}`);
    assert.equal(next.status, 200);
    assert.match(JSON.stringify(next.body), /MM052_NEXT_PROMPT_SENTINEL/u);
    assert.match(JSON.stringify(next.body), /MM052_NEXT_CHOICE_SENTINEL/u);
  } finally {
    db.close();
    globalThis.__BAEUMZIP_ENV__ = previous;
  }
});
