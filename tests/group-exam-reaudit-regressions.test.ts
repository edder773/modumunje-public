import { activateApprovedGroupBank } from "./helpers/approved-group-bank";
import assert from "node:assert/strict";
import test from "node:test";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";
import { sqliteD1 } from "./helpers/sqlite-d1.mjs";
import { POST } from "../apps/backend/src/modules/group-exams/group-exam.service";
import { GroupExamRepository } from "../apps/backend/src/modules/group-exams/group-exam.repository";

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

test("concurrent immediate run-start with one idempotency key converges", async () => {
  const database = openCanonicalTestDatabase(process.cwd());
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(database) as unknown as D1Database, SKCT_GROUP_SERVICE_ENABLED: "1" };
  try {
    await seedBank(database);
    const owner = "race-owner@example.test";
    const created = await post(owner, { action: "group-create", name: "race group", publicName: "owner", memberLimit: 2, idempotencyKey: "race-create-0001" });
    assert.equal(created.status, 201);
    const groupId = String((created.body.group as Record<string, unknown>).id);
    const key = "race-start-same-key-0001";
    const body = { action: "run-start", groupId, mode: "immediate", idempotencyKey: key };
    const [a, b] = await Promise.all([post(owner, body), post(owner, body)]);
    assert.deepEqual([a.status,b.status],[201,201],JSON.stringify({a,b}));
    const rows = database.prepare("SELECT id FROM study_group_exam_runs WHERE group_id=?").all(groupId);
    assert.equal(rows.length, 1);
  } finally { database.close(); globalThis.__BAEUMZIP_ENV__ = previous; }
});

test("concurrent exact group create replays once and changed payload has no side effects", async () => {
  const database = openCanonicalTestDatabase(process.cwd());
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(database) as unknown as D1Database, SKCT_GROUP_SERVICE_ENABLED: "1" };
  try {
    const owner = "idem-owner@example.test";
    const exact = { action: "group-create", name: "idem group", publicName: "owner", memberLimit: 2, idempotencyKey: "idem-create-same-0001" };
    const [a, b] = await Promise.all([post(owner, exact), post(owner, exact)]);
    assert.equal(a.status, 201); assert.equal(b.status, 201); assert.deepEqual(a.body, b.body);
    assert.equal(database.prepare("SELECT COUNT(*) n FROM study_groups").get().n, 1);
    assert.equal(database.prepare("SELECT COUNT(*) n FROM study_group_members").get().n, 1);
    assert.equal(database.prepare("SELECT COUNT(*) n FROM study_group_membership_events").get().n, 1);
    const conflict = await post(owner, { ...exact, name: "different group" });
    assert.equal(conflict.status, 409);
    assert.equal(database.prepare("SELECT COUNT(*) n FROM study_groups").get().n, 1);
    const other = await post("other-actor@example.test", exact);
    assert.equal(other.status, 201, JSON.stringify(other));
    assert.equal(database.prepare("SELECT COUNT(*) n FROM study_groups").get().n, 2);
  } finally { database.close(); globalThis.__BAEUMZIP_ENV__ = previous; }
});

test("forced precommit exact immediate run-start still converges", async () => {
  const database = openCanonicalTestDatabase(process.cwd());
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(database) as unknown as D1Database, SKCT_GROUP_SERVICE_ENABLED: "1" };
  const original = GroupExamRepository.prototype.createRun;
  let arrivals = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  GroupExamRepository.prototype.createRun = async function (...args: Parameters<typeof original>) {
    arrivals += 1;
    if (arrivals === 2) release();
    await gate;
    return original.apply(this, args);
  };
  try {
    await seedBank(database);
    const owner = "forced-race-owner@example.test";
    const created = await post(owner, { action: "group-create", name: "forced race", publicName: "owner", memberLimit: 2, idempotencyKey: "forced-create-0001" });
    const groupId = String((created.body.group as Record<string, unknown>).id);
    const key = "forced-start-key-0001";
    const body = { action: "run-start", groupId, mode: "immediate", idempotencyKey: key };
    const [a, b] = await Promise.all([post(owner, body), post(owner, body)]);
    assert.equal(arrivals, 2);
    assert.deepEqual([a.status, b.status], [201, 201], JSON.stringify({ a, b }));
  } finally {
    GroupExamRepository.prototype.createRun = original;
    database.close(); globalThis.__BAEUMZIP_ENV__ = previous;
  }
});

test("run-start public response redacts the internal actor key", async () => {
  const database = openCanonicalTestDatabase(process.cwd());
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(database) as unknown as D1Database, SKCT_GROUP_SERVICE_ENABLED: "1" };
  try {
    await seedBank(database);
    const owner = "run-dto-owner@example.test";
    const created = await post(owner, { action: "group-create", name: "dto group", publicName: "owner", memberLimit: 2, idempotencyKey: "dto-create-0001" });
    const groupId = String((created.body.group as Record<string, unknown>).id);
    const started = await post(owner, { action: "run-start", groupId, mode: "immediate", idempotencyKey: "dto-start-0001" });
    assert.equal(started.status, 201);
    assert.equal((started.body.run as Record<string, unknown>).created_by_user_key, undefined, JSON.stringify(started.body));
  } finally { database.close(); globalThis.__BAEUMZIP_ENV__ = previous; }
});

test("leave response reflects the mutation result after concurrent owner transfer", async () => {
  const database = openCanonicalTestDatabase(process.cwd());
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(database) as unknown as D1Database, SKCT_GROUP_SERVICE_ENABLED: "1" };
  const original = GroupExamRepository.prototype.leaveGroup;
  let replacementOwner = "";
  GroupExamRepository.prototype.leaveGroup = async function (...args: Parameters<typeof original>) {
    database.prepare("UPDATE study_groups SET owner_user_key=? WHERE id=?").run(replacementOwner, args[0].groupId);
    return original.apply(this, args);
  };
  try {
    const owner = "leave-owner@example.test";
    const member = "leave-member@example.test";
    const created = await post(owner, { action: "group-create", name: "leave race", publicName: "owner", memberLimit: 2, idempotencyKey: "leave-create-0001" });
    const groupId = String((created.body.group as Record<string, unknown>).id);
    const invited = await post(owner, { action: "invite-create", groupId, idempotencyKey: "leave-invite-0001" });
    await post(member, { action: "invite-accept", token: String((invited.body.invite as Record<string, unknown>).token), publicName: "member", idempotencyKey: "leave-accept-0001" });
    replacementOwner = String(database.prepare("SELECT user_key FROM study_group_members WHERE group_id=? AND public_name='member'").get(groupId).user_key);
    const left = await post(owner, { action: "group-leave", groupId, idempotencyKey: "leave-operation-0001" });
    assert.equal(left.status, 200);
    assert.equal(left.body.status, "left", JSON.stringify(left.body));
    assert.equal(database.prepare("SELECT status FROM study_groups WHERE id=?").get(groupId).status, "active");
  } finally {
    GroupExamRepository.prototype.leaveGroup = original;
    database.close(); globalThis.__BAEUMZIP_ENV__ = previous;
  }
});

test("invite resend rechecks owner authority in the final mutation", async () => {
  const database = openCanonicalTestDatabase(process.cwd());
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(database) as unknown as D1Database, SKCT_GROUP_SERVICE_ENABLED: "1" };
  const original = GroupExamRepository.prototype.rotateInvite;
  let enteredResolve!: () => void;
  let releaseResolve!: () => void;
  const entered = new Promise<void>((resolve) => { enteredResolve = resolve; });
  const release = new Promise<void>((resolve) => { releaseResolve = resolve; });
  GroupExamRepository.prototype.rotateInvite = async function (...args: Parameters<typeof original>) {
    enteredResolve();
    await release;
    return original.apply(this, args);
  };
  try {
    const owner = "invite-race-owner@example.test";
    const member = "invite-race-member@example.test";
    const created = await post(owner, { action: "group-create", name: "invite race", publicName: "owner", memberLimit: 3, idempotencyKey: "ir-create-0001" });
    const groupId = String((created.body.group as Record<string, unknown>).id);
    const joinInvite = await post(owner, { action: "invite-create", groupId, idempotencyKey: "ir-invite-0001" });
    await post(member, { action: "invite-accept", token: String((joinInvite.body.invite as Record<string, unknown>).token), publicName: "member", idempotencyKey: "ir-accept-0001" });
    const pending = await post(owner, { action: "invite-create", groupId, idempotencyKey: "ir-invite-0002" });
    const pendingId = String((pending.body.invite as Record<string, unknown>).id);
    const memberPublicId = String(database.prepare("SELECT public_id FROM study_group_members WHERE group_id=? AND public_name='member'").get(groupId).public_id);
    const resendPromise = post(owner, { action: "invite-resend", inviteId: pendingId, idempotencyKey: "ir-resend-0001" });
    await entered;
    const transferred = await post(owner, { action: "owner-transfer", groupId, targetMembershipId: memberPublicId, idempotencyKey: "ir-transfer-0001" });
    assert.equal(transferred.status, 200);
    releaseResolve();
    const resend = await resendPromise;
    assert.notEqual(resend.status, 200, JSON.stringify(resend));
  } finally {
    releaseResolve?.();
    GroupExamRepository.prototype.rotateInvite = original;
    database.close(); globalThis.__BAEUMZIP_ENV__ = previous;
  }
});

test("owner transfer cannot succeed without its required audit record", async () => {
  const database = openCanonicalTestDatabase(process.cwd());
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(database) as unknown as D1Database, SKCT_GROUP_SERVICE_ENABLED: "1" };
  const original = GroupExamRepository.prototype.writeGroupAudit;
  try {
    const owner = "audit-owner@example.test";
    const member = "audit-member@example.test";
    const created = await post(owner, { action: "group-create", name: "audit atomic", publicName: "owner", memberLimit: 2, idempotencyKey: "aa-create-0001" });
    const groupId = String((created.body.group as Record<string, unknown>).id);
    const invited = await post(owner, { action: "invite-create", groupId, idempotencyKey: "aa-invite-0001" });
    await post(member, { action: "invite-accept", token: String((invited.body.invite as Record<string, unknown>).token), publicName: "member", idempotencyKey: "aa-accept-0001" });
    const memberPublicId = String(database.prepare("SELECT public_id FROM study_group_members WHERE group_id=? AND public_name='member'").get(groupId).public_id);
    GroupExamRepository.prototype.writeGroupAudit = async function (input: Parameters<typeof original>[0]) {
      if (input.action === "owner-transfer") throw new Error("synthetic audit sink failure");
      return original.call(this, input);
    };
    const transferred = await post(owner, { action: "owner-transfer", groupId, targetMembershipId: memberPublicId, idempotencyKey: "aa-transfer-0001" });
    assert.notEqual(transferred.status, 200, JSON.stringify(transferred));
    assert.equal(database.prepare("SELECT COUNT(*) n FROM study_group_audit_events WHERE group_id=? AND action='owner-transfer'").get(groupId).n, 0);
  } finally {
    GroupExamRepository.prototype.writeGroupAudit = original;
    database.close(); globalThis.__BAEUMZIP_ENV__ = previous;
  }
});
