import { activateApprovedGroupBank } from "./helpers/approved-group-bank";
import assert from "node:assert/strict";
import test from "node:test";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";
import { sqliteD1 } from "./helpers/sqlite-d1.mjs";
import { learnerUserHash } from "../apps/backend/src/common/auth/admin-auth";
import { GET, GET_ADMIN, POST, POST_ADMIN, runGroupExamMaintenance } from "../apps/backend/src/modules/group-exams/group-exam.service";
import { GroupExamAdminRepository } from "../apps/backend/src/modules/group-exams/group-exam-admin.repository";

const origin = "https://example.test";
let requestSequence = 0;

function request(email: string, body: Record<string, unknown>) {
  return new Request(`${origin}/api/group-exams`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "origin": origin,
      "x-baeumzip-authenticated-user-email": email,
      "x-sql-study-user-request": "1",
    },
    body: JSON.stringify({ ...body, idempotencyKey: body.idempotencyKey ?? `test-request-${++requestSequence}` }),
  });
}

async function post(email: string, body: Record<string, unknown>) {
  const result = await POST(request(email, body));
  return { result, body: await result.json() as Record<string, unknown> };
}

async function postAdmin(email: string, body: Record<string, unknown>) {
  const result = await POST_ADMIN(new Request(`${origin}/api/group-exams/admin`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "origin": origin,
      "x-baeumzip-authenticated-user-email": email,
      "x-sql-study-admin-request": "1",
    },
    body: JSON.stringify({ ...body, idempotencyKey: body.idempotencyKey ?? `test-admin-${++requestSequence}` }),
  }));
  return { result, body: await result.json() as Record<string, unknown> };
}

async function seedBank(database: ReturnType<typeof openCanonicalTestDatabase>) {
  await activateApprovedGroupBank(database);
}

test("group service keeps invites single-use, active questions redacted, and results private until deadline", async () => {
  const database = openCanonicalTestDatabase(process.cwd());
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(database) as unknown as D1Database, SKCT_GROUP_SERVICE_ENABLED: "1" };
  try {
    await seedBank(database);
    const owner = "owner@example.test";
    const member = "member@example.test";
    const outsider = "outsider@example.test";
    const created = await post(owner, { action: "group-create", name: "검증 그룹", publicName: "대표", memberLimit: 2, settings: { areaSeconds: { 언어이해: 1, 자료해석: 1, 창의수리: 1, 언어추리: 1, 수열추리: 1 } } });
    assert.equal(created.result.status, 201);
    const groupId = String((created.body.group as Record<string, unknown>).id);
    const lobbyResponse = await GET(new Request(`${origin}/api/group-exams?scope=group&groupId=${groupId}`, {
      headers: { "x-baeumzip-authenticated-user-email": owner },
    }));
    const lobby = ((await lobbyResponse.json() as Record<string, unknown>).group as Record<string, unknown>).lobby as Record<string, unknown>;
    assert.equal(lobby.effectiveQuestionCount, 15);
    assert.equal(lobby.quotaTotal, 1);
    assert.equal(lobby.quotaRemaining, 1);
    assert.match(String(lobby.nextQuotaResetAt), /T15:00:00[.]000Z$/u);

    const invited = await post(owner, { action: "invite-create", groupId });
    assert.equal(invited.result.status, 201);
    const token = String((invited.body.invite as Record<string, unknown>).token);
    assert.ok(token.length >= 43);
    const capacity = await post(owner, { action: "invite-create", groupId });
    assert.equal(capacity.result.status, 409);

    const accepted = await post(member, { action: "invite-accept", token, publicName: "참가자" });
    assert.equal(accepted.result.status, 200);
    const replay = await post(outsider, { action: "invite-accept", token, publicName: "외부인" });
    assert.equal(replay.result.status, 410);

    const expanded = await post(owner, {
      action: "settings-update", groupId, expectedRevision: 0, memberLimit: 3,
      settings: { areaSeconds: { 언어이해: 1, 자료해석: 1, 창의수리: 1, 언어추리: 1, 수열추리: 1 } },
    });
    assert.equal(expanded.result.status, 200);
    const spareInvite = await post(owner, { action: "invite-create", groupId });
    const spareToken = String((spareInvite.body.invite as Record<string, unknown>).token);
    const alreadyMember = await post(member, { action: "invite-accept", token: spareToken, publicName: "참가자" });
    assert.equal(alreadyMember.result.status, 409);
    assert.equal(alreadyMember.body.code, "GROUP_ALREADY_MEMBER");

    const started = await post(owner, { action: "run-start", groupId, mode: "immediate", idempotencyKey: "start-test-0001" });
    assert.equal(started.result.status, 201);
    const runId = String((started.body.run as Record<string, unknown>).id);
    const repeated = await post(owner, { action: "run-start", groupId, mode: "immediate", idempotencyKey: "start-test-0001" });
    assert.equal(repeated.result.status, 201);
    assert.equal((repeated.body.run as Record<string, unknown>).id, runId);

    const countdown = await GET(new Request(`${origin}/api/group-exams?scope=current&groupId=${groupId}`, { headers: { "x-baeumzip-authenticated-user-email": owner } }));
    assert.equal(countdown.status, 200);
    assert.equal((await countdown.json() as Record<string, unknown>).question, null);
    const openedAt = new Date(Date.now() - 1_000).toISOString();
    database.prepare("UPDATE study_group_exam_runs SET actual_started_at_utc=? WHERE id=?").run(openedAt, runId);
    database.prepare("UPDATE study_group_exam_question_public SET opens_at_utc=?, deadline_at_utc=? WHERE run_id=?")
      .run(openedAt, new Date(Date.now() + 60_000).toISOString(), runId);
    const current = await GET(new Request(`${origin}/api/group-exams?scope=current&groupId=${groupId}`, { headers: { "x-baeumzip-authenticated-user-email": owner } }));
    const currentText = await current.text();
    assert.equal(current.status, 200);
    const currentBody = JSON.parse(currentText) as { question?: { prompt_snapshot?: string } };
    assert.ok(currentBody.question?.prompt_snapshot);
    assert.equal(/correct_answers|explanation_snapshot/u.test(currentText), false);

    const secret = database.prepare("SELECT correct_answers_snapshot_json FROM study_group_exam_question_secret WHERE run_id=? AND position=0").get(runId);
    assert.ok(secret);
    const correct = JSON.parse(String(secret.correct_answers_snapshot_json)) as number[];
    assert.ok(correct.length > 0);
    const saved = await post(owner, { action: "answer-save", runId, position: 0, answers: correct, expectedRevision: 0, operationId: "answer-operation-0001" });
    assert.equal(saved.result.status, 200);
    const early = await GET(new Request(`${origin}/api/group-exams?scope=result&runId=${runId}`, { headers: { "x-baeumzip-authenticated-user-email": owner } }));
    assert.equal(early.status, 404);

    const past = new Date(Date.now() - 1_000).toISOString();
    database.prepare("UPDATE study_group_exam_runs SET final_deadline_at_utc = ? WHERE id = ?").run(past, runId);
    database.prepare("UPDATE study_group_exam_question_public SET deadline_at_utc = ? WHERE run_id = ?").run(past, runId);
    const maintenance = await runGroupExamMaintenance(new Date());
    assert.equal(maintenance.finalized, 1);
    const ownerKey = await learnerUserHash(owner);
    const memberKey = await learnerUserHash(member);
    const participantRows = database.prepare("SELECT user_key,status,score,wrong_count FROM study_group_exam_participants WHERE run_id=? ORDER BY user_key").all(runId).map((row: Record<string, unknown>) => ({ ...row }));
    assert.deepEqual(participantRows, [
      { user_key: memberKey, status: "no_show", score: 0, wrong_count: 15 },
      { user_key: ownerKey, status: "auto_submitted", score: 1, wrong_count: 14 },
    ].sort((a, b) => a.user_key.localeCompare(b.user_key)));

    const result = await GET(new Request(`${origin}/api/group-exams?scope=result&runId=${runId}`, { headers: { "x-baeumzip-authenticated-user-email": owner } }));
    const resultText = await result.text();
    assert.equal(result.status, 200);
    const resultBody = JSON.parse(resultText) as { review: Array<{ explanation: string }>; ranking: Array<{ rank: number }> };
    assert.ok(resultBody.review.some((item) => item.explanation.length > 0));
    assert.equal(resultBody.ranking[0]?.rank, 1);

    const memberPublicId = String(database.prepare("SELECT public_id FROM study_group_members WHERE group_id=? AND user_key=?").get(groupId, memberKey)?.public_id);
    const transferred = await post(owner, { action: "owner-transfer", groupId, targetMembershipId: memberPublicId });
    assert.equal(transferred.result.status, 200);
    assert.equal(database.prepare("SELECT owner_user_key FROM study_groups WHERE id=?").get(groupId)?.owner_user_key, memberKey);
    database.prepare("UPDATE study_group_members SET status='left', left_at=? WHERE group_id=? AND user_key=?")
      .run(new Date().toISOString(), groupId, memberKey);
    const departedResult = await GET(new Request(`${origin}/api/group-exams?scope=result&runId=${runId}`, {
      headers: { "x-baeumzip-authenticated-user-email": member },
    }));
    const departedRanking = (await departedResult.json() as Record<string, unknown>).ranking as Record<string, unknown>[];
    assert.equal(departedRanking.length, 1);
    assert.equal(departedRanking[0].rank, 2, "departed participant keeps the frozen-roster rank before privacy filtering");
  } finally {
    database.close();
    globalThis.__BAEUMZIP_ENV__ = previous;
  }
});

test("a solo owner can persist settings, start immediately, time out, and read the ranked result", async () => {
  const database = openCanonicalTestDatabase(process.cwd());
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(database) as unknown as D1Database, SKCT_GROUP_SERVICE_ENABLED: "1" };
  try {
    await seedBank(database);
    const owner = "solo-owner@example.test";
    const created = await post(owner, {
      action: "group-create", name: "1인 검증 그룹", publicName: "혼자응시", memberLimit: 2,
    });
    assert.equal(created.result.status, 201);
    const groupId = String((created.body.group as Record<string, unknown>).id);
    const areaSeconds = { 언어이해: 1, 자료해석: 1, 창의수리: 1, 언어추리: 1, 수열추리: 1 };
    const saved = await post(owner, {
      action: "settings-update", groupId, expectedRevision: 0, memberLimit: 2, settings: { areaSeconds },
      idempotencyKey: "solo-settings-0001",
    });
    assert.equal(saved.result.status, 200);
    const detailResponse = await GET(new Request(`${origin}/api/group-exams?scope=group&groupId=${groupId}`, {
      headers: { "x-baeumzip-authenticated-user-email": owner },
    }));
    const detail = ((await detailResponse.json() as Record<string, unknown>).group as Record<string, unknown>);
    assert.equal(detail.revision, 1);
    assert.equal(detail.member_limit, 2);
    assert.deepEqual(JSON.parse(String(detail.settings_json)), { areaSeconds, autoNext: true, repeatPolicy: "allow" });

    const replayedSave = await post(owner, {
      action: "settings-update", groupId, expectedRevision: 0, memberLimit: 2, settings: { areaSeconds },
      idempotencyKey: "solo-settings-0001",
    });
    assert.equal(replayedSave.result.status, 200);
    assert.equal(database.prepare("SELECT revision FROM study_groups WHERE id=?").get(groupId)?.revision, 1);

    const staleSave = await post(owner, {
      action: "settings-update", groupId, expectedRevision: 0, memberLimit: 3, settings: { areaSeconds },
      idempotencyKey: "solo-settings-stale-0001",
    });
    assert.equal(staleSave.result.status, 409);
    assert.equal(staleSave.body.code, "GROUP_REVISION_CONFLICT");
    assert.equal(database.prepare("SELECT member_limit FROM study_groups WHERE id=?").get(groupId)?.member_limit, 2);

    const invalidCapacity = await post(owner, {
      action: "settings-update", groupId, expectedRevision: 1, memberLimit: 1, settings: { areaSeconds },
      idempotencyKey: "solo-settings-invalid-capacity-0001",
    });
    assert.equal(invalidCapacity.result.status, 400);
    const invalidTime = await post(owner, {
      action: "settings-update", groupId, expectedRevision: 1, memberLimit: 2,
      settings: { areaSeconds: { ...areaSeconds, 언어이해: 0 } },
      idempotencyKey: "solo-settings-invalid-time-0001",
    });
    assert.equal(invalidTime.result.status, 400);

    const started = await post(owner, {
      action: "run-start", groupId, mode: "immediate", idempotencyKey: "solo-start-0001",
    });
    assert.equal(started.result.status, 201);
    const runId = String((started.body.run as Record<string, unknown>).id);
    assert.equal(database.prepare("SELECT participant_count_snapshot FROM study_group_exam_runs WHERE id=?").get(runId)?.participant_count_snapshot, 1);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM study_group_exam_participants WHERE run_id=?").get(runId)?.count, 1);

    const countdown = await GET(new Request(`${origin}/api/group-exams?scope=current&groupId=${groupId}`, {
      headers: { "x-baeumzip-authenticated-user-email": owner },
    }));
    assert.equal((await countdown.json() as Record<string, unknown>).question, null);
    const openedAt = new Date(Date.now() - 1_000).toISOString();
    database.prepare("UPDATE study_group_exam_runs SET actual_started_at_utc=? WHERE id=?").run(openedAt, runId);
    database.prepare("UPDATE study_group_exam_question_public SET opens_at_utc=?, deadline_at_utc=? WHERE run_id=?")
      .run(openedAt, new Date(Date.now() + 60_000).toISOString(), runId);
    const current = await GET(new Request(`${origin}/api/group-exams?scope=current&groupId=${groupId}`, {
      headers: { "x-baeumzip-authenticated-user-email": owner },
    }));
    assert.equal(current.status, 200);
    const savedAnswer = await post(owner, {
      action: "answer-save", runId, position: 0, answers: [0], expectedRevision: 0,
      operationId: "solo-answer-0001",
    });
    assert.equal(savedAnswer.result.status, 200);

    const past = new Date(Date.now() - 1_000).toISOString();
    database.prepare("UPDATE study_group_exam_runs SET final_deadline_at_utc=? WHERE id=?").run(past, runId);
    database.prepare("UPDATE study_group_exam_question_public SET deadline_at_utc=? WHERE run_id=?").run(past, runId);
    assert.equal((await runGroupExamMaintenance(new Date())).finalized, 1);
    const result = await GET(new Request(`${origin}/api/group-exams?scope=result&runId=${runId}`, {
      headers: { "x-baeumzip-authenticated-user-email": owner },
    }));
    assert.equal(result.status, 200);
    const resultBody = await result.json() as Record<string, unknown>;
    const ranking = resultBody.ranking as Record<string, unknown>[];
    assert.equal(ranking.length, 1);
    assert.equal(ranking[0].rank, 1);
    assert.equal(ranking[0].self, true);
    assert.equal((resultBody.review as unknown[]).length, 15);
  } finally {
    database.close();
    globalThis.__BAEUMZIP_ENV__ = previous;
  }
});

test("scheduled run creation and cancel are stable 410 with zero side effects", async () => {
  const database = openCanonicalTestDatabase(process.cwd()); const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(database) as unknown as D1Database, SKCT_GROUP_SERVICE_ENABLED: "1" };
  try { await seedBank(database); const owner="schedule-owner@example.test";
    const created=await post(owner,{action:"group-create",name:"예약 폐지",publicName:"대표",memberLimit:2,idempotencyKey:"schedule-create-0001"});
    const groupId=String((created.body.group as Record<string,unknown>).id);
    const scheduled=await post(owner,{action:"run-start",groupId,mode:"scheduled",scheduledAt:new Date(Date.now()+60000).toISOString(),idempotencyKey:"schedule-test-0001"});
    assert.equal(scheduled.result.status,410);assert.equal((await post(owner,{action:"run-cancel",runId:"removed",idempotencyKey:"cancel-removed-0001"})).result.status,410);
    assert.equal(database.prepare("SELECT COUNT(*) n FROM study_group_exam_runs WHERE group_id=?").get(groupId)?.n,0);
  } finally { database.close(); globalThis.__BAEUMZIP_ENV__=previous; }
});

test("admin quota grants are atomic and idempotent", async () => {
  const database = openCanonicalTestDatabase(process.cwd());
  const previous = globalThis.__BAEUMZIP_ENV__;
  const admin = "admin@example.test";
  globalThis.__BAEUMZIP_ENV__ = {
    DB: sqliteD1(database) as unknown as D1Database,
    SKCT_GROUP_SERVICE_ENABLED: "1",
    ADMIN_EMAIL: admin,
  };
  try {
    const created = await post("quota-owner@example.test", {
      action: "group-create", name: "횟수 검증 그룹", publicName: "횟수대표", memberLimit: 3,
    });
    const groupId = String((created.body.group as Record<string, unknown>).id);
    const dateKey = "2099-01-02";
    const requestBody = { action: "quota-grant", groupId, dateKey, count: 2, expectedRevision: 0, idempotencyKey: "quota-grant-0001" };
    const granted = await postAdmin(admin, requestBody);
    assert.equal(granted.result.status, 200);
    assert.deepEqual(granted.body, { granted: 2, revision: 1 });
    const replayed = await postAdmin(admin, requestBody);
    assert.equal(replayed.result.status, 200);
    assert.deepEqual(replayed.body, granted.body);
    const slots = database.prepare(`
      SELECT slot_no, source, status FROM study_group_quota_slots
      WHERE group_id = ? AND date_key = ? ORDER BY slot_no
    `).all(groupId, dateKey).map((row: Record<string, unknown>) => ({ ...row }));
    assert.deepEqual(slots, [
      { slot_no: 1, source: "base", status: "available" },
      { slot_no: 2, source: "admin_grant", status: "available" },
      { slot_no: 3, source: "admin_grant", status: "available" },
    ]);
    assert.equal(database.prepare(`
      SELECT COUNT(*) AS count FROM study_group_quota_events
      WHERE group_id = ? AND date_key = ? AND event_type = 'admin_grant'
    `).get(groupId, dateKey)?.count, 1);

    const resetBody = { action: "quota-reset", groupId, dateKey, count: 1, expectedRevision: 1, idempotencyKey: "quota-reset-0001" };
    const reset = await postAdmin(admin, resetBody);
    assert.equal(reset.result.status, 200);
    assert.deepEqual(reset.body, { restored: 1, revision: 2 });
    assert.deepEqual((await postAdmin(admin, resetBody)).body, reset.body);
    assert.equal(database.prepare(`
      SELECT COUNT(*) AS count FROM study_group_quota_slots WHERE group_id=? AND date_key=?
    `).get(groupId, dateKey)?.count, 4, "quota reset adds one compensating slot without deleting history");

    const second = await post("quota-owner-2@example.test", {
      action: "group-create", name: "두번째 횟수 그룹", publicName: "두번째대표", memberLimit: 3,
    });
    const secondGroupId = String((second.body.group as Record<string, unknown>).id);
    const sameClientKey = await postAdmin(admin, { ...requestBody, groupId: secondGroupId });
    assert.equal(sameClientKey.result.status, 409);
    assert.equal(sameClientKey.body.code, "GROUP_IDEMPOTENCY_CONFLICT");
    assert.equal(database.prepare(`
      SELECT COUNT(*) AS count FROM study_group_quota_slots WHERE group_id=? AND date_key=?
    `).get(secondGroupId, dateKey)?.count, 0);
  } finally {
    database.close();
    globalThis.__BAEUMZIP_ENV__ = previous;
  }
});

test("quota grant and reset audit the live ledger inside the mutation batch", async () => {
  const database = openCanonicalTestDatabase(process.cwd());
  const previous = globalThis.__BAEUMZIP_ENV__;
  const admin = "quota-race-admin@example.test";
  globalThis.__BAEUMZIP_ENV__ = {
    DB: sqliteD1(database) as unknown as D1Database,
    SKCT_GROUP_SERVICE_ENABLED: "1",
    ADMIN_EMAIL: admin,
  };
  const originalGrant = GroupExamAdminRepository.prototype.grantQuota;
  let injected = false;
  GroupExamAdminRepository.prototype.grantQuota = async function (...args: Parameters<typeof originalGrant>) {
    if (!injected) {
      injected = true;
      const input = args[0];
      database.prepare(`
        UPDATE study_group_quota_slots
        SET status='consumed', revision=revision+1, updated_at=?
        WHERE group_id=? AND date_key=? AND slot_no=1 AND status='available'
      `).run(input.timestamp, input.groupId, input.dateKey);
    }
    return originalGrant.apply(this, args);
  };
  const ledger = (groupId: string, dateKey: string) => ({ ...database.prepare(`
    SELECT COUNT(*) total,
      COALESCE(SUM(status='available'),0) available,
      COALESCE(SUM(status='reserved'),0) reserved,
      COALESCE(SUM(status='consumed'),0) consumed
    FROM study_group_quota_slots WHERE group_id=? AND date_key=?
  `).get(groupId, dateKey) }) as Record<string, unknown>;
  try {
    const created = await post("quota-race-owner@example.test", {
      action: "group-create", name: "횟수 감사 경합", publicName: "경합대표", memberLimit: 2,
    });
    const groupId = String((created.body.group as Record<string, unknown>).id);
    const dateKey = "2099-02-01";
    database.prepare(`
      INSERT INTO study_group_quota_slots (
        group_id,date_key,slot_no,source,status,revision,created_at,updated_at
      ) VALUES (?,?,1,'base','available',0,?,?)
    `).run(groupId, dateKey, new Date().toISOString(), new Date().toISOString());

    const granted = await postAdmin(admin, {
      action: "quota-grant", groupId, dateKey, count: 1,
      expectedRevision: 0, idempotencyKey: "quota-race-grant-0001",
    });
    assert.equal(granted.result.status, 200);
    const afterGrant = ledger(groupId, dateKey);
    assert.deepEqual(afterGrant, { total: 2, available: 1, reserved: 0, consumed: 1 });
    const grantAudit = database.prepare(`
      SELECT before_summary,after_summary FROM admin_audit_logs
      WHERE target_id=? AND action='skct_group_quota_granted'
    `).get(groupId) as { before_summary: string; after_summary: string };
    assert.deepEqual(JSON.parse(grantAudit.before_summary).ledger,
      { total: 1, available: 0, reserved: 0, consumed: 1 });
    assert.deepEqual(JSON.parse(grantAudit.after_summary).ledger, afterGrant);

    const reset = await postAdmin(admin, {
      action: "quota-reset", groupId, dateKey, count: 1,
      expectedRevision: 1, idempotencyKey: "quota-race-reset-0001",
    });
    assert.equal(reset.result.status, 200);
    const afterReset = ledger(groupId, dateKey);
    assert.deepEqual(afterReset, { total: 3, available: 2, reserved: 0, consumed: 1 });
    const resetAudit = database.prepare(`
      SELECT before_summary,after_summary FROM admin_audit_logs
      WHERE target_id=? AND action='skct_group_quota_reset'
    `).get(groupId) as { before_summary: string; after_summary: string };
    assert.deepEqual(JSON.parse(resetAudit.before_summary).ledger, afterGrant);
    assert.deepEqual(JSON.parse(resetAudit.after_summary).ledger, afterReset);
  } finally {
    GroupExamAdminRepository.prototype.grantQuota = originalGrant;
    database.close();
    globalThis.__BAEUMZIP_ENV__ = previous;
  }
});

test("admin group mutations use revision CAS and write reconstructable before/after audit", async () => {
  const database = openCanonicalTestDatabase(process.cwd());
  const previous = globalThis.__BAEUMZIP_ENV__;
  const admin = "admin@example.test";
  globalThis.__BAEUMZIP_ENV__ = {
    DB: sqliteD1(database) as unknown as D1Database,
    SKCT_GROUP_SERVICE_ENABLED: "1",
    ADMIN_EMAIL: admin,
  };
  try {
    const created = await post("admin-race-owner@example.test", {
      action: "group-create", name: "관리자 CAS 검증", publicName: "CAS대표", memberLimit: 2,
    });
    const groupId = String((created.body.group as Record<string, unknown>).id);
    const [left, right] = await Promise.all([
      postAdmin(admin, { action: "question-count-set", groupId, count: 7, expectedRevision: 0, idempotencyKey: "admin-cas-left-0001" }),
      postAdmin(admin, { action: "question-count-set", groupId, count: 9, expectedRevision: 0, idempotencyKey: "admin-cas-right-0001" }),
    ]);
    assert.deepEqual([left.result.status, right.result.status].sort(), [200, 409]);
    const group = database.prepare("SELECT revision,admin_question_count_override count FROM study_groups WHERE id=?").get(groupId);
    assert.equal(group?.revision, 1);
    assert.ok(group?.count === 7 || group?.count === 9);
    const audits = database.prepare(`
      SELECT before_summary,after_summary FROM admin_audit_logs
      WHERE target_id=? AND action='skct_group_question_count_set'
    `).all(groupId) as Array<{ before_summary: string; after_summary: string }>;
    assert.equal(audits.length, 1);
    const before = JSON.parse(audits[0].before_summary) as Record<string, unknown>;
    const after = JSON.parse(audits[0].after_summary) as Record<string, unknown>;
    assert.deepEqual(before, { count: null, expectedRevision: 0 });
    assert.equal(after.resultRevision, 1);
    assert.match(String(after.executionId), /^[0-9a-f-]{36}$/u);
    assert.match(String(after.idempotencyKey), /^admin-cas-(?:left|right)-0001$/u);

    const staleQuota = await postAdmin(admin, {
      action: "quota-grant", groupId, dateKey: "2099-02-01", count: 2,
      expectedRevision: 0, idempotencyKey: "admin-cas-stale-quota-0001",
    });
    assert.equal(staleQuota.result.status, 409);
    assert.equal(staleQuota.body.code, "GROUP_ADMIN_REVISION_CONFLICT");
    assert.equal(database.prepare("SELECT COUNT(*) count FROM study_group_quota_slots WHERE group_id=? AND date_key='2099-02-01'").get(groupId)?.count, 0);
  } finally {
    database.close();
    globalThis.__BAEUMZIP_ENV__ = previous;
  }
});

test("maintenance cancels and refunds a legacy future schedule exactly once", async () => {
  const database=openCanonicalTestDatabase(process.cwd());const previous=globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__={DB:sqliteD1(database) as unknown as D1Database,SKCT_GROUP_SERVICE_ENABLED:"1"};
  try {await seedBank(database);const owner="legacy-schedule@example.test";const created=await post(owner,{action:"group-create",name:"기존 예약",publicName:"대표",memberLimit:2,idempotencyKey:"legacy-create-0001"});const groupId=String((created.body.group as Record<string,unknown>).id);const started=await post(owner,{action:"run-start",groupId,mode:"immediate",idempotencyKey:"legacy-start-0001"});const runId=String((started.body.run as Record<string,unknown>).id);
    database.prepare("DELETE FROM study_group_active_runs WHERE run_id=?").run(runId);database.prepare("DELETE FROM study_group_exam_participants WHERE run_id=?").run(runId);database.prepare("UPDATE study_group_exam_runs SET status='scheduled',scheduled_at_utc=?,actual_started_at_utc=NULL,final_deadline_at_utc=NULL WHERE id=?").run(new Date(Date.now()+3600000).toISOString(),runId);database.prepare("UPDATE study_group_quota_slots SET status='reserved',reserved_run_id=? WHERE group_id=?").run(runId,groupId);
    await runGroupExamMaintenance();await runGroupExamMaintenance();assert.equal(database.prepare("SELECT status FROM study_group_exam_runs WHERE id=?").get(runId)?.status,"canceled");assert.equal(database.prepare("SELECT status FROM study_group_quota_slots WHERE reserved_run_id IS NULL AND group_id=?").get(groupId)?.status,"available");assert.equal(database.prepare("SELECT COUNT(*) n FROM study_group_quota_events WHERE run_id=? AND idempotency_key LIKE '%schedule-feature-removed-refund'").get(runId)?.n,1);
  } finally {database.close();globalThis.__BAEUMZIP_ENV__=previous;}
});

test("future schedule polling never activates a removed feature", async () => {
  const source = await import("node:fs").then(fs=>fs.readFileSync("apps/backend/src/modules/group-exams/group-exam.service.ts","utf8"));
  assert.match(source,/scheduledRunsForDeprecation/);assert.doesNotMatch(source.slice(source.indexOf("runGroupExamMaintenance")),/activateScheduledRun/);
});

test("canonical sync, TTL presence, and admin group controls preserve membership and exam boundaries", async () => {
  const database = openCanonicalTestDatabase(process.cwd());
  const previous = globalThis.__BAEUMZIP_ENV__;
  const admin = "group-admin@example.test";
  globalThis.__BAEUMZIP_ENV__ = {
    DB: sqliteD1(database) as unknown as D1Database,
    SKCT_GROUP_SERVICE_ENABLED: "1",
    ADMIN_EMAIL: admin,
  };
  try {
    await seedBank(database);
    const owner = "sync-owner@example.test";
    const member = "sync-member@example.test";
    const created = await post(owner, { action: "group-create", name: "동기화 검증 그룹", publicName: "동기대표", memberLimit: 3 });
    const groupId = String((created.body.group as Record<string, unknown>).id);
    const invited = await post(owner, { action: "invite-create", groupId });
    await post(member, { action: "invite-accept", token: (invited.body.invite as Record<string, unknown>).token, publicName: "동기회원" });

    const idle = await GET(new Request(`${origin}/api/group-exams?scope=sync&groupId=${groupId}`, {
      headers: { "x-baeumzip-authenticated-user-email": member },
    }));
    assert.equal(idle.status, 200);
    assert.equal((await idle.json() as Record<string, unknown>).phase, "idle");

    const heartbeat = await post(owner, {
      action: "presence-heartbeat", groupId, sessionId: "presence:test-owner-session", pageContext: "lobby", visible: true,
    });
    assert.equal(heartbeat.result.status, 200);
    const afterHeartbeat = await GET(new Request(`${origin}/api/group-exams?scope=sync&groupId=${groupId}`, {
      headers: { "x-baeumzip-authenticated-user-email": member },
    }));
    const presence = (await afterHeartbeat.json() as Record<string, unknown>).presence as Record<string, unknown>[];
    assert.equal(presence.filter((row) => row.online).length, 1);
    assert.equal(presence.filter((row) => row.presence_state === "online").length, 1);
    assert.equal(presence.some((row) => "user_key" in row), false);
    assert.equal(presence.some((row) => "last_seen_at" in row), false);

    assert.equal((await post(owner, {
      action: "presence-heartbeat", groupId, sessionId: "presence:test-owner-session", pageContext: "lobby", visible: false,
    })).result.status, 200);
    const recentlyLeftResponse = await GET(new Request(`${origin}/api/group-exams?scope=sync&groupId=${groupId}`, {
      headers: { "x-baeumzip-authenticated-user-email": member },
    }));
    const recentlyLeft = (await recentlyLeftResponse.json() as Record<string, unknown>).presence as Record<string, unknown>[];
    assert.equal(recentlyLeft.find((row) => row.presence_state === "recent")?.public_name, "동기대표");
    assert.equal(recentlyLeft.some((row) => "last_seen_at" in row), false, "presence exposes only a coarse state");

    const started = await post(owner, { action: "run-start", groupId, mode: "immediate", idempotencyKey: "sync-start-0001" });
    assert.equal(started.result.status, 201);
    const runId = String((started.body.run as Record<string, unknown>).id);
    const memberSyncResponse = await GET(new Request(`${origin}/api/group-exams?scope=sync&groupId=${groupId}`, {
      headers: { "x-baeumzip-authenticated-user-email": member },
    }));
    const memberSyncText = await memberSyncResponse.text();
    assert.equal(memberSyncResponse.status, 200);
    assert.match(memberSyncText, new RegExp(runId, "u"));
    assert.doesNotMatch(memberSyncText, /correct_answers|explanation|created_by_user_key|user_key/u);
    const selection = JSON.parse(String(database.prepare("SELECT settings_snapshot_json FROM study_group_exam_runs WHERE id=?").get(runId)?.settings_snapshot_json)).selection;
    assert.equal(selection.algorithm, "bundle-sha256-v1");
    assert.equal(selection.repeatPolicy, "allow");
    assert.match(selection.selectedQuestionUidsSha256, /^[a-f0-9]{64}$/u);
    assert.match(selection.historyDigestSha256, /^[a-f0-9]{64}$/u);
    assert.match(selection.snapshotDigestSha256, /^[a-f0-9]{64}$/u);
    assert.equal(selection.repeatFallback, false);
    assert.equal(selection.settingsSchemaVersion, 1);
    const durableSelection = database.prepare(`
      SELECT algorithm_version, seed, history_cutoff_utc, history_digest_sha256,
             snapshot_digest_sha256, repeat_policy, repeat_fallback, area_policy,
             settings_schema_version
      FROM study_group_exam_selection_metadata WHERE run_id=?
    `).get(runId) as Record<string, unknown>;
    assert.equal(durableSelection.algorithm_version, selection.algorithm);
    assert.equal(durableSelection.seed, selection.seed);
    assert.equal(durableSelection.history_cutoff_utc, selection.historyCutoffUtc);
    assert.equal(durableSelection.history_digest_sha256, selection.historyDigestSha256);
    assert.equal(durableSelection.snapshot_digest_sha256, selection.snapshotDigestSha256);
    assert.equal(durableSelection.repeat_policy, "allow");
    assert.equal(durableSelection.repeat_fallback, 0);
    assert.equal(durableSelection.area_policy, selection.areaPolicy);
    assert.equal(durableSelection.settings_schema_version, 1);

    const denied = await GET_ADMIN(new Request(`${origin}/api/group-exams/admin?page=1`, {
      headers: { "x-baeumzip-authenticated-user-email": member },
    }));
    assert.equal(denied.status, 403);
    const listed = await GET_ADMIN(new Request(`${origin}/api/group-exams/admin?page=1&pageSize=20`, {
      headers: { "x-baeumzip-authenticated-user-email": admin },
    }));
    assert.equal(listed.status, 200);
    const listedBody = await listed.json() as Record<string, unknown>;
    assert.equal((listedBody.groups as Record<string, unknown>[])[0].id, groupId);
    assert.equal((listedBody.bank as Record<string, unknown>).perAreaTenReady, true);

    assert.equal((await postAdmin(admin, { action: "question-count-set", groupId, count: 9, expectedRevision: 0 })).result.status, 200);
    assert.equal(database.prepare("SELECT admin_question_count_override value FROM study_groups WHERE id=?").get(groupId)?.value, 9);
    assert.equal((await postAdmin(admin, { action: "question-count-reset", groupId, expectedRevision: 1 })).result.status, 200);
    assert.equal(database.prepare("SELECT admin_question_count_override value FROM study_groups WHERE id=?").get(groupId)?.value, null);
  } finally {
    database.close();
    globalThis.__BAEUMZIP_ENV__ = previous;
  }
});
