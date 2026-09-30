import assert from "node:assert/strict";
import test from "node:test";
import { learnerUserHash } from "@backend/common/auth/admin-auth";
import { GET, POST } from "../apps/backend/src/modules/study/study.service";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";
import { sqliteD1 } from "./helpers/sqlite-d1.mjs";

const origin = "https://example.test";
function mutation(email: string, payload: Record<string, unknown>) {
  return new Request(`${origin}/api/study`, {
    method: "POST",
    headers: { "content-type": "application/json", origin,
      "x-baeumzip-authenticated-user-email": email, "x-sql-study-user-request": "1" },
    body: JSON.stringify(payload),
  });
}
function feedback() {
  return { action: "attempt", questionId: 1, clientOperationId: "maintenance01",
    selectedAnswers: [0], mode: "practice", examType: "SQLD", feedbackAuthorization: "synthetic-token" };
}

test("maintenance denies study account touch and feedback before any account write, with blocked 403 first", async () => {
  const db = openCanonicalTestDatabase(process.cwd());
  const previous = globalThis.__BAEUMZIP_ENV__;
  const previousBuild = (globalThis as typeof globalThis & { __BAEUMZIP_BUILD_SHA__?: string }).__BAEUMZIP_BUILD_SHA__;
  const d1 = sqliteD1(db);
  globalThis.__BAEUMZIP_ENV__ = { DB: d1 as unknown as D1Database, ADMIN_EMAIL: "admin-maintenance@example.test" };
  (globalThis as typeof globalThis & { __BAEUMZIP_BUILD_SHA__: string }).__BAEUMZIP_BUILD_SHA__ = "study-maintenance-test";
  const setting = db.prepare(`INSERT INTO site_settings(key,value,value_type,updated_by_hash,updated_at)
    VALUES('maintenance_mode',?,'boolean','test',CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value`);
  const accountCount = (email: string) => Number(db.prepare("SELECT COUNT(*) AS n FROM user_accounts WHERE email=?").get(email)?.n ?? 0);
  const writes = () => Number(db.prepare("SELECT total_changes() AS n").get()?.n ?? 0);
  try {
    setting.run("true");
    const fresh = "fresh-maintenance@example.test";
    let beforeWrites = writes();
    assert.equal((await POST(mutation(fresh, { action: "account-touch", displayName: "Fresh" }))).status, 503);
    assert.equal(writes(), beforeWrites);
    assert.equal(accountCount(fresh), 0);
    const freshKey = await learnerUserHash(fresh);
    assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM user_settings WHERE user_key=?").get(freshKey)?.n), 0);
    const before = d1.roundTrips;
    beforeWrites = writes();
    assert.equal((await POST(mutation(fresh, feedback()))).status, 503);
    assert.equal(d1.roundTrips - before, 1);
    assert.equal(writes(), beforeWrites);
    assert.equal(accountCount(fresh), 0);
    const recovered = await GET(new Request(`${origin}/api/study?scope=shell`, {
      headers: { "x-baeumzip-authenticated-user-email": fresh },
    }));
    assert.equal(recovered.status, 200);
    assert.equal(accountCount(fresh), 0);

    const blocked = "blocked-maintenance@example.test";
    const blockedKey = await learnerUserHash(blocked);
    db.prepare(`INSERT INTO user_accounts(user_key,email,display_name,status,blocked_reason,last_login_at)
      VALUES(?,?,?,'blocked','test','2026-01-01T00:00:00.000Z')`).run(blockedKey, blocked, blocked);
    beforeWrites = writes();
    assert.equal((await POST(mutation(blocked, { action: "account-touch" }))).status, 403);
    assert.equal((await POST(mutation(blocked, feedback()))).status, 403);
    assert.equal(writes(), beforeWrites);
    assert.equal(db.prepare("SELECT last_login_at FROM user_accounts WHERE user_key=?").get(blockedKey)?.last_login_at,
      "2026-01-01T00:00:00.000Z");
    assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM attempts WHERE user_key=?").get(blockedKey)?.n), 0);

    const admin = "admin-maintenance@example.test";
    assert.equal((await POST(mutation(admin, { action: "account-touch" }))).status, 200);
    assert.equal(accountCount(admin), 1);
    setting.run("false");
    assert.equal((await POST(mutation(fresh, { action: "account-touch" }))).status, 200);
    assert.equal(accountCount(fresh), 1);
  } finally {
    db.close();
    globalThis.__BAEUMZIP_ENV__ = previous;
    (globalThis as typeof globalThis & { __BAEUMZIP_BUILD_SHA__?: string }).__BAEUMZIP_BUILD_SHA__ = previousBuild;
  }
});
