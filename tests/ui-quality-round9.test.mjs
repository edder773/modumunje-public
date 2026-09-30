import { readFeatureSource } from "./helpers/feature-source.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { tsImport } from "tsx/esm/api";
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

test("mock exam reuses the practice setup layout and the common page title", () => {
  const component = source("apps/frontend/src/features/study/components/study-app.tsx")
    + source("apps/frontend/src/features/study/components/study-navigation.ts");
  const topbar = source("apps/frontend/src/features/study/components/study-topbar.tsx");
  const styles = source("apps/frontend/app/globals.css");

  assert.match(component, /const topbarTitle = learningLevel === "root"[\s\S]*courseViewTitle\(activeView, selectedExam, selectedField\.name\)/);
  assert.match(component, /<StudyTopbar[\s\S]*title=\{topbarTitle\}/);
  assert.match(topbar, /contentUsesPrimaryHeading[\s\S]*\? <p className="topbar-title"[\s\S]*: <h1>\{title\}<\/h1>/);
  assert.match(component, /if \(view === "mock"\) return `\$\{examName\} 모의고사`/);
  assert.match(component, /className="practice-setup mock-setup"/);
  assert.match(component, /시험 진행은 자동 저장됩니다/);
  assert.match(styles, /\.mock-intro,\s*\.practice-intro\s*\{/);
  assert.match(styles, /\.mock-setup \.exam-card-grid\s*\{\s*width:\s*100%/);
  assert.match(styles, /\.mock-home \.mock-intro,\s*\.mock-home \.exam-shortage\s*\{\s*width:\s*100%/);
});

test("admin recent content, settings, and quality cards keep readable responsive grids", () => {
  const component = source("apps/frontend/src/features/admin/components/admin-app.tsx");
  const styles = source("apps/frontend/app/admin/admin.css");

  assert.match(component, /admin-activity-list admin-content-activity/);
  assert.match(component, /\/admin\/questions\?focus=/);
  assert.match(component, /\/admin\/theories\?focus=/);
  assert.match(styles, /\.admin-content-activity > a\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto/);
  assert.match(styles, /\.admin-switch\s*\{[\s\S]*grid-template-columns:\s*36px minmax\(0,\s*1fr\)/);
  assert.match(styles, /\.quality-list article\s*\{[\s\S]*grid-template-columns:\s*64px minmax\(0,\s*1fr\) minmax\(150px,\s*auto\)/);
  assert.match(styles, /@media \(max-width:\s*430px\)[\s\S]*\.quality-list article\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
});

test("quality issues link directly to focused question or theory details", () => {
  const component = source("apps/frontend/src/features/admin/components/admin-app.tsx");
  const api = source("apps/backend/src/modules/admin/admin-request-handlers.ts");

  assert.match(component, /useSearchParams/);
  assert.match(component, /searchParams\.get\("focus"\)/);
  assert.match(component, /해당 콘텐츠 확인/);
  assert.match(api, /const focusId = integer\(url\.searchParams\.get\("id"\)\)/);
  assert.match(api, /where\.push\("q\.id = \?"\)/);
  assert.match(api, /where\.push\("t\.id = \?"\)/);
  assert.match(api, /targetIds:\s*\[id\]/);
});

test("active descriptive questions have complete rubrics or a content-bound answer policy and valid scope", async () => {
  const database = materializeDatabase();
  const invalid = database.prepare(`
    SELECT id, exam_scope, category, kind, prompt, explanation, scoring_criteria, required_concepts
    FROM questions
    WHERE active = 1
      AND kind = 'descriptive'
      AND (
        NOT (
          (exam_scope = 'SQLP' AND category = 'SQL 고급 활용 및 튜닝')
          OR (exam_scope = 'DAP' AND category IN ('데이터 표준화', '데이터 모델링'))
        OR (exam_scope = 'IPEP' AND category = '정보처리실무')
        )
        OR json_array_length(scoring_criteria) < CASE WHEN exam_scope = 'SQLP' THEN 3 ELSE 1 END
        OR json_array_length(required_concepts) < CASE WHEN exam_scope = 'SQLP' THEN 2 ELSE 1 END
      )
  `).all();

  const { gradePastAnswer } = await tsImport("../apps/backend/src/modules/study/ipe-practical-past-grading.ts", import.meta.url);
  const policies = new Map(JSON.parse(fs.readFileSync(path.join(projectRoot,
    "apps/backend/resources/ipe-practical-past-answer-policies.json"), "utf8"))
    .map((policy) => [policy.id, policy]));
  for (const row of invalid) {
    assert.equal(row.exam_scope, "IPEP", `invalid scope: ${row.id}`);
    assert.equal(row.category, "정보처리실무", `invalid category: ${row.id}`);
    const policy = policies.get(row.id);
    assert.ok(policy?.active, `missing active rubric or answer policy: ${row.id}`);
    const question = { ...row, examScope: row.exam_scope };
    assert.equal((await gradePastAnswer(question, policy.answer))?.correct, true,
      `canonical answer or content fingerprint mismatch: ${row.id}`);
    assert.equal((await gradePastAnswer(question, "엉뚱한 답 987654"))?.correct, false,
      `unrelated answer accepted: ${row.id}`);
    assert.equal(await gradePastAnswer({ ...question, prompt: question.prompt + " changed" }, policy.answer), null,
      `changed content reused an old answer policy: ${row.id}`);
  }
  database.close();
});

test("persisted checkpoint sections share the detailed explanation baseline", () => {
  const database = materializeDatabase();
  const rows = database.prepare(`
    SELECT id, explanation FROM questions WHERE active = 1
  `).all();
  const indented = [];

  for (const row of rows) {
    const lines = String(row.explanation).split(/\r?\n/);
    let checkpoint = false;
    for (const line of lines) {
      const text = line.trim();
      if (/^#{1,6}\s+(?:오답 판단 포인트|실전 점검|채점 기준)$/.test(text)) {
        checkpoint = true;
        continue;
      }
      if (/^#{1,6}\s+/.test(text)) checkpoint = false;
      if (checkpoint && /^[-*+]\s+/.test(text)) indented.push(row.id);
    }
  }

  assert.deepEqual([...new Set(indented)], []);
});

test("quality duplicate detection includes objective choices and answers", () => {
  const api = source("apps/backend/src/modules/admin/admin-request-handlers.ts");
  const pool = source("packages/shared/src/content/question-pool.mjs");

  assert.match(api, /questionContentFingerprint\(\{/u);
  assert.match(api, /correctAnswers: correct/u);
  assert.match(pool, /const choices = parsedList\(question\?\.choices\)/u);
  assert.match(pool, /question\?\.correctAnswers \?\? question\?\.correct_answers/u);
  assert.match(api, /if \(kind === "descriptive" && active && !practical\)/);
  assert.match(api, /if \(!Boolean\(row\.active\)\) continue/);
});

test("admin quality keeps SW string IDs linkable and checks SW duplicate groups", () => {
  const api = source("apps/backend/src/modules/admin/admin-request-handlers.ts");
  const client = source("apps/frontend/src/features/admin/components/admin-app.tsx");

  assert.match(api, /targetId: string \| number \| null/u);
  assert.match(api, /const swPromptGroups = new Map<string, string\[\]>/u);
  assert.match(api, /const swStemGroups = new Map<string, string\[\]>/u);
  assert.match(api, /const swDisplayOrders = new Map</u);
  assert.match(api, /const id = String\(row[.]id \?\? ""\)[.]trim\(\)/u);
  assert.match(api, /targetType: "sw-question",[\s\S]*?targetId: ids\[0\]/u);
  assert.match(api, /existingSwFingerprintOwners/u);
  assert.match(api, /seenSwQuestionFingerprints/u);
  assert.match(api, /const questionVariantGroups = new Map<number, string>/u);
  assert.match(api, /const isReviewedVariantGroup = Boolean\(reviewedVariantGroup\)/u);
  assert.match(api, /&& !isReviewedVariantGroup/u);
  assert.match(api, /let insideFence = false/u);
  assert.match(api, /if \(!insideFence/u);
  assert.match(api, /replace\(\/\^\\s\{0,3\}\(\?:#\{1,6\}\|>\)/u);
  assert.doesNotMatch(api, /replace\(\/\[`\*_#>\|/u);
  assert.match(client, /targetId: string \| number \| null/u);
  assert.match(client, /const isCollection = issue[.]targetType === "collection"/u);
});
