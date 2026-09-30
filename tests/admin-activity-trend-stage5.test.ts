import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  adminActivityTrendBindings,
  adminActivityTrendQuery,
} from "../apps/backend/src/modules/admin/admin-activity-trend-query";

const now = new Date("2026-09-01T00:30:00+09:00");
const adminKey = "admin-user-hash";

function oldQuery(excludeAdmin: boolean) {
  return `
    WITH RECURSIVE days(day) AS (
      SELECT date(datetime(?, '+9 hours'), '-29 days')
      UNION ALL SELECT date(day, '+1 day') FROM days
      WHERE day < date(datetime(?, '+9 hours'))
    )
    SELECT day,
      (SELECT COUNT(DISTINCT e.anonymous_session_id) FROM analytics_events e
        WHERE e.event_type = 'page_view'
          AND date(datetime(e.occurred_at, '+9 hours')) = day
          ${excludeAdmin ? "AND e.is_admin = 0" : ""}) AS dau,
      (SELECT COUNT(DISTINCT e.anonymous_session_id) FROM analytics_events e
        WHERE e.event_type = 'page_view'
          AND date(datetime(e.occurred_at, '+9 hours')) BETWEEN date(day, '-29 days') AND day
          ${excludeAdmin ? "AND e.is_admin = 0" : ""}) AS mau,
      ((SELECT COUNT(*) FROM attempts a JOIN questions q ON q.id = a.question_id
        WHERE date(datetime(a.created_at, '+9 hours')) = day AND q.kind != 'descriptive'
          ${excludeAdmin ? "AND a.is_admin = 0" : ""})
      + (SELECT COUNT(*) FROM sw_attempts sa
        WHERE date(datetime(sa.created_at, '+9 hours')) = day
          ${excludeAdmin ? "AND sa.user_key != ?" : ""})) AS question_attempts
    FROM days ORDER BY day
  `;
}

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE analytics_events (
      id INTEGER PRIMARY KEY, event_type TEXT, anonymous_session_id TEXT,
      is_admin INTEGER, occurred_at TEXT
    );
    CREATE INDEX analytics_events_type_admin_time_session_idx
      ON analytics_events(event_type, is_admin, occurred_at, anonymous_session_id);
    CREATE TABLE questions (id INTEGER PRIMARY KEY, kind TEXT);
    CREATE TABLE attempts (
      id INTEGER PRIMARY KEY, question_id INTEGER, is_admin INTEGER, created_at TEXT
    );
    CREATE TABLE sw_attempts (id INTEGER PRIMARY KEY, user_key TEXT, created_at TEXT);
    INSERT INTO questions VALUES (1, 'single'), (2, 'descriptive');
  `);
  const view = db.prepare(`
    INSERT INTO analytics_events (event_type, anonymous_session_id, is_admin, occurred_at)
    VALUES ('page_view', ?, ?, ?)
  `);
  const samples: Array<[string, number, string]> = [
    ["learner-a", 0, "2026-08-31T14:59:59.000Z"],
    ["learner-a", 0, "2026-08-31T15:00:01.000Z"],
    ["learner-a", 0, "2026-08-31T15:10:00.000Z"],
    ["learner-b", 0, "2026-08-03T02:00:00.000Z"],
    ["rolling-boundary", 0, "2026-07-05T03:00:00.000Z"],
    ["admin-session", 1, "2026-08-31T16:00:00.000Z"],
  ];
  for (const sample of samples) view.run(...sample);
  db.exec(`
    INSERT INTO attempts VALUES
      (1, 1, 0, '2026-08-31T15:01:00.000Z'),
      (2, 1, 1, '2026-08-31T15:02:00.000Z'),
      (3, 2, 0, '2026-08-31T15:03:00.000Z');
  `);
  db.prepare("INSERT INTO sw_attempts VALUES (?, ?, ?)").run(
    1, "learner-key", "2026-08-31T15:04:00.000Z",
  );
  db.prepare("INSERT INTO sw_attempts VALUES (?, ?, ?)").run(
    2, adminKey, "2026-08-31T15:05:00.000Z",
  );
  return db;
}

function readRows(db: DatabaseSync, optimized: boolean, excludeAdmin: boolean) {
  const bindings = optimized
    ? adminActivityTrendBindings(now, excludeAdmin, adminKey)
    : [now.toISOString(), now.toISOString(), ...(excludeAdmin ? [adminKey] : [])];
  const sql = optimized ? adminActivityTrendQuery(excludeAdmin) : oldQuery(excludeAdmin);
  return db.prepare(sql).all(...bindings);
}

for (const excludeAdmin of [true, false]) {
  test(`stage 5 optimized trend preserves exact KST/admin semantics (exclude=${excludeAdmin})`, () => {
    const db = database();
    assert.deepEqual(readRows(db, true, excludeAdmin), readRows(db, false, excludeAdmin));
    db.close();
  });
}

test("stage 5 late and retried events remain visible without aggregate replay state", () => {
  const db = database();
  const before = readRows(db, true, true);
  db.prepare(`
    INSERT INTO analytics_events (event_type, anonymous_session_id, is_admin, occurred_at)
    VALUES ('page_view', 'late-session', 0, '2026-08-31T15:20:00.000Z')
  `).run();
  const after = readRows(db, true, true);
  assert.equal(Number(after.at(-1)?.dau), Number(before.at(-1)?.dau) + 1);
  db.close();
});

test("stage 5 trend materializes raw sources once instead of correlated raw scans", () => {
  const sql = adminActivityTrendQuery(true);
  assert.match(sql, /visitor_days AS MATERIALIZED/u);
  assert.match(sql, /attempt_sources AS MATERIALIZED/u);
  assert.equal((sql.match(/FROM analytics_events/g) ?? []).length, 1);
  assert.equal((sql.match(/FROM attempts /g) ?? []).length, 1);
  assert.equal((sql.match(/FROM sw_attempts/g) ?? []).length, 1);
});

test("stage 5 page-view reduction keeps the covering analytics index available", () => {
  const db = database();
  const plan = db.prepare(`EXPLAIN QUERY PLAN ${adminActivityTrendQuery(true)}`)
    .all(...adminActivityTrendBindings(now, true, adminKey))
    .map((row) => String(row.detail)).join("\n");
  assert.match(plan, /analytics_events_type_admin_time_session_idx/u);
  db.close();
});
