import { readFeatureSource } from "./helpers/feature-source.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function source(path) {
  return readFeatureSource(new URL(`../${path}`, import.meta.url), "utf8");
}

test("catalog and course entry keep screen data scoped instead of loading the full bank", () => {
  const study = source("apps/frontend/src/features/study/components/study-app.tsx");
  const apiClient = source("apps/frontend/src/features/study/model/study-api-client.ts");
  const api = source("apps/backend/src/modules/study/study.service.ts");
  const scopes = source("apps/backend/src/modules/study/study-read-scope.ts");

  assert.match(api, /const requestedScope = url\.searchParams\.get\("scope"\)/u);
  assert.match(api, /const scope = parseStudyReadScope\(requestedScope\)/u);
  assert.doesNotMatch(scopes, /["']full["']/u);
  assert.match(api, /scope === "shell"[\s\S]*?scope === "overview"/u);
  assert.match(api, /async function readLearningShell/u);
  assert.match(api, /async function readCourseOverview/u);
  assert.match(api, /questions:\s*\[\],[\s\S]*theories:\s*\[\]/u);
  assert.match(study, /requestStudyData<StudyData>/u);
  assert.match(apiClient, /new URLSearchParams\(\{ scope \}\)/u);
  assert.match(study, /if \(view === "dashboard"\) return;[\s\S]*?await refreshData\(scope,/u);
  assert.match(study, /fetchStudyData\("practice", params\)/u);
  assert.doesNotMatch(`${study}\n${apiClient}`, /["']full["']/u);
});

test("learning paths derive their field and course from the catalog", () => {
  const catalog = source("packages/shared/src/study/learning-catalog.ts");

  assert.match(catalog, /function learningFieldForCourse/u);
  assert.match(catalog, /const base = `\/learn\/\$\{field\.id\}\/\$\{course\.id\}`/u);
  assert.match(catalog, /const field = learningField\(segments\[1\]\)/u);
  assert.doesNotMatch(catalog, /segments\[1\] !== "sql"/u);
  assert.doesNotMatch(catalog, /const base = `\/learn\/sql/u);
});

test("learner and administrator searches handle normalized multiword queries", () => {
  const study = source("apps/frontend/src/features/study/components/study-app.tsx");
  const adminApi = source("apps/backend/src/modules/admin/admin-request-handlers.ts");

  assert.match(study, /function normalizedSearchTokens/u);
  assert.match(study, /tokens\.every\(\(token\) => searchableText\.includes\(token\)\)/u);
  assert.match(study, /className="theory-search-reset"/u);
  assert.match(adminApi, /function searchTokens/u);
  assert.match(adminApi, /for \(const token of searchTokens\(search\)\)/u);
  assert.match(adminApi, /searchWhere\.join\(" AND "\)/u);
});

test("first-round cleanup removes stale entry styles and starter assets", () => {
  const styles = source("apps/frontend/app/globals.css");

  assert.doesNotMatch(styles, /\.catalog-hero/u);
  assert.doesNotMatch(styles, /\.field-selection-hero/u);
  assert.doesNotMatch(styles, /\.learning-hierarchy/u);
  for (const asset of ["public/file.svg", "public/globe.svg", "public/window.svg"]) {
    assert.equal(fs.existsSync(new URL(`../${asset}`, import.meta.url)), false);
  }
});

test("course loading failures remain actionable and catalog headings stay semantic", () => {
  const feedback = source("apps/frontend/src/features/study/components/learning-feedback.tsx");
  const catalog = source("apps/frontend/src/features/study/components/catalog/catalog-home.tsx");
  const styles = source("apps/frontend/app/globals.css");

  assert.match(feedback, /function LearningLoadError/u);
  assert.match(feedback, /다시 불러오기/u);
  assert.match(catalog, /<h3 id=\{`catalog-field-\$\{field[.]id\}`\}>\{field[.]cardTitle\}<\/h3>/u);
  assert.match(styles, /\.learning-load-error/u);
  assert.match(styles, /\.learning-field-card > header h3/u);
});
