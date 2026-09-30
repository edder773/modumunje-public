import { readFeatureSource } from "./helpers/feature-source.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";
import {
  answersMatchReference,
  extractModelAnswer,
  normalizeMarkdownProse,
  stripProblemApplicationSection,
} from "../packages/shared/src/content/content-format.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function source(file) {
  return readFeatureSource(path.join(projectRoot, file), "utf8");
}

function materializeDatabase() {
  return openCanonicalTestDatabase(projectRoot);
}

test("problem-application sections are removed for markdown, bold, and plain headings", () => {
  for (const heading of ["## 문제 풀이 적용", "## **문제 풀이 적용**", "**문제 풀이 적용**", "문제 풀이 적용:"]) {
    const stripped = stripProblemApplicationSection(`## 해설\n고유 해설\n\n${heading}\n공통 문구`);
    assert.equal(stripped, "## 해설\n고유 해설");
  }
  const component = source("apps/frontend/src/features/study/components/study-app.tsx");
  assert.match(component, /normalizeMarkdownProse\(stripProblemApplicationSection\(value\)\)/);
});

test("malformed and repeated model-answer labels resolve to the answer users copy", () => {
  const malformed = [
    "## 모범답안해설 문장",
    "",
    "모범답안",
    "/*+ LEADING(A B) USE_HASH(B) */",
    "",
    "## 채점 기준",
    "- 올바른 조인 순서",
  ].join("\n");
  const model = extractModelAnswer(malformed);

  assert.equal(model, "/*+ LEADING(A B) USE_HASH(B) */");
  assert.equal(answersMatchReference("/*+ leading(a b) use_hash(b) */", model), true);

  const database = materializeDatabase();
  const importedExplanation = database.prepare(`
    SELECT explanation
    FROM questions
    WHERE kind = 'descriptive'
    ORDER BY id
    LIMIT 1
  `).get().explanation;
  const importedModelAnswer = extractModelAnswer(importedExplanation);
  assert.ok(importedModelAnswer.length >= 20);
  assert.equal(answersMatchReference(importedModelAnswer, importedModelAnswer), true);
  const malformedHeadings = database.prepare(`
    SELECT COUNT(*) AS count
    FROM questions
    WHERE active = 1
      AND kind = 'descriptive'
      AND substr(explanation, 1, length('## 모범답안')) = '## 모범답안'
      AND substr(explanation, length('## 모범답안') + 1, 1) NOT IN (char(10), char(13), ' ')
      AND explanation NOT LIKE '## 모범답안과 상세 해설%'
  `).get().count;
  assert.equal(malformedHeadings, 0);
});

test("explanation headings align with prose while code and nested lists retain structure", () => {
  const normalized = normalizeMarkdownProse([
    "    일반 해설",
    "    ## 채점 기준",
    "- 기준",
    "    하위 설명",
    "",
    "```sql",
    "  SELECT *",
    "  FROM EMP",
    "```",
  ].join("\n"));

  assert.match(normalized, /^일반 해설\n## 채점 기준/m);
  assert.match(normalized, /- 기준\n    하위 설명/);
  assert.match(normalized, /```sql\n  SELECT \*\n  FROM EMP\n```/);
});

test("mock exam results persist and render per-question verdicts and answer comparisons", () => {
  const api = source("apps/backend/src/modules/study/study.service.ts");
  const domain = source("packages/shared/src/study/study-domain.ts");
  const component = source("apps/frontend/src/features/study/components/study-app.tsx");

  assert.match(domain, /questionResults:\s*ExamQuestionResult\[\]/);
  assert.match(api, /const questionResults: ExamResult\["questionResults"\] = \[\]/);
  assert.match(api, /result:\s*!selected\.length \? "unanswered" : correct \? "correct" : "incorrect"/);
  assert.match(api, /questionResults,\s*breakdowns:/);
  assert.match(domain, /breakdowns\?:\s*{/);
  assert.match(api, /topics:\s*buildExamResultBreakdown\(questionResults, byId/);
  assert.match(api, /difficulties:\s*buildExamResultBreakdown\(questionResults, byId/);
  assert.match(component, /문항별 채점 결과/);
  assert.match(component, /오답·부분 정답/);
  assert.match(component, /answerLetters\(item\.selectedAnswers\)/);
  assert.match(component, /answerLetters\(item\.correctAnswers\)/);
  assert.match(domain, /choices\?:\s*string\[\]/);
  assert.match(api, /choices:\s*question\.choices/);
  assert.match(component, /className="exam-review-choices"/);
  assert.match(component, /내 선택/);
  assert.match(component, /<em>정답<\/em>/);
  assert.match(component, /className="category-label">\{question\.category\}<\/span><span className="difficulty-badge">난이도 \{question\.difficulty\}/);
  assert.match(component, /resolvedExamQuestionResults/);
  assert.match(component, /const resultBreakdownsPending = !result\.breakdowns && !allQuestionDetailsLoaded/);
  assert.match(component, /전체 문항 정보를 확인한 뒤 정확한 주제별·난이도별 결과를 한 번에 표시합니다/);
});
