import { activateApprovedGroupBank } from "./helpers/approved-group-bank";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";
import { sqliteD1 } from "./helpers/sqlite-d1.mjs";
import { POST } from "../apps/backend/src/modules/group-exams/group-exam.service";
import { GroupExamRepository, type MutationIdempotency, type RunRow } from "../apps/backend/src/modules/group-exams/group-exam.repository";
import { GroupExamAdminRepository } from "../apps/backend/src/modules/group-exams/group-exam-admin.repository";

const origin = "https://example.test";
function request(email: string, body: Record<string, unknown>) {
  return new Request(`${origin}/api/group-exams`, {
    method: "POST",
    headers: { "content-type": "application/json", origin,
      "x-baeumzip-authenticated-user-email": email, "x-sql-study-user-request": "1" },
    body: JSON.stringify(body),
  });
}
async function post(email: string, body: Record<string, unknown>) {
  const response = await POST(request(email, body));
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}
async function seedBank(database: ReturnType<typeof openCanonicalTestDatabase>) {
  await activateApprovedGroupBank(database);
}

test("every idempotent group mutation gates its success row on an exact operation marker", () => {
  const sources = [
    readFileSync("apps/backend/src/modules/group-exams/group-exam.repository.ts", "utf8"),
    readFileSync("apps/backend/src/modules/group-exams/group-exam-admin.repository.ts", "utf8"),
  ];
  const combinedSource = sources.join("\n");
  assert.doesNotMatch(combinedSource, /\bidempotencyStatement\(/u);
  const methods = [
    "createGroup", "createInvite", "rotateInvite", "revokeInvite", "acceptInvite",
    "updateGroupSettings", "kickMember", "transferOwner", "leaveGroup",
    "cancelScheduledRun", "submitParticipant", "grantQuota", "setQuestionCountOverride",
  ];
  for (const method of methods) {
    const source = sources.find((candidate) => candidate.includes(`async ${method}(`)) ?? "";
    const start = source.indexOf(`async ${method}(`);
    const genericNext = source.indexOf("\n  async ", start + 1);
    const end = genericNext > start ? genericNext : source.length;
    const body = source.slice(start, end);
    assert.ok(start >= 0, `${method} missing`);
    assert.match(body, /idempotencyStatementWhen/u, `${method} has no conditional success row`);
    assert.match(body, method === "grantQuota" ? /study_group_quota_events/u : /last_mutation_execution_id/u,
      `${method} is not bound to its exact operation marker`);
  }
  assert.doesNotMatch(combinedSource, /DELETE FROM study_group_idempotency/u);
});

test("guarded no-op mutation matrix leaves no success response, event, or audit row", async () => {
  const database = openCanonicalTestDatabase(process.cwd());
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(database) as unknown as D1Database, SKCT_GROUP_SERVICE_ENABLED: "1" };
  const repository = new GroupExamRepository();
  const adminRepository = new GroupExamAdminRepository();
  const timestamp = "2026-09-19T00:00:00.000Z";
  const idem = (action: string): MutationIdempotency => ({
    actorUserKey: "missing-actor", action, key: `${action}-missing-0001`,
    requestDigest: action.padEnd(64, "0").slice(0, 64), executionId: crypto.randomUUID(),
    responseStatus: 200, response: { ok: true }, timestamp,
  });
  const fakeInvite = {
    id: "missing-invite", group_id: "missing-group", token_digest: "missing-digest",
    status: "active" as const, expires_at: "2026-09-20T00:00:00.000Z",
    created_by_user_key: "missing-actor", consumed_by_user_key: null,
    created_at: timestamp, consumed_at: null, revoked_at: null, revision: 0,
  };
  const fakeRun: RunRow = {
    id: "missing-run", group_id: "missing-group", start_request_id: "missing-start",
    mode: "scheduled", status: "scheduled", scheduled_at_utc: "2026-09-20T00:00:00.000Z",
    actual_started_at_utc: null, quota_date_key: "2026-09-20", quota_slot_no: 1,
    question_count_snapshot: 15, settings_snapshot_json: "{}", source_release_id: "missing-release",
    source_release_sha256: "0".repeat(64), participant_count_snapshot: 0,
    final_deadline_at_utc: null, lease_owner: null, lease_until: null, revision: 0,
    created_by_user_key: "missing-actor", created_at: timestamp, completed_at: null,
    canceled_at: null, failure_code: null,
  };
  try {
    assert.equal(await repository.createInvite({ id: "new-invite", groupId: "missing-group",
      digest: "new-digest", expiresAt: fakeInvite.expires_at, actorUserKey: "missing-actor",
      timestamp, idempotency: idem("invite-create") }), null);
    assert.equal(await repository.rotateInvite({ previous: fakeInvite, nextId: "next-invite",
      nextDigest: "next-digest", expiresAt: fakeInvite.expires_at, actorUserKey: "missing-actor",
      timestamp, idempotency: idem("invite-resend") }), null);
    assert.equal(await repository.revokeInvite(fakeInvite.id, fakeInvite.group_id, "missing-actor",
      timestamp, idem("invite-revoke")), false);
    assert.equal((await repository.acceptInvite({ invite: fakeInvite, userKey: "missing-user",
      publicId: "missing-public", publicName: "missing", timestamp,
      idempotency: idem("invite-accept") })).accepted, false);
    assert.equal(await repository.updateGroupSettings({ groupId: "missing-group", actorUserKey: "missing-actor",
      expectedRevision: 0, memberLimit: 2, settingsJson: "{}", timestamp,
      idempotency: idem("settings-update") }), false);
    assert.equal(await repository.kickMember({ groupId: "missing-group", actorUserKey: "missing-actor",
      targetMembershipId: "missing-public", timestamp, idempotency: idem("member-kick") }), false);
    assert.equal(await repository.transferOwner({ groupId: "missing-group", actorUserKey: "missing-actor",
      targetMembershipId: "missing-public", timestamp, idempotency: idem("owner-transfer") }), false);
    assert.equal(await repository.leaveGroup({ groupId: "missing-group", userKey: "missing-user",
      timestamp, idempotency: idem("group-leave") }), "missing");
    assert.equal(await repository.cancelScheduledRun(fakeRun, "missing-actor", timestamp,
      idem("run-cancel")), false);
    assert.equal(await repository.submitParticipant("missing-run", "missing-user", timestamp,
      idem("run-submit")), false);
    assert.equal(await adminRepository.setQuestionCountOverride("missing-group", 15, "admin-hash", timestamp,
      idem("question-count-set"), 0, null), false);
    for (const table of ["study_group_idempotency", "study_group_audit_events", "study_group_membership_events"]) {
      assert.equal(database.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 0, table);
    }
  } finally {
    database.close();
    globalThis.__BAEUMZIP_ENV__ = previous;
  }
});

test("initial and forced-race replay run DTOs share only the public projection", async () => {
  const database = openCanonicalTestDatabase(process.cwd());
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(database) as unknown as D1Database, SKCT_GROUP_SERVICE_ENABLED: "1" };
  const createRunOriginal = GroupExamRepository.prototype.createRun;
  let arrivals = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  GroupExamRepository.prototype.createRun = async function (...args: Parameters<typeof createRunOriginal>) {
    arrivals += 1;
    if (arrivals === 2) release();
    await gate;
    return createRunOriginal.apply(this, args);
  };
  try {
    await seedBank(database);
    const owner = "dto-race-owner@example.test";
    const created = await post(owner, { action: "group-create", name: "dto race", publicName: "owner", memberLimit: 2, idempotencyKey: "dto-race-create-0001" });
    const groupId = String((created.body.group as Record<string, unknown>).id);
    const body = { action: "run-start", groupId, mode: "immediate", idempotencyKey: "dto-race-start-0001" };
    const [a, b] = await Promise.all([post(owner, body), post(owner, body)]);
    assert.equal(arrivals, 2);
    assert.equal(a.status, 201); assert.equal(b.status, 201);
    assert.deepEqual([a.body.replayed, b.body.replayed].sort(), [false, true]);
    for (const item of [a.body, b.body]) {
      const run = item.run as Record<string, unknown>;
      for (const internal of ["created_by_user_key", "lease_owner", "lease_until", "source_release_id", "source_release_sha256", "settings_snapshot_json", "start_request_id"]) {
        assert.equal(run[internal], undefined, `${internal} leaked: ${JSON.stringify(item)}`);
      }
    }
    assert.deepEqual(a.body.run, b.body.run);
  } finally {
    release?.();
    GroupExamRepository.prototype.createRun = createRunOriginal;
    database.close();
    globalThis.__BAEUMZIP_ENV__ = previous;
  }
});

test("failed final-owner mutation must never publish a transient success replay", async () => {
  const database = openCanonicalTestDatabase(process.cwd());
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(database) as unknown as D1Database, SKCT_GROUP_SERVICE_ENABLED: "1" };
  const rotateOriginal = GroupExamRepository.prototype.rotateInvite;
  const discardOriginal = GroupExamRepository.prototype.discardIdempotent;
  let rotateEnteredResolve!: () => void;
  let rotateReleaseResolve!: () => void;
  let discardEnteredResolve!: () => void;
  let discardReleaseResolve!: () => void;
  const rotateEntered = new Promise<void>((resolve) => { rotateEnteredResolve = resolve; });
  const rotateRelease = new Promise<void>((resolve) => { rotateReleaseResolve = resolve; });
  const discardEntered = new Promise<void>((resolve) => { discardEnteredResolve = resolve; });
  const discardRelease = new Promise<void>((resolve) => { discardReleaseResolve = resolve; });
  GroupExamRepository.prototype.rotateInvite = async function (...args: Parameters<typeof rotateOriginal>) {
    if (args[0].idempotency.key === "window-resend-0001") {
      rotateEnteredResolve();
      await rotateRelease;
    }
    return rotateOriginal.apply(this, args);
  };
  GroupExamRepository.prototype.discardIdempotent = async function (...args: Parameters<typeof discardOriginal>) {
    if (args[0].key === "window-resend-0001") {
      discardEnteredResolve();
      await discardRelease;
    }
    return discardOriginal.apply(this, args);
  };
  try {
    const owner = "window-owner@example.test";
    const member = "window-member@example.test";
    const created = await post(owner, { action: "group-create", name: "window group", publicName: "owner", memberLimit: 3, idempotencyKey: "window-create-0001" });
    assert.equal(created.status, 201);
    const groupId = String((created.body.group as Record<string, unknown>).id);
    const joinInvite = await post(owner, { action: "invite-create", groupId, idempotencyKey: "window-invite-0001" });
    await post(member, { action: "invite-accept", token: String((joinInvite.body.invite as Record<string, unknown>).token), publicName: "member", idempotencyKey: "window-accept-0001" });
    const pending = await post(owner, { action: "invite-create", groupId, idempotencyKey: "window-invite-0002" });
    const inviteId = String((pending.body.invite as Record<string, unknown>).id);
    const memberPublicId = String(database.prepare("SELECT public_id FROM study_group_members WHERE group_id=? AND public_name='member'").get(groupId).public_id);
    const retryBody = { action: "invite-resend", inviteId, idempotencyKey: "window-resend-0001" };
    const originalRequest = post(owner, retryBody);
    await rotateEntered;
    const transferred = await post(owner, { action: "owner-transfer", groupId, targetMembershipId: memberPublicId, idempotencyKey: "window-transfer-0001" });
    assert.equal(transferred.status, 200);
    rotateReleaseResolve();
    await discardEntered;
    const transientRow = database.prepare("SELECT response_status, response_json FROM study_group_idempotency WHERE actor_user_key=(SELECT user_key FROM study_group_members WHERE group_id=? AND public_name='owner') AND action='invite-resend' AND idempotency_key=?").get(groupId, "window-resend-0001");
    assert.equal(transientRow, undefined, "failed mutation must not publish a success idempotency row");
    const retry = await post(owner, retryBody);
    discardReleaseResolve();
    const originalResult = await originalRequest;
    assert.notEqual(originalResult.status, 200, JSON.stringify(originalResult));
    assert.notEqual(retry.status, 200, `same-key retry replayed a failed success: ${JSON.stringify(retry)}`);
    assert.equal(database.prepare("SELECT COUNT(*) n FROM study_group_idempotency WHERE action='invite-resend' AND idempotency_key='window-resend-0001'").get().n, 0);
    assert.equal(database.prepare("SELECT COUNT(*) n FROM study_group_audit_events WHERE group_id=? AND action='invite-resend'").get(groupId).n, 0);
    assert.equal(database.prepare("SELECT COUNT(*) n FROM study_group_invites WHERE group_id=? AND status='active'").get(groupId).n, 1);

    const newOwnerBody = { action: "invite-resend", inviteId, idempotencyKey: "window-resend-new-owner-0001" };
    const valid = await post(member, newOwnerBody);
    const validReplay = await post(member, newOwnerBody);
    assert.equal(valid.status, 200, JSON.stringify(valid));
    assert.deepEqual(validReplay, valid);
    assert.ok((valid.body.invite as Record<string, unknown>).token);
    const changedPayload = await post(member, { ...newOwnerBody, inviteId: crypto.randomUUID() });
    assert.equal(changedPayload.status, 409);
  } finally {
    rotateReleaseResolve?.();
    discardReleaseResolve?.();
    GroupExamRepository.prototype.rotateInvite = rotateOriginal;
    GroupExamRepository.prototype.discardIdempotent = discardOriginal;
    database.close();
    globalThis.__BAEUMZIP_ENV__ = previous;
  }
});

test("an audit INSERT execution fault rolls mutation, event, and idempotency back together", async () => {
  const database = openCanonicalTestDatabase(process.cwd());
  const previous = globalThis.__BAEUMZIP_ENV__;
  type FaultableStatement = D1PreparedStatement & { execute: () => D1Result<unknown> };
  const base = sqliteD1(database) as unknown as {
    prepare: (sql: string) => FaultableStatement;
    batch: D1Database["batch"];
  };
  let failAuditExecution = false;
  const faulting = {
    prepare(sql: string) {
      const statement = base.prepare(sql);
      if (sql.includes("INSERT INTO study_group_audit_events")) {
        const execute = statement.execute.bind(statement);
        statement.execute = () => {
          if (failAuditExecution) throw new Error("synthetic audit INSERT execution fault");
          return execute();
        };
      }
      return statement;
    },
    batch: base.batch.bind(base),
  };
  globalThis.__BAEUMZIP_ENV__ = { DB: faulting as unknown as D1Database, SKCT_GROUP_SERVICE_ENABLED: "1" };
  try {
    const owner = "batch-owner@example.test";
    const member = "batch-member@example.test";
    const created = await post(owner, { action: "group-create", name: "batch group", publicName: "owner", memberLimit: 2, idempotencyKey: "batch-create-0001" });
    const groupId = String((created.body.group as Record<string, unknown>).id);
    const invited = await post(owner, { action: "invite-create", groupId, idempotencyKey: "batch-invite-0001" });
    await post(member, { action: "invite-accept", token: String((invited.body.invite as Record<string, unknown>).token), publicName: "member", idempotencyKey: "batch-accept-0001" });
    const memberPublicId = String(database.prepare("SELECT public_id FROM study_group_members WHERE group_id=? AND public_name='member'").get(groupId).public_id);
    const ownerKeyBefore = String(database.prepare("SELECT owner_user_key FROM study_groups WHERE id=?").get(groupId).owner_user_key);
    failAuditExecution = true;
    const transferred = await post(owner, { action: "owner-transfer", groupId, targetMembershipId: memberPublicId, idempotencyKey: "batch-transfer-0001" });
    assert.equal(transferred.status, 500, JSON.stringify(transferred));
    assert.equal(database.prepare("SELECT owner_user_key FROM study_groups WHERE id=?").get(groupId).owner_user_key, ownerKeyBefore);
    assert.equal(database.prepare("SELECT COUNT(*) n FROM study_group_membership_events WHERE group_id=? AND event_type='owner_transferred'").get(groupId).n, 0);
    assert.equal(database.prepare("SELECT COUNT(*) n FROM study_group_audit_events WHERE group_id=? AND action='owner-transfer'").get(groupId).n, 0);
    assert.equal(database.prepare("SELECT COUNT(*) n FROM study_group_idempotency WHERE action='owner-transfer' AND idempotency_key='batch-transfer-0001'").get().n, 0);
  } finally {
    database.close();
    globalThis.__BAEUMZIP_ENV__ = previous;
  }
});
