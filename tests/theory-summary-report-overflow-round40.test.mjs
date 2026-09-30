import { readFeatureSource } from "./helpers/feature-source.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function source(file) {
  return readFeatureSource(path.join(root, file), "utf8");
}

test("the canonical subject-three summaries retain the concise reviewed copy", () => {
  const database = openCanonicalTestDatabase(root);
  assert.equal(database.prepare(
    "SELECT COUNT(*) AS count FROM theories WHERE category = 'SQL 고급 활용 및 튜닝'",
  ).get().count, 122);
  assert.equal(
    database.prepare("SELECT MAX(LENGTH(summary)) AS length FROM theories WHERE category = 'SQL 고급 활용 및 튜닝'").get().length,
    127,
  );
  assert.equal(
    database.prepare("SELECT summary FROM theories WHERE id = 736").get().summary,
    "누적 통계를 그대로 비교하지 않고 동일 범위의 Snapshot 차이와 업무량으로 정규화합니다.",
  );
  assert.equal(
    database.prepare("SELECT summary FROM theories WHERE id = 738").get().summary,
    "Child Cursor 누적 통계를 총량·1회당 부하·Parse 효율로 나눠 튜닝 우선순위와 Cursor 공유 문제를 찾습니다.",
  );
});

test("question reports carry the active question and use the existing report workflow", () => {
  const component = source("apps/frontend/src/features/study/components/study-app.tsx");
  const api = source("apps/backend/src/modules/reports/reports.service.ts");

  assert.match(component, /className="question-report-button"[\s\S]*문제 오류 신고/u);
  assert.match(component, /setReportRequest\(\{ mode: "question", questionId: currentQuestion\.id \}\)/u);
  assert.match(component, /submitUserReport\(\{ category, title, description, questionId \}\)/u);
  const client = source("apps/frontend/src/features/study/model/user-report-client.ts");
  assert.match(client, /"\/api\/reports"[\s\S]*method: "POST"[\s\S]*body: JSON\.stringify\(report\)/u);
  assert.match(component, /questionReport \? "content" : "bug"/u);
  assert.match(api, /INSERT INTO user_reports/u);
  assert.match(api, /question_id/u);
});

test("theory cards retain the published three-line preview with a complete reader summary", () => {
  const styles = source("apps/frontend/app/globals.css");

  assert.match(styles, /\.theory-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/u);
  assert.match(styles, /\.theory-reader > \.theory-title\s*\{[\s\S]*overflow-wrap:\s*anywhere/u);
  assert.match(styles, /\.theory-card > p\s*\{[\s\S]*max-width:\s*100%[\s\S]*overflow-wrap:\s*anywhere/u);
  const cardSummaryRule = styles.match(/\.theory-card > p\s*\{[^}]+\}/u)?.[0] ?? "";
  assert.match(cardSummaryRule, /-webkit-line-clamp:\s*3/u);
  assert.match(cardSummaryRule, /(?:^|\n)\s*line-clamp:\s*3/u);
  assert.match(cardSummaryRule, /overflow:\s*hidden/u);
  assert.match(source("apps/frontend/src/features/study/components/sql/theory/theory-screen.tsx"), /className="theory-lead">\{selected\.summary\}/u);
  assert.match(styles, /\.quiz-head-actions\s*\{[\s\S]*min-width:\s*0/u);
});

test("all BAE theory card summaries are concise complete sentences", () => {
  const database = openCanonicalTestDatabase(root);
  const summaries = database.prepare(`
    SELECT id, summary
    FROM theories
    WHERE exam_scope = 'BAE' AND active = 1
    ORDER BY id
  `).all();

  assert.equal(summaries.length, 54);
  assert.ok(summaries.every(({ summary }) => [...summary].length <= 40));
  assert.ok(summaries.every(({ summary }) => summary.endsWith(".")));
  assert.ok(summaries.every(({ summary }) => !summary.includes("…")));
});
