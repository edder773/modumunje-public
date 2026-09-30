import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { openCanonicalDatabase } from "./lib/canonical-database.mjs";
import { StudyRepository } from "../apps/backend/src/modules/study/study.repository.ts";
import { readContentCacheRevision } from "../apps/backend/src/common/content/content-cache-revision.ts";
import { courseOverviewInputs, theoryListInputs } from "../apps/backend/src/modules/study/study-public-content-cache.ts";

import {
  adminActivityTrendBindings,
  adminActivityTrendQuery,
} from "../apps/backend/src/modules/admin/admin-activity-trend-query.ts";
import { createPublicContentCache, invalidateLocalPublicContentCache } from "../apps/backend/src/common/content/public-content-cache.ts";

const now = new Date("2026-09-01T00:30:00+09:00");
const adminKey = "stage5-admin";
const samples = 15;

function oldTrendQuery() {
  return `
    WITH RECURSIVE days(day) AS (
      SELECT date(datetime(?, '+9 hours'), '-29 days')
      UNION ALL SELECT date(day, '+1 day') FROM days
      WHERE day < date(datetime(?, '+9 hours'))
    )
    SELECT day,
      (SELECT COUNT(DISTINCT e.anonymous_session_id) FROM analytics_events e
        WHERE e.event_type = 'page_view' AND date(datetime(e.occurred_at, '+9 hours')) = day
          AND e.is_admin = 0) AS dau,
      (SELECT COUNT(DISTINCT e.anonymous_session_id) FROM analytics_events e
        WHERE e.event_type = 'page_view'
          AND date(datetime(e.occurred_at, '+9 hours')) BETWEEN date(day, '-29 days') AND day
          AND e.is_admin = 0) AS mau,
      ((SELECT COUNT(*) FROM attempts a JOIN questions q ON q.id = a.question_id
        WHERE date(datetime(a.created_at, '+9 hours')) = day AND q.kind != 'descriptive'
          AND a.is_admin = 0)
      + (SELECT COUNT(*) FROM sw_attempts sa
        WHERE date(datetime(sa.created_at, '+9 hours')) = day AND sa.user_key != ?))
        AS question_attempts
    FROM days ORDER BY day
  `;
}

function percentile(values, fraction) {
  const ordered = [...values].sort((left, right) => left - right);
  return Number(ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * fraction))].toFixed(3));
}

function timings(run) {
  const values = [];
  for (let index = 0; index < samples; index += 1) {
    const started = performance.now();
    run();
    values.push(performance.now() - started);
  }
  return { samples, p50Ms: percentile(values, 0.5), p95Ms: percentile(values, 0.95) };
}

function fixture(scale) {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE analytics_events (
      id INTEGER PRIMARY KEY, event_type TEXT, anonymous_session_id TEXT,
      is_admin INTEGER, occurred_at TEXT
    );
    CREATE INDEX analytics_events_type_admin_time_session_idx
      ON analytics_events(event_type, is_admin, occurred_at, anonymous_session_id);
    CREATE TABLE questions (id INTEGER PRIMARY KEY, kind TEXT);
    CREATE TABLE attempts (id INTEGER PRIMARY KEY, question_id INTEGER, is_admin INTEGER, created_at TEXT);
    CREATE TABLE sw_attempts (id INTEGER PRIMARY KEY, user_key TEXT, created_at TEXT);
    CREATE TABLE theories (id INTEGER PRIMARY KEY, title TEXT, summary TEXT, active INTEGER);
    INSERT INTO questions VALUES (1, 'single'), (2, 'descriptive');
  `);
  const event = database.prepare(`
    INSERT INTO analytics_events (event_type, anonymous_session_id, is_admin, occurred_at)
    VALUES ('page_view', ?, ?, ?)
  `);
  const attempt = database.prepare("INSERT INTO attempts VALUES (?, ?, ?, ?)");
  const swAttempt = database.prepare("INSERT INTO sw_attempts VALUES (?, ?, ?)");
  const theory = database.prepare("INSERT INTO theories VALUES (?, ?, ?, 1)");
  database.exec("BEGIN");
  for (let index = 0; index < 2_400 * scale; index += 1) {
    const day = index % 59;
    const occurred = new Date(now.getTime() - day * 86_400_000 - (index % 12) * 3_600_000).toISOString();
    event.run(`session-${index % (420 * scale)}`, index % 37 === 0 ? 1 : 0, occurred);
  }
  for (let index = 1; index <= 1_200 * scale; index += 1) {
    attempt.run(index, index % 11 === 0 ? 2 : 1, index % 41 === 0 ? 1 : 0,
      new Date(now.getTime() - (index % 30) * 86_400_000).toISOString());
  }
  for (let index = 1; index <= 600 * scale; index += 1) {
    swAttempt.run(index, index % 43 === 0 ? adminKey : `learner-${index % 100}`,
      new Date(now.getTime() - (index % 30) * 86_400_000).toISOString());
  }
  for (let index = 1; index <= 250; index += 1) {
    theory.run(index, `이론 ${index}`, "공개 학습 요약".repeat(8));
  }
  database.exec("COMMIT");
  return database;
}

function measureTrend(scale) {
  const database = fixture(scale);
  const oldStatement = database.prepare(oldTrendQuery());
  const optimizedStatement = database.prepare(adminActivityTrendQuery(true));
  const oldBindings = [now.toISOString(), now.toISOString(), adminKey];
  const optimizedBindings = adminActivityTrendBindings(now, true, adminKey);
  const beforeRows = oldStatement.all(...oldBindings);
  const afterRows = optimizedStatement.all(...optimizedBindings);
  assert.deepEqual(afterRows, beforeRows);
  const result = {
    scale: `${scale}x`,
    inputRows: { pageViews: 2_400 * scale, sqlAttempts: 1_200 * scale, swAttempts: 600 * scale },
    outputRows: afterRows.length,
    responseBytes: Buffer.byteLength(JSON.stringify(afterRows)),
    apiLatencyMs: null,
    queryCount: { before: 1, after: 1 },
    rawSourceReferences: { before: 4, after: 3 },
    before: timings(() => oldStatement.all(...oldBindings)),
    after: timings(() => optimizedStatement.all(...optimizedBindings)),
    parity: true,
    d1Meta: { durationMs: null, rowsRead: null, rowsWritten: null },
  };
  database.close();
  return result;
}

async function measureContentCache() {
  const database = fixture(1);
  const statement = database.prepare("SELECT id, title, summary FROM theories WHERE active = 1 ORDER BY id");
  let baselineQueries = 0;
  const baseline = [];
  for (let index = 0; index < 50; index += 1) {
    const started = performance.now();
    baselineQueries += 1;
    statement.all();
    baseline.push(performance.now() - started);
  }
  const cache = createPublicContentCache({
    ttlMs: 60_000,
    maxItems: 8,
    maxBytes: 1024 * 1024,
    maxEntryBytes: 512 * 1024,
  });
  let cachedQueries = 0;
  const cached = [];
  for (let index = 0; index < 50; index += 1) {
    const started = performance.now();
    await cache.read({
      namespace: "theories", key: "SQLD", revision: "measure-r1",
      loader: async () => {
        cachedQueries += 1;
        return statement.all();
      },
    });
    cached.push(performance.now() - started);
  }
  const diagnostics = cache.diagnostics();
  database.close();
  return {
    requests: 50,
    scope: "public loader only; excludes mandatory revision check and live settings/auth/private queries",
    rowsPerResponse: 250,
    responseBytes: diagnostics.bytes,
    apiLatencyMs: null,
    baseline: { queries: baselineQueries, p50Ms: percentile(baseline, 0.5), p95Ms: percentile(baseline, 0.95) },
    cached: { queries: cachedQueries, p50Ms: percentile(cached, 0.5), p95Ms: percentile(cached, 0.95) },
    requiredRevisionQueriesAcrossRequests: 50,
    cacheBytes: diagnostics.bytes,
    configuredMaximumBytes: 1024 * 1024,
  };
}

async function measureCanonicalReads() {
  const database = openCanonicalDatabase(fileURLToPath(new URL("../", import.meta.url)));
  const previous = globalThis.__BAEUMZIP_ENV__;
  let queries = 0;
  const d1 = {
    prepare(sql) {
      let values = [];
      const execute = () => {
        queries += 1;
        return database.prepare(sql).all(...values);
      };
      return {
        bind(...input) { values = input; return this; },
        async all() { return { success: true, results: execute() }; },
        async first() { return execute()[0] ?? null; },
      };
    },
    async batch(statements) { return Promise.all(statements.map((statement) => statement.all())); },
  };
  globalThis.__BAEUMZIP_ENV__ = { DB: d1 };
  try {
    const repository = new StudyRepository();
    const results = [];
    for (const scope of ["overview", "theories"]) {
      for (const identity of ["guest", "member"]) {
        const userKey = identity === "member" ? "stage5-empty-user" : undefined;
        const baseline = () => scope === "overview"
          ? repository.readCourseOverview(userKey)
          : repository.findTheoryList(userKey, "SQLD");
        const cached = async () => {
          const revision = await readContentCacheRevision(d1);
          return scope === "overview"
            ? courseOverviewInputs(repository, userKey, revision)
            : theoryListInputs(repository, userKey, "SQLD", revision);
        };
        const measure = async (read) => {
          queries = 0;
          const durations = [];
          let value;
          let coldQueries = 0;
          for (let index = 0; index < 16; index += 1) {
            const started = performance.now();
            value = await read();
            durations.push(performance.now() - started);
            if (index === 0) coldQueries = queries;
          }
          return {
            value,
            coldMs: Number(durations[0].toFixed(3)),
            warmP50Ms: percentile(durations.slice(1), 0.5),
            warmP95Ms: percentile(durations.slice(1), 0.95),
            coldQueries,
            warmQueriesPerRequest: (queries - coldQueries) / 15,
          };
        };
        invalidateLocalPublicContentCache();
        const before = await measure(baseline);
        const after = await measure(cached);
        assert.deepEqual(JSON.parse(JSON.stringify(after.value)), JSON.parse(JSON.stringify(before.value)));
        const responseBytes = Buffer.byteLength(JSON.stringify(after.value));
        delete before.value;
        delete after.value;
        results.push({ scope, identity, before, after, responseBytes, parity: true });
      }
    }
    return {
      fixture: "local isolated canonical content; member with no persisted learning state",
      contentCounts: database.prepare("SELECT (SELECT COUNT(*) FROM questions) AS questions, (SELECT COUNT(*) FROM theories) AS theories").get(),
      scope: "repository inputs including revision; excludes HTTP/auth/live-site-settings cost in both paths",
      apiLatencyMs: null,
      d1Meta: { durationMs: null, rowsRead: null, rowsWritten: null },
      results,
    };
  } finally {
    invalidateLocalPublicContentCache();
    globalThis.__BAEUMZIP_ENV__ = previous;
    database.close();
  }
}

const report = {
  environment: `local node:sqlite ${process.version}`,
  note: "Local synthetic measurements only; Cloudflare D1 result metadata is unavailable locally.",
  analytics: [measureTrend(1), measureTrend(5)],
  publicContent: await measureContentCache(),
  canonicalReads: await measureCanonicalReads(),
};

console.log(JSON.stringify(report, null, 2));
