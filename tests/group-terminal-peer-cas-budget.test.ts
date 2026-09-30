import assert from "node:assert/strict";
import test from "node:test";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";
import { sqliteD1 } from "./helpers/sqlite-d1.mjs";
import { activateApprovedGroupBank } from "./helpers/approved-group-bank";
import { POST } from "../apps/backend/src/modules/group-exams/group-exam.service";
import { learnerUserHash } from "../apps/backend/src/common/auth/admin-auth";
import { v2Repository } from "../apps/backend/src/modules/group-exams/group-exam-v2.service";

const origin = "https://example.test";
const owner = "cas-budget-owner@example.test";
const peer = "cas-budget-peer@example.test";
let serial = 0;
async function post(email: string, body: Record<string, unknown>) {
  const response = await POST(new Request(`${origin}/api/group-exams`, {
    method: "POST",
    headers: { origin, "content-type": "application/json", "x-sql-study-user-request": "1",
      "x-baeumzip-authenticated-user-email": email },
    body: JSON.stringify({ idempotencyKey: `cas-budget-${++serial}`, ...body }),
  }));
  const opsHeader = response.headers.get("X-Group-DB-Ops");
  assert.notEqual(opsHeader, null);
  return { status: response.status, ops: Number(opsHeader),
    body: await response.json() as Record<string, unknown> };
}

test("terminal peer CAS conflicts retain correctness and report their D1 operation count", async () => {
  const db = openCanonicalTestDatabase(process.cwd());
  const previous = globalThis.__BAEUMZIP_ENV__;
  const original = v2Repository.mutateProgress;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(db) as unknown as D1Database,
    SKCT_GROUP_SERVICE_ENABLED: "1", SKCT_GROUP_V2_ENABLED: "1", SKCT_GROUP_REPEAT_IDENTITY_VERIFIED: "1" };
  try {
    await activateApprovedGroupBank(db);
    const created = await post(owner, { action: "group-create", name: "CAS 계측 그룹", publicName: "대표" });
    assert.equal(created.status, 201, JSON.stringify(created));
    const groupId = String((created.body.group as { id: string }).id);
    db.prepare("UPDATE study_groups SET admin_question_count_override=3 WHERE id=?").run(groupId);
    const invite = await post(owner, { action: "invite-create", groupId });
    assert.equal(invite.status, 201);
    const joined = await post(peer, { action: "invite-accept", token: (invite.body.invite as {token:string}).token, publicName: "동료" });
    assert.equal(joined.status, 200);
    const started = await post(owner, { action: "run-start", groupId, mode: "immediate" });
    assert.equal(started.status, 201, JSON.stringify(started));
    const runId = String((started.body.run as {id:string}).id);
    const now = Date.now();
    db.prepare("UPDATE study_group_exam_runs SET actual_started_at_utc=?,final_deadline_at_utc=? WHERE id=?")
      .run(new Date(now-1000).toISOString(), new Date(now+900000).toISOString(), runId);
    db.prepare("UPDATE study_group_exam_participant_progress SET current_opened_at_utc=?,current_deadline_at_utc=? WHERE run_id=?")
      .run(new Date(now-1000).toISOString(), new Date(now+40000).toISOString(), runId);
    const peerKey = await learnerUserHash(peer);
    const overdue = new Date(now-500).toISOString();
    db.prepare("UPDATE study_group_exam_participant_progress SET current_position=2,current_deadline_at_utc=? WHERE run_id=? AND user_key=?")
      .run(overdue, runId, peerKey);
    let injected = false;
    v2Repository.mutateProgress = async function(input) {
      if (!injected) {
        injected = true;
        const sealed = db.prepare("SELECT correct_answers_snapshot_json FROM study_group_exam_question_secret WHERE run_id=? AND position=2")
          .get(runId) as {correct_answers_snapshot_json:string};
        db.prepare(`INSERT INTO study_group_exam_answers
          (run_id,user_key,position,answer_json,revision,last_client_operation_id,server_received_at_utc,updated_at)
          VALUES (?,?,?,?,1,?,?,?)`)
          .run(runId,peerKey,2,sealed.correct_answers_snapshot_json,"concurrent-peer-answer",overdue,overdue);
        db.prepare("UPDATE study_group_exam_participant_progress SET revision=revision+1 WHERE run_id=? AND user_key=?")
          .run(runId, peerKey);
      }
      return original.call(this, input);
    };
    const submitted = await post(owner, { action: "run-submit", runId, position: 0, expectedProgressRevision: 0 });
    assert.equal(submitted.status, 200, JSON.stringify(submitted));
    assert.ok(Number.isInteger(submitted.ops) && submitted.ops >= 0);
    assert.ok(submitted.ops <= 3, `revision-only peer race used ${submitted.ops} D1 rounds`);
    assert.equal(injected, true);
    const run = db.prepare("SELECT status FROM study_group_exam_runs WHERE id=?").get(runId) as {status:string};
    const peerProgress = db.prepare("SELECT terminal_status,finished_at_utc,revision FROM study_group_exam_participant_progress WHERE run_id=? AND user_key=?")
      .get(runId, peerKey) as {terminal_status:string;finished_at_utc:string;revision:number};
    assert.equal(run.status, "completed");
    assert.equal(peerProgress.terminal_status, "auto_submitted");
    assert.equal(peerProgress.finished_at_utc, overdue);
    assert.equal(db.prepare("SELECT correct_count FROM study_group_exam_participant_progress WHERE run_id=? AND user_key=?")
      .get(runId,peerKey)?.correct_count,1);
    console.log(JSON.stringify({ case: "peer_revision_changed_between_preflight_and_mutation", httpStatus: submitted.status,
      d1Ops: submitted.ops, runStatus: run.status, peerStatus: peerProgress.terminal_status,
      peerFinishedAtOriginalDeadline: peerProgress.finished_at_utc === overdue }));
    db.prepare("UPDATE study_group_quota_slots SET status='available',reserved_run_id=NULL WHERE group_id=?")
      .run(groupId);
    const started2 = await post(owner, { action: "run-start", groupId, mode: "immediate" });
    assert.equal(started2.status, 201, JSON.stringify(started2));
    const runId2 = String((started2.body.run as {id:string}).id);
    const now2 = Date.now();
    db.prepare("UPDATE study_group_exam_runs SET actual_started_at_utc=?,final_deadline_at_utc=? WHERE id=?")
      .run(new Date(now2-1000).toISOString(), new Date(now2+900000).toISOString(), runId2);
    db.prepare("UPDATE study_group_exam_participant_progress SET current_opened_at_utc=?,current_deadline_at_utc=? WHERE run_id=?")
      .run(new Date(now2-1000).toISOString(), new Date(now2+40000).toISOString(), runId2);
    const overdue2 = new Date(now2-500).toISOString();
    db.prepare("UPDATE study_group_exam_participant_progress SET current_position=2,current_deadline_at_utc=? WHERE run_id=? AND user_key=?")
      .run(overdue2, runId2, peerKey);
    injected = false;
    v2Repository.mutateProgress = async function(input) {
      if (!injected) {
        injected = true;
        db.prepare("UPDATE study_group_exam_participant_progress SET current_position=1,current_opened_at_utc=?,revision=revision+1 WHERE run_id=? AND user_key=?")
          .run(new Date(now2-45500).toISOString(), runId2, peerKey);
      }
      return original.call(this, input);
    };
    const submitted2 = await post(owner, { action: "run-submit", runId: runId2, position: 0, expectedProgressRevision: 0 });
    assert.equal(submitted2.status, 200, JSON.stringify(submitted2));
    assert.ok(Number.isInteger(submitted2.ops) && submitted2.ops >= 0);
    assert.ok(submitted2.ops <= 3, `peer-position race used ${submitted2.ops} D1 rounds`);
    const run2 = db.prepare("SELECT status FROM study_group_exam_runs WHERE id=?").get(runId2) as {status:string};
    const peer2 = db.prepare("SELECT current_position,terminal_status,current_deadline_at_utc FROM study_group_exam_participant_progress WHERE run_id=? AND user_key=?")
      .get(runId2, peerKey) as {current_position:number;terminal_status:string|null;current_deadline_at_utc:string};
    assert.equal(run2.status, "running");
    assert.equal(peer2.current_position, 2);
    assert.equal(peer2.terminal_status, null);
    assert.ok(Date.parse(peer2.current_deadline_at_utc) > now2);
    console.log(JSON.stringify({ case: "peer_position_changed_between_preflight_and_mutation", httpStatus: submitted2.status,
      d1Ops: submitted2.ops, runStatus: run2.status, peerPosition: peer2.current_position,
      peerDeadlineAdvanced: Date.parse(peer2.current_deadline_at_utc) > now2 }));
    db.prepare("UPDATE study_group_exam_runs SET status='completed' WHERE id=?").run(runId2);
    db.prepare("DELETE FROM study_group_active_runs WHERE run_id=?").run(runId2);
    db.prepare("UPDATE study_group_quota_slots SET status='available',reserved_run_id=NULL WHERE group_id=?")
      .run(groupId);
    const started3 = await post(owner, { action: "run-start", groupId, mode: "immediate" });
    assert.equal(started3.status, 201, JSON.stringify(started3));
    const runId3 = String((started3.body.run as {id:string}).id);
    const now3 = Date.now();
    db.prepare("UPDATE study_group_exam_runs SET actual_started_at_utc=?,final_deadline_at_utc=? WHERE id=?")
      .run(new Date(now3-1000).toISOString(), new Date(now3+900000).toISOString(), runId3);
    db.prepare("UPDATE study_group_exam_participant_progress SET current_opened_at_utc=?,current_deadline_at_utc=? WHERE run_id=?")
      .run(new Date(now3-1000).toISOString(), new Date(now3+40000).toISOString(), runId3);
    db.prepare("UPDATE study_group_exam_participant_progress SET current_position=2,current_deadline_at_utc=? WHERE run_id=? AND user_key=?")
      .run(new Date(now3-500).toISOString(),runId3,peerKey);
    const ownerKey = await learnerUserHash(owner);
    const peerBeforeRejected = db.prepare("SELECT * FROM study_group_exam_participant_progress WHERE run_id=? AND user_key=?")
      .get(runId3,peerKey);
    injected = false;
    v2Repository.mutateProgress = async function(input) {
      if (!injected) {
        injected = true;
        db.prepare("UPDATE study_group_exam_participant_progress SET revision=revision+1 WHERE run_id=? AND user_key=?")
          .run(runId3,ownerKey);
      }
      return original.call(this,input);
    };
    const rejected = await post(owner,{action:"run-submit",runId:runId3,position:0,expectedProgressRevision:0});
    assert.equal(rejected.status,409);
    assert.deepEqual(db.prepare("SELECT * FROM study_group_exam_participant_progress WHERE run_id=? AND user_key=?")
      .get(runId3,peerKey),peerBeforeRejected);
    assert.equal(db.prepare("SELECT status FROM study_group_exam_runs WHERE id=?").get(runId3)?.status,"running");
  } finally {
    v2Repository.mutateProgress = original;
    db.close();
    globalThis.__BAEUMZIP_ENV__ = previous;
  }
});
