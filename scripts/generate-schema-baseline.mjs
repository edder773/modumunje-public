import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import {
  EXPECTED_SCHEMA_VERSION,
  SCHEMA_BASELINE_VERSION,
} from "../packages/shared/src/database/schema-contract.mjs";
import { migrationFiles } from "./lib/canonical-database.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(
  root,
  "apps/backend/drizzle",
  `${SCHEMA_BASELINE_VERSION}_schema_baseline.sql`,
);

function ensureIdempotent(source, type) {
  const patterns = {
    index: /^(CREATE\s+(?:UNIQUE\s+)?INDEX)\s+(?!IF\s+NOT\s+EXISTS)/iu,
    table: /^(CREATE\s+TABLE)\s+(?!IF\s+NOT\s+EXISTS)/iu,
    trigger: /^(CREATE\s+TRIGGER)\s+(?!IF\s+NOT\s+EXISTS)/iu,
    view: /^(CREATE\s+VIEW)\s+(?!IF\s+NOT\s+EXISTS)/iu,
  };
  const pattern = patterns[type];
  if (!pattern) throw new Error(`unsupported schema object type: ${type}`);
  return source.replace(pattern, "$1 IF NOT EXISTS ").replace(/;\s*$/u, "");
}

function schemaObjects(database) {
  return database.prepare(`
    SELECT type, name, sql
    FROM sqlite_master
    WHERE sql IS NOT NULL
      AND name NOT LIKE 'sqlite_%'
      AND type IN ('table', 'index', 'view', 'trigger')
    ORDER BY
      CASE
        WHEN type = 'table' AND name = 'app_schema_state' THEN 0
        WHEN type = 'table' THEN 1
        WHEN type = 'index' THEN 2
        WHEN type = 'view' THEN 3
        ELSE 4
      END,
      name
  `).all();
}

function baselineSql(database) {
  const objects = schemaObjects(database);
  const statements = [
    `-- Schema baseline ${SCHEMA_BASELINE_VERSION}.`,
    "-- This migration is intentionally idempotent: it is applied once to the existing",
    "-- production database, then becomes the only bootstrap migration for new databases.",
    "-- Learning content is delivered by the versioned content bootstrap/release path.",
    "",
  ];
  for (const object of objects) {
    statements.push(`${ensureIdempotent(String(object.sql), String(object.type))};`);
    statements.push("--> statement-breakpoint", "");
  }
  statements.push(`INSERT INTO \`app_schema_state\` (\`id\`, \`migration_version\`, \`applied_at\`)
VALUES (1, '${SCHEMA_BASELINE_VERSION}', CURRENT_TIMESTAMP)
ON CONFLICT (\`id\`) DO UPDATE SET
  \`migration_version\` = excluded.\`migration_version\`,
  \`applied_at\` = excluded.\`applied_at\`;`);
  statements.push("--> statement-breakpoint", "");
  return `${statements.join("\n")}\n`;
}

const database = new DatabaseSync(":memory:");
database.exec("PRAGMA foreign_keys = ON");
try {
  let sourceMigrations = migrationFiles(root)
    .filter((file) => path.basename(file).slice(0, 4) < SCHEMA_BASELINE_VERSION);
  if (sourceMigrations.length === 0) sourceMigrations = [output];
  for (const migration of sourceMigrations) {
    database.exec(fs.readFileSync(migration, "utf8").replaceAll("\r\n", "\n"));
  }
  const sourceVersion = database.prepare(
    "SELECT migration_version FROM app_schema_state WHERE id = 1",
  ).get()?.migration_version;
  if (String(sourceVersion ?? "") !== SCHEMA_BASELINE_VERSION) {
    throw new Error(`baseline source schema must be ${SCHEMA_BASELINE_VERSION}; received ${sourceVersion ?? "none"}`);
  }
  const generated = baselineSql(database);
  if (process.argv.includes("--check")) {
    if (!fs.existsSync(output) || fs.readFileSync(output, "utf8") !== generated) {
      throw new Error(`${path.relative(root, output)} is not the deterministic ${SCHEMA_BASELINE_VERSION} baseline`);
    }
  } else {
    fs.writeFileSync(output, generated, "utf8");
  }
  process.stdout.write(`${JSON.stringify({
    bytes: Buffer.byteLength(generated),
    expectedSchemaVersion: EXPECTED_SCHEMA_VERSION,
    objectCount: schemaObjects(database).length,
    output: path.relative(root, output),
    sourceSchemaVersion: sourceVersion,
  }, null, 2)}\n`);
} finally {
  database.close();
}
