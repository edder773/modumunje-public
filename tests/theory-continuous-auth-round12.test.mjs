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

test("the verified SQL and DA theory libraries coexist without breaking links", () => {
  const database = materializeDatabase();
  const summary = database.prepare(
    "SELECT COUNT(*) AS count, SUM(active) AS active FROM theories",
  ).get();

  assert.equal(summary.count, APPROVED_RELEASE.theoryCount);
  assert.equal(summary.active, APPROVED_RELEASE.theoryCount);
  assert.equal(database.prepare(`
    SELECT COUNT(*) AS count FROM theories
    WHERE exam_scope IN ('SQLD', 'SQLP', 'both')
  `).get().count, 158);
  assert.equal(
    database.prepare(
      "SELECT value FROM site_settings WHERE key = 'content_revision_version'",
    ).get().value,
    "20260802_sqlp_122_learning_pairs",
  );
  assert.equal(
    database.prepare(
      "SELECT value FROM site_settings WHERE key = 'theory_revision_version'",
    ).get().value,
    "20260729_sqlp_subject3_verified",
  );
  assert.equal(
    database.prepare(
      `SELECT COUNT(*) AS count
       FROM questions q
       LEFT JOIN theories t ON t.id = q.theory_id
       WHERE q.active = 1 AND q.theory_id IS NOT NULL
         AND (t.id IS NULL OR t.active != 1)`,
    ).get().count,
    0,
  );
  assert.equal(
    database.prepare("SELECT COUNT(*) AS count FROM theories WHERE id BETWEEN 1 AND 119").get().count,
    0,
  );
  const sample = database.prepare("SELECT content FROM theories WHERE id = 717").get();
  assert.match(sample.content, /## 핵심 요약/);
  assert.match(sample.content, /## 복습 문제/);
});

test("page and theory transitions restore the document to the top", () => {
  const component = source("apps/frontend/src/features/study/components/study-app.tsx");

  assert.match(
    component,
    /window\.scrollTo\(\{ top: 0, left: 0, behavior: "auto" \}\);[\s\S]*\[activeView, selectedTheoryId, cursor, examIndex\]/,
  );
  assert.match(component, /onNavigate=\{\(\) => onSelect\(nextTheory\.id\)\}/);
});

test("ordinary practice continues beyond a fixed 20-question batch and has an explicit stop", () => {
  const component = source("apps/frontend/src/features/study/components/study-app.tsx");
  const practice = component.match(/function Practice[\s\S]*?function MockExamHome/)?.[0] ?? "";

  assert.match(component, /continuousPractice/);
  assert.match(component, /setQueue\(ordered\.slice\(0, options\?\.theory \? 10 : undefined\)/);
  assert.doesNotMatch(component, /options\?\.theory \? 10 : 20/);
  assert.match(component, /setQueue\(\(previous\) => \[\.\.\.previous, \.\.\.replenished\]\)/);
  assert.match(practice, /문제 풀이 마치기/);
  assert.match(practice, /원하는 만큼 이어서 풀기/);
  assert.doesNotMatch(practice, /className="number-grid"/);
});

test("guest learning keeps a compact header sign-in without a dashboard promotion", () => {
  const page = source("apps/frontend/src/features/study/pages/learner-page.tsx");
  const component = source("apps/frontend/src/features/study/components/study-app.tsx");
  const styles = source("apps/frontend/app/globals.css");

  assert.match(page, /isAuthenticated=\{false\}/);
  assert.match(component, /className="top-login-link"[\s\S]*로그인/);
  assert.doesNotMatch(component, /className="guest-login-card"/);
  assert.doesNotMatch(component, /브라우저 학습 모드/);
  assert.match(component, /GUEST_LEARNING_STORAGE_KEY/);
  assert.doesNotMatch(styles, /\.guest-login-card\s*\{/);
  assert.match(styles, /\.top-login-link\s*\{/);
});
