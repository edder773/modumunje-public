import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  collectRepositoryHealth,
  comparisonRange,
  containsContentDml,
  evaluateNewSql,
  evaluateSourceBudget,
  guardChangeEntries,
  guardChangedFiles,
  LARGE_SOURCE_FILE_BYTES,
  SCHEMA_SQL_LIMIT_BYTES,
  parseNameStatus,
} from "../scripts/lib/repository-health.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("repository health report is deterministic and accepts the compact baseline", () => {
  assert.deepEqual(collectRepositoryHealth(root), collectRepositoryHealth(root));
  assert.equal(collectRepositoryHealth(root).warnings.length, 0);
  assert.equal(LARGE_SOURCE_FILE_BYTES, 50_000);
  const health = collectRepositoryHealth(root);
  assert.ok(health.architectureMetrics.some((item) => item.file.endsWith("study-app.tsx")));
  assert.ok(health.architectureMetrics.some((item) => item.directHistoryCalls > 0));
});

test("a valid empty comparison range is accepted", () => {
  assert.deepEqual(guardChangedFiles(root, "HEAD...HEAD"), []);
});

test("CI comparison ranges preserve event SHAs and parse rename or delete records", () => {
  assert.equal(comparisonRange("origin/main...HEAD"), "origin/main...HEAD");
  assert.equal(comparisonRange("abc123...def456"), "abc123...def456");
  assert.equal(comparisonRange("main"), "origin/main...HEAD");
  assert.deepEqual(parseNameStatus([
    "R100\told-name.tsx\tnew-name.tsx",
    "D\tremoved.tsx",
    "A\tadded.tsx",
  ].join("\n")), [
    { status: "R100", file: "new-name.tsx", previousFile: "old-name.tsx" },
    { status: "D", file: "removed.tsx" },
    { status: "A", file: "added.tsx" },
  ]);
});

test("external GitHub Actions are pinned to immutable commit SHAs", () => {
  const pending = [path.join(root, ".github")];
  const yamlFiles = [];
  while (pending.length) {
    const directory = pending.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(absolute);
      else if (/\.ya?ml$/u.test(entry.name)) yamlFiles.push(absolute);
    }
  }

  const actionRefs = yamlFiles.flatMap((file) => Array.from(
    fs.readFileSync(file, "utf8").matchAll(/^\s*(?:-\s*)?uses:\s+([^@\s]+)@([^\s#]+)/gmu),
    (match) => ({ file: path.relative(root, file), action: match[1], ref: match[2] }),
  ));
  assert.ok(actionRefs.length > 0);
  for (const actionRef of actionRefs) {
    assert.match(
      actionRef.ref,
      /^[a-f0-9]{40}$/u,
      `${actionRef.file}: ${actionRef.action} must use a full commit SHA`,
    );
  }
});

test("applied migrations cannot be modified, deleted, or renamed", () => {
  for (const entry of [
    { status: "M", file: "apps/backend/drizzle/0554_schema_baseline.sql" },
    { status: "D", file: "apps/backend/drizzle/0554_schema_baseline.sql" },
    {
      status: "R100",
      previousFile: "apps/backend/drizzle/0554_schema_baseline.sql",
      file: "docs/renamed.sql",
    },
  ]) {
    assert.match(guardChangeEntries(root, [entry])[0], /applied migrations are immutable/u);
  }
});

test("retired pre-baseline migrations may be removed but not modified", () => {
  const retired = "apps/backend/drizzle/0297_guard_learning_state_integrity.sql";
  assert.deepEqual(guardChangeEntries(root, [{ status: "D", file: retired }]), []);
  assert.match(
    guardChangeEntries(root, [{ status: "M", file: retired }])[0],
    /applied migrations are immutable/u,
  );
});

test("large new TSX and baseline growth remain guarded", () => {
  assert.equal(LARGE_SOURCE_FILE_BYTES, 50_000);
  const source = "export default function Page(){return null;}\n".repeat(2_000);
  assert.ok(Buffer.byteLength(source) > LARGE_SOURCE_FILE_BYTES);
  assert.match(
    evaluateSourceBudget({ file: "apps/frontend/src/new-large.tsx", bytes: Buffer.byteLength(source) })[0],
    /automatic 50000-byte source limit/u,
  );
  assert.match(
    evaluateSourceBudget({
      file: "apps/frontend/src/features/study/components/study-app.tsx",
      bytes: 87_501,
    })[0],
    /86000-byte budget/u,
  );
  const health = collectRepositoryHealth(root);
  assert.equal(
    health.watchedFiles.find((item) => item.file.endsWith("study-app.tsx"))?.bytes
      <= health.budgets["apps/frontend/src/features/study/components/study-app.tsx"],
    true,
  );
});

test("all content DML after the stage 9 cutoff is rejected while schema DDL passes", () => {
  const bulkRows = Array.from({ length: 30 }, (_, index) => `(${index + 1}, 'row')`).join(",");
  const failures = evaluateNewSql({
    file: "apps/backend/drizzle/0555_bulk_questions.sql",
    content: `INSERT INTO questions (id, prompt) VALUES ${bulkRows};`,
  });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /cannot mutate learning-content tables/u);

  assert.match(evaluateNewSql({
    file: "apps/backend/drizzle/0555_one_theory.sql",
    content: "UPDATE main.`theories` SET title = 'changed' WHERE id = 1;",
  })[0], /use a content release/u);

  assert.deepEqual(evaluateNewSql({
    file: "apps/backend/drizzle/0555_add_release_index.sql",
    content: "CREATE INDEX IF NOT EXISTS idx_content_releases_status ON content_releases(status);",
  }), []);
});

test("content DML classification is independent for consecutive migration files", () => {
  const consecutiveSql = [
    "INSERT INTO questions (id) VALUES (1);",
    "UPDATE main.`theories` SET active = 1;",
    "DELETE FROM [sw_questions] WHERE id = 'SW-1';",
  ];
  assert.deepEqual(consecutiveSql.map(containsContentDml), [true, true, true]);
  assert.deepEqual([...consecutiveSql].reverse().map(containsContentDml), [true, true, true]);
  assert.equal(containsContentDml("CREATE INDEX question_id ON questions(id);"), false);

  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "baeumzip-health-stage2-"));
  try {
    for (const file of Object.keys(collectRepositoryHealth(root).budgets)) {
      const absolute = path.join(fixtureRoot, file);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, "");
    }
    const migrationDirectory = path.join(fixtureRoot, "apps/backend/drizzle");
    fs.mkdirSync(migrationDirectory, { recursive: true });
    for (const [name, sql] of consecutiveSql.map((sql, index) => [
      `${String(index + 1).padStart(4, "0")}_content.sql`,
      sql,
    ])) {
      fs.writeFileSync(path.join(migrationDirectory, name), sql);
    }

    const first = collectRepositoryHealth(fixtureRoot);
    const second = collectRepositoryHealth(fixtureRoot);
    assert.equal(first.migrationSql.contentRelatedCount, 3);
    assert.equal(second.migrationSql.contentRelatedCount, 3);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("content DML guard preserves verbs, quoting, schema qualification, and non-DML handling", () => {
  for (const sql of [
    "INSERT OR REPLACE INTO main.questions (id) VALUES (1);",
    "REPLACE INTO `theories` (id) VALUES (1);",
    "UPDATE OR ROLLBACK [main].\"sw_questions\" SET active = 0;",
    "DELETE FROM 'sw_theories' WHERE id = 'SW-T-1';",
  ]) {
    const failures = evaluateNewSql({
      file: "apps/backend/drizzle/0555_content.sql",
      content: sql,
    });
    assert.equal(failures.length, 1, sql);
  }
  assert.deepEqual(evaluateNewSql({
    file: "apps/backend/drizzle/0555_schema.sql",
    content: "CREATE TABLE questions_archive (id INTEGER); SELECT * FROM questions;",
  }), []);
});

test("oversized new schema SQL requires an explicit redesign", () => {
  const failures = evaluateNewSql({
    file: "apps/backend/drizzle/0555_oversized_schema.sql",
    content: `CREATE TABLE oversized(value TEXT);\n-- ${"x".repeat(SCHEMA_SQL_LIMIT_BYTES)}`,
  });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /schema migration exceeds/u);
});
