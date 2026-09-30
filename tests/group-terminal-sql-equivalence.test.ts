import assert from "node:assert/strict";
import test from "node:test";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";
import { sqliteD1 } from "./helpers/sqlite-d1.mjs";
import { activateApprovedGroupBank } from "./helpers/approved-group-bank";
import { POST, runGroupExamMaintenance } from "../apps/backend/src/modules/group-exams/group-exam.service";
import { learnerUserHash } from "../apps/backend/src/common/auth/admin-auth";
import { mutateV2, v2Repository } from "../apps/backend/src/modules/group-exams/group-exam-v2.service";
import { reconcileProgress } from "../apps/backend/src/modules/group-exams/domain/group-exam-v2.domain";

const origin = "https://example.test";
const owner = "sql-timer-owner@example.test";
const peer = "sql-timer-peer@example.test";
let serial = 0;
async function post(email: string, body: Record<string, unknown>) {
  const response = await POST(new Request(`${origin}/api/group-exams`, { method: "POST",
    headers: { origin, "content-type": "application/json", "x-sql-study-user-request": "1",
      "x-baeumzip-authenticated-user-email": email },
    body: JSON.stringify({ idempotencyKey: `sql-timer-${++serial}`, ...body }) }));
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

test("live SQL peer timer equals domain across catch-up, exact milliseconds, and hard clamp", async () => {
  const db = openCanonicalTestDatabase(process.cwd());
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(db) as unknown as D1Database,
    SKCT_GROUP_SERVICE_ENABLED: "1", SKCT_GROUP_V2_ENABLED: "1", SKCT_GROUP_REPEAT_IDENTITY_VERIFIED: "1" };
  try {
    await activateApprovedGroupBank(db);
    const created = await post(owner, { action: "group-create", name: "시각 비교 그룹", publicName: "대표" });
    assert.equal(created.status, 201);
    const groupId = String((created.body.group as {id:string}).id);
    db.prepare("UPDATE study_groups SET admin_question_count_override=3 WHERE id=?").run(groupId);
    const invite = await post(owner, { action: "invite-create", groupId });
    assert.equal(invite.status, 201);
    assert.equal((await post(peer, { action: "invite-accept", token: (invite.body.invite as {token:string}).token,
      publicName: "동료" })).status, 200);
    const ownerKey = await learnerUserHash(owner);
    const peerKey = await learnerUserHash(peer);
    const fixedNow = Date.parse("2026-09-29T12:00:00.123Z");
    const scenarios = [
      { label: "multiple-expired", deadlineOffset: -100_000, hardOffset: 600_000, position: 0 },
      { label: "exact-ms-boundary", deadlineOffset: -45_000, hardOffset: 600_000, position: 0 },
      { label: "hard-clamp", deadlineOffset: -400, hardOffset: 1_500, position: 0 },
      { label: "last-question-expired", deadlineOffset: -1, hardOffset: 600_000, position: 2 },
    ];
    for (const scenario of scenarios) {
      db.prepare("UPDATE study_group_quota_slots SET status='available',reserved_run_id=NULL WHERE group_id=?")
        .run(groupId);
      const started = await post(owner, { action: "run-start", groupId, mode: "immediate" });
      assert.equal(started.status, 201, scenario.label);
      const runId = String((started.body.run as {id:string}).id);
      const timeLimits = (await v2Repository.questionsForRun(runId)).map(q=>q.time_limit_seconds*1000);
      assert.equal(timeLimits.length,3);
      const hard = new Date(fixedNow + scenario.hardOffset).toISOString();
      db.prepare("UPDATE study_group_exam_runs SET actual_started_at_utc=?,final_deadline_at_utc=? WHERE id=?")
        .run(new Date(fixedNow-1000).toISOString(), hard, runId);
      db.prepare("UPDATE study_group_exam_participant_progress SET current_opened_at_utc=?,current_deadline_at_utc=?,started_at_utc=?,connected_at_utc=? WHERE run_id=?")
        .run(new Date(fixedNow-1000).toISOString(), new Date(fixedNow+200_000).toISOString(),
          new Date(fixedNow-1000).toISOString(),new Date(fixedNow-1000).toISOString(),runId);
      const offset = scenario.label==="exact-ms-boundary" ? -timeLimits[1] : scenario.deadlineOffset;
      const peerDeadline = new Date(fixedNow + offset).toISOString();
      db.prepare("UPDATE study_group_exam_participant_progress SET current_position=?,current_deadline_at_utc=? WHERE run_id=? AND user_key=?")
        .run(scenario.position,peerDeadline,runId,peerKey);
      const before = await v2Repository.progress(runId,peerKey);
      assert.ok(before);
      const expected = reconcileProgress(before,timeLimits,fixedNow,Date.parse(hard));
      const preflight = await v2Repository.progressMutationSnapshot(runId,ownerKey,"run-submit",`timer-${scenario.label}`,1);
      const result = await mutateV2({runId,userKey:ownerKey,action:"run-submit",position:0,
        expectedProgressRevision:0,now:new Date(fixedNow),preflight});
      assert.equal(result.submitted,true);
      const actual = await v2Repository.progress(runId,peerKey);
      assert.ok(actual);
      for (const field of ["current_position","current_opened_at_utc","current_deadline_at_utc","carried_ms",
        "finished_at_utc","terminal_status"] as const) {
        assert.deepEqual(actual[field],expected[field],`${scenario.label}: ${field}`);
      }
      db.prepare("UPDATE study_group_exam_runs SET status='completed' WHERE id=?").run(runId);
      db.prepare("DELETE FROM study_group_active_runs WHERE run_id=?").run(runId);
    }
    db.prepare("UPDATE study_group_quota_slots SET status='available',reserved_run_id=NULL WHERE group_id=?")
      .run(groupId);
    const boundaryStart = await post(owner, {action:"run-start",groupId,mode:"immediate"});
    assert.equal(boundaryStart.status,201);
    const boundaryRunId = String((boundaryStart.body.run as {id:string}).id);
    const boundary = new Date(fixedNow).toISOString();
    db.prepare("UPDATE study_group_exam_runs SET actual_started_at_utc=?,final_deadline_at_utc=? WHERE id=?")
      .run(new Date(fixedNow-1000).toISOString(),boundary,boundaryRunId);
    db.prepare("UPDATE study_group_exam_participant_progress SET current_opened_at_utc=?,current_deadline_at_utc=?,started_at_utc=? WHERE run_id=?")
      .run(new Date(fixedNow-1000).toISOString(),new Date(fixedNow-500).toISOString(),
        new Date(fixedNow-1000).toISOString(),boundaryRunId);
    db.prepare("UPDATE study_group_exam_participant_progress SET connected_at_utc=? WHERE run_id=? AND user_key=?")
      .run(new Date(fixedNow-1000).toISOString(),boundaryRunId,ownerKey);
    const peerAtBoundary = await v2Repository.progress(boundaryRunId,peerKey);
    const boundaryPreflight = await v2Repository.progressMutationSnapshot(boundaryRunId,ownerKey,"run-submit","hard-boundary",1);
    await assert.rejects(mutateV2({runId:boundaryRunId,userKey:ownerKey,action:"run-submit",position:0,
      expectedProgressRevision:0,now:new Date(fixedNow),preflight:boundaryPreflight}),/마감/u);
    assert.deepEqual(await v2Repository.progress(boundaryRunId,peerKey),peerAtBoundary,
      "hard-deadline rejected own CAS must leave peer untouched");
    await runGroupExamMaintenance(new Date(fixedNow+1));
    const noShow = await v2Repository.progress(boundaryRunId,peerKey);
    assert.equal(noShow?.terminal_status,"no_show");
    assert.equal(noShow?.finished_at_utc,boundary);
  } finally {
    db.close();
    globalThis.__BAEUMZIP_ENV__ = previous;
  }
});
