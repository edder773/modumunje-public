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

test("public learning screens do not reveal question-bank inventory", () => {
  const dashboard = source("apps/frontend/src/features/study/components/sql/dashboard/dashboard-screen.tsx");
  const practice = source("apps/frontend/src/features/study/components/sql/practice/practice-screen.tsx");
  const stats = source("apps/frontend/src/features/study/components/sql/records/records-screen.tsx");

  assert.doesNotMatch(dashboard, /questions\.length|출제 가능 문제|문항 보유/);
  assert.doesNotMatch(practice, /출제 가능 문제|count\}문항/);
  assert.doesNotMatch(stats, /문항 보유|ids\.size\}문항|item\.questions|difficultyByCategory/);
  assert.match(practice, /className="practice-intro"/);
  assert.match(practice, /배운 개념을 문제로 확인하세요/);
});

test("objective explanation outliers are compacted and only reviewed retirements remain", () => {
  const database = materializeDatabase();
  const outliers = database.prepare(`
    SELECT id, length(explanation) AS length
    FROM questions
    WHERE active = 1
      AND kind <> 'descriptive'
      AND length(explanation) > 1400
  `).all();

  assert.deepEqual(outliers, []);
  assert.deepEqual(
    database.prepare("SELECT id FROM questions WHERE active = 0 ORDER BY id").all()
      .map((row) => row.id),
    [891, 1700, 88100044, 88100249, 88100357],
  );
});

test("the replacement bank retains hierarchical-query coverage without split-word prompts", () => {
  const database = materializeDatabase();
  const hierarchyCount = database.prepare(`
    SELECT count(*) AS count
    FROM questions
    WHERE active = 1
      AND (
        topic LIKE '%계층%'
        OR prompt LIKE '%CONNECT BY%'
        OR explanation LIKE '%CONNECT BY%'
      )
  `).get().count;
  const brokenWords = database.prepare(`
    SELECT count(*) AS count
    FROM questions
    WHERE active = 1
      AND (
        prompt LIKE '%' || '최적 인' || char(10) || char(10) || '덱스' || '%'
        OR explanation LIKE '%' || '최적 인' || char(10) || char(10) || '덱스' || '%'
      )
  `).get().count;

  assert.ok(hierarchyCount > 0);
  assert.equal(brokenWords, 0);
});
