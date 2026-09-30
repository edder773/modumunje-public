import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { SCHEMA_BASELINE_VERSION } from "../packages/shared/src/database/schema-contract.mjs";
import { DEFAULT_RELEASE_VERSION } from "./lib/content-release.mjs";
import {
  COURSE_CONTENT_SCOPE_ROWS,
  COURSE_SUBJECT_ROWS,
} from "../packages/shared/src/study/course-contract.mjs";
import {
  DATABASE_BOOTSTRAP_TABLES,
  DATABASE_BOOTSTRAP_VERSION,
  loadAndValidateDatabaseBootstrap,
} from "./lib/database-bootstrap.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(
  root,
  "apps/backend/resources/database",
  `bootstrap-v${SCHEMA_BASELINE_VERSION}`,
);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function exportTable(database, table) {
  const columns = database.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all()
    .sort((left, right) => Number(left.cid) - Number(right.cid))
    .map((column) => String(column.name));
  const primaryKey = database.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all()
    .filter((column) => Number(column.pk) > 0)
    .sort((left, right) => Number(left.pk) - Number(right.pk))
    .map((column) => quoteIdentifier(column.name));
  const orderBy = primaryKey.length > 0 ? primaryKey.join(", ") : "rowid";
  let rows = database.prepare(`
    SELECT ${columns.map(quoteIdentifier).join(", ")}
    FROM ${quoteIdentifier(table)} ORDER BY ${orderBy}
  `).all().map((row) => Object.fromEntries(columns.map((column) => [column, row[column]])));
  const registryOrder = table === "course_content_scopes"
    ? COURSE_CONTENT_SCOPE_ROWS.map((row) => `${row.examType}\0${row.contentScope}`)
    : table === "course_subjects"
      ? COURSE_SUBJECT_ROWS.map((row) => `${row.examType}\0${row.subject}`)
      : null;
  if (registryOrder) {
    const order = new Map(registryOrder.map((key, index) => [key, index]));
    rows = rows.sort((left, right) => (
      (order.get(`${left.exam_type}\0${left.content_scope ?? left.subject}`) ?? Infinity)
      - (order.get(`${right.exam_type}\0${right.content_scope ?? right.subject}`) ?? Infinity)
    ));
  }
  const source = rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "");
  return { columns, count: rows.length, sha256: sha256(source), source };
}

const sourceFileIndex = process.argv.indexOf("--source-db");
const sourceFile = sourceFileIndex >= 0 ? process.argv[sourceFileIndex + 1] : "";
if (process.argv.includes("--check")) {
  const verified = loadAndValidateDatabaseBootstrap(root);
  process.stdout.write(`${JSON.stringify({
    contentReleaseVersion: verified.manifest.contentReleaseVersion,
    output: path.relative(root, verified.directory),
    result: "pass",
    schemaVersion: verified.manifest.schemaVersion,
    tables: Object.fromEntries(DATABASE_BOOTSTRAP_TABLES.map((table) => [
      table,
      verified.tables[table].length,
    ])),
  }, null, 2)}\n`);
  process.exit(0);
}
if (!sourceFile) {
  throw new Error("generation requires --source-db <verified-schema-0554.sqlite>; use --check for routine verification");
}
const database = new DatabaseSync(path.resolve(sourceFile), { readOnly: true });
try {
  const sourceSchema = database.prepare(
    "SELECT migration_version FROM app_schema_state WHERE id = 1",
  ).get()?.migration_version;
  if (sourceSchema !== SCHEMA_BASELINE_VERSION) {
    throw new Error(`source database schema must be ${SCHEMA_BASELINE_VERSION}; received ${sourceSchema ?? "none"}`);
  }
  fs.mkdirSync(output, { recursive: true });
  const tables = {};
  for (const table of DATABASE_BOOTSTRAP_TABLES) {
    const artifact = exportTable(database, table);
    fs.writeFileSync(path.join(output, `${table}.ndjson`), artifact.source, "utf8");
    tables[table] = {
      columns: artifact.columns,
      count: artifact.count,
      file: `${table}.ndjson`,
      sha256: artifact.sha256,
    };
  }
  const manifest = {
    contentReleaseVersion: DEFAULT_RELEASE_VERSION,
    resourceVersion: DATABASE_BOOTSTRAP_VERSION,
    schemaVersion: SCHEMA_BASELINE_VERSION,
    provenance: "verified-schema-baseline-transition",
    tables,
  };
  fs.writeFileSync(path.join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({
    output: path.relative(root, output),
    schemaVersion: SCHEMA_BASELINE_VERSION,
    tables: Object.fromEntries(Object.entries(tables).map(([table, value]) => [table, value.count])),
  }, null, 2)}\n`);
} finally {
  database.close();
}
