import { readFeatureSource } from "./helpers/feature-source.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";
import {
  areEquivalentContents,
  normalizeMarkdownProse,
} from "../packages/shared/src/content/content-format.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function source(file) {
  return readFeatureSource(path.join(projectRoot, file), "utf8");
}

function materializeDatabase() {
  return openCanonicalTestDatabase(projectRoot);
}

test("every active descriptive question belongs to a released practical subject", () => {
  const database = materializeDatabase();
  const invalidDescriptive = database.prepare(`
    SELECT COUNT(*) AS count
    FROM questions
    WHERE active = 1
      AND kind = 'descriptive'
      AND NOT (
        (exam_scope = 'SQLP' AND category = 'SQL 고급 활용 및 튜닝')
        OR (exam_scope = 'DAP' AND category IN ('데이터 표준화', '데이터 모델링'))
        OR (exam_scope = 'IPEP' AND category = '정보처리실무')
      )
  `).get().count;
  const sqldDescriptive = database.prepare(`
    SELECT COUNT(*) AS count
    FROM questions
    WHERE active = 1
      AND kind = 'descriptive'
      AND exam_scope IN ('SQLD', 'both')
  `).get().count;

  assert.equal(invalidDescriptive, 0);
  assert.equal(sqldDescriptive, 0);
});

test("practice, exams, management, and writes share the descriptive subject rule", () => {
  const component = source("apps/frontend/src/features/study/components/study-app.tsx");
  const api = source("apps/backend/src/modules/study/study.service.ts");
  const adminApi = source("apps/backend/src/modules/admin/admin-request-handlers.ts");
  const adminValues = source("apps/backend/src/modules/admin/admin-content-values.ts");
  const domain = source("packages/shared/src/study/study-domain.ts");

  assert.match(component, /questionAllowedForExam\(question, selectedExam\)/);
  assert.match(component, /scopeQuestions\(data\.questions, selectedExam\)/);
  const editor = source("apps/frontend/src/features/admin/components/admin-question-sections.tsx");
  assert.match(editor, /descriptivePlacements\.length > 0 && <option value="descriptive"/);
  assert.match(adminApi, /from "\.\/admin-content-values"/);
  assert.match(adminValues, /function questionValues\(payload/);
  assert.match(adminValues, /isDescriptiveAllowed\(examScope, category\)/);
  assert.match(api, /questionAllowedForExam\(question, selectedExam\)/);
  assert.match(domain, /isDescriptiveAllowed\(examType: string, category: string\)/);
});

test("equivalent evaluation content is detected despite markdown, HTML, and whitespace", () => {
  const first = "## **모범답안**\n\n인덱스 선두 컬럼을 먼저 확인한다.";
  const second = "<h2>모범답안</h2>   인덱스 선두 컬럼을 먼저 확인한다.";

  assert.equal(areEquivalentContents(first, second), true);
  assert.equal(areEquivalentContents(first, "다른 설명"), false);

  const component = source("apps/frontend/src/features/study/components/study-app.tsx");
  const api = source("apps/backend/src/modules/study/study.service.ts");
  const delivery = source("apps/backend/src/modules/study/study-question-delivery.ts");
  assert.doesNotMatch(component, /showImprovedAnswer|개선된 답안 예시/);
  assert.doesNotMatch(component, /잘 작성한 부분|누락된 핵심 내용|잘못 이해한 부분|개선 방법/);
  assert.match(delivery, /explanation: normalizeExplanationMarkdown/);
  assert.match(api, /detailedExplanation: question\.explanation/);
});

test("prose indentation is normalized without damaging code and nested structures", () => {
  const input = [
    "    일반 설명 문단입니다.",
    "",
    "```sql",
    "  SELECT *",
    "  FROM EMP;",
    "```",
    "",
    "- 목록",
    "    목록의 하위 설명",
    "",
    "    SELECT * FROM EMP;",
  ].join("\n");
  const result = normalizeMarkdownProse(input);

  assert.match(result, /^일반 설명 문단입니다\./);
  assert.match(result, /```sql\n  SELECT \*\n  FROM EMP;\n```/);
  assert.match(result, /- 목록\n    목록의 하위 설명/);
  assert.match(result, /    SELECT \* FROM EMP;/);
});

test("service naming, question labels, modal actions, and responsive grids use clear UI text", () => {
  const component = source("apps/frontend/src/features/study/components/study-app.tsx");
  const layout = source("apps/frontend/app/layout.tsx");
  const styles = source("apps/frontend/app/globals.css");

  assert.match(layout, /title:\s*"모두의 문제집 \| 자격증·전공 학습 플랫폼"/);
  assert.doesNotMatch(layout, /SQLP Study Lab/);
  assert.doesNotMatch(component, /icon="Q"/);
  assert.doesNotMatch(component, />QUESTION \{/);
  assert.doesNotMatch(component, /문제 \{cursor \+ 1\}/);
  assert.match(component, /문제 \{currentIndex \+ 1\}/);
  assert.doesNotMatch(component, /표시 번호/);
  assert.match(styles, /\.modal-actions\s*{[\s\S]*?position:\s*static/);
  assert.match(styles, /\.compact-wrong-list\s*{[\s\S]*?repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.stats-summary\s*{[\s\S]*?repeat\(5, minmax\(0, 1fr\)\)/);
});
