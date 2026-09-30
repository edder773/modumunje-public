import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  CONTENT_MIGRATION_CUTOFF,
  CONTENT_RELEASE_TABLES,
  SCHEMA_BASELINE_VERSION,
} from "../../packages/shared/src/database/schema-contract.mjs";

export const LEGACY_MIGRATION_MAX = Number(CONTENT_MIGRATION_CUTOFF);
export const SCHEMA_SQL_LIMIT_BYTES = 256 * 1024;
export const LARGE_SOURCE_FILE_BYTES = 50_000;
export const SOURCE_FILE_BUDGETS = Object.freeze({
  "apps/frontend/src/features/study/components/study-app.tsx": 86_000,
  "apps/frontend/src/features/study/components/sw-curriculum-planner.tsx": 43_500,
  "apps/frontend/app/globals.css": 600,
  "apps/frontend/app/styles/design-system-base.css": 1_200,
  "apps/frontend/app/styles/global-foundation.css": 62_500,
  "apps/frontend/app/styles/sql-learning.css": 23_600,
  "apps/frontend/app/styles/ui-integrity.css": 13_200,
  "apps/frontend/app/styles/readability.css": 4_300,
  "apps/frontend/app/styles/question-privacy.css": 2_400,
  "apps/frontend/app/styles/account-learning.css": 15_300,
  "apps/frontend/app/styles/responsive-learning.css": 8_500,
  "apps/frontend/app/styles/service-entry.css": 13_900,
  "apps/frontend/app/styles/platform-navigation.css": 5_300,
  "apps/frontend/app/styles/sw-learning.css": 7_400,
  "apps/frontend/app/styles/accessibility.css": 13_900,
  "apps/frontend/app/styles/audit-remediation.css": 5_600,
  // Includes restored analytics styling and responsive backup creation controls.
  "apps/frontend/app/admin/admin.css": 65_000,
  "apps/backend/src/modules/admin/admin-request-handlers.ts": 22_000,
  "apps/backend/src/modules/study/study.service.ts": 50_050,
  "apps/backend/src/modules/study/study.repository.ts": 25_163,
});
export const UI_FILE_BUDGETS = SOURCE_FILE_BUDGETS;

const CONTENT_TABLE_PATTERN = `(?:${CONTENT_RELEASE_TABLES.join("|")})`;
const CONTENT_DML_PATTERN_SOURCE = String.raw`\b(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|REPLACE\s+INTO|UPDATE(?:\s+OR\s+\w+)?|DELETE\s+FROM)\s+(?:(?:"|'|\[|\x60)?[a-z_]\w*(?:"|'|\]|\x60)?\s*[.]\s*)?(?:"|'|\[|\x60)?${CONTENT_TABLE_PATTERN}\b`;
const CONTENT_DML_MATCH_PATTERN = new RegExp(
  CONTENT_DML_PATTERN_SOURCE,
  "giu",
);
const CONTENT_DML_TEST_PATTERN = new RegExp(CONTENT_DML_PATTERN_SOURCE, "iu");

export function containsContentDml(content) {
  return CONTENT_DML_TEST_PATTERN.test(content);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function relative(root, file) {
  return path.relative(root, file).replaceAll("\\", "/");
}

function normalizedTextBytes(file) {
  return Buffer.byteLength(fs.readFileSync(file, "utf8").replaceAll("\r\n", "\n"));
}

function git(root, args, fallback = "unknown") {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return fallback;
  }
}

function readGeneratedConstant(file, name) {
  if (!fs.existsSync(file)) return null;
  const source = fs.readFileSync(file, "utf8");
  const match = source.match(new RegExp(String.raw`export const ${name} = (?:(\d+)|"([a-f0-9]+)")`, "u"));
  return match?.[1] ? Number(match[1]) : match?.[2] ?? null;
}

function sourceFiles(root) {
  const files = [];
  for (const directory of ["apps", "packages"]) {
    const pending = [path.join(root, directory)];
    while (pending.length) {
      const current = pending.pop();
      if (!current || !fs.existsSync(current)) continue;
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const absolute = path.join(current, entry.name);
        if (entry.isDirectory()) pending.push(absolute);
        else if (/[.]tsx?$/u.test(entry.name)) files.push(absolute);
      }
    }
  }
  return files.sort();
}

function architectureMetric(root, absolute) {
  const source = fs.readFileSync(absolute, "utf8").replaceAll("\r\n", "\n");
  return {
    file: relative(root, absolute),
    bytes: Buffer.byteLength(source),
    functionCount: (source.match(/\b(?:async\s+)?function\s+\w+|\bconst\s+\w+\s*=\s*(?:async\s*)?\(/gu) ?? []).length,
    effectCount: (source.match(/\buseEffect\s*\(/gu) ?? []).length,
    exhaustiveDepsSuppressions: (source.match(/eslint-disable-(?:line|next-line) react-hooks\/exhaustive-deps/gu) ?? []).length,
    directHistoryCalls: (source.match(/window[.]history[.](?:pushState|replaceState)\s*\(/gu) ?? []).length,
  };
}

export function evaluateNewSql({ content, file, size = Buffer.byteLength(content) }) {
  const normalizedFile = file.replaceAll("\\", "/");
  const number = Number(path.basename(normalizedFile).match(/^(\d{4})_/u)?.[1] ?? -1);
  if (!Number.isInteger(number) || number <= LEGACY_MIGRATION_MAX) return [];

  const failures = [];
  const dmlMatches = content.match(CONTENT_DML_MATCH_PATTERN) ?? [];
  if (dmlMatches.length > 0) {
    failures.push(
      `${normalizedFile}: numbered SQL after ${CONTENT_MIGRATION_CUTOFF} cannot mutate learning-content tables; use a content release`,
    );
  }
  if (size > SCHEMA_SQL_LIMIT_BYTES) {
    failures.push(`${normalizedFile}: schema migration exceeds ${SCHEMA_SQL_LIMIT_BYTES} bytes`);
  }
  return failures;
}

export function evaluateSourceBudget({ file, bytes }) {
  if (file in SOURCE_FILE_BUDGETS && bytes > SOURCE_FILE_BUDGETS[file]) {
    return [`${file}: ${bytes} bytes exceeds ${SOURCE_FILE_BUDGETS[file]}-byte budget`];
  }
  if (!/[.]tsx?$/u.test(file)) return [];
  if (bytes > LARGE_SOURCE_FILE_BYTES && !(file in SOURCE_FILE_BUDGETS)) {
    return [`${file}: ${bytes} bytes exceeds the automatic ${LARGE_SOURCE_FILE_BYTES}-byte source limit`];
  }
  return [];
}

export function collectRepositoryHealth(root) {
  const migrationDirectory = path.join(root, "apps/backend/drizzle");
  const migrations = fs.readdirSync(migrationDirectory)
    .filter((name) => /^\d{4}.*[.]sql$/u.test(name))
    .sort()
    .map((name) => {
      const file = path.join(migrationDirectory, name);
      const content = fs.readFileSync(file);
      const text = content.toString("utf8");
      return {
        file: relative(root, file),
        bytes: content.byteLength,
        sha256: sha256(content),
        contentDml: containsContentDml(text),
      };
    });

  const allSourceFiles = sourceFiles(root);
  const watchedFiles = [...new Set([
    ...Object.keys(SOURCE_FILE_BUDGETS),
    "apps/backend/src/common/content/server-question-bank.mjs",
    "apps/backend/src/common/content/server-theory-bank.mjs",
    "apps/backend/src/modules/admin/admin-request-handlers.ts",
    "apps/backend/src/modules/study/study.service.ts",
  ])].map((file) => ({
    file,
    bytes: fs.existsSync(path.join(root, file)) ? normalizedTextBytes(path.join(root, file)) : 0,
  })).sort((left, right) => left.file.localeCompare(right.file));

  const questionModule = path.join(root, "apps/backend/src/common/content/server-question-bank.mjs");
  const theoryModule = path.join(root, "apps/backend/src/common/content/server-theory-bank.mjs");
  const warnings = [];
  for (const [file, budget] of Object.entries(SOURCE_FILE_BUDGETS)) {
    const bytes = normalizedTextBytes(path.join(root, file));
    if (bytes > budget) warnings.push(`${file} exceeds its ${budget}-byte baseline`);
  }
  for (const absolute of allSourceFiles) {
    const file = relative(root, absolute);
    const bytes = normalizedTextBytes(absolute);
    if (bytes > LARGE_SOURCE_FILE_BYTES && !(file in SOURCE_FILE_BUDGETS)) {
      warnings.push(`${file} exceeds ${LARGE_SOURCE_FILE_BYTES} bytes without a ratchet budget`);
    }
  }

  return {
    baselineCommit: git(root, ["rev-parse", "HEAD"]),
    migrationSql: {
      count: migrations.length,
      bytes: migrations.reduce((sum, item) => sum + item.bytes, 0),
      contentRelatedCount: migrations.filter((item) => item.contentDml).length,
      contentRelatedBytes: migrations.filter((item) => item.contentDml)
        .reduce((sum, item) => sum + item.bytes, 0),
      largest: [...migrations]
        .sort((left, right) => right.bytes - left.bytes || left.file.localeCompare(right.file))
        .slice(0, 20),
    },
    canonicalContent: {
      questionCount: readGeneratedConstant(questionModule, "CANONICAL_QUESTION_COUNT"),
      questionSha256: readGeneratedConstant(questionModule, "CANONICAL_QUESTION_SHA256"),
      theoryCount: readGeneratedConstant(theoryModule, "CANONICAL_THEORY_COUNT"),
      theorySha256: readGeneratedConstant(theoryModule, "CANONICAL_THEORY_SHA256"),
    },
    watchedFiles,
    budgets: SOURCE_FILE_BUDGETS,
    architectureMetrics: allSourceFiles
      .map((absolute) => architectureMetric(root, absolute))
      .filter((metric) => (
        metric.bytes > LARGE_SOURCE_FILE_BYTES
        || metric.effectCount > 0
        || metric.exhaustiveDepsSuppressions > 0
        || metric.directHistoryCalls > 0
      )),
    warnings: warnings.sort(),
  };
}

export function comparisonRange(base) {
  if (!base) return "";
  if (base.includes("..")) return base;
  const ref = base.startsWith("origin/") ? base : `origin/${base}`;
  return `${ref}...HEAD`;
}

export function parseNameStatus(output) {
  return output.split(/\r?\n/u).filter(Boolean).map((line) => {
    const [status, ...parts] = line.split("\t");
    const renamed = /^[RC]/u.test(status) && parts.length > 1;
    return {
      status,
      file: parts.at(-1)?.replaceAll("\\", "/") ?? "",
      ...(renamed ? { previousFile: parts[0].replaceAll("\\", "/") } : {}),
    };
  });
}

export function changedFiles(root, base) {
  const comparison = base || process.env.GITHUB_BASE_REF;
  if (!comparison) return [];
  const output = git(root, ["diff", "--name-status", comparisonRange(comparison)], "");
  return parseNameStatus(output);
}

export function guardChangeEntries(root, entries) {
  const failures = [];
  for (const entry of entries) {
    const migrationPath = [entry.file, entry.previousFile]
      .filter(Boolean)
      .find((file) => /^apps\/backend\/drizzle\/\d{4}_.+[.]sql$/u.test(file));
    const migrationNumber = Number(path.basename(migrationPath ?? "").slice(0, 4));
    const retiredBeforeBaseline = Boolean(
      migrationPath
      && entry.status === "D"
      && migrationNumber < Number(SCHEMA_BASELINE_VERSION)
    );
    if (migrationPath && entry.status !== "A" && !retiredBeforeBaseline) {
      failures.push(`${migrationPath}: applied migrations are immutable; add the next numbered SQL file`);
      continue;
    }
    const absolute = path.join(root, entry.file);
    if (!fs.existsSync(absolute)) continue;
    if (entry.status === "A" && /^apps\/backend\/drizzle\/\d{4}_.+[.]sql$/u.test(entry.file)) {
      const content = fs.readFileSync(absolute, "utf8");
      failures.push(...evaluateNewSql({ content, file: entry.file }));
    }
    failures.push(...evaluateSourceBudget({ file: entry.file, bytes: normalizedTextBytes(absolute) }));
  }
  return failures.sort();
}

export function guardChangedFiles(root, base) {
  const entries = changedFiles(root, base);
  const failures = guardChangeEntries(root, entries);
  if (base && entries.length === 0) {
    try {
      execFileSync("git", ["diff", "--quiet", comparisonRange(base)], {
        cwd: root,
        stdio: "ignore",
      });
    } catch (error) {
      if (!error || typeof error !== "object" || !("status" in error) || error.status !== 1) {
        failures.push(`${comparisonRange(base)}: comparison range is unavailable`);
      }
    }
  }
  return failures.sort();
}
