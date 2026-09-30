import assert from "node:assert/strict";
import test from "node:test";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";
import { sqliteD1 } from "./helpers/sqlite-d1.mjs";
import { tsImport } from "tsx/esm/api";
const { OperationsRepository } = await tsImport("../apps/backend/src/modules/operations/operations.repository.ts", import.meta.url);
const { guestLearningKey, initializeGuestLearningSession, guestExamQuotaReached, claimGuestExamResults } = await tsImport("../apps/backend/src/common/auth/guest-learning-session.ts", import.meta.url);

test("temporary session expiry cleanup cannot delete member or unexpired guest data", async () => {
  const db = openCanonicalTestDatabase(process.cwd());
  const sql = [];
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(db, sql), GOOGLE_AUTH_SESSION_SECRET: "retention-local-only-test-secret-at-least-32-characters" };
  try {
    const now = Math.floor(Date.now() / 1000);
    const oldKey = `guest:${now - 1}:${"a".repeat(32)}`;
    const freshKey = `guest:${now + 3600}:${"b".repeat(32)}`;
    for (const [id, key] of [["old", oldKey], ["fresh", freshKey], ["member", "member-owner"]]) {
      db.prepare("INSERT INTO exam_sessions (id, user_key, exam_type, started_at, ends_at) VALUES (?, ?, 'SQLD', '2026-01-01', '2026-01-02')").run(id, key);
      db.prepare("INSERT INTO sw_learning_sessions (id, user_key, mode) VALUES (?, ?, 'mock')").run(`sw-${id}`, key);
    }
    const cleaned = await new OperationsRepository().cleanupExpiredRows(90);
    assert.equal(cleaned.guestSessions, 2);
    assert.deepEqual(db.prepare("SELECT id FROM exam_sessions ORDER BY id").all().map(row => row.id), ["fresh", "member"]);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sw_learning_sessions").get().n, 2);
    const request = new Request("https://modumunje.com/api/guest-learning");
    const initialized = await initializeGuestLearningSession(request);
    const cookie = initialized.headers.getSetCookie()[0].split(";")[0];
    const owned = new Request(request.url, { headers: { cookie } });
    const key = await guestLearningKey(owned);
    assert.ok(key?.startsWith("guest:"));
    assert.equal(await guestExamQuotaReached(key, "sql"), false);
    for (let index = 0; index < 30; index++) db.prepare("INSERT INTO exam_sessions (id, user_key, exam_type, started_at, ends_at) VALUES (?, ?, 'SQLD', '2026-01-01', '2026-01-02')").run(`quota-${index}`, key);
    assert.equal(await guestExamQuotaReached(key, "sql"), true);
    const signatureChanged = cookie.slice(0, -1) + (cookie.endsWith("0") ? "1" : "0");
    assert.equal(await guestLearningKey(new Request(request.url, { headers: { cookie: signatureChanged } })), null);
    await claimGuestExamResults(owned, "member-owner", false);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM exam_sessions WHERE user_key = ?").get(key).n, 30, "active exams must not silently move during sign-in");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM user_accounts").get().n, 0);
  } finally { db.close(); }
});
