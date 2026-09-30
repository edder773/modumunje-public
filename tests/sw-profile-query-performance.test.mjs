import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";
import { buildSwPracticeQuery } from "../apps/backend/src/modules/sw-study/sw-practice-query.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const subjects = [
  "data-structures",
  "operating-systems",
  "database-sql",
  "network-data-communication",
  "programming-languages",
  "software-engineering",
  "information-security",
  "system-operations",
];
const phases = [
  "필기:소프트웨어설계",
  "필기:소프트웨어개발",
  "필기:데이터베이스구축",
  "필기:프로그래밍언어활용",
  "필기:정보시스템구축관리",
];

function freshDatabase() {
  return openCanonicalTestDatabase(root);
}

function percentile(values, fraction) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor((ordered.length - 1) * fraction)];
}

function addQuestionCopies(database, firstCopy, lastCopy) {
  const copy = database.prepare(`
    INSERT INTO sw_questions (
      id, theory_id, subject_group_id, subject_id, category, topic,
      display_order, difficulty, difficulty_rationale, kind, prompt, choices,
      correct_answers, explanation, tags, required_concepts, active, created_at, updated_at
    )
    SELECT id || '-perf-' || ?, theory_id, subject_group_id, subject_id, category, topic,
      display_order + (? * 100000), difficulty, difficulty_rationale, kind, prompt, choices,
      correct_answers, explanation, tags, required_concepts, active, created_at, updated_at
    FROM sw_questions
    WHERE id NOT LIKE '%-perf-%'
  `);
  database.exec("BEGIN");
  for (let index = firstCopy; index <= lastCopy; index += 1) copy.run(index, index);
  database.exec("COMMIT");
}

test("actual IPE repository query stays indexed across limits, exclusions, and 5x growth", (context) => {
  const database = freshDatabase();
  const measurements = [];
  for (const scale of [1, 5]) {
    if (scale === 5) addQuestionCopies(database, 1, 4);
    const actualExcludedIds = database.prepare(`
      SELECT question_id FROM sw_question_tags
      WHERE tag = '정보처리기사'
      ORDER BY question_id LIMIT 100
    `).all().map((row) => String(row.question_id));
    for (const limit of [20, 100]) {
      for (const excludeCount of [0, 100]) {
        const input = {
          subjects,
          theoryId: Number.NaN,
          excludedIds: actualExcludedIds.slice(0, excludeCount),
          requiredTag: "정보처리기사",
          profileOrder: true,
          profilePhases: phases,
          limit,
        };
        const query = buildSwPracticeQuery(input);
        const plan = database.prepare(`EXPLAIN QUERY PLAN ${query.sql}`).all(...query.values)
          .map((row) => String(row.detail)).join("\n");
        assert.match(plan, /sw_questions_active_subject_order_v2_idx/u, plan);
        assert.match(plan, /sqlite_autoindex_sw_question_tags_1/u, plan);
        const statement = database.prepare(query.sql);
        const coldStartedAt = performance.now();
        statement.all(...query.values);
        const coldMs = performance.now() - coldStartedAt;
        const warmDurations = [];
        for (let repetition = 0; repetition < 10; repetition += 1) {
          const startedAt = performance.now();
          statement.all(...query.values);
          warmDurations.push(performance.now() - startedAt);
        }
        const measurement = {
          scale,
          limit,
          excludeCount,
          coldMs: Number(coldMs.toFixed(3)),
          warmP50Ms: Number(percentile(warmDurations, 0.5).toFixed(3)),
          warmP95Ms: Number(percentile(warmDurations, 0.95).toFixed(3)),
        };
        measurements.push(measurement);
        assert.ok(coldMs < 500, JSON.stringify(measurements));
        assert.ok(measurement.warmP95Ms < 100, JSON.stringify(measurements));
      }
    }
  }
  context.diagnostic(JSON.stringify(measurements));
  database.close();
});
