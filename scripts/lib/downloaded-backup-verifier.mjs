import { GROUP_OWNER_SLOT_RECOVERY_SQL } from "../../packages/shared/src/admin/group-owner-slot-recovery.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  BACKUP_DELETE_ORDER,
  BACKUP_INSERT_ORDER,
  supportedBackupSchema,
  backupTableSpec,
  BACKUP_TABLES,
  BACKUP_VERSION,
  EXTERNAL_BACKUP_FORMAT,
  EXTERNAL_BACKUP_VERSION,
  RESTORE_TABLES,
  allowedBackupTables,
} from "../../packages/shared/src/admin/backup-contract.mjs";
import {
  COURSE_CONTENT_SCOPE_ROWS,
  COURSE_SUBJECT_ROWS,
} from "../../packages/shared/src/study/course-contract.mjs";
import { applyCanonicalMigrations } from "./canonical-database.mjs";
import { buildDataIntegrityReport } from "./data-integrity.mjs";

const MAX_BACKUP_BYTES = 256 * 1024 * 1024;
const VALID_SOURCES = new Set(["manual", "automatic", "pre-restore"]);
const CONTENT_CONTRACT_DRIFT = new Set([
  "canonical question contract changed",
  "canonical theory contract changed",
  "active content release differs from canonical content",
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function quoteIdentifier(value) {
  if (!/^[a-z][a-z0-9_]*$/u.test(value)) throw new Error(`Unsafe identifier: ${value}`);
  return `\`${value}\``;
}

function primaryKeys(spec) {
  return Array.isArray(spec.primaryKey) ? spec.primaryKey : [spec.primaryKey];
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function validateRowShape(table, rows, schemaVersion) {
  const spec = backupTableSpec(table, schemaVersion);
  assert.ok(spec, `${table} has no restore contract`);
  const expectedColumns = sorted(spec.columns);
  for (const row of rows) {
    assert.ok(plainObject(row), `${table} contains a non-object row`);
    assert.deepEqual(sorted(Object.keys(row)), expectedColumns, `${table} row columns drifted`);
  }
}

export function validateDownloadedBackupEnvelope(value, { requireFull = true } = {}) {
  assert.ok(plainObject(value), "backup envelope must be an object");
  const { metadata, data } = value;
  assert.ok(plainObject(metadata), "backup metadata is missing");
  assert.ok(plainObject(data), "backup data is missing");
  const external = metadata.backupVersion === EXTERNAL_BACKUP_VERSION;
  assert.ok(
    metadata.backupVersion === BACKUP_VERSION || external,
    "backup version is unsupported",
  );
  assert.ok(supportedBackupSchema(metadata.schemaVersion), "backup schema is unsupported");
  assert.ok(Object.hasOwn(BACKUP_TABLES, metadata.type), "backup type is unsupported");
  assert.ok(VALID_SOURCES.has(metadata.source), "backup source is unsupported");
  assert.ok(typeof metadata.appVersion === "string" && metadata.appVersion.length > 0,
    "backup app version is missing");
  assert.ok(Number.isFinite(Date.parse(metadata.generatedAt)), "backup timestamp is invalid");
  assert.match(metadata.checksum ?? "", /^[a-f0-9]{64}$/u, "backup checksum is invalid");
  assert.ok(Array.isArray(metadata.includedData), "backup table list is invalid");
  assert.equal(new Set(metadata.includedData).size, metadata.includedData.length,
    "backup table list contains duplicates");

  const includeAnalytics = metadata.includedData.includes("analytics_events");
  const permitted = new Set(allowedBackupTables(metadata.type, includeAnalytics, metadata.schemaVersion));
  for (const table of metadata.includedData) {
    assert.ok(permitted.has(table), `${table} is not permitted for this backup type`);
  }
  if (requireFull) {
    assert.equal(metadata.type, "full", "disaster-recovery drill requires a full backup");
    assert.deepEqual(metadata.includedData, allowedBackupTables("full", includeAnalytics, metadata.schemaVersion),
      "full backup coverage does not match the recovery contract");
  }

  assert.deepEqual(Object.keys(data), metadata.includedData, "backup data tables do not match metadata");
  assert.ok(plainObject(metadata.counts), "backup counts are missing");
  assert.deepEqual(sorted(Object.keys(metadata.counts)), sorted(metadata.includedData),
    "backup count tables do not match metadata");
  for (const table of metadata.includedData) {
    const rows = data[table];
    assert.ok(Array.isArray(rows), `${table} backup rows are invalid`);
    assert.equal(metadata.counts[table], rows.length, `${table} backup count is incorrect`);
    validateRowShape(table, rows, metadata.schemaVersion);
  }

  let actualChecksum;
  if (external) {
    assert.equal(metadata.storageFormat, EXTERNAL_BACKUP_FORMAT, "external backup format is unsupported");
    assert.ok(Array.isArray(metadata.parts), "external backup parts are missing");
    const observedCounts = Object.fromEntries(metadata.includedData.map((table) => [table, 0]));
    let previousTableIndex = -1;
    let expectedPartIndex = 0;
    for (const part of metadata.parts) {
      const tableIndex = metadata.includedData.indexOf(part.table);
      assert.ok(tableIndex >= 0 && tableIndex >= previousTableIndex, "external backup part order is invalid");
      if (tableIndex !== previousTableIndex) expectedPartIndex = 0;
      assert.equal(part.partIndex, expectedPartIndex, "external backup part index is invalid");
      assert.equal(part.rowStart, observedCounts[part.table], "external backup row offset is invalid");
      assert.ok(Number.isInteger(part.rowCount) && part.rowCount > 0, "external backup part row count is invalid");
      const rows = data[part.table].slice(part.rowStart, part.rowStart + part.rowCount);
      assert.equal(rows.length, part.rowCount, "external backup part coverage is incomplete");
      const serializedPart = JSON.stringify(rows);
      assert.equal(Buffer.byteLength(serializedPart), part.byteSize, "external backup part byte size is invalid");
      assert.equal(sha256(serializedPart), part.checksum, "external backup part checksum failed");
      observedCounts[part.table] += part.rowCount;
      previousTableIndex = tableIndex;
      expectedPartIndex += 1;
    }
    for (const table of metadata.includedData) {
      assert.equal(observedCounts[table], metadata.counts[table], `${table} external part coverage is incomplete`);
    }
    const manifestMetadata = { ...metadata };
    delete manifestMetadata.checksum;
    delete manifestMetadata.parts;
    const { parts } = metadata;
    actualChecksum = sha256(JSON.stringify({
      format: EXTERNAL_BACKUP_FORMAT,
      metadata: manifestMetadata,
      parts,
    }));
  } else {
    const metadataWithoutChecksum = { ...metadata };
    delete metadataWithoutChecksum.checksum;
    actualChecksum = sha256(JSON.stringify({ metadata: metadataWithoutChecksum, data }));
  }
  const { checksum } = metadata;
  assert.equal(actualChecksum, checksum, "backup checksum verification failed");
  return value;
}

function validateDatabaseContract(database, tables) {
  for (const table of tables) {
    const spec = RESTORE_TABLES[table];
    assert.ok(spec, `${table} has no restore contract`);
    const actualColumns = database.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`)
      .all().map((row) => row.name);
    assert.deepEqual(sorted(actualColumns), sorted(spec.columns), `${table} schema columns drifted`);
  }
}

function initializeRecoveryReferences(database) {
  // These schema-owned references are intentionally outside the backup contract.
  // Keep all restorable content and learner tables empty until the snapshot is applied.
  // Forward migrations may already have registered some of these reference pairs.
  const insertScope = database.prepare(
    "INSERT INTO course_content_scopes (exam_type, content_scope) VALUES (?, ?) ON CONFLICT(exam_type, content_scope) DO NOTHING",
  );
  for (const row of COURSE_CONTENT_SCOPE_ROWS) insertScope.run(row.examType, row.contentScope);
  const insertSubject = database.prepare(
    "INSERT INTO course_subjects (exam_type, subject) VALUES (?, ?) ON CONFLICT(exam_type, subject) DO NOTHING",
  );
  for (const row of COURSE_SUBJECT_ROWS) insertSubject.run(row.examType, row.subject);
}

function incrementReason(reasons, reason) {
  reasons[reason] = (reasons[reason] ?? 0) + 1;
}

function validateExamSessionQuestionSets(database, envelope) {
  const questions = new Map(envelope.data.questions.map((question) => [question.id, question]));
  const subjects = new Set(database.prepare("SELECT exam_type, subject FROM course_subjects")
    .all().map((row) => `${row.exam_type}\0${row.subject}`));
  const scopes = new Set(database.prepare("SELECT exam_type, content_scope FROM course_content_scopes")
    .all().map((row) => `${row.exam_type}\0${row.content_scope}`));
  const failures = [];
  for (const session of envelope.data.exam_sessions) {
    const reasons = {};
    let questionIds;
    try {
      questionIds = JSON.parse(session.question_ids);
    } catch {
      questionIds = [];
      incrementReason(reasons, "invalid-json");
    }
    if (!Array.isArray(questionIds)) {
      questionIds = [];
      incrementReason(reasons, "not-an-array");
    }
    const unique = new Set();
    for (const questionId of questionIds) {
      if (!Number.isInteger(questionId)) {
        incrementReason(reasons, "non-integer-id");
        continue;
      }
      if (unique.has(questionId)) incrementReason(reasons, "duplicate-id");
      unique.add(questionId);
      const question = questions.get(questionId);
      if (!question) {
        incrementReason(reasons, "missing-question");
        continue;
      }
      if (session.status !== "submitted" && question.active !== 1) {
        incrementReason(reasons, "inactive-question");
      }
      if (!subjects.has(`${session.exam_type}\0${question.category}`)) {
        incrementReason(reasons, "subject-out-of-scope");
      }
      if (!scopes.has(`${session.exam_type}\0${question.exam_scope}`)) {
        incrementReason(reasons, "content-scope-mismatch");
      }
    }
    if (Object.keys(reasons).length) {
      failures.push({
        examType: session.exam_type,
        status: session.status,
        questionCount: questionIds.length,
        reasons,
      });
    }
  }
  assert.deepEqual(failures, [], `exam session recovery preflight failed: ${JSON.stringify(failures)}`);
}

function restoreRows(database, table, rows) {
  if (!rows.length) return 0;
  const spec = RESTORE_TABLES[table];
  const keys = primaryKeys(spec);
  const columns = spec.columns.map(quoteIdentifier).join(", ");
  const extracted = spec.columns
    .map((column) => `json_extract(value, '$.${column}')`)
    .join(", ");
  const updates = spec.columns
    .filter((column) => !keys.includes(column))
    .map((column) => `${quoteIdentifier(column)} = excluded.${quoteIdentifier(column)}`)
    .join(", ");
  const conflictTarget = keys.map(quoteIdentifier).join(", ");
  const statement = database.prepare(`
    INSERT INTO ${quoteIdentifier(table)} (${columns})
    SELECT ${extracted} FROM json_each(?) WHERE 1
    ON CONFLICT(${conflictTarget}) DO UPDATE SET ${updates}
  `);
  let statementCount = 0;
  let group = [];
  let characters = 2;
  for (const row of rows) {
    const rowSize = JSON.stringify(row).length + 1;
    if (group.length && characters + rowSize > 100_000) {
      statement.run(JSON.stringify(group));
      statementCount += 1;
      group = [];
      characters = 2;
    }
    group.push(row);
    characters += rowSize;
  }
  if (group.length) {
    statement.run(JSON.stringify(group));
    statementCount += 1;
  }
  return statementCount;
}

function rowKey(row, spec) {
  return JSON.stringify(primaryKeys(spec).map((key) => row[key]));
}

function verifyRestoredRows(database, table, expectedRows) {
  const spec = RESTORE_TABLES[table];
  const columns = spec.columns.map(quoteIdentifier).join(", ");
  const actualRows = database.prepare(`SELECT ${columns} FROM ${quoteIdentifier(table)}`).all();
  assert.equal(actualRows.length, expectedRows.length, `${table} restored count changed`);
  const actualByKey = new Map(actualRows.map((row) => [rowKey(row, spec), { ...row }]));
  assert.equal(actualByKey.size, actualRows.length, `${table} restored primary keys are not unique`);
  for (const sourceRow of expectedRows) {
    assert.deepEqual(actualByKey.get(rowKey(sourceRow, spec)), sourceRow, `${table} restored row changed`);
  }
}

export function runDownloadedBackupRecoveryDrill(projectRoot, inputFile) {
  const startedAt = Date.now();
  const resolvedInput = path.resolve(inputFile);
  const stat = fs.statSync(resolvedInput);
  assert.ok(stat.isFile(), "backup input must be a regular file");
  assert.ok(stat.size > 0 && stat.size <= MAX_BACKUP_BYTES, "backup input size is outside the safe limit");
  const serialized = fs.readFileSync(resolvedInput, "utf8");
  assert.equal(Buffer.byteLength(serialized), stat.size, "backup input is not valid UTF-8 JSON");
  const envelope = validateDownloadedBackupEnvelope(JSON.parse(serialized));
  const database = new DatabaseSync(":memory:");
  let restoreStatementCount = 0;
  try {
    applyCanonicalMigrations(database, projectRoot);
    initializeRecoveryReferences(database);
    const restoredTables = envelope.metadata.includedData.filter(table => RESTORE_TABLES[table]);
    validateDatabaseContract(database, restoredTables);
    validateExamSessionQuestionSets(database, envelope);
    const included = new Set(envelope.metadata.includedData);
    database.exec("BEGIN IMMEDIATE");
    try {
      for (const table of BACKUP_DELETE_ORDER) {
        if (included.has(table)) database.exec(`DELETE FROM ${quoteIdentifier(table)}`);
      }
      for (const table of BACKUP_INSERT_ORDER) {
        if (included.has(table)) {
          restoreStatementCount += restoreRows(database, table, envelope.data[table]);
        }
      }
      for (const sql of GROUP_OWNER_SLOT_RECOVERY_SQL) database.exec(sql);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }

    for (const table of restoredTables) {
      verifyRestoredRows(database, table, envelope.data[table], envelope.metadata.schemaVersion);
    }
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), [],
      "restored backup has foreign-key violations");
    const sqliteIntegrity = database.prepare("PRAGMA integrity_check").all();
    assert.equal(sqliteIntegrity.length, 1, "restored SQLite database returned multiple integrity results");
    assert.equal(sqliteIntegrity[0].integrity_check, "ok",
      "restored SQLite database failed integrity_check");
    const integrity = buildDataIntegrityReport(database, {
      databaseLabel: "downloaded-backup-isolated-memory",
    });
    const contentContractFailures = integrity.failures
      .filter((failure) => CONTENT_CONTRACT_DRIFT.has(failure));
    const blockingIntegrityFailures = integrity.failures
      .filter((failure) => !CONTENT_CONTRACT_DRIFT.has(failure));
    assert.deepEqual(blockingIntegrityFailures, [],
      `restored backup failed data-integrity checks: ${blockingIntegrityFailures.join(", ")}`);

    return {
      result: contentContractFailures.length ? "pass-with-content-drift" : "pass",
      isolation: "in-memory SQLite; no production write connection",
      source: envelope.metadata.source,
      generatedAt: envelope.metadata.generatedAt,
      schemaVersion: envelope.metadata.schemaVersion,
      fileByteSize: stat.size,
      fileSha256: sha256(serialized),
      envelopeChecksum: envelope.metadata.checksum,
      tableCount: envelope.metadata.includedData.length,
      restoredTableCount: restoredTables.length,
      ignoredRetiredTables: envelope.metadata.includedData.filter(table => !RESTORE_TABLES[table]),
      rowCount: Object.values(envelope.metadata.counts).reduce((sum, count) => sum + count, 0),
      counts: envelope.metadata.counts,
      restoreStatementCount,
      sqliteIntegrity: "pass",
      foreignKeys: "pass",
      dataIntegrity: "pass",
      legacyGuestSessions: integrity.report.integrity.legacyGuestSessions,
      contentContract: contentContractFailures.length ? "drift" : "pass",
      contentContractFailures,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    database.close();
  }
}
