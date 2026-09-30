import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { instrumentD1, metricPhase, metricSyncPhase, performanceRoute, withD1Metrics } from "../apps/backend/src/common/observability/d1-metrics";
import { GET as groupGet } from "../apps/backend/src/modules/group-exams/group-exam.service";
import { GET as studyGet } from "../apps/backend/src/modules/study/study.service";
import { learnerUserHash } from "../apps/backend/src/common/auth/admin-auth";
import { sqliteD1 } from "./helpers/sqlite-d1.mjs";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";

test("D1 metrics count each execution and a batch as one round trip", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const native = sqliteD1(sqlite);
  try {
    const response = await withD1Metrics(async () => {
      const db = instrumentD1(native as unknown as D1Database);
      await db.prepare("CREATE TABLE sample (id INTEGER PRIMARY KEY)").run();
      await db.prepare("INSERT INTO sample (id) VALUES (?)").bind(1).run();
      assert.equal((await db.prepare("SELECT id FROM sample").first<{ id: number }>())?.id, 1);
      assert.deepEqual((await db.prepare("SELECT id FROM sample").all<{ id: number }>()).results.map((row) => row.id), [1]);
      assert.deepEqual(await db.prepare("SELECT id FROM sample").raw(), [[1]]);
      await db.batch([
        db.prepare("INSERT INTO sample (id) VALUES (?)").bind(2),
        db.prepare("SELECT id FROM sample WHERE id = ?").bind(2),
      ]);
      return Response.json({ ok: true });
    });
    assert.equal(native.roundTrips, 6);
    assert.equal(response.headers.get("X-DB-Ops"), "6");
    assert.match(response.headers.get("Server-Timing") ?? "", /d1_ops;dur=6/u);
    assert.match(response.headers.get("Server-Timing") ?? "", /boot;desc="instance-(?:first-fetch|reused)"/u);
  } finally { sqlite.close(); }
});

test("a response stream is untouched until the caller reads it, even with no D1 binding", async () => {
  let pulled = false;
  const response = await withD1Metrics(async () => new Response(new ReadableStream({
    pull(controller) {
      pulled = true;
      controller.enqueue(new TextEncoder().encode("streamed"));
      controller.close();
    },
  }), { headers: { "Content-Encoding": "gzip" } }));
  assert.equal(response.headers.get("X-DB-Ops"), "0");
  assert.equal(response.headers.get("Content-Encoding"), "gzip");
  // ReadableStream may pull once during construction, but the response remains readable.
  assert.equal(response.bodyUsed, false);
  assert.equal(await response.text(), "streamed");
  assert.equal(pulled, true);
});

test("group list authenticates and returns its rows within two D1 round trips", async () => {
  const sqlite = openCanonicalTestDatabase(process.cwd());
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(sqlite) as unknown as D1Database, SKCT_GROUP_SERVICE_ENABLED: "1" };
  try {
    const response = await groupGet(new Request("https://example.test/api/group-exams?scope=groups", {
      headers: { "x-baeumzip-authenticated-user-email": "reader@example.test" },
    }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("X-DB-Ops"), "2");
    assert.equal(response.headers.get("X-Group-DB-Ops"), "2");
    assert.ok(Number(response.headers.get("X-Group-Payload-Bytes")) > 0);
    assert.match(response.headers.get("Server-Timing") ?? "", /group_serialize;dur=/u);
    assert.deepEqual((await response.json() as { groups: unknown[] }).groups, []);
  } finally {
    globalThis.__BAEUMZIP_ENV__ = previous;
    sqlite.close();
  }
});

test("study shell reads account, live controls, and setting in one D1 batch", async () => {
  const sqlite = openCanonicalTestDatabase(process.cwd());
  const previous = globalThis.__BAEUMZIP_ENV__;
  const previousBuild = (globalThis as typeof globalThis & { __BAEUMZIP_BUILD_SHA__?: string }).__BAEUMZIP_BUILD_SHA__;
  const email = "shell-budget@example.test";
  const userKey = await learnerUserHash(email);
  sqlite.prepare("INSERT INTO user_accounts (user_key, email, display_name) VALUES (?, ?, 'reader')").run(userKey, email);
  sqlite.prepare("INSERT INTO user_settings (user_key, selected_exam) VALUES (?, 'SQLP')").run(userKey);
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(sqlite) as unknown as D1Database };
  (globalThis as typeof globalThis & { __BAEUMZIP_BUILD_SHA__: string }).__BAEUMZIP_BUILD_SHA__ = "performance-test-build";
  const request = () => new Request("https://example.test/api/study?scope=shell", {
    headers: { "x-baeumzip-authenticated-user-email": email },
  });
  try {
    const guest = await withD1Metrics(() => studyGet(new Request("https://example.test/api/study?scope=shell")));
    assert.equal(guest.status, 200);
    assert.equal(guest.headers.get("X-DB-Ops"), "1");
    assert.equal((await guest.json() as { authenticated: boolean }).authenticated, false);
    const response = await withD1Metrics(() => studyGet(request()));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("X-DB-Ops"), "1");
    const payload = await response.json() as { settings: { selectedExam: string }; site: { maintenanceMode: boolean } };
    assert.equal(payload.settings.selectedExam, "SQLP");
    sqlite.prepare("UPDATE site_settings SET value='true' WHERE key='maintenance_mode'").run();
    const changed = await withD1Metrics(() => studyGet(request()));
    assert.equal((await changed.json() as { site: { maintenanceMode: boolean } }).site.maintenanceMode, true);
    sqlite.prepare("UPDATE user_accounts SET status='blocked' WHERE user_key=?").run(userKey);
    const blocked = await withD1Metrics(() => studyGet(request()));
    assert.equal(blocked.status, 403);
    assert.equal(blocked.headers.get("X-DB-Ops"), "1");
  } finally {
    globalThis.__BAEUMZIP_ENV__ = previous;
    (globalThis as typeof globalThis & { __BAEUMZIP_BUILD_SHA__?: string }).__BAEUMZIP_BUILD_SHA__ = previousBuild;
    sqlite.close();
  }
});

test("warm logged-in course overview stays within two D1 round trips", async () => {
  const sqlite = openCanonicalTestDatabase(process.cwd());
  const previous = globalThis.__BAEUMZIP_ENV__;
  const previousBuild = (globalThis as typeof globalThis & { __BAEUMZIP_BUILD_SHA__?: string }).__BAEUMZIP_BUILD_SHA__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(sqlite) as unknown as D1Database };
  (globalThis as typeof globalThis & { __BAEUMZIP_BUILD_SHA__: string }).__BAEUMZIP_BUILD_SHA__ = "performance-test-build";
  const request = () => new Request("https://example.test/api/study?scope=overview", {
    headers: { "x-baeumzip-authenticated-user-email": "overview-budget@example.test" },
  });
  try {
    const cold = await withD1Metrics(() => studyGet(request()));
    assert.equal(cold.status, 200);
    await cold.arrayBuffer();
    const warm = await withD1Metrics(() => studyGet(request()));
    assert.equal(warm.status, 200);
    assert.ok(Number(warm.headers.get("X-DB-Ops")) <= 2);
  } finally {
    globalThis.__BAEUMZIP_ENV__ = previous;
    (globalThis as typeof globalThis & { __BAEUMZIP_BUILD_SHA__?: string }).__BAEUMZIP_BUILD_SHA__ = previousBuild;
    sqlite.close();
  }
});


test("application timing measures headers without consuming the stream and uses bounded private-safe phases", async () => {
  const request = new Request("https://example.test/learn/sql/sqld/theory/secret-id?token=never-log", {
    headers: { "X-Request-ID": "0123456789abcdef0123456789abcdef" },
  });
  const response = await withD1Metrics(async () => {
    await metricPhase("context", async () => undefined);
    metricSyncPhase("proxy", () => undefined);
    await metricPhase('email@example.test;desc="unsafe"', async () => undefined);
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode("first")); controller.close();
    } }), { headers: { "Server-Timing": "platform;dur=3" } });
  }, { request });
  const timing = response.headers.get("Server-Timing")!;
  assert.match(timing, /platform;dur=3/u);
  assert.match(timing, /app_headers;dur=[\d.]+/u);
  assert.match(timing, /context;dur=/u);
  assert.match(timing, /proxy;dur=/u);
  assert.doesNotMatch(timing, /email|token|secret-id/u);
  assert.equal(response.headers.get("X-Request-ID"), request.headers.get("X-Request-ID"));
  assert.equal(performanceRoute(new URL(request.url).pathname), "/learn/:field/:course/:page");
  assert.equal(response.bodyUsed, false);
  assert.equal(await response.text(), "first");
});
