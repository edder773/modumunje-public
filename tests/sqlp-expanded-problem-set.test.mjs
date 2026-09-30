import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function materializeDatabase() {
  return openCanonicalTestDatabase(projectRoot);
}

function reviewedQuestions(database) {
  return database.prepare(`
    SELECT id, category, topic, difficulty, kind, prompt, choices,
           correct_answers, explanation, theory_id
    FROM questions
    WHERE exam_scope IN ('SQLD', 'SQLP', 'both')
    ORDER BY id
  `).all().map((row) => ({
    ...row,
    choices: JSON.parse(row.choices),
    correctAnswers: JSON.parse(row.correct_answers),
  }));
}

test("keeps the complete reviewed replacement bank with its subject totals", () => {
  const questions = reviewedQuestions(materializeDatabase());
  assert.equal(questions.length, 5225);
  assert.equal(questions.filter((question) => question.category === "데이터 모델링의 이해").length, 123);
  assert.equal(questions.filter((question) => question.category === "SQL 기본 및 활용").length, 381);
  assert.equal(questions.filter((question) => question.category === "SQL 고급 활용 및 튜닝").length, 4721);
  assert.equal(questions.filter((question) => question.kind === "descriptive").length, 64);
  assert.ok(questions.every((question) => question.theory_id !== null));
});

test("keeps every objective answer index, descriptive answer, and markdown field valid", () => {
  const questions = reviewedQuestions(materializeDatabase());
  for (const question of questions) {
    const values = [question.prompt, question.explanation, ...question.choices];
    for (const value of values) {
      const fenceCount = String(value)
        .split(/\r?\n/u)
        .filter((line) => /^\s{0,3}(?:```|~~~)/u.test(line))
        .length;
      assert.equal(fenceCount % 2, 0, `문제 ${question.id} 코드 펜스`);
    }
    assert.doesNotMatch(question.explanation, /## 문제 풀이 적용/);

    if (question.kind === "descriptive") {
      assert.deepEqual(question.choices, []);
      assert.deepEqual(question.correctAnswers, []);
      assert.match(question.explanation, /## 모범답안/);
    } else {
      assert.ok(question.choices.length >= 2);
      assert.ok(question.correctAnswers.length >= 1);
      assert.ok(question.correctAnswers.every(
        (answer) => answer >= 0 && answer < question.choices.length,
      ));
      assert.match(question.explanation, /## 정답/);
      assert.match(question.explanation, /## 상세 해설/);
    }
  }
});

test("code-block choices remain separate from answer labels without shifting indexes", () => {
  const questions = reviewedQuestions(materializeDatabase());
  const codeChoiceQuestions = questions.filter((question) => (
    question.choices.some((choice) => /^\s{0,3}(?:```|~~~)/u.test(choice))
  ));

  assert.ok(codeChoiceQuestions.length > 0);
  for (const question of codeChoiceQuestions) {
    assert.ok(question.correctAnswers.every(
      (answer) => answer >= 0 && answer < question.choices.length,
    ));
    assert.doesNotMatch(
      question.explanation,
      /[①②③④⑤⑥⑦⑧⑨⑩][ \t]+(?:```|~~~)/u,
    );
  }
});

test("replacement content does not retain recurrent PDF, OCR, or source appendices", () => {
  const questions = reviewedQuestions(materializeDatabase());
  const content = questions
    .flatMap((question) => [question.prompt, question.explanation, ...question.choices])
    .join("\n");

  assert.doesNotMatch(content, /\b(?:UNIONALL|GROUPBY|ORDERBY|FROMTABLE|PLANFOR|HASHVALUE|TABLEACCESS|INDEXRANGE)\b/i);
  assert.doesNotMatch(content, /SELECT\s*\*FROM|empwhere/i);
  assert.doesNotMatch(content, /:REG_NOIS(?:NOT)?NULL/i);
  assert.doesNotMatch(content, /수록 문항:\s*\d+문항|(?:out|OUT)\s*\(\d+\)\.pdf/u);
});

test("legacy expansion markers are removed and reviewed retirements are retained", () => {
  const database = materializeDatabase();
  assert.equal(
    database.prepare("SELECT count(*) AS count FROM questions WHERE prompt LIKE '%### SQLP 확장 문제 %'").get().count,
    0,
  );
  assert.deepEqual(
    database.prepare("SELECT id FROM questions WHERE active = 0 ORDER BY id").all()
      .map((row) => row.id),
    [891, 1700, 88100044, 88100249, 88100357],
  );
});
