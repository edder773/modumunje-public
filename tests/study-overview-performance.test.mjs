import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function freshDatabase() {
  return openCanonicalTestDatabase(root);
}

const overviewAttemptQuery = `
  SELECT a.exam_type, COUNT(*) AS attempt_count
  FROM attempts AS a
  JOIN questions AS q ON q.id = a.question_id
  WHERE a.user_key = ? AND q.active = 1 AND q.kind IN ('single', 'multiple')
  GROUP BY a.exam_type
`;

const overviewRecentQuery = `
  WITH course_types AS (
    SELECT DISTINCT exam_type FROM course_content_scopes
  ), latest AS (
    SELECT course_types.exam_type, (
      SELECT a.id FROM attempts AS a
      JOIN questions AS q ON q.id = a.question_id
      WHERE a.user_key = ? AND a.exam_type = course_types.exam_type
        AND q.active = 1 AND q.kind IN ('single', 'multiple')
      ORDER BY a.created_at DESC, a.id DESC LIMIT 1
    ) AS attempt_id
    FROM course_types
  )
  SELECT latest.exam_type, q.category, q.topic, a.created_at
  FROM latest
  JOIN attempts AS a ON a.id = latest.attempt_id
  JOIN questions AS q ON q.id = a.question_id
`;

function percentile(values, fraction) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor((ordered.length - 1) * fraction)];
}

test("authenticated overview queries remain bounded at 0, 100, 1000, and 10000 attempts", (context) => {
  const database = freshDatabase();
  const questionId = Number(database.prepare(`
    SELECT id FROM questions WHERE active = 1 AND kind IN ('single', 'multiple') LIMIT 1
  `).get().id);
  const insert = database.prepare(`
    INSERT INTO attempts (
      question_id, selected_answers, correct, mode, user_key, exam_type,
      result, score, answer_text, review_status, is_admin, created_at
    ) VALUES (?, '[]', 0, 'practice', ?, 'SQLP', 'incorrect', 0, '', 'pending', 0, ?)
  `);
  const measurements = [];
  for (const count of [0, 100, 1_000, 10_000]) {
    const userKey = `overview-${count}`;
    database.exec("BEGIN");
    for (let index = 0; index < count; index += 1) {
      insert.run(questionId, userKey, new Date(Date.UTC(2026, 0, 1 + index % 365)).toISOString());
    }
    database.exec("COMMIT");
    const attemptStatement = database.prepare(overviewAttemptQuery);
    const recentStatement = database.prepare(overviewRecentQuery);
    const durations = [];
    let rows = 0;
    for (let repetition = 0; repetition < 50; repetition += 1) {
      const startedAt = performance.now();
      rows = attemptStatement.all(userKey).length + recentStatement.all(userKey).length;
      durations.push(performance.now() - startedAt);
    }
    measurements.push({
      count,
      rows,
      p50Ms: Number(percentile(durations, 0.5).toFixed(3)),
      p95Ms: Number(percentile(durations, 0.95).toFixed(3)),
    });
    assert.ok(measurements.at(-1).p95Ms < 1_000, JSON.stringify(measurements));
  }
  const plan = database.prepare(`EXPLAIN QUERY PLAN ${overviewAttemptQuery}`).all("overview-10000")
    .map((row) => String(row.detail)).join("\n");
  assert.match(plan, /attempts_user_exam_(?:question_)?time_idx/u, plan);
  const recentPlan = database.prepare(`EXPLAIN QUERY PLAN ${overviewRecentQuery}`).all("overview-10000")
    .map((row) => String(row.detail)).join("\n");
  assert.match(recentPlan, /attempts_user_exam_time_idx/u, recentPlan);
  assert.doesNotMatch(recentPlan, /TEMP B-TREE/u, recentPlan);
  const baseline = Math.max(0.05, measurements[1].p95Ms);
  assert.ok(measurements.at(-1).p95Ms < Math.max(1_000, baseline * 5), JSON.stringify(measurements));
  context.diagnostic(JSON.stringify(measurements));
  database.close();
});
