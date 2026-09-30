import { APPROVED_RELEASE } from "./helpers/approved-release.mjs";
import { readFeatureSource } from "./helpers/feature-source.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function source(file) {
  return readFeatureSource(path.join(projectRoot, file), "utf8");
}

function materializeDatabase() {
  return openCanonicalTestDatabase(projectRoot);
}

test("keeps the reviewed bank with continuous active SQL display numbers", () => {
  const database = materializeDatabase();
  const totals = database.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(kind != 'descriptive') AS objective,
      SUM(kind != 'descriptive' AND difficulty = '하') AS low
    FROM questions
    WHERE active = 1
  `).get();
  const physicalTotal = database.prepare("SELECT COUNT(*) AS count FROM questions").get().count;
  const sqlOrders = database.prepare(`
    SELECT display_order
    FROM questions
    WHERE active = 1 AND exam_scope IN ('SQLD', 'SQLP', 'both')
    ORDER BY display_order
  `).all().map((row) => row.display_order);

  assert.equal(physicalTotal, APPROVED_RELEASE.questionCount);
  assert.equal(totals.total, APPROVED_RELEASE.questionCount - 5);
  assert.equal(totals.objective, APPROVED_RELEASE.questionCount - 960);
  assert.ok(totals.low > 0);
  assert.ok(totals.low < totals.objective);
  assert.deepEqual(sqlOrders, Array.from({ length: 5223 }, (_, index) => index + 1));
  const allActiveOrders = database.prepare(`
    SELECT display_order FROM questions WHERE active = 1 ORDER BY display_order
  `).all().map((row) => row.display_order);
  assert.equal(new Set(allActiveOrders).size, allActiveOrders.length);
});

test("SQLD has enough eligible objective questions without SQLP-only tuning content", () => {
  const database = materializeDatabase();
  const counts = database.prepare(`
    SELECT category, COUNT(*) AS count
    FROM questions
    WHERE active = 1
      AND exam_scope IN ('SQLD', 'both')
      AND kind IN ('single', 'multiple')
    GROUP BY category
  `).all();
  const byCategory = Object.fromEntries(counts.map((row) => [row.category, row.count]));

  assert.ok(byCategory["데이터 모델링의 이해"] >= 10);
  assert.ok(byCategory["SQL 기본 및 활용"] >= 40);
  assert.equal(byCategory["SQL 고급 활용 및 튜닝"], undefined);
  assert.equal(database.prepare(`
    SELECT COUNT(*) AS count
    FROM questions
    WHERE exam_scope IN ('SQLD', 'both') AND kind = 'descriptive'
  `).get().count, 0);
});

test("SQLP has enough questions for 70 objective and 2 practical items", () => {
  const database = materializeDatabase();
  const objective = database.prepare(`
    SELECT category, COUNT(*) AS count
    FROM questions
    WHERE active = 1
      AND exam_scope IN ('SQLP', 'both')
      AND kind IN ('single', 'multiple')
    GROUP BY category
  `).all();
  const counts = Object.fromEntries(objective.map((row) => [row.category, row.count]));
  const practical = database.prepare(`
    SELECT COUNT(*) AS count
    FROM questions
    WHERE active = 1
      AND exam_scope IN ('SQLP', 'both')
      AND kind = 'descriptive'
  `).get().count;

  assert.ok(counts["데이터 모델링의 이해"] >= 10);
  assert.ok(counts["SQL 기본 및 활용"] >= 20);
  assert.ok(counts["SQL 고급 활용 및 튜닝"] >= 40);
  assert.ok(practical >= 2);
});

test("creates durable user, evaluation, and exam-session storage", () => {
  const database = materializeDatabase();
  const tables = database.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
  `).all().map((row) => row.name);

  for (const name of ["user_settings", "ai_evaluations", "exam_sessions"]) {
    assert.ok(tables.includes(name), name);
  }
  const questionColumns = database.prepare("PRAGMA table_info(questions)").all().map((row) => row.name);
  for (const column of ["display_order", "exam_scope", "active", "scoring_criteria", "required_concepts"]) {
    assert.ok(questionColumns.includes(column), column);
  }
});

test("exam configs encode the official requested structures in one shared engine", () => {
  const registry = source("packages/shared/src/study/course-contract.mjs");
  const api = source("apps/backend/src/modules/study/study.service.ts");

  assert.match(registry, /"examType":\s*"SQLD"[\s\S]*"durationMinutes":\s*90[\s\S]*"데이터 모델링의 이해":\s*10[\s\S]*"SQL 기본 및 활용":\s*40[\s\S]*"totalQuestions":\s*50[\s\S]*"passingScore":\s*60/);
  assert.match(registry, /"examType":\s*"SQLP"[\s\S]*"durationMinutes":\s*180[\s\S]*"데이터 모델링의 이해":\s*10[\s\S]*"SQL 기본 및 활용":\s*20[\s\S]*"SQL 고급 활용 및 튜닝":\s*40[\s\S]*"descriptiveCount":\s*2[\s\S]*"passingScore":\s*75/);
  assert.match(api, /const config = selectedExam === "IPEP" \? \{ \.\.\.EXAM_CONFIGS\[selectedExam\],/);
  assert.match(api, /\} : EXAM_CONFIGS\[selectedExam\];/);
  assert.match(api, /score\.rate < config\.subjectMinimumRate/);
  assert.match(api, /selfScore \* \(config\.descriptivePoint \/ 100\)/);
});

test("practice defaults to objective and only SQLP subject 3 can opt into descriptive questions", () => {
  const component = source("apps/frontend/src/features/study/components/study-app.tsx");
  const domain = source("packages/shared/src/study/study-domain.ts");
  const registry = source("packages/shared/src/study/course-contract.mjs");

  assert.match(component, /useState<PracticeKind>\("objective"\)/);
  assert.match(component, /const descriptiveAvailable = isDescriptiveAllowed\(examType, category\)/);
  assert.match(component, /descriptiveAvailable \? \[\["descriptive", "서술형"\]/);
  assert.match(domain, /descriptiveSubjects\(examType\)\.includes/);
  assert.match(registry, /"examType":\s*"SQLP"[\s\S]*"descriptiveSubjects":\s*\[[\s\S]*"SQL 고급 활용 및 튜닝"/);
  assert.match(component, /item\.kind === "descriptive"/);
});

test("descriptive answers use durable learner self assessment without AI calls", () => {
  const api = source("apps/backend/src/modules/study/study.service.ts");
  const component = source("apps/frontend/src/features/study/components/study-app.tsx");
  const schema = source("apps/backend/src/infrastructure/database/schema.ts");

  assert.doesNotMatch(api, /evaluateDescriptive|evaluationReferenceHash|answerHash/);
  assert.match(api, /if \(action === "evaluate"\)[\s\S]*status: 410/);
  assert.match(component, /평가 기준·모범답안 확인/);
  assert.match(component, /내 점수 저장/);
  assert.match(component, /function DescriptiveGuidance/);
  assert.match(schema, /descriptiveScores: text\("descriptive_scores"\)/);
});

test("content management is server-protected and theory practice uses only direct links", () => {
  const api = source("apps/backend/src/modules/study/study.service.ts");
  const adminApi = source("apps/backend/src/modules/admin/admin-request-handlers.ts");
  const component = source("apps/frontend/src/features/study/components/study-app.tsx");

  assert.match(api, /if \(action === "theory"\)[\s\S]*관리자 페이지에서만 사용할 수 있습니다/);
  assert.match(api, /if \(action === "question"\)[\s\S]*관리자 페이지에서만 사용할 수 있습니다/);
  assert.match(adminApi, /authorizeAdminRequest\(request\)/);
  assert.match(adminApi, /async function insertQuestion\(payload: JsonRecord\)[\s\S]*INSERT INTO questions/);
  assert.match(adminApi, /async function insertTheory\(payload: JsonRecord\)[\s\S]*INSERT INTO theories/);
  assert.match(api, /function PATCH\(\)[\s\S]*관리자 페이지에서만 사용할 수 있습니다/);
  assert.match(api, /function DELETE\(\)[\s\S]*관리자 페이지에서만 사용할 수 있습니다/);
  assert.doesNotMatch(component, /문제 수정|이론 수정|백업 파일 다운로드|백업 파일 가져오기/);
  assert.match(component, /const linked = questions\.filter\(\(question\) => question\.theoryId === theoryId\)/);
  assert.doesNotMatch(component, /else if \(question\.topic === article\.topic\) score = 3/);
  assert.match(component, /slice\(0, 10\)/);
});

test("wrong-note lists stay compact and details use the common renderer", () => {
  const component = source("apps/frontend/src/features/study/components/study-app.tsx");
  const styles = source("apps/frontend/app/globals.css");

  assert.match(component, /className="card wrong-summary-card"/);
  assert.match(component, /<WrongDetailModal/);
  assert.doesNotMatch(component.match(/function WrongNote[\s\S]*?function WrongDetailModal/)?.[0] ?? "", /question\.explanation/);
  assert.match(styles, /-webkit-line-clamp:\s*2/);
});

test("markdown, modal, code, tables, and mobile layout are width-safe", () => {
  const styles = source("apps/frontend/app/globals.css");
  const layout = source("apps/frontend/app/layout.tsx");

  assert.match(layout, /width:\s*"device-width"/);
  assert.match(layout, /viewportFit:\s*"cover"/);
  assert.match(styles, /\.modal\s*{[\s\S]*?width:\s*min\(760px, calc\(100vw - 24px\)\)[\s\S]*?max-height:\s*calc\(100dvh - 24px\)/);
  assert.match(styles, /\.modal-body\s*{[\s\S]*?overflow-y:\s*auto/);
  assert.match(styles, /\.code-block pre,[\s\S]*?\.markdown-table-wrap\s*{[\s\S]*?overflow-x:\s*auto/);
  assert.match(styles, /\.markdown-body p\s*{[\s\S]*?text-indent:\s*0[\s\S]*?overflow-wrap:\s*anywhere/);
  assert.match(styles, /@media \(max-width: 360px\)/);
  assert.match(styles, /\.exam-layout\s*{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/);
});
