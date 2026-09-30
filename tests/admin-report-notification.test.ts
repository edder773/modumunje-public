import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { sqliteD1 } from "./helpers/sqlite-d1.mjs";
import { AUTHENTICATED_USER_EMAIL_HEADER } from "../packages/shared/src/auth/authenticated-user";

test("report notification counts all new reports without returning private report content", async () => {
  const db = new DatabaseSync(":memory:");
  const previous = globalThis.__BAEUMZIP_ENV__;
  Object.defineProperty(globalThis, "__BAEUMZIP_APP_VERSION__", { value: "notification-test", configurable: true });
  db.exec("CREATE TABLE user_reports (id INTEGER PRIMARY KEY, status TEXT, description TEXT)");
  const insert = db.prepare("INSERT INTO user_reports (status, description) VALUES (?, 'private report text')");
  for (let i = 0; i < 205; i++) insert.run("new");
  insert.run("reviewing"); insert.run("resolved");
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(db) as unknown as D1Database, ADMIN_EMAIL: "admin@example.test" };
  try {
    const { GET } = await import("../apps/backend/src/modules/admin/admin-request-handlers");
    const read = (email?: string) => GET(new Request("https://example.test/api/admin?resource=report-notification", {
      headers: email ? { [AUTHENTICATED_USER_EMAIL_HEADER]: email } : {},
    }));
    assert.equal((await read()).status, 401);
    assert.equal((await read("learner@example.test")).status, 403);
    const response = await read("admin@example.test");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { newCount: 205 });
    db.exec("UPDATE user_reports SET status = 'reviewing' WHERE id = 1");
    assert.deepEqual(await (await read("admin@example.test")).json(), { newCount: 204 });
    db.exec("UPDATE user_reports SET status = 'resolved'");
    assert.deepEqual(await (await read("admin@example.test")).json(), { newCount: 0 });
  } finally { globalThis.__BAEUMZIP_ENV__ = previous; db.close(); }
});


test("dashboard warns about a stopped scheduler even when a recent backup succeeded", async () => {
  const { readAdminOperationalStatus } = await import("../apps/backend/src/modules/admin/admin-operational-status");
  const db = new DatabaseSync(":memory:");
  const previous = globalThis.__BAEUMZIP_ENV__;
  db.exec(`
    CREATE TABLE site_settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE backup_snapshots (backup_type TEXT, status TEXT, created_at TEXT);
    CREATE TABLE maintenance_runs (task TEXT, last_succeeded_at TEXT, last_failed_at TEXT, consecutive_failures INTEGER, last_error TEXT);
    CREATE TABLE analytics_events (occurred_at TEXT, event_type TEXT, metric_name TEXT, metric_value REAL, is_admin INTEGER,
      api_route TEXT, http_status INTEGER, retry_count INTEGER, cache_source TEXT, duration_ms REAL);
    INSERT INTO site_settings VALUES ('auto_backup_enabled', 'true');
  `);
  const now = new Date().toISOString();
  db.prepare("INSERT INTO backup_snapshots VALUES ('auto-full','completed',?)").run(now);
  db.prepare("INSERT INTO maintenance_runs VALUES ('operational_housekeeping',?,NULL,0,'')")
    .run(new Date(Date.now() - 48 * 3600_000).toISOString());
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(db) as unknown as D1Database };
  try {
    const range = { start: now, end: now };
    const beforeReads = db.prepare("SELECT total_changes() AS writes").get();
    const stale = await readAdminOperationalStatus(range, true);
    assert.deepEqual(db.prepare("SELECT total_changes() AS writes").get(), beforeReads, "dashboard must not write a cache revision or any data");
    assert.deepEqual(stale.operationalWarnings, ["정기 유지보수가 26시간 이상 완료되지 않았습니다. 예약 실행 상태를 확인해 주세요."]);
    db.prepare("UPDATE maintenance_runs SET last_succeeded_at=?").run(now);
    assert.deepEqual((await readAdminOperationalStatus(range, true)).operationalWarnings, []);
  } finally { globalThis.__BAEUMZIP_ENV__ = previous; db.close(); }
});
