import { activateApprovedGroupBank } from "./helpers/approved-group-bank";
import assert from "node:assert/strict";
import test from "node:test";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";
import { sqliteD1 } from "./helpers/sqlite-d1.mjs";
import { GET, POST, POST_ADMIN } from "../apps/backend/src/modules/group-exams/group-exam.service";

const origin = "https://example.test";

function request(email: string, body: Record<string, unknown>, admin = false) {
  return new Request(`${origin}/api/group-exams${admin ? "/admin" : ""}`, {
    method: "POST",
    headers: {
      "content-type": "application/json", origin,
      "x-baeumzip-authenticated-user-email": email,
      [admin ? "x-sql-study-admin-request" : "x-sql-study-user-request"]: "1",
    },
    body: JSON.stringify(body),
  });
}

async function post(email: string, body: Record<string, unknown>) {
  const response = await POST(request(email, body));
  return { response, body: await response.json() as Record<string, unknown> };
}

async function seedBank(database: ReturnType<typeof openCanonicalTestDatabase>) {
  await activateApprovedGroupBank(database);
}

test("public DTOs redact user keys and mutation retries return the original response exactly once", async () => {
  const database = openCanonicalTestDatabase(process.cwd());
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(database) as unknown as D1Database,
    SKCT_GROUP_SERVICE_ENABLED: "1", ADMIN_EMAIL: "admin@example.test" };
  try {
    const owner = "privacy-owner@example.test";
    const member = "privacy-member@example.test";
    const created = await post(owner, { action: "group-create", name: "공개 DTO", publicName: "대표",
      memberLimit: 2, idempotencyKey: "create-audit-0001" });
    assert.equal(created.response.status, 201);
    assert.equal((created.body.group as Record<string, unknown>).owner_user_key, undefined);
    const groupId = String((created.body.group as Record<string, unknown>).id);
    const invite = await post(owner, { action: "invite-create", groupId, idempotencyKey: "invite-audit-0001" });
    const inviteReplay = await post(owner, { action: "invite-create", groupId, idempotencyKey: "invite-audit-0001" });
    assert.deepEqual(inviteReplay.body, invite.body);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM study_group_invites WHERE group_id=?").get(groupId)?.count, 1);
    const token = String((invite.body.invite as Record<string, unknown>).token);
    const acceptBody = { action: "invite-accept", token, publicName: "참가자", idempotencyKey: "accept-audit-0001" };
    const accepted = await post(member, acceptBody);
    const acceptReplay = await post(member, acceptBody);
    assert.equal(accepted.response.status, 200);
    assert.deepEqual(acceptReplay.body, accepted.body);
    const conflict = await post(member, { ...acceptBody, publicName: "다른 이름" });
    assert.equal(conflict.response.status, 409);
    const lobbyResponse = await GET(new Request(`${origin}/api/group-exams?scope=group&groupId=${groupId}`,
      { headers: { "x-baeumzip-authenticated-user-email": owner } }));
    const lobby = await lobbyResponse.json() as Record<string, unknown>;
    assert.equal((lobby.group as Record<string, unknown>).owner_user_key, undefined);
    for (const row of lobby.members as Record<string, unknown>[]) {
      assert.equal(row.user_key, undefined);
      assert.equal(row.member_id, undefined);
      assert.match(String(row.membership_id), /^[0-9a-f-]{36}$/u);
    }
    const adminBody = { action: "question-count-set", groupId, count: 15, expectedRevision: 0, idempotencyKey: "question-count-audit-0001" };
    const first = await POST_ADMIN(request("admin@example.test", adminBody, true));
    const second = await POST_ADMIN(request("admin@example.test", adminBody, true));
    assert.equal(first.status, 200); assert.equal(second.status, 200);
    assert.equal(database.prepare("SELECT revision FROM study_groups WHERE id=?").get(groupId)?.revision, 1);
    const concurrentBody = { action: "question-count-set", groupId, count: 14, expectedRevision: 1, idempotencyKey: "question-count-audit-0002" };
    const [concurrentA, concurrentB] = await Promise.all([
      POST_ADMIN(request("admin@example.test", concurrentBody, true)),
      POST_ADMIN(request("admin@example.test", concurrentBody, true)),
    ]);
    assert.equal(concurrentA.status, 200); assert.equal(concurrentB.status, 200);
    assert.deepEqual(await concurrentA.json(), await concurrentB.json());
    assert.equal(database.prepare("SELECT revision FROM study_groups WHERE id=?").get(groupId)?.revision, 2);
    const memberRow = database.prepare("SELECT user_key, public_id FROM study_group_members WHERE group_id=? AND public_name='참가자'").get(groupId) as Record<string, unknown>;
    database.prepare("UPDATE study_group_members SET status='left', left_at=CURRENT_TIMESTAMP WHERE group_id=? AND user_key=?")
      .run(groupId, memberRow.user_key);
    const staleTransfer = await post(owner, { action: "owner-transfer", groupId,
      targetMembershipId: memberRow.public_id, idempotencyKey: "transfer-audit-0001" });
    assert.equal(staleTransfer.response.status, 409);
    assert.equal(database.prepare("SELECT owner_user_key FROM study_groups WHERE id=?").get(groupId)?.owner_user_key,
      database.prepare("SELECT user_key FROM study_group_members WHERE group_id=? AND public_name='대표'").get(groupId)?.user_key);
  } finally { database.close(); globalThis.__BAEUMZIP_ENV__ = previous; }
});

test("submitted current view is a server-clock waiting state and submit replay is identical", async () => {
  const database = openCanonicalTestDatabase(process.cwd());
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(database) as unknown as D1Database, SKCT_GROUP_SERVICE_ENABLED: "1" };
  try {
    await seedBank(database);
    const owner = "submit-owner@example.test";
    const member = "submit-member@example.test";
    const created = await post(owner, { action: "group-create", name: "제출 복구", publicName: "대표", memberLimit: 2, idempotencyKey: "submit-create-0001" });
    const groupId = String((created.body.group as Record<string, unknown>).id);
    const invited = await post(owner, { action: "invite-create", groupId, idempotencyKey: "submit-invite-0001" });
    const token = String((invited.body.invite as Record<string, unknown>).token);
    await post(member, { action: "invite-accept", token, publicName: "참가자", idempotencyKey: "submit-accept-0001" });
    const started = await post(owner, { action: "run-start", groupId, mode: "immediate", idempotencyKey: "submit-start-0001" });
    const runId = String((started.body.run as Record<string, unknown>).id);
    const submitBody = { action: "run-submit", runId, idempotencyKey: "submit-operation-0001" };
    const beforeCountdown = await post(owner, submitBody);
    assert.equal(beforeCountdown.response.status, 409);
    const startedAt = new Date(Date.now() - 1_000).toISOString();
    database.prepare("UPDATE study_group_exam_runs SET actual_started_at_utc=? WHERE id=?").run(startedAt, runId);
    database.prepare("UPDATE study_group_exam_question_public SET opens_at_utc=?, deadline_at_utc=? WHERE run_id=?")
      .run(startedAt, new Date(Date.now() + 60_000).toISOString(), runId);
    const submitted = await post(owner, submitBody);
    const replay = await post(owner, submitBody);
    assert.equal(submitted.response.status, 200); assert.equal(replay.response.status, 200);
    assert.deepEqual(replay.body, submitted.body);
    const current = await GET(new Request(`${origin}/api/group-exams?scope=current&groupId=${groupId}`,
      { headers: { "x-baeumzip-authenticated-user-email": owner } }));
    const currentBody = await current.json() as Record<string, unknown>;
    assert.equal(currentBody.participantStatus, "submitted");
    assert.equal(currentBody.question, null);
    assert.match(String(currentBody.serverNow), /^\d{4}-\d{2}-\d{2}T/u);
  } finally { database.close(); globalThis.__BAEUMZIP_ENV__ = previous; }
});

test("scheduled creation and cancel endpoints are permanently unavailable", async () => {
  const database = openCanonicalTestDatabase(process.cwd());
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(database) as unknown as D1Database, SKCT_GROUP_SERVICE_ENABLED: "1" };
  try {
    await seedBank(database);
    const owner = "archived-owner@example.test";
    const created = await post(owner, { action: "group-create", name: "예약 폐지", publicName: "대표", memberLimit: 2,
      idempotencyKey: "archive-create-0001" });
    const groupId = String((created.body.group as Record<string, unknown>).id);
    const scheduled = await post(owner, { action: "run-start", groupId, mode: "scheduled", scheduledAt: new Date(Date.now()+60000).toISOString(),
      idempotencyKey: "archive-start-0001" });
    assert.equal(scheduled.response.status, 410);
    const canceled = await post(owner, { action: "run-cancel", runId: "removed-schedule", idempotencyKey: "archive-cancel-0001" });
    assert.equal(canceled.response.status, 410);
    assert.equal(database.prepare("SELECT COUNT(*) n FROM study_group_exam_runs WHERE group_id=?").get(groupId)?.n, 0);
  } finally { database.close(); globalThis.__BAEUMZIP_ENV__ = previous; }
});
