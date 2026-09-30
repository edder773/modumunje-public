import { readFeatureSource } from "./helpers/feature-source.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (relativePath) => readFeatureSource(path.join(root, relativePath), "utf8");

test("course home and each learning screen request only their scoped content", () => {
  const api = source("apps/backend/src/modules/study/study.service.ts");
  const siteSettings = source("apps/backend/src/modules/study/study-site-settings-cache.ts");
  const app = source("apps/frontend/src/features/study/components/study-app.tsx");
  const session = source("apps/frontend/src/server/auth/page-session.ts");
  const router = source("apps/frontend/src/features/study/routing/use-learning-router.ts");

  assert.match(api, /scope === "overview"[\s\S]*readCourseOverview/u);
  const repository = source("apps/backend/src/modules/study/study.repository.ts");
  assert.match(repository, /async readCourseContentOverview/u);
  assert.match(repository, /async readCourseUserOverview[\s\S]*await d1[.]batch\(\[/u);
  assert.match(api, /courseOverviewInputs\(studyRepository/u);
  assert.match(siteSettings, /await repository\.findPublicSiteSettings\(\)/u);
  assert.doesNotMatch(siteSettings, /CACHE_TTL|pending|cachedAt/u);
  assert.match(api, /readPublicSiteSettings\(studyRepository\)/u);
  assert.match(api, /scope === "theories"[\s\S]*readTheoryList/u);
  assert.match(api, /scope === "practice"[\s\S]*readPracticeBatch/u);
  assert.match(api, /scope === "records"[\s\S]*readRecords/u);
  assert.match(app, /view === "theory"[\s\S]*window\.location\.assign\(destination\)[\s\S]*view === "practice"[\s\S]*\? "practice-meta"/u);
  assert.match(app, /await refreshData\(scope,/u);
  assert.match(session, /!route \|\| route\.page === "field" \|\| route\.page === "home"/u);
  assert.match(app, /initialLearningRoute\?\.page === "home"[\s\S]*\? "shell"/u);
  assert.match(router, /strategy: "router" \| "client" = "client"/u);
  assert.match(app, /Dashboard = lazy\(\(\) => import\("\.\/sql\/dashboard\/dashboard-screen"\)\)/u);
  assert.match(app, /<Suspense fallback=\{<LearningLoadingState/u);
  assert.doesNotMatch(
    app.match(/function selectLearningCourse[\s\S]*?async function retryCourseData/u)?.[0] ?? "",
    /refreshData\("overview"\)|setLoading\(true\)/u,
  );
  assert.doesNotMatch(app, /await refreshData\("full"\)/u);
});

test("learning read indexes are valid and cover the high-frequency lookup columns", () => {
  const database = openCanonicalTestDatabase(root);

  const indexes = database.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'
  `).all().map((row) => row.name);
  for (const expected of [
    "ai_evaluations_user_time_idx",
    "attempts_user_exam_time_idx",
    "questions_active_display_idx",
    "questions_active_scope_category_kind_idx",
    "theories_active_category_order_idx",
  ]) assert.ok(indexes.includes(expected), expected);

  const plan = database.prepare(`
    EXPLAIN QUERY PLAN
    SELECT * FROM attempts
    WHERE user_key = ? AND exam_type = ?
    ORDER BY created_at, id
  `).all("member", "SQLP").map((row) => String(row.detail)).join("\n");
  assert.match(plan, /attempts_user_exam_time_idx/u);
});

test("course-home hierarchy is compact while the current-course panel has more room", () => {
  const css = source("apps/frontend/app/globals.css");
  assert.match(css, /\.entry-hero \{[\s\S]*grid-template-columns: minmax\(0, 1\.15fr\) minmax\(360px, \.85fr\)/u);
  assert.match(css, /\.entry-hero h2 \{[\s\S]*font-size: clamp\(30px, 3\.25vw, 46px\)/u);
  assert.match(css, /\.current-course-panel \{[\s\S]*min-height: 280px/u);
  assert.match(css, /\.learning-context-bar \{[\s\S]*min-height: 54px/u);
  assert.match(css, /\.learning-context-bar \{[\s\S]*width: 100%;[\s\S]*max-width: none;[\s\S]*margin: -10px 0 24px/u);
});

test("practice and mock-exam setup content starts from the left edge", () => {
  const css = source("apps/frontend/app/globals.css");
  assert.match(css, /\.practice-setup \{[\s\S]*justify-content: start/u);
  assert.match(css, /\.exam-card-grid \{[\s\S]*margin-inline: 0/u);
  assert.match(css, /\.mock-home \.mock-intro,[\s\S]*margin-inline: 0/u);
});
