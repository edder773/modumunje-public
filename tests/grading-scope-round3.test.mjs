import { APPROVED_RELEASE } from "./helpers/approved-release.mjs";
import { readFeatureSource } from "./helpers/feature-source.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";
import {
  stripProblemApplicationSection,
} from "../packages/shared/src/content/content-format.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function source(file) {
  return readFeatureSource(path.join(projectRoot, file), "utf8");
}

function materializeDatabase() {
  return openCanonicalTestDatabase(projectRoot);
}

test("problem-application boilerplate is removed without touching earlier code", () => {
  const value = [
    "## 상세 해설",
    "설명입니다.",
    "",
    "```sql",
    "SELECT * FROM EMP;",
    "```",
    "",
    "## 문제 풀이 적용",
    "- 공통 상용구",
  ].join("\n");
  const stripped = stripProblemApplicationSection(value);

  assert.match(stripped, /SELECT \* FROM EMP/);
  assert.doesNotMatch(stripped, /문제 풀이 적용|공통 상용구/);
});

test("migration preserves reviewed retirements and keeps active descriptive questions in released practical subjects", () => {
  const database = materializeDatabase();
  const totals = database.prepare(`
    SELECT
      COUNT(*) AS physical,
      SUM(active) AS active,
      SUM(active = 1 AND kind = 'descriptive') AS descriptive
    FROM questions
  `).get();
  const invalid = database.prepare(`
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
  const applicationTips = database.prepare(`
    SELECT COUNT(*) AS count
    FROM questions
    WHERE explanation LIKE '%## 문제 풀이 적용%'
  `).get().count;
  const sqlDisplayOrders = database.prepare(`
    SELECT display_order
    FROM questions
    WHERE active = 1 AND exam_scope IN ('SQLD', 'SQLP', 'both')
    ORDER BY display_order
  `).all().map((row) => row.display_order);

  assert.equal(totals.physical, APPROVED_RELEASE.questionCount);
  assert.equal(totals.active, APPROVED_RELEASE.questionCount - 5);
  assert.equal(totals.descriptive, 955);
  assert.equal(invalid, 0);
  assert.equal(applicationTips, 0);
  assert.deepEqual(sqlDisplayOrders, Array.from({ length: 5223 }, (_, index) => index + 1));
  assert.deepEqual(
    database.prepare("SELECT id FROM questions WHERE active = 0 ORDER BY id").all()
      .map((row) => row.id),
    [891, 1700, 88100044, 88100249, 88100357],
  );
});

test("descriptive grading endpoint is retired and self scores are applied without AI", () => {
  const api = source("apps/backend/src/modules/study/study.service.ts");
  const domain = source("apps/backend/src/modules/study/domain/study.domain.ts");

  assert.doesNotMatch(api, /evaluateDescriptive|evaluationReferenceHash|answerHash/);
  assert.match(api, /if \(action === "evaluate"\)[\s\S]*status: 410/);
  assert.match(domain, /function selfAssessmentVerdict/);
  assert.match(api, /selfScore \* \(config\.descriptivePoint \/ 100\)/);
});

test("practice, management, mock exams, and evaluation UI enforce the same compact rules", () => {
  const component = source("apps/frontend/src/features/study/components/study-app.tsx");
  const api = source("apps/backend/src/modules/study/study.service.ts");
  const domain = source("packages/shared/src/study/study-domain.ts");

  assert.match(domain, /questionAllowedForExam/);
  assert.match(component, /const descriptiveAvailable = isDescriptiveAllowed\(examType, category\)/);
  const editor = source("apps/frontend/src/features/admin/components/admin-question-sections.tsx");
  assert.match(editor, /descriptivePlacements\.length > 0 && <option value="descriptive"/);
  assert.match(editor, /if \(!defaultDescriptivePlacement\) return previous/);
  assert.match(api, /isDescriptiveAllowed\(selectedExam, question\.category\)/);
  assert.match(api, /question\.kind === "descriptive"/);
  assert.doesNotMatch(api, /const other = eligible\.filter/);

  assert.match(component, /const examSessions = sessions\.filter\(\(session\) => session\.examType === examType\s*&& !session\.questionIds\.some\(isHiddenPracticalPastQuestion\)/);
  assert.doesNotMatch(component.match(/function MockExamHome[\s\S]*?function ExamRunner/)?.[0] ?? "", /\(\["SQLD", "SQLP"\]/);
  assert.doesNotMatch(component, /잘 작성한 부분|누락된 핵심 내용|잘못 이해한 부분|개선된 답안 예시/);
  assert.match(component, /function DescriptiveGuidance[\s\S]*평가 기준[\s\S]*모범답안[\s\S]*해설/);
  assert.match(component, /내 답안 직접 채점하기/);
  assert.doesNotMatch(component, /AI 평가|자동 평가|답안 평가 중/);
});
