import { readFeatureSource } from "./helpers/feature-source.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function materializeDatabase() {
  return openCanonicalTestDatabase(projectRoot);
}

function tuningQuestions(database) {
  return database.prepare(`
    SELECT id, kind, prompt, choices, correct_answers, explanation, theory_id,
           scoring_criteria, required_concepts
    FROM questions
    WHERE category = 'SQL 고급 활용 및 튜닝'
    ORDER BY id
  `).all().map((row) => ({
    ...row,
    choices: JSON.parse(row.choices),
    correctAnswers: JSON.parse(row.correct_answers),
    scoringCriteria: JSON.parse(row.scoring_criteria),
    requiredConcepts: JSON.parse(row.required_concepts),
  }));
}

test("keeps the reviewed SQLP tuning bank with only approved retirements inactive", () => {
  const database = materializeDatabase();
  const questions = tuningQuestions(database);
  assert.equal(questions.length, 4721);
  assert.equal(questions.filter((question) => question.kind === "descriptive").length, 64);
  assert.equal(questions.filter((question) => question.kind !== "descriptive").length, 4657);
  assert.ok(questions.every((question) => question.theory_id !== null));
  assert.deepEqual(
    database.prepare("SELECT id FROM questions WHERE active = 0 ORDER BY id").all()
      .map((row) => row.id),
    [891, 1700, 88100044, 88100249, 88100357],
  );
});

test("multiple-choice and descriptive tuning records keep valid learning data", () => {
  const questions = tuningQuestions(materializeDatabase());
  const objective = questions.filter((question) => question.kind !== "descriptive");
  const descriptive = questions.filter((question) => question.kind === "descriptive");

  assert.ok(objective.every((question) => question.choices.length >= 2));
  assert.ok(objective.every((question) => question.correctAnswers.length >= 1));
  assert.ok(objective.every((question) => question.explanation.includes("## 상세 해설")));
  assert.ok(descriptive.every((question) => question.choices.length === 0));
  assert.ok(descriptive.every((question) => question.correctAnswers.length === 0));
  assert.ok(descriptive.every((question) => question.scoringCriteria.length >= 3));
  assert.ok(descriptive.every((question) => question.requiredConcepts.length >= 2));
  assert.ok(descriptive.every((question) => question.explanation.includes("## 모범답안")));
});

test("known SQL distractor defects are explained and OCR artifacts are absent", () => {
  const questions = tuningQuestions(materializeDatabase());
  const content = questions
    .flatMap((question) => [question.prompt, question.explanation, ...question.choices])
    .join("\n");

  assert.match(content, /req\.학습자키\s*=\s*req\.학습자키[\s\S]{0,180}항상 참/u);
  assert.doesNotMatch(content, /\b(?:UNIONALL|GROUPBY|ORDERBY|FROMTABLE|PLANFOR|HASHVALUE|TABLEACCESS|INDEXRANGE)\b/i);
});

test("keeps markdown fences renderable in every tuning field", () => {
  const questions = tuningQuestions(materializeDatabase());
  for (const question of questions) {
    const values = [question.prompt, question.explanation, ...question.choices];
    for (const value of values) {
      const count = String(value)
        .split(/\r?\n/u)
        .filter((line) => /^\s{0,3}(?:```|~~~)/u.test(line))
        .length;
      assert.equal(count % 2, 0, `문제 ${question.id} 코드 펜스`);
    }
  }
});

test("supports descriptive self-assessment in the editor, practice UI, and API", () => {
  const studyApp = readFeatureSource(
    path.join(projectRoot, "apps", "frontend", "src", "features", "study", "components", "study-app.tsx"),
    "utf8",
  );
  const api = readFeatureSource(
    path.join(projectRoot, "apps", "backend", "src", "modules", "study", "study.service.ts"),
    "utf8",
  );
  const adminApi = readFeatureSource(
    path.join(projectRoot, "apps", "backend", "src", "modules", "admin", "admin-request-handlers.ts"),
    "utf8",
  );
  const adminValues = readFeatureSource(
    path.join(projectRoot, "apps", "backend", "src", "modules", "admin", "admin-content-values.ts"),
    "utf8",
  );

  const domain = readFeatureSource(path.join(projectRoot, "packages/shared/src/study/study-domain.ts"), "utf8");
  const editor = readFeatureSource(path.join(projectRoot, "apps/frontend/src/features/admin/components/admin-question-sections.tsx"), "utf8");
  assert.match(domain, /type QuestionKind = "single" \| "multiple" \| "descriptive"/);
  assert.match(studyApp, /kind: QuestionKind/);
  assert.match(studyApp, /평가 기준·모범답안 확인/);
  assert.match(studyApp, /개인 학습 기록에 저장/);
  assert.match(studyApp, /"self-assessment"/);
  assert.match(editor, /descriptivePlacements\.length > 0 && <option value="descriptive"/);
  assert.match(api, /if \(action === "evaluate"\)[\s\S]*status: 410/);
  assert.match(adminApi, /from "\.\/admin-content-values"/);
  assert.match(adminValues, /kind !== "descriptive" && !\[2, 4\]\.includes\(choices\.length\)/);
  assert.match(adminValues, /서술형 문제는 등록된 과정의 지정 과목에서만 등록할 수 있습니다/);
});
