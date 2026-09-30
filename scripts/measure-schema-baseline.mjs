import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { EXPECTED_SCHEMA_VERSION } from "../packages/shared/src/database/schema-contract.mjs";
import { databaseBootstrapFiles } from "./lib/database-bootstrap.mjs";
import {
  applyCanonicalMigrations,
  buildCanonicalDatabaseFile,
  migrationFiles,
} from "./lib/canonical-database.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const retiredHistory = Object.freeze({
  count: 554,
  medianMs: 8827.6,
  sqlBytes: 94_166_684,
});

function option(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function percentageReduction(before, after) {
  return Number(((1 - after / before) * 100).toFixed(2));
}

function databaseDigest(database) {
  const hash = crypto.createHash("sha256");
  const tables = database.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all().map((row) => String(row.name));
  for (const table of tables) {
    const columns = database.prepare(`PRAGMA table_xinfo("${table.replaceAll('"', '""')}")`).all()
      .filter((column) => Number(column.hidden) === 0)
      .map((column) => String(column.name));
    const rows = database.prepare(`SELECT ${columns.map((column) => `"${column.replaceAll('"', '""')}"`).join(", ")} FROM "${table.replaceAll('"', '""')}"`).all();
    hash.update(`${table}\0${columns.join("\0")}\0${rows.length}\0`);
  }
  return { sha256: hash.digest("hex"), tableCount: tables.length };
}

const runCount = Number(option("--runs") ?? 3);
if (!Number.isInteger(runCount) || runCount < 1 || runCount > 9) {
  throw new Error("--runs must be an integer from 1 through 9");
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "baeumzip-schema-baseline-"));
try {
  const schemaDurations = [];
  const fullInstallDurations = [];
  let canonicalFile = "";
  for (let index = 0; index < runCount; index += 1) {
    const schemaDatabase = new DatabaseSync(":memory:");
    const schemaStartedAt = performance.now();
    applyCanonicalMigrations(schemaDatabase, root);
    schemaDurations.push(Number((performance.now() - schemaStartedAt).toFixed(1)));
    schemaDatabase.close();

    const file = path.join(temporary, `canonical-${index}.sqlite`);
    const fullStartedAt = performance.now();
    buildCanonicalDatabaseFile(root, file);
    fullInstallDurations.push(Number((performance.now() - fullStartedAt).toFixed(1)));
    canonicalFile = file;
  }

  const migrations = migrationFiles(root);
  const schemaSqlBytes = migrations.reduce((total, file) => total + fs.statSync(file).size, 0);
  const bootstrapBytes = databaseBootstrapFiles(root)
    .filter((file) => file.includes("/resources/database/"))
    .reduce((total, file) => total + fs.statSync(file).size, 0);
  const schemaMedianMs = Number(median(schemaDurations).toFixed(1));
  const fullMedianMs = Number(median(fullInstallDurations).toFixed(1));
  const database = new DatabaseSync(canonicalFile, { readOnly: true });
  const schemaVersion = database.prepare(
    "SELECT migration_version FROM app_schema_state WHERE id = 1",
  ).get()?.migration_version;
  const digest = databaseDigest(database);
  const counts = {
    questions: database.prepare("SELECT COUNT(*) AS count FROM questions").get().count,
    swQuestions: database.prepare("SELECT COUNT(*) AS count FROM sw_questions").get().count,
    swTheories: database.prepare("SELECT COUNT(*) AS count FROM sw_theories").get().count,
    theories: database.prepare("SELECT COUNT(*) AS count FROM theories").get().count,
  };
  database.close();
  if (schemaVersion !== EXPECTED_SCHEMA_VERSION) {
    throw new Error(`canonical schema ${schemaVersion ?? "missing"} differs from ${EXPECTED_SCHEMA_VERSION}`);
  }

  const report = {
    decision: "schema-baseline-adopted",
    explanation: "Production was first advanced to the idempotent 0554 baseline. The retired 0000-0553 files are replaced by one schema-only baseline and a checksum-verified database bootstrap.",
    freshInstall: {
      databaseBytes: fs.statSync(canonicalFile).size,
      durationsMs: fullInstallDurations,
      medianMs: fullMedianMs,
    },
    parity: {
      ...digest,
      counts,
      schemaVersion,
    },
    retiredHistory,
    runCount,
    schemaBaseline: {
      count: migrations.length,
      durationsMs: schemaDurations,
      medianMs: schemaMedianMs,
      sqlBytes: schemaSqlBytes,
    },
    sizeReduction: {
      schemaOnlyPercent: percentageReduction(retiredHistory.sqlBytes, schemaSqlBytes),
      schemaWithBootstrapPercent: percentageReduction(
        retiredHistory.sqlBytes,
        schemaSqlBytes + bootstrapBytes,
      ),
    },
    speedup: {
      schemaOnlyVsRetiredHistory: Number((retiredHistory.medianMs / schemaMedianMs).toFixed(2)),
      fullBootstrapVsRetiredHistory: Number((retiredHistory.medianMs / fullMedianMs).toFixed(2)),
    },
    bootstrap: {
      bytes: bootstrapBytes,
      fileCount: databaseBootstrapFiles(root).filter((file) => file.includes("/resources/database/")).length,
    },
    status: "adopted",
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  const output = option("--output");
  if (output) fs.writeFileSync(path.resolve(output), serialized, "utf8");
  process.stdout.write(serialized);
} finally {
  fs.rmSync(temporary, { force: true, recursive: true });
}
