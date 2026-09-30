import { readFeatureSource } from "./helpers/feature-source.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (file) => readFeatureSource(path.join(root, file), "utf8");

test("server data reaches StudyApp before hydration without a deferred duplicate read", () => {
  const session = source("apps/frontend/src/server/auth/page-session.ts");
  const learner = source("apps/frontend/src/features/study/pages/learner-page.tsx");
  const study = source("apps/frontend/src/features/study/components/study-app.tsx");
  const bootstrap = study.slice(study.indexOf("let cancelled = false"), study.indexOf("const routeFocusKey"));

  assert.match(session, /loadLearnerPageContext/u);
  assert.match(session, /readStudyData\(new Request/u);
  assert.match(learner, /initialData=\{initialData\}/u);
  assert.match(study, /useState<StudyData>\(initialData \?\? EMPTY_DATA\)/u);
  assert.match(study, /if \(!payload\) payload = await refreshData/u);
  assert.doesNotMatch(bootstrap, /setTimeout/u);
});

test("SQL learner reads and writes avoid the full Nest application context", () => {
  const route = source("apps/frontend/app/api/study/route.ts");
  const getRoute = route.slice(route.indexOf("export const GET"), route.indexOf("export const POST"));
  assert.match(getRoute, /handleStudyGet/u);
  assert.match(getRoute, /withApiErrorBoundary/u);
  assert.doesNotMatch(getRoute, /invokeBackend|StudyController/u);
  assert.match(route, /handleStudyPost/u);
  assert.doesNotMatch(route, /invokeBackend|StudyController/u);
});

test("ordinary practice is fresh while mock exam recovery remains explicit", () => {
  const study = source("apps/frontend/src/features/study/components/study-app.tsx")
    + source("apps/frontend/src/features/study/components/sw-curriculum-planner.tsx")
    + source("apps/frontend/src/features/study/components/sw-curriculum-content.tsx");
  const sqlDelivery = source("apps/backend/src/modules/study/study-question-delivery.ts");
  const swService = source("apps/backend/src/modules/sw-study/sw-study.service.ts");
  const swStore = source("apps/frontend/src/features/study/persistence/sw-learning-store.ts");
  assert.doesNotMatch(study, /restorePracticeSession|PracticeSessionSnapshot/u);
  assert.match(study, /readRecentSqlPracticeQuestionIds/u);
  assert.match(study, /recentPracticeQuestionIds/u);
  assert.match(study, /if \(contentView === "mock"\)/u);
  assert.match(study, /delete next\.activeSession/u);
  assert.doesNotMatch(study, /eslint-disable-line react-hooks\/exhaustive-deps/u);
  assert.match(sqlDelivery, /excludedIds: excluded/u);
  assert.match(source("apps/backend/src/modules/study/study-practice-query.mjs"), /ORDER BY exclusion_rank/u);
  assert.match(swService, /rows\.length < limit && excludedIds\.length/u);
  assert.match(swStore, /recentPracticeQuestionIds/u);
});

test("guest record routes return a valid empty pagination envelope", () => {
  const sqlService = source("apps/backend/src/modules/study/study.service.ts");
  const guestRecords = sqlService.slice(
    sqlService.indexOf('scope === "records"'),
    sqlService.indexOf('scope === "mock-session"'),
  );
  assert.match(guestRecords, /scopedEmpty\(\{ selectedExam \}\)/u);
  assert.match(guestRecords, /attemptsNextCursor: null/u);
  assert.match(guestRecords, /bookmarksNextCursor: null/u);
});

test("performance and deployment gates cover real user delivery", () => {
  const telemetry = source("apps/frontend/src/features/study/telemetry/study-telemetry.ts");
  const request = source("apps/frontend/src/shared/api/request-json.ts");
  const worker = source("apps/frontend/worker/index.ts");
  const workerFetch = worker.slice(worker.indexOf("async fetch"), worker.indexOf("async scheduled"));
  const production = source("playwright.production.config.ts");
  const deployed = source("playwright.deployed.config.ts");
  const ci = source(".github/workflows/ci.yml");
  const workflow = source(".github/workflows/post-deploy.yml");
  const build = source("scripts/build-verified.sh");

  assert.match(telemetry, /import\("web-vitals"\)/u);
  assert.match(telemetry, /navigationTraceId/u);
  assert.match(request, /DEFAULT_TOTAL_BUDGET_MS = 5_000/u);
  assert.match(request, /SLOW_REQUEST_NOTICE_MS = 2_000/u);
  assert.doesNotMatch(workerFetch, /scheduleMaintenance/u);
  assert.match(production, /grep: \/@production\/u/u);
  assert.match(deployed, /DEPLOYED_BASE_URL is required/u);
  assert.match(ci, /node-tests:[\s\S]*needs: \[classify, prepare-database, build\]/u);
  assert.match(ci, /name: production-build[\s\S]*path: dist/u);
  assert.match(workflow, /name: Post-deploy verification/u);
  assert.match(workflow, /npm run test:smoke:deployed/u);
  assert.match(workflow, /npm run test:e2e:deployed/u);
  assert.match(build, /export BAEUMZIP_BUILD_SHA=/u);
  assert.match(build, /git -C "\$\{SITES_PROJECT_ROOT\}" rev-parse HEAD/u);
  // A global Suspense fallback hides public documents from browsers without JS.
  assert.equal(fs.existsSync(path.join(root, "apps/frontend/app/loading.tsx")), false);
  assert.equal(fs.existsSync(path.join(root, "apps/frontend/app/learn/loading.tsx")), false);
});

test("unused font preloads and hydration metadata rewrites stay removed", () => {
  const layout = source("apps/frontend/app/layout.tsx");
  assert.doesNotMatch(layout, /next\/font|geist-latin|geist-mono/u);
  assert.doesNotMatch(fs.readFileSync(path.join(root, "apps/frontend/src/features/study/components/study-app.tsx"), "utf8"), /document\.title|meta\[name="description"\]/u);
});
