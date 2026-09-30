import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { EXPECTED_SCHEMA_VERSION, SCHEMA_BASELINE_VERSION } from "../../packages/shared/src/database/schema-contract.mjs";

export const DATABASE_BOOTSTRAP_VERSION = 1;
export const DATABASE_BOOTSTRAP_TABLES = Object.freeze([
  "course_content_scopes",
  "course_subjects",
  "site_settings",
  "sw_theories",
  "sw_questions",
  "sw_question_tags",
]);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function bootstrapDirectory(root) {
  return path.join(
    root,
    "apps/backend/resources/database",
    `bootstrap-v${SCHEMA_BASELINE_VERSION}`,
  );
}

export function databaseBootstrapFiles(root) {
  const directory = bootstrapDirectory(root);
  const manifestFile = path.join(directory, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  const releaseDirectory = path.join(
    root,
    "apps/backend/resources/content/releases",
    manifest.contentReleaseVersion,
  );
  return [
    manifestFile,
    ...DATABASE_BOOTSTRAP_TABLES.map((table) => path.join(directory, `${table}.ndjson`)),
    path.join(releaseDirectory, "manifest.json"),
    path.join(releaseDirectory, "questions.ndjson"),
    path.join(releaseDirectory, "theories.ndjson"),
  ];
}

function readNdjson(file) {
  const source = fs.readFileSync(file, "utf8").replaceAll("\r\n", "\n");
  if (!source.endsWith("\n")) throw new Error(`${file} must end with LF`);
  const rows = source.trim() ? source.trimEnd().split("\n").map((line) => JSON.parse(line)) : [];
  return { rows, sha256: sha256(source), source };
}

function insertRows(database, table, rows) {
  if (rows.length === 0) return;
  const columns = Object.keys(rows[0]);
  const primaryKey = database.prepare(`PRAGMA table_info(${table})`).all()
    .filter((column) => Number(column.pk) > 0)
    .sort((left, right) => Number(left.pk) - Number(right.pk))
    .map((column) => String(column.name));
  const mutableColumns = columns.filter((column) => !primaryKey.includes(column));
  const conflict = primaryKey.length === 0
    ? ""
    : ` ON CONFLICT (${primaryKey.join(", ")}) DO ${mutableColumns.length === 0
      ? "NOTHING"
      : `UPDATE SET ${mutableColumns.map((column) => `${column} = excluded.${column}`).join(", ")}`}`;
  const insert = database.prepare(
    `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})${conflict}`,
  );
  for (const row of rows) insert.run(...columns.map((column) => row[column]));
}

function loadContentRelease(root, expectedVersion) {
  const directory = path.join(root, "apps/backend/resources/content/releases", expectedVersion);
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8"));
  const questions = readNdjson(path.join(directory, "questions.ndjson"));
  const theories = readNdjson(path.join(directory, "theories.ndjson"));
  const canonicalHash = (rows) => sha256(JSON.stringify(rows));
  const failures = [];
  if (manifest.version !== expectedVersion) failures.push("content release version mismatch");
  if (questions.rows.length !== manifest.questionCount) failures.push("content question count mismatch");
  if (theories.rows.length !== manifest.theoryCount) failures.push("content theory count mismatch");
  if (questions.sha256 !== manifest.questionArtifactSha256) failures.push("content question artifact checksum mismatch");
  if (theories.sha256 !== manifest.theoryArtifactSha256) failures.push("content theory artifact checksum mismatch");
  if (canonicalHash(questions.rows) !== manifest.questionSha256) failures.push("content question canonical checksum mismatch");
  if (canonicalHash(theories.rows) !== manifest.theorySha256) failures.push("content theory canonical checksum mismatch");
  if (failures.length > 0) throw new Error(`database bootstrap content is invalid:\n- ${failures.join("\n- ")}`);
  return { manifest, questions: questions.rows, theories: theories.rows };
}

export function loadAndValidateDatabaseBootstrap(root) {
  const directory = bootstrapDirectory(root);
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8"));
  const failures = [];
  if (manifest.resourceVersion !== DATABASE_BOOTSTRAP_VERSION) failures.push("bootstrap resource version mismatch");
  if (manifest.schemaVersion !== SCHEMA_BASELINE_VERSION) failures.push("bootstrap schema version mismatch");
  const tables = {};
  for (const table of DATABASE_BOOTSTRAP_TABLES) {
    const contract = manifest.tables?.[table];
    if (!contract || contract.file !== `${table}.ndjson`) {
      failures.push(`${table}: manifest entry is missing`);
      continue;
    }
    const artifact = readNdjson(path.join(directory, contract.file));
    if (artifact.rows.length !== contract.count) failures.push(`${table}: row count mismatch`);
    if (artifact.sha256 !== contract.sha256) failures.push(`${table}: checksum mismatch`);
    const columns = artifact.rows[0] ? Object.keys(artifact.rows[0]) : [];
    if (JSON.stringify(columns) !== JSON.stringify(contract.columns)) failures.push(`${table}: column contract mismatch`);
    tables[table] = artifact.rows;
  }
  const release = loadContentRelease(root, manifest.contentReleaseVersion);
  if (failures.length > 0) throw new Error(`database bootstrap validation failed:\n- ${failures.join("\n- ")}`);
  return { directory, manifest, release, tables };
}

export function applyDatabaseBootstrap(database, root) {
  const bootstrap = loadAndValidateDatabaseBootstrap(root);
  const schemaVersion = database.prepare(
    "SELECT migration_version FROM app_schema_state WHERE id = 1",
  ).get()?.migration_version;
  if (schemaVersion !== EXPECTED_SCHEMA_VERSION) {
    throw new Error(`database bootstrap requires schema ${EXPECTED_SCHEMA_VERSION}; received ${schemaVersion ?? "none"}`);
  }
  database.exec("BEGIN IMMEDIATE");
  try {
    for (const table of DATABASE_BOOTSTRAP_TABLES.slice(0, 3)) {
      insertRows(database, table, bootstrap.tables[table]);
    }
    insertRows(database, "theories", bootstrap.release.theories);
    insertRows(database, "questions", bootstrap.release.questions);
    insertRows(database, "sw_theories", bootstrap.tables.sw_theories);
    insertRows(database, "sw_questions", bootstrap.tables.sw_questions);
    insertRows(database, "sw_question_tags", bootstrap.tables.sw_question_tags);
    const manifest = bootstrap.release.manifest;
    database.prepare(`
      INSERT INTO content_releases (
        version, schema_version, source_checksum, question_checksum, theory_checksum,
        expected_question_count, imported_question_count, expected_theory_count,
        imported_theory_count, status, created_at, activated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
      ON CONFLICT (version) DO UPDATE SET
        schema_version = excluded.schema_version,
        source_checksum = excluded.source_checksum,
        question_checksum = excluded.question_checksum,
        theory_checksum = excluded.theory_checksum,
        expected_question_count = excluded.expected_question_count,
        imported_question_count = excluded.imported_question_count,
        expected_theory_count = excluded.expected_theory_count,
        imported_theory_count = excluded.imported_theory_count,
        status = excluded.status,
        created_at = excluded.created_at,
        activated_at = excluded.activated_at
    `).run(
      manifest.version,
      manifest.schemaVersion,
      manifest.sourceSha256,
      manifest.questionSha256,
      manifest.theorySha256,
      manifest.questionCount,
      manifest.questionCount,
      manifest.theoryCount,
      manifest.theoryCount,
      manifest.createdAt,
      manifest.createdAt,
    );
    const violations = database.prepare("PRAGMA foreign_key_check").all();
    if (violations.length > 0) throw new Error("database bootstrap created foreign-key violations");
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return {
    contentReleaseVersion: bootstrap.manifest.contentReleaseVersion,
    schemaVersion: SCHEMA_BASELINE_VERSION,
    tables: Object.fromEntries(DATABASE_BOOTSTRAP_TABLES.map((table) => [
      table,
      bootstrap.tables[table].length,
    ])),
  };
}
