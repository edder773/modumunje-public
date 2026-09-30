import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  EXPECTED_SCHEMA_VERSION,
  SCHEMA_BASELINE_LOCK,
  SCHEMA_BASELINE_VERSION,
} from "../../packages/shared/src/database/schema-contract.mjs";
import { applySyntheticMigrationSeed } from "./public-migration-seed.mjs";
import {
  LEGACY_MIGRATION_MAX,
  evaluateNewSql,
} from "./repository-health.mjs";

const MIGRATION_PATTERN = /^(\d{4})_.+[.]sql$/u;
const FORBIDDEN_TRANSACTION_DIRECTIVE = /^\s*(?:BEGIN(?:\s+(?:DEFERRED|EXCLUSIVE|IMMEDIATE|TRANSACTION))?|COMMIT|ROLLBACK(?:\s+TO)?|SAVEPOINT|RELEASE)\b[^'"`]*;/gimu;
const REQUIRED_TRIGGERS = Object.freeze([
  "attempts_integrity_before_insert",
  "attempts_integrity_before_update",
  "exam_active_sessions_integrity_before_insert",
  "exam_active_sessions_integrity_before_update",
  "exam_session_items_integrity_before_insert",
  "exam_session_items_integrity_before_update",
  "exam_session_maps_integrity_before_insert",
  "exam_session_maps_integrity_before_update",
  "exam_sessions_integrity_before_insert",
  "exam_sessions_integrity_before_update",
  "questions_integrity_before_insert",
  "questions_integrity_before_update",
  "sw_question_tags_after_delete",
  "sw_question_tags_after_insert",
  "sw_question_tags_after_update",
  "sw_attempts_integrity_before_insert",
  "sw_attempts_integrity_before_update",
  "sw_learning_sessions_integrity_before_insert",
  "sw_learning_sessions_integrity_before_update",
  "sw_session_maps_integrity_before_insert",
  "sw_session_maps_integrity_before_update",
  "sw_questions_integrity_before_insert",
  "sw_questions_integrity_before_update",
  "sw_theories_integrity_before_insert",
  "sw_theories_integrity_before_update",
  "theories_integrity_before_insert",
  "theories_integrity_before_update",
]);

function normalizedSource(file) {
  return fs.readFileSync(file, "utf8").replaceAll("\r\n", "\n");
}

export function migrationEntries(root) {
  const directory = path.join(root, "apps/backend/drizzle");
  return fs.readdirSync(directory)
    .filter((name) => MIGRATION_PATTERN.test(name))
    .sort()
    .map((name) => ({
      bytes: fs.statSync(path.join(directory, name)).size,
      file: path.join(directory, name),
      name,
      number: Number(name.slice(0, 4)),
      source: normalizedSource(path.join(directory, name)),
      version: name.slice(0, 4),
    }));
}

function historyDigest(entries, through) {
  const hash = crypto.createHash("sha256");
  const locked = entries.filter((entry) => entry.version <= through);
  for (const entry of locked) {
    hash.update(entry.name).update("\0").update(entry.source).update("\0");
  }
  return { count: locked.length, sha256: hash.digest("hex") };
}

export function validateMigrationInventory(root) {
  const entries = migrationEntries(root);
  const failures = [];
  if (entries.length === 0) return { entries, failures: ["no numbered migrations exist"] };

  const byNumber = new Map();
  for (const entry of entries) {
    const matches = byNumber.get(entry.number) ?? [];
    matches.push(entry.name);
    byNumber.set(entry.number, matches);
  }
  for (const [number, names] of byNumber) {
    if (names.length !== 1) failures.push(`migration ${String(number).padStart(4, "0")} is duplicated: ${names.join(", ")}`);
  }
  const baselineNumber = Number(SCHEMA_BASELINE_VERSION);
  const minimum = Math.min(...entries.map((entry) => entry.number));
  if (minimum !== baselineNumber) {
    failures.push(`migration inventory must begin at schema baseline ${SCHEMA_BASELINE_VERSION}`);
  }
  const maximum = Math.max(...entries.map((entry) => entry.number));
  for (let number = baselineNumber; number <= maximum; number += 1) {
    if (!byNumber.has(number)) failures.push(`migration ${String(number).padStart(4, "0")} is missing`);
  }

  const latest = entries.at(-1);
  if (latest?.version !== EXPECTED_SCHEMA_VERSION) {
    failures.push(`latest migration ${latest?.version ?? "none"} differs from expected schema ${EXPECTED_SCHEMA_VERSION}`);
  }
  if (
    latest
    && (!latest.source.includes("app_schema_state")
      || !new RegExp(`["']${EXPECTED_SCHEMA_VERSION}["']`, "u").test(latest.source))
  ) failures.push(`${latest.name} does not record schema version ${EXPECTED_SCHEMA_VERSION}`);

  const locked = historyDigest(entries, SCHEMA_BASELINE_LOCK.through);
  if (
    locked.count !== SCHEMA_BASELINE_LOCK.count
    || locked.sha256 !== SCHEMA_BASELINE_LOCK.sha256
  ) failures.push(`schema baseline ${SCHEMA_BASELINE_LOCK.through} changed`);

  for (const entry of entries.filter((candidate) => candidate.number > LEGACY_MIGRATION_MAX)) {
    failures.push(...evaluateNewSql({
      content: entry.source,
      file: `apps/backend/drizzle/${entry.name}`,
      size: entry.bytes,
    }));
    if (FORBIDDEN_TRANSACTION_DIRECTIVE.test(entry.source)) {
      failures.push(`${entry.name} contains a top-level transaction directive`);
    }
    FORBIDDEN_TRANSACTION_DIRECTIVE.lastIndex = 0;
  }

  return {
    entries,
    failures: failures.sort(),
    history: locked,
    latestVersion: latest?.version ?? null,
  };
}

function applyTransactional(database, entry) {
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(entry.source);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw new Error(`${entry.name} failed: ${error.message}`, { cause: error });
  }
}

function scalar(database, sql, parameters = []) {
  return Number(database.prepare(sql).get(...parameters)?.value ?? 0);
}

function durableCounts(database) {
  return Object.fromEntries([
    "attempts",
    "exam_sessions",
    "guest_import_batches",
    "guest_import_receipts",
    "sw_attempts",
    "sw_learning_sessions",
    "user_accounts",
    "user_bookmarks",
    "user_reports",
    "user_settings",
  ].map((table) => [
    table,
    scalar(database, `SELECT COUNT(*) AS value FROM ${table}`),
  ]));
}

function activeRelease(database) {
  return database.prepare(`
    SELECT version, schema_version, question_checksum, theory_checksum
    FROM content_releases WHERE status = 'active'
    ORDER BY activated_at DESC, created_at DESC, version DESC LIMIT 1
  `).get() ?? null;
}

export function runMigrationSafetyDrill(root) {
  const startedAt = performance.now();
  const inventory = validateMigrationInventory(root);
  if (inventory.failures.length > 0) {
    throw new Error(`migration inventory failed:\n- ${inventory.failures.join("\n- ")}`);
  }
  const entries = inventory.entries;
  const latest = entries.at(-1);
  if (!latest) throw new Error("latest migration is unavailable");

  const fresh = new DatabaseSync(":memory:");
  fresh.exec("PRAGMA foreign_keys = ON");
  try {
    for (const entry of entries) applyTransactional(fresh, entry);
    const applied = fresh.prepare(
      "SELECT migration_version FROM app_schema_state WHERE id = 1",
    ).get()?.migration_version;
    if (applied !== EXPECTED_SCHEMA_VERSION) {
      throw new Error(`fresh install recorded schema ${applied ?? "none"}`);
    }
    const integrity = fresh.prepare("PRAGMA integrity_check").get()?.integrity_check;
    if (integrity !== "ok") throw new Error(`SQLite integrity_check returned ${integrity}`);
    const foreignKeyViolations = fresh.prepare("PRAGMA foreign_key_check").all();
    if (foreignKeyViolations.length > 0) throw new Error("fresh install has foreign-key violations");
    const triggers = fresh.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name
    `).all().map((row) => String(row.name));
    for (const trigger of REQUIRED_TRIGGERS) {
      if (!triggers.includes(trigger)) throw new Error(`required trigger is missing: ${trigger}`);
    }
  } finally {
    fresh.close();
  }

  const rollback = new DatabaseSync(":memory:");
  rollback.exec("PRAGMA foreign_keys = ON");
  try {
    let rejected = false;
    rollback.exec("BEGIN IMMEDIATE");
    try {
      for (const entry of entries) rollback.exec(entry.source);
      rollback.exec("SELECT * FROM __forced_stage2_failure__");
      rollback.exec("COMMIT");
    } catch {
      rejected = true;
      rollback.exec("ROLLBACK");
    }
    if (!rejected) throw new Error("forced migration failure was not rejected");
    const residualObjects = scalar(rollback, `
      SELECT COUNT(*) AS value FROM sqlite_master
      WHERE name NOT LIKE 'sqlite_%' AND sql IS NOT NULL
    `);
    if (residualObjects !== 0) throw new Error("failed baseline migration did not roll back atomically");
    for (const entry of entries) applyTransactional(rollback, entry);
    applySyntheticMigrationSeed(rollback);
    rollback.prepare(`
      INSERT INTO user_accounts (user_key, email, display_name)
      VALUES ('stage5-preservation-user', 'stage5@example.invalid', 'Stage 5')
    `).run();
    rollback.prepare(`
      INSERT INTO user_settings (user_key, selected_exam)
      VALUES ('stage5-preservation-user', 'BAE-W')
    `).run();
    rollback.prepare(`
      INSERT INTO guest_import_batches (user_key, import_id)
      VALUES ('stage5-preservation-user', 'preserved-import')
    `).run();
    rollback.prepare(`
      INSERT INTO guest_import_receipts (user_key, import_id, payload_digest)
      VALUES ('stage5-preservation-user', 'preserved-import', ?)
    `).run("a".repeat(64));
    const questionId = rollback.prepare("SELECT id FROM questions ORDER BY id LIMIT 1").get()?.id;
    if (!Number.isInteger(questionId)) throw new Error("bootstrap did not provide a preservation fixture question");
    rollback.prepare(`
      INSERT INTO user_bookmarks (user_key, question_id)
      VALUES ('stage5-preservation-user', ?)
    `).run(questionId);
    const before = { counts: durableCounts(rollback), release: activeRelease(rollback) };
    // D1 records applied migration filenames; ALTER TABLE runs once.
    const recorded = rollback.prepare("SELECT migration_version FROM app_schema_state WHERE id=1").get()?.migration_version;
    if (String(recorded ?? "") < latest.version) applyTransactional(rollback, latest);
    const after = { counts: durableCounts(rollback), release: activeRelease(rollback) };
    if (JSON.stringify(after) !== JSON.stringify(before)) {
      throw new Error("migration-ledger retry changed durable learner data");
    }
    const applied = rollback.prepare(
      "SELECT migration_version FROM app_schema_state WHERE id = 1",
    ).get()?.migration_version;
    if (applied !== EXPECTED_SCHEMA_VERSION) throw new Error("upgrade did not reach expected schema");
  } finally {
    rollback.close();
  }

  return {
    result: "pass",
    migrationCount: entries.length,
    latestVersion: EXPECTED_SCHEMA_VERSION,
    schemaBaseline: inventory.history,
    freshInstall: "pass",
    atomicFailureRollback: "pass",
    durableRowPreservation: "pass",
    preservationFixture: "synthetic-in-memory",
    durationMs: Number((performance.now() - startedAt).toFixed(1)),
  };
}

export function verifyPackagedMigrations(root, artifactDirectory) {
  const source = migrationEntries(root);
  const packaged = fs.readdirSync(artifactDirectory)
    .filter((name) => MIGRATION_PATTERN.test(name))
    .sort();
  const sourceNames = source.map((entry) => entry.name);
  if (JSON.stringify(packaged) !== JSON.stringify(sourceNames)) {
    throw new Error("packaged migration filenames differ from the source migration set");
  }
  for (const entry of source) {
    const artifact = normalizedSource(path.join(artifactDirectory, entry.name));
    if (artifact !== entry.source) throw new Error(`packaged migration differs: ${entry.name}`);
  }
  return { count: source.length, latestVersion: source.at(-1)?.version ?? null };
}
