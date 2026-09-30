import { APPROVED_RELEASE } from "./helpers/approved-release.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function materializeDatabase() {
  return openCanonicalTestDatabase(projectRoot);
}

test("every linked question has an active, exam-compatible theory entry point", () => {
  const database = materializeDatabase();
  const broken = database.prepare(`
    SELECT
      q.id,
      q.exam_scope AS question_scope,
      t.exam_scope AS theory_scope,
      t.active AS theory_active
    FROM questions q
    LEFT JOIN theories t ON t.id = q.theory_id
    WHERE q.theory_id IS NOT NULL AND (
      t.id IS NULL
      OR t.active <> 1
      OR (q.exam_scope = 'both' AND t.exam_scope <> 'both')
      OR (q.exam_scope = 'SQLD' AND t.exam_scope NOT IN ('SQLD', 'both'))
      OR (q.exam_scope = 'SQLP' AND t.exam_scope NOT IN ('SQLP', 'both'))
    )
  `).all();

  assert.deepEqual(broken, []);
});

test("all subject 1 and 2 questions open a substantial lesson in the same subject", () => {
  const database = materializeDatabase();
  const broken = database.prepare(`
    SELECT q.id, q.category, t.category AS theory_category, length(t.content) AS content_length
    FROM questions q
    JOIN theories t ON t.id = q.theory_id
    WHERE q.category IN ('데이터 모델링의 이해', 'SQL 기본 및 활용')
      AND (
        t.category <> q.category
        OR length(t.content) < 1100
      )
  `).all();

  assert.deepEqual(broken, []);
});

test("linked lessons are substantial and curriculum-compatible for the full reviewed bank", () => {
  const database = materializeDatabase();
  const broken = database.prepare(`
    SELECT
      q.id,
      q.category,
      q.topic,
      t.category AS theory_category,
      t.topic AS theory_topic,
      length(t.content) AS content_length
    FROM questions q
    JOIN theories t ON t.id = q.theory_id
    WHERE length(t.content) < 700
      OR (
        t.category <> q.category
        AND lower(trim(t.topic)) <> lower(trim(q.topic))
      )
  `).all();

  assert.deepEqual(broken, []);
  assert.equal(database.prepare("SELECT count(*) AS count FROM questions").get().count, APPROVED_RELEASE.questionCount);
});

test("every objective question has in-range answers and explanatory evidence", () => {
  const database = materializeDatabase();
  const brokenAnswers = database.prepare(`
    SELECT DISTINCT q.id
    FROM questions q
    LEFT JOIN json_each(q.correct_answers) answer
    WHERE q.kind <> 'descriptive'
      AND (
        json_array_length(q.choices) < 2
        OR json_array_length(q.correct_answers) < 1
        OR CAST(answer.value AS INTEGER) < 0
        OR CAST(answer.value AS INTEGER) >= json_array_length(q.choices)
        OR instr(q.explanation, '## 정답') = 0
        OR instr(q.explanation, '## 상세 해설') = 0
      )
  `).all();

  assert.deepEqual(brokenAnswers, []);
});

test("legacy broad-range rows are gone and active SQL display order stays continuous", () => {
  const database = materializeDatabase();
  const orders = database.prepare(`
    SELECT display_order
    FROM questions
    WHERE active = 1 AND exam_scope IN ('SQLD', 'SQLP', 'both')
    ORDER BY display_order
  `).all().map((row) => row.display_order);

  assert.equal(database.prepare("SELECT count(*) AS count FROM questions WHERE id < 596").get().count, 0);
  assert.deepEqual(orders, Array.from({ length: 5223 }, (_, index) => index + 1));
  assert.deepEqual(
    database.prepare("SELECT id FROM questions WHERE active = 0 ORDER BY id").all()
      .map((row) => row.id),
    [891, 1700, 88100044, 88100249, 88100357],
  );
});
