import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeContentImport } from "../packages/shared/src/admin/admin-import.mjs";
import {
  REGISTERED_EXAM_TYPES,
  REGISTERED_SUBJECTS,
} from "../packages/shared/src/study/course-contract.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceFile = path.join(
  root,
  "apps/backend/resources/content/sources/da-theories-2026-08-24.json",
);
const migrationDirectory = path.join(root, "apps/backend/drizzle");
const importedAt = "2026-08-24T00:00:00.000Z";
const chunkSize = 8;
const firstMigration = 320;
const maximumMigrationBytes = 256 * 1024;

const source = JSON.parse(fs.readFileSync(sourceFile, "utf8"));
assert.equal(source.contentVersion, "da-theories-2026.08.24.1");
assert.equal(source.qualityReview, "passed");

const normalized = normalizeContentImport(source, importedAt, {
  examTypes: REGISTERED_EXAM_TYPES,
  subjects: REGISTERED_SUBJECTS,
});
assert.equal(normalized.questions.length, 0);
assert.equal(normalized.theories.length, 61);
assert.deepEqual(
  normalized.theories.map((theory) => theory.id),
  Array.from({ length: 61 }, (_, index) => 82_600_001 + index),
);

const columns = Object.keys(normalized.theories[0]);
assert.deepEqual(columns, [
  "id",
  "title",
  "category",
  "topic",
  "sort_order",
  "exam_scope",
  "difficulty",
  "active",
  "summary",
  "content",
  "review_answers",
  "keywords",
  "created_at",
  "updated_at",
]);

function sqlValue(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return `CAST(X'${Buffer.from(String(value), "utf8").toString("hex")}' AS TEXT)`;
}

function migrationSource(rows) {
  const firstId = rows.at(0)?.id;
  const lastId = rows.at(-1)?.id;
  const updates = columns
    .filter((column) => column !== "id")
    .map((column) => `  \`${column}\` = excluded.\`${column}\``)
    .join(",\n");
  const statements = rows.map((row) => `INSERT INTO \`theories\` (${columns.map((column) => `\`${column}\``).join(", ")})
VALUES (${columns.map((column) => sqlValue(row[column])).join(", ")})
ON CONFLICT (\`id\`) DO UPDATE SET
${updates};`).join("\n--> statement-breakpoint\n\n");
  return `-- Import reviewed DA theory content ${firstId}-${lastId}.
-- Source: ${path.relative(root, sourceFile)}
-- Content version: ${source.contentVersion}; quality review: ${source.qualityReview}.
${statements}
--> statement-breakpoint
`;
}

const generated = [];
for (let offset = 0; offset < normalized.theories.length; offset += chunkSize) {
  const chunkIndex = Math.floor(offset / chunkSize);
  const rows = normalized.theories.slice(offset, offset + chunkSize);
  const number = String(firstMigration + chunkIndex).padStart(4, "0");
  const name = `${number}_import_reviewed_da_theories_${String(chunkIndex + 1).padStart(2, "0")}.sql`;
  const content = migrationSource(rows);
  const bytes = Buffer.byteLength(content);
  assert.ok(bytes <= maximumMigrationBytes, `${name} exceeds the migration size limit`);
  fs.writeFileSync(path.join(migrationDirectory, name), content, "utf8");
  generated.push({
    bytes,
    name,
    rows: rows.length,
    sha256: crypto.createHash("sha256").update(content).digest("hex"),
  });
}

process.stdout.write(`${JSON.stringify({
  contentVersion: source.contentVersion,
  source: path.relative(root, sourceFile),
  theoryCount: normalized.theories.length,
  migrations: generated,
}, null, 2)}\n`);
