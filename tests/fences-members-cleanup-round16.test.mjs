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

test("question-bank generation and quality checks use renderable markdown fences", () => {
  const generator = source("scripts/generate-question-bank-replacement.mjs");
  const adminApi = source("apps/backend/src/modules/admin/admin-request-handlers.ts");
  const database = openCanonicalTestDatabase(projectRoot);

  assert.match(generator, /function answerChoiceMarkdown/);
  assert.match(generator, /`\$\{label\}\\n\\n\$\{normalizedChoice\}`/);
  assert.ok(adminApi.includes(
    ".filter((line) => /^\\s{0,3}(?:```|~~~)/u.test(line));",
  ));

  const rows = database.prepare(`
    SELECT id, prompt, explanation
    FROM questions
    ORDER BY id
  `).all();
  assert.equal(rows.length, APPROVED_RELEASE.questionCount);
  for (const row of rows) {
    for (const [field, markdown] of [["prompt", row.prompt], ["explanation", row.explanation]]) {
      const fenceCount = String(markdown)
        .split(/\r?\n/u)
        .filter((line) => /^\s{0,3}(?:```|~~~)/u.test(line))
        .length;
      assert.equal(fenceCount % 2, 0, `문제 ${row.id} ${field} 코드 펜스`);
      assert.doesNotMatch(
        String(markdown),
        /[①②③④⑤⑥⑦⑧⑨⑩][ \t]+(?:```|~~~)/u,
        `문제 ${row.id} ${field} 인라인 시작 펜스`,
      );
    }
  }
});

test("the canonical release retains only the reviewed inactive question set", () => {
  const database = openCanonicalTestDatabase(projectRoot);
  assert.deepEqual(
    database.prepare("SELECT id FROM questions WHERE active = 0 ORDER BY id").all()
      .map((row) => row.id),
    [891, 1700, 88100044, 88100249, 88100357],
  );
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
});

test("member search has a dedicated responsive grid and accessible identifier input", () => {
  const ui = source("apps/frontend/src/features/admin/components/admin-app.tsx");
  const styles = source("apps/frontend/app/admin/admin.css");

  assert.match(ui, /className="member-filter-form"/);
  assert.match(ui, /className="member-search-field"[\s\S]*<span>회원 검색<\/span>/);
  assert.match(ui, /placeholder="이름·이메일·회원 식별값"/);
  assert.match(ui, /aria-label="이름, 이메일 또는 회원 식별값 검색"/);
  assert.match(styles, /\.admin-filter-card form\.member-filter-form\s*\{[\s\S]*grid-template-columns:/);
  assert.match(
    styles,
    /@media \(max-width: 720px\)[\s\S]*\.admin-filter-card form\.member-filter-form\s*\{[\s\S]*grid-template-columns: minmax\(0, 1fr\)/,
  );
});
