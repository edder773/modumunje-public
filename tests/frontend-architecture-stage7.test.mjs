import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { readFeatureSource } from "./helpers/feature-source.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function source(file) {
  return readFeatureSource(path.join(root, file), "utf8");
}

function rawSource(file) {
  return readFileSync(path.join(root, file), "utf8");
}

function normalizedBytes(file) {
  const content = rawSource(file).replaceAll("\r\n", "\n");
  return Buffer.byteLength(content, "utf8");
}

async function loadViewModel() {
  const file = path.join(
    root,
    "apps/frontend/src/features/study/model/learning-field-view-model.ts",
  );
  const output = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: file,
    reportDiagnostics: true,
  });
  assert.deepEqual(output.diagnostics ?? [], []);
  return import(`data:text/javascript;base64,${Buffer.from(output.outputText).toString("base64")}`);
}

test("stage 7 keeps feature entry points small and delegates domain rendering", () => {
  const studyApp = rawSource("apps/frontend/src/features/study/components/study-app.tsx");
  const fieldHome = rawSource("apps/frontend/src/features/study/components/learning-field-home.tsx");
  const swPlanner = rawSource("apps/frontend/src/features/study/components/sw-curriculum-planner.tsx");
  const swContent = rawSource("apps/frontend/src/features/study/components/sw-curriculum-content.tsx");
  const adminApp = rawSource("apps/frontend/src/features/admin/components/admin-app.tsx");
  const adminCore = rawSource("apps/frontend/src/features/admin/components/admin-core-sections.tsx");

  assert.ok(normalizedBytes("apps/frontend/src/features/study/components/study-app.tsx") <= 86_000);
  for (const file of [
    "apps/frontend/src/features/study/components/learning-field-home.tsx",
    "apps/frontend/src/features/study/components/sw-curriculum-planner.tsx",
    "apps/frontend/src/features/study/components/sw-question-runners.tsx",
    "apps/frontend/src/features/admin/components/admin-app.tsx",
    "apps/frontend/src/features/admin/components/admin-core-sections.tsx",
    "apps/frontend/src/features/admin/components/admin-dashboard-section.tsx",
    "apps/frontend/src/features/admin/components/admin-question-sections.tsx",
    "apps/frontend/src/features/admin/components/admin-theory-sections.tsx",
    "apps/frontend/src/features/admin/components/admin-ui.tsx",
  ]) {
    assert.ok(normalizedBytes(file) <= 50_000, `${file} exceeds the component budget`);
  }

  assert.match(rawSource("apps/frontend/src/features/study/components/study-lazy-screens.ts"), /LearningFieldHome = lazy\(\(\) => import\("\.\/learning-field-home"\)\)/u);
  assert.match(studyApp, /import StudyHeader/u);
  assert.match(studyApp, /import StudySidebar/u);
  assert.match(studyApp, /usePracticeSession/u);
  assert.match(rawSource("apps/frontend/src/features/study/model/use-practice-session.ts"), /selectSqlPracticeCandidates/u);
  assert.doesNotMatch(studyApp, /pairedChecks|isGeneralPracticeQuestion/u);
  assert.doesNotMatch(studyApp, /function SwCurriculumPlanner|sw-study-api-client/u);
  assert.match(fieldHome, /const SwCurriculumPlanner = lazy\(\(\) => import\("\.\/sw-curriculum-planner"\)\)/u);
  assert.match(swPlanner, /import SwCurriculumContent/u);
  assert.match(swPlanner, /restoreSwSessionSnapshot/u);
  assert.doesNotMatch(swPlanner, /Object\.entries\(session\.answers\)/u);
  assert.doesNotMatch(swPlanner, /<SwTheoryListView|<SwMockRunner|<SwPracticeRunner/u);
  assert.match(swContent, /from "\.\/sw-question-runners"/u);
  assert.match(adminApp, /lazy\(\(\) => import\("\.\/admin-core-sections"\)\)/u);
  assert.match(adminCore, /lazy\(\(\) => import\("\.\/admin-dashboard-section"\)\)/u);
  assert.match(adminCore, /lazy\(\(\) => import\("\.\/admin-question-sections"\)\)/u);
  assert.match(adminCore, /lazy\(\(\) => import\("\.\/admin-theory-sections"\)\)/u);
});

test("admin feature modules depend on shared UI contracts instead of the app shell", () => {
  const directory = path.join(root, "apps/frontend/src/features/admin/components");
  const featureSources = readdirSync(directory)
    .filter((file) => /\.(?:ts|tsx)$/u.test(file))
    .map((file) => rawSource(`apps/frontend/src/features/admin/components/${file}`))
    .join("\n");

  assert.doesNotMatch(featureSources, /from ["']\.\/admin-app["']/u);
  assert.match(source("apps/frontend/src/features/admin/components/admin-ui.tsx"), /export function Modal/u);
  assert.match(source("apps/frontend/src/features/admin/components/admin-content-shared.tsx"), /export function ContentDomainTabs/u);
});

test("SW curriculum collapse is visible and effective only in the mobile breakpoint", () => {
  const selection = source("apps/frontend/src/features/study/components/sw-curriculum-selection.tsx");
  const styles = source("apps/frontend/src/features/study/components/sw-curriculum.css");
  const mobileBreakpoint = styles.indexOf("@media (max-width: 680px)");

  assert.ok(mobileBreakpoint > 0);
  assert.match(selection, /className="outline-button sw-mobile-group-toggle"/u);
  assert.match(selection, /aria-expanded=\{!mobileCollapsed\}/u);
  assert.match(selection, /aria-controls=\{`\$\{group\.id\}-subjects`\}/u);
  assert.match(selection, /data-mobile-collapsed=\{mobileCollapsed \|\| undefined\}/u);
  assert.match(styles.slice(0, mobileBreakpoint), /\.sw-mobile-group-toggle\s*\{\s*display:\s*none/u);
  assert.doesNotMatch(styles.slice(0, mobileBreakpoint), /data-mobile-collapsed/u);
  assert.match(styles.slice(mobileBreakpoint), /\.sw-mobile-group-toggle\s*\{[\s\S]*display:\s*inline-flex/u);
  assert.match(
    styles.slice(mobileBreakpoint),
    /\.sw-subject-group\[data-mobile-collapsed="true"\] \.sw-subject-grid\s*\{\s*display:\s*none/u,
  );
});

test("course card composition accepts a future DAP course without common-component edits", async () => {
  const { buildCourseCardViewModels } = await loadViewModel();
  const sourceCourse = {
    id: "dap-core",
    examType: "DAP",
    name: "DAP",
    summary: "데이터아키텍처 전문가",
    studyMode: "이론·문제",
    mockExam: "100문항",
  };

  const cards = buildCourseCardViewModels(
    [sourceCourse],
    (examType) => `/learn/data-architecture/${examType.toLowerCase()}`,
  );
  assert.deepEqual(cards, [{ ...sourceCourse, href: "/learn/data-architecture/dap" }]);
  assert.doesNotMatch(
    source("apps/frontend/src/features/study/model/learning-field-view-model.ts"),
    /SQLD|SQLP|software-major/u,
  );
});

test("learning field labels and analytics scopes come from catalog configuration", () => {
  const catalog = source("packages/shared/src/study/learning-catalog.ts");
  const studyApp = source("apps/frontend/src/features/study/components/study-app.tsx");
  const swPlanner = source("apps/frontend/src/features/study/components/sw-curriculum-planner.tsx");
  const swRunners = source("apps/frontend/src/features/study/components/sw-question-runners.tsx");

  assert.match(catalog, /shortLabel:\s*string/u);
  assert.match(catalog, /analyticsScope\?:\s*"SW"/u);
  assert.match(studyApp, /selectedField\.shortLabel/u);
  assert.match(source("apps/frontend/app/layout.tsx"), /LEARNING_CATALOG\.flatMap[\s\S]*field\.analyticsScope/u);
  assert.match(source("apps/frontend/src/features/study/telemetry/page-view-tracker.tsx"), /pageViewScope\(path, scopes\)/u);
  assert.doesNotMatch(studyApp, /selectedField\.id ===/u);
  assert.match(swPlanner, /from "\.\/learning-feedback"/u);
  assert.match(swRunners, /from "\.\/learning-feedback"/u);
});
