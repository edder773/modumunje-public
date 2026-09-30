import { readFeatureSource } from "./helpers/feature-source.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";

import {
  isGeneralPracticeQuestion,
  isTheoryOnlyQuestion,
  THEORY_PAIR_QUESTION_RANGE,
} from "../packages/shared/src/content/question-pool.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function migratedDatabase() {
  return openCanonicalTestDatabase(root);
}

test("2026-08-02 theory pairs are classified without deleting or deactivating them", () => {
  const database = migratedDatabase();
  const summary = database.prepare(`
    SELECT
      COUNT(*) AS question_count,
      COUNT(DISTINCT theory_id) AS theory_count,
      MIN(id) AS first_id,
      MAX(id) AS last_id,
      MIN(linked_count) AS minimum_per_theory,
      MAX(linked_count) AS maximum_per_theory
    FROM (
      SELECT
        id,
        theory_id,
        COUNT(*) OVER (PARTITION BY theory_id) AS linked_count
      FROM questions
      WHERE practice_scope = 'theory_only'
        AND active = 1
    )
  `).get();
  assert.deepEqual({ ...summary }, {
    question_count: THEORY_PAIR_QUESTION_RANGE.count,
    theory_count: 122,
    first_id: THEORY_PAIR_QUESTION_RANGE.firstId,
    last_id: THEORY_PAIR_QUESTION_RANGE.lastId,
    minimum_per_theory: 30,
    maximum_per_theory: 30,
  });

  const invalid = database.prepare(`
    SELECT COUNT(*) AS count
    FROM questions
    WHERE practice_scope = 'theory_only'
      AND (
        active != 1
        OR exam_scope != 'SQLP'
        OR category != 'SQL 고급 활용 및 튜닝'
        OR kind != 'single'
        OR theory_id IS NULL
      )
  `).get();
  assert.equal(invalid.count, 0);
});

test("general and theory-only selectors remain mutually exclusive", () => {
  assert.equal(isGeneralPracticeQuestion({ practiceScope: "general" }), true);
  assert.equal(isGeneralPracticeQuestion({ practiceScope: "theory_only" }), false);
  assert.equal(isTheoryOnlyQuestion({ practiceScope: "theory_only" }), true);
  assert.equal(isTheoryOnlyQuestion({ practiceScope: "general" }), false);

  assert.equal(isTheoryOnlyQuestion({
    id: THEORY_PAIR_QUESTION_RANGE.firstId,
    theory_id: 713,
    exam_scope: "SQLP",
    category: "SQL 고급 활용 및 튜닝",
  }), true, "older backups without practice_scope must keep the batch theory-only");
  assert.equal(isGeneralPracticeQuestion({
    id: THEORY_PAIR_QUESTION_RANGE.firstId,
    theory_id: 713,
    exam_scope: "SQLP",
    category: "SQL 고급 활용 및 튜닝",
    practice_scope: "general",
  }), true, "an explicit current scope must override the legacy backup inference");
});

test("general practice and mock-exam code both apply the shared pool rule", () => {
  const learner = readFeatureSource(path.join(root, "apps/frontend/src/features/study/components/study-app.tsx"), "utf8");
  const studyApi = readFeatureSource(path.join(root, "apps/backend/src/modules/study/study.service.ts"), "utf8");
  assert.match(learner, /candidates\s*=\s*questions\.filter\(isGeneralPracticeQuestion\)/u);
  assert.match(learner, /pairedChecks\s*=\s*linked\.filter\(isTheoryOnlyQuestion\)/u);
  assert.match(learner, /pairedChecks\.length\s*\?\s*pairedChecks\s*:\s*linked/u);
  assert.match(studyApi, /questionAllowedForExam\(question, selectedExam\)[\s\S]{0,120}isGeneralPracticeQuestion\(question\)/u);
});

test("each linked theory can still retrieve its complete objective pair set", () => {
  const database = migratedDatabase();
  const incomplete = database.prepare(`
    SELECT theory_id, COUNT(*) AS count
    FROM questions
    WHERE practice_scope = 'theory_only' AND active = 1
    GROUP BY theory_id
    HAVING COUNT(*) != 30
  `).all();
  assert.deepEqual(incomplete, []);

  const missingTheory = database.prepare(`
    SELECT COUNT(*) AS count
    FROM questions q
    LEFT JOIN theories t ON t.id = q.theory_id AND t.active = 1
    WHERE q.practice_scope = 'theory_only' AND t.id IS NULL
  `).get();
  assert.equal(missingTheory.count, 0);
});
