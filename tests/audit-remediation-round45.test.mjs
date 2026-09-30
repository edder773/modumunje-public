import { readFeatureSource } from "./helpers/feature-source.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";
import {
  canonicalQuestionId,
  dedupeCanonicalQuestions,
  isCanonicalPracticeQuestion,
  questionContentFingerprint,
} from "../packages/shared/src/content/question-pool.mjs";
import { canonicalTopicId } from "../packages/shared/src/content/topic-taxonomy.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function source(file) {
  return readFeatureSource(path.join(projectRoot, file), "utf8");
}

function materializeDatabase() {
  return openCanonicalTestDatabase(projectRoot);
}

test("audited SQL topic aliases resolve to one stable taxonomy without rewriting rows", () => {
  const database = materializeDatabase();
  const mismatches = database.prepare(`
    SELECT q.id, q.category, q.topic, q.theory_id,
           t.category AS theory_category, t.topic AS theory_topic
    FROM questions q
    JOIN theories t ON t.id = q.theory_id
    WHERE q.exam_scope IN ('SQLD', 'SQLP', 'both')
      AND lower(trim(q.topic)) <> lower(trim(t.topic))
  `).all();

  assert.equal(mismatches.length, 5);
  for (const row of mismatches) {
    assert.equal(
      canonicalTopicId(row.category, row.topic, row.theory_id),
      canonicalTopicId(row.theory_category, row.theory_topic, row.theory_id),
      `문제 ${row.id} canonical topic`,
    );
  }
});

test("rewritten questions 603 and 722 remain independently selectable", () => {
  const database = materializeDatabase();
  const rows = database.prepare(`
    SELECT id, kind, prompt, choices, correct_answers
    FROM questions
    WHERE id IN (603, 722)
    ORDER BY id
  `).all();

  assert.equal(rows.length, 2);
  assert.notEqual(questionContentFingerprint(rows[0]), questionContentFingerprint(rows[1]));
  assert.equal(canonicalQuestionId(722), 722);
  assert.equal(isCanonicalPracticeQuestion(rows[0]), true);
  assert.equal(isCanonicalPracticeQuestion(rows[1]), true);
  assert.deepEqual(dedupeCanonicalQuestions(rows).map((row) => row.id), [603, 722]);
  const mockCandidateQuery = source(
    "apps/backend/src/modules/study/study-exam-candidate.repository-query.ts",
  );
  assert.doesNotMatch(mockCandidateQuery, /id\s*!=\s*722/u);
});

test("audited historical SQL defects stay corrected in the current bank", () => {
  const database = materializeDatabase();
  const question1437 = database.prepare(`
    SELECT q.category, q.exam_scope, q.theory_id,
           t.category AS theory_category, t.exam_scope AS theory_scope
    FROM questions q JOIN theories t ON t.id = q.theory_id
    WHERE q.id = 1437
  `).get();
  assert.deepEqual({ ...question1437 }, {
    category: "SQL 기본 및 활용",
    exam_scope: "both",
    theory_id: 802,
    theory_category: "SQL 기본 및 활용",
    theory_scope: "both",
  });

  const question688 = database.prepare("SELECT choices FROM questions WHERE id = 688").get();
  assert.equal(new Set(JSON.parse(question688.choices)).size, 4);

  const question781 = database.prepare(
    "SELECT choices, correct_answers FROM questions WHERE id = 781",
  ).get();
  const choices781 = JSON.parse(question781.choices);
  assert.notEqual(choices781[2], choices781[3]);
  assert.deepEqual(JSON.parse(question781.correct_answers), [2, 3]);

  const prompts = database.prepare(
    "SELECT id, prompt FROM questions WHERE id IN (629, 633) ORDER BY id",
  ).all();
  assert.notEqual(prompts[0].prompt, prompts[1].prompt);
});

test("audit remediations are wired into learner and administrator flows", () => {
  const learner = source("apps/frontend/src/features/study/components/study-app.tsx");
  const studyApi = source("apps/backend/src/modules/study/study.service.ts");
  const admin = source("apps/frontend/src/features/admin/components/admin-app.tsx");
  const adminApi = source("apps/backend/src/modules/admin/admin-request-handlers.ts");

  assert.match(learner, /aria-label="모두의 문제집"/u);
  assert.match(learner, /\[\.\.\.field[.]courses, \.\.\.practiceCourses\][.]map\(\(course\) => course[.]name\)[.]join\("·"\)/u);
  assert.match(learner, /isCanonicalPracticeQuestion/u);
  assert.match(studyApi, /isCanonicalPracticeQuestion/u);
  assert.match(learner, /이 단원에 연결된 문제를 준비하고 있습니다/u);
  assert.match(admin, /<label>연결 문제<select value=\{filters\.linked\}/u);
  assert.match(admin, /<option value="none">0건<\/option>/u);
  assert.match(adminApi, /linked === "none"/u);
  assert.match(adminApi, /questionContentFingerprint/u);
  assert.match(adminApi, /canonicalTopicId/u);
});
