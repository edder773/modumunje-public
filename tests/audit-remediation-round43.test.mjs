import { readFeatureSource } from "./helpers/feature-source.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";

import {
  createExportDocument,
  exportHeaders,
  serializeRowsExport,
} from "../packages/shared/src/admin/admin-export.mjs";
import { normalizeContentImport } from "../packages/shared/src/admin/admin-import.mjs";
import { dedupeCanonicalQuestions } from "../packages/shared/src/content/question-pool.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
test("same-stem variants are grouped without deleting historical IDs", () => {
  const db = openCanonicalTestDatabase(root);
  const grouped = db.prepare(`
    SELECT COUNT(*) AS rows, COUNT(DISTINCT variant_group_id) AS groups
    FROM questions WHERE variant_group_id IS NOT NULL
  `).get();
  assert.deepEqual({ ...grouped }, { rows: 28, groups: 13 });
  assert.deepEqual(
    db.prepare("SELECT id, variant_group_id FROM questions WHERE id IN (603, 722) ORDER BY id").all()
      .map((row) => ({ ...row })),
    [
      { id: 603, variant_group_id: null },
      { id: 722, variant_group_id: null },
    ],
  );
  assert.equal(dedupeCanonicalQuestions([
    { id: 3302, variantGroupId: "sql-variant-3302" },
    { id: 3337, variantGroupId: "sql-variant-3302" },
    { id: 7, variantGroupId: null },
  ]).length, 2);
});

test("six audited learner explanations no longer expose original-item edit history", () => {
  const db = openCanonicalTestDatabase(root);
  const ids = [1222, 1281, 1297, 1358, 1361, 1370];
  const rows = db.prepare(`SELECT id, explanation FROM questions WHERE id IN (${ids.map(() => "?").join(",")}) ORDER BY id`).all(...ids);
  assert.equal(rows.length, ids.length);
  for (const row of rows) {
    assert.doesNotMatch(String(row.explanation), /원본 문항/u);
    assert.match(String(row.explanation), /## (?:정답|상세 해설)/u);
  }
});

test("unlinked theories remain intact instead of receiving unrelated questions", () => {
  const db = openCanonicalTestDatabase(root);
  const rows = db.prepare(`
    SELECT t.id, COUNT(q.id) AS linked
    FROM theories t LEFT JOIN questions q ON q.theory_id = t.id AND q.active = 1
    WHERE t.id IN (934, 935, 937)
    GROUP BY t.id ORDER BY t.id
  `).all();
  assert.deepEqual(rows.map((row) => [row.id, row.linked]), [[934, 0], [935, 0], [937, 0]]);
});

test("SW exports and imports retain IDs, answers and theory relationships", () => {
  const exportedAt = "2026-08-07T00:00:00.000Z";
  const question = {
    id: "SW-TEST-001",
    theory_id: 20001,
    subject_group_id: "data-structure",
    subject_id: "linear-structure",
    category: "자료구조",
    topic: "배열과 연결 리스트",
    display_order: 1,
    difficulty: "중",
    kind: "single",
    prompt: "질문",
    choices: "[\"A\",\"B\"]",
    correct_answers: "[1]",
    explanation: "## 정답\n\n② B",
    active: 1,
  };
  assert.ok(exportHeaders("sw-questions").includes("theory_id"));
  assert.match(serializeRowsExport("sw-questions", "csv", [question], exportedAt), /SW-TEST-001/u);
  const document = createExportDocument("sw-questions", [question], exportedAt);
  const normalized = normalizeContentImport(document, exportedAt);
  assert.equal(normalized.swQuestions[0].id, question.id);
  assert.equal(normalized.swQuestions[0].theory_id, question.theory_id);
  assert.equal(normalized.swQuestions[0].correct_answers, "[1]");
});

test("screen-scoped APIs and public/private caching replace the SQL full bootstrap", () => {
  const route = readFeatureSource(path.join(root, "apps/backend/src/modules/study/study.service.ts"), "utf8")
    + readFeatureSource(path.join(root, "apps/backend/src/modules/study/study-session.repository.ts"), "utf8");
  const sessionDomain = readFeatureSource(path.join(root, "apps/backend/src/modules/study/study-session.domain.ts"), "utf8");
  const scopes = readFeatureSource(path.join(root, "apps/backend/src/modules/study/study-read-scope.ts"), "utf8");
  assert.match(route, /scope === "theory"/u);
  assert.match(route, /scope === "practice"/u);
  assert.match(route, /scope === "records"/u);
  assert.match(route, /public, max-age=0, must-revalidate/u);
  assert.match(route, /private, no-store/u);
  assert.match(route, /questionMeta: \[\]/u);
  assert.match(route, /parseStudyReadScope\(requestedScope\)/u);
  assert.doesNotMatch(scopes, /["']full["']/u);
  assert.match(sessionDomain, /const MOCK_QUESTION_WINDOW = 10/u);
  assert.match(sessionDomain, /function mockQuestionWindow/u);
  assert.match(route, /mockQuestionWindow\(parsed\.questionIds, 0\)/u);
  assert.match(route, /mockQuestionWindow\(activeIds, currentIndex\)/u);
});

test("admin quality and management keep all five content domains explicitly separated", () => {
  const route = readFeatureSource(path.join(root, "apps/backend/src/modules/admin/admin-request-handlers.ts"), "utf8");
  const client = readFeatureSource(path.join(root, "apps/frontend/src/features/admin/components/admin-app.tsx"), "utf8");
  assert.match(route, /FROM sw_questions WHERE active = 1 ORDER BY id/u);
  assert.match(route, /FROM sw_theories WHERE active = 1 ORDER BY id/u);
  assert.match(route, /modelAnswerForQuality/u);
  assert.match(route, /variant-stem-/u);
  assert.match(route, /qualitySnapshot/u);
  assert.match(client, /SW 전공 문제 관리/u);
  assert.match(client, /SW 전공 이론 관리/u);
  const domains = readFeatureSource(path.join(root, "packages/shared/src/admin/content-domains.ts"), "utf8");
  for (const id of ["sql", "da", "bae", "ipe", "sw"]) assert.ok(domains.includes(`id: '${id}'`));
  assert.match(domains, /데이터 아키텍처/u);
  assert.match(client, /CONTENT_ADMIN_DOMAINS[.]map/u);
  assert.match(client, /contentDomain:\s*domain/u);
  assert.match(route, /contentScopesForField/u);
  assert.match(client, /aria-current=\{domain === item[.]id/u);
});

test("descriptive answer reveal is gated by an immutable learner snapshot", () => {
  const source = readFeatureSource(path.join(root, "apps/frontend/src/features/study/components/study-app.tsx"), "utf8");
  assert.match(source, /descriptiveAnswerSnapshot/u);
  assert.match(source, /disabled=\{!descriptiveAnswer\.trim\(\)/u);
  assert.match(source, /setDescriptiveAnswerSnapshot\(descriptiveAnswer\.trim\(\)\)/u);
  assert.match(source, /disabled=\{revealed \|\| Boolean\(evaluation\)\}/u);
  assert.match(source, /answerText\.trim\(\) !== answerSnapshot/u);
  assert.match(source, /examDescriptiveSnapshots/u);
  assert.match(source, /disabled=\{Boolean\(answerSnapshot\)\}/u);
  assert.match(source, /평가 자료를 공개한 시점의 답안을 저장하고 잠갔습니다/u);
  const route = readFeatureSource(path.join(root, "apps/backend/src/modules/study/study.service.ts"), "utf8")
    + readFeatureSource(path.join(root, "apps/backend/src/modules/study/study-session.repository.ts"), "utf8");
  assert.match(route, /function sanitizedExamState/u);
  assert.match(route, /answer !== answerSnapshot/u);
  assert.match(route, /descriptive_snapshots = \?/u);
});
