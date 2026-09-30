import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  BACKUP_SCHEMA_VERSION,
  BACKUP_TABLES,
  backupTableSpec,
  RESTORE_TABLES,
  allowedBackupTables,
} from "../packages/shared/src/admin/backup-contract.mjs";
import {
  runDownloadedBackupRecoveryDrill,
  validateDownloadedBackupEnvelope,
} from "../scripts/lib/downloaded-backup-verifier.mjs";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

// Fixed from the admin-7 full-backup contract before personal SKCT tables were added.
// Keep this independent of allowedBackupTables so omissions cannot pass by agreement.
const ADMIN7_FULL_TABLES = [
  "theories",
  "questions",
  "sw_theories",
  "sw_questions",
  "content_releases",
  "skct_content_releases",
  "skct_question_public",
  "skct_question_secret",
  "user_accounts",
  "user_settings",
  "guest_import_batches",
  "user_bookmarks",
  "exam_sessions",
  "exam_session_items",
  "exam_active_sessions",
  "attempts",
  "ai_evaluations",
  "sw_attempts",
  "sw_learning_sessions",
  "study_groups",
  "study_group_members",
  "study_group_membership_events",
  "study_group_invites",
  "study_group_quota_slots",
  "study_group_exam_runs",
  "study_group_exam_selection_metadata",
  "study_group_active_runs",
  "study_group_quota_events",
  "study_group_exam_participants",
  "study_group_exam_question_public",
  "study_group_exam_question_secret",
  "study_group_exam_answers",
  "study_group_answer_operations",
  "study_group_idempotency",
  "study_group_audit_events",
  "study_group_owner_slots",
  "study_group_exam_run_contract_v2",
  "skct_question_identity",
  "study_group_exam_question_identity_snapshot",
  "study_group_exam_repeat_claims",
  "study_group_exam_participant_progress",
  "user_reports",
  "site_settings",
];

function writeEnvelope(inputFile, envelope) {
  const metadata = { ...envelope.metadata };
  delete metadata.checksum;
  metadata.counts = Object.fromEntries(Object.entries(envelope.data)
    .map(([table, rows]) => [table, rows.length]));
  const checksum = createHash("sha256")
    .update(JSON.stringify({ metadata, data: envelope.data })).digest("hex");
  writeFileSync(inputFile, JSON.stringify({
    metadata: { ...metadata, checksum }, data: envelope.data,
  }), { mode: 0o600 });
}

function recoveryFixture(t, { includeLegacyGuests = false } = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "baeumzip-backup-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const inputFile = path.join(directory, "backup.json");
  const database = openCanonicalTestDatabase(projectRoot);
  try {
    const { id } = database.prepare(`
      SELECT q.id FROM questions q
      JOIN course_subjects subject ON subject.subject = q.category AND subject.exam_type = 'SQLP'
      JOIN course_content_scopes scope ON scope.content_scope = q.exam_scope AND scope.exam_type = 'SQLP'
      WHERE q.active = 1 ORDER BY q.id LIMIT 1
    `).get();
    database.prepare(`
      INSERT INTO exam_sessions (id, user_key, exam_type, status, question_ids, started_at, ends_at)
      VALUES ('download-drill-session', 'owner', 'SQLP', 'active', ?,
        '2026-09-07T00:00:00Z', '2026-09-07T01:00:00Z')
    `).run(JSON.stringify([id]));
    database.prepare(`
      INSERT INTO exam_session_items (session_id, question_id, position)
      VALUES ('download-drill-session', ?, 0)
    `).run(id);
    database.exec(`
      INSERT INTO exam_active_sessions (user_key, exam_type, session_id)
      VALUES ('owner', 'SQLP', 'download-drill-session')
    `);
    if (includeLegacyGuests) {
      const guestKey = `guest:${Math.floor(Date.parse("2026-09-08T00:00:00Z") / 1000)}:${"a".repeat(32)}`;
      const swQuestion = database.prepare("SELECT id FROM sw_questions WHERE active = 1 LIMIT 1").get();
      database.prepare(`
        INSERT INTO exam_sessions (id, user_key, exam_type, status, question_ids,
          started_at, ends_at, submitted_at, created_at)
        VALUES ('download-drill-guest', ?, 'SQLP', 'submitted', ?,
          '2026-09-07T00:00:00Z', '2026-09-07T01:00:00Z', '2026-09-07T01:00:00Z',
          '2026-09-07T00:00:00Z')
      `).run(guestKey, JSON.stringify([id]));
      database.prepare(`
        INSERT INTO exam_session_items (session_id, question_id, position)
        VALUES ('download-drill-guest', ?, 0)
      `).run(id);
      database.prepare(`
        INSERT INTO sw_learning_sessions (id, user_key, mode, status, question_ids, created_at)
        VALUES ('download-drill-guest-sw', ?, 'practice', 'active', ?, '2026-09-07T00:00:00Z')
      `).run(guestKey, JSON.stringify([swQuestion.id]));
    }
    const envelope = emptyFullEnvelope();
    for (const table of envelope.metadata.includedData) {
      envelope.data[table] = database.prepare(
        `SELECT ${RESTORE_TABLES[table].columns.join(", ")} FROM ${table}`,
      ).all().map((row) => ({ ...row }));
    }
    writeEnvelope(inputFile, envelope);
    return { inputFile, envelope };
  } finally {
    database.close();
  }
}

function emptyFullEnvelope({ includeAnalytics = false, schemaVersion = BACKUP_SCHEMA_VERSION } = {}) {
  const tables = allowedBackupTables("full", includeAnalytics, schemaVersion);
  const data = Object.fromEntries(tables.map((table) => [table, []]));
  const metadata = {
    backupVersion: "1",
    appVersion: "test",
    schemaVersion,
    type: "full",
    source: "automatic",
    generatedAt: "2026-08-26T00:00:00.000Z",
    includedData: tables,
    counts: Object.fromEntries(tables.map((table) => [table, 0])),
  };
  const checksum = createHash("sha256")
    .update(JSON.stringify({ metadata, data }))
    .digest("hex");
  return { metadata: { ...metadata, checksum }, data };
}

test("backup type lookup rejects inherited object keys", () => {
  assert.deepEqual(allowedBackupTables("toString"), []);
  assert.deepEqual(allowedBackupTables("__proto__"), []);
});

test("full backups cover every durable learner, group, and personal SKCT state", () => {
  const full = new Set(BACKUP_TABLES.full);
  for (const table of [
    "skct_personal_releases",
    "skct_personal_public_items",
    "skct_personal_secret_items",
    "skct_personal_release_audit",
    "skct_personal_attempts",
    "skct_personal_attempt_items",
    "user_accounts",
    "guest_import_batches",
    "guest_import_receipts",
    "exam_sessions",
    "exam_session_items",
    "exam_active_sessions",
    "attempts",
    "sw_attempts",
    "sw_learning_sessions",
    "content_releases",
    "skct_content_releases",
    "skct_question_public",
    "skct_question_secret",
    "study_groups",
    "study_group_members",
    "study_group_membership_events",
    "study_group_invites",
    "study_group_quota_slots",
    "study_group_exam_runs",
    "study_group_exam_selection_metadata",
    "study_group_active_runs",
    "study_group_quota_events",
    "study_group_exam_participants",
    "study_group_exam_question_public",
    "study_group_exam_question_secret",
    "study_group_exam_answers",
    "study_group_answer_operations",
    "study_group_idempotency",
    "study_group_audit_events",
  ]) {
    assert.ok(full.has(table), table);
    assert.ok(RESTORE_TABLES[table], `${table} restore contract`);
  }
  assert.ok(RESTORE_TABLES.attempts.columns.includes("client_operation_id"));
  assert.ok(RESTORE_TABLES.exam_sessions.columns.includes("revision"));
});

test("admin-7 snapshots remain valid without personal SKCT tables", () => {
  assert.equal(ADMIN7_FULL_TABLES.length,43);
  assert.deepEqual(allowedBackupTables("full",false,"admin-7"),ADMIN7_FULL_TABLES);
  assert.equal(ADMIN7_FULL_TABLES.some(table => table.startsWith("skct_personal_")),false);
  const envelope = emptyFullEnvelope({ schemaVersion:"admin-7" });
  assert.deepEqual(envelope.metadata.includedData,ADMIN7_FULL_TABLES);
  assert.equal(validateDownloadedBackupEnvelope(envelope),envelope);
  const withAnalytics = emptyFullEnvelope({ schemaVersion:"admin-7",includeAnalytics:true });
  assert.deepEqual(withAnalytics.metadata.includedData,[...ADMIN7_FULL_TABLES,"analytics_events"]);
  assert.equal(validateDownloadedBackupEnvelope(withAnalytics),withAnalytics);
});

test("admin-7 full snapshots still complete the downloaded recovery drill", (t) => {
  const { inputFile,envelope } = recoveryFixture(t);
  const tables = ADMIN7_FULL_TABLES;
  envelope.metadata.schemaVersion = "admin-7";
  envelope.metadata.includedData = tables;
  envelope.data = Object.fromEntries(tables.map(table => [table,envelope.data[table] ?? []]));
  writeEnvelope(inputFile,envelope);
  const result = runDownloadedBackupRecoveryDrill(projectRoot,inputFile);
  assert.equal(result.result,"pass");
  assert.equal(result.counts.exam_session_items,1);
});

test("admin-8 full snapshot restores a legacy guest marker without a receipt", (t) => {
  const { inputFile, envelope } = recoveryFixture(t);
  envelope.metadata.schemaVersion = "admin-8";
  envelope.metadata.includedData = allowedBackupTables("full", false, "admin-8");
  delete envelope.data.guest_import_receipts;
  envelope.data.guest_import_batches.push({
    user_key: "owner", import_id: "guest_import_legacy_001", imported_at: "2026-09-07 00:00:00",
  });
  writeEnvelope(inputFile, envelope);
  const result = runDownloadedBackupRecoveryDrill(projectRoot, inputFile);
  assert.equal(result.result, "pass");
  assert.equal(result.counts.guest_import_batches, 1);
  assert.equal(result.counts.guest_import_receipts, undefined);
});

test("admin-9 full snapshot preserves a verified guest receipt digest", (t) => {
  const { inputFile, envelope } = recoveryFixture(t);
  envelope.data.guest_import_batches.push({
    user_key: "owner", import_id: "guest_import_verified_001", imported_at: "2026-09-07 00:00:00",
  });
  envelope.data.guest_import_receipts.push({
    user_key: "owner", import_id: "guest_import_verified_001",
    payload_digest: "a".repeat(64), imported_at: "2026-09-07 00:00:00",
  });
  writeEnvelope(inputFile, envelope);
  const result = runDownloadedBackupRecoveryDrill(projectRoot, inputFile);
  assert.equal(result.result, "pass");
  assert.equal(result.counts.guest_import_batches, 1);
  assert.equal(result.counts.guest_import_receipts, 1);
});

test("admin-7 full snapshots reject tampering and missing recovery tables", () => {
  const tampered = emptyFullEnvelope({ schemaVersion:"admin-7" });
  tampered.metadata.generatedAt = "2026-08-26T00:00:01.000Z";
  assert.throws(() => validateDownloadedBackupEnvelope(tampered), /checksum verification failed/u);
  const incomplete = emptyFullEnvelope({ schemaVersion:"admin-7" });
  incomplete.metadata.includedData = incomplete.metadata.includedData.slice(1);
  assert.throws(() => validateDownloadedBackupEnvelope(incomplete), /coverage does not match/u);
});

test("admin-7 recovery preflight rejects questions outside the session course", (t) => {
  const { inputFile,envelope } = recoveryFixture(t);
  envelope.metadata.schemaVersion = "admin-7";
  envelope.metadata.includedData = ADMIN7_FULL_TABLES;
  envelope.data = Object.fromEntries(ADMIN7_FULL_TABLES.map(table => [table,envelope.data[table] ?? []]));
  envelope.data.exam_sessions[0].exam_type = "ADP";
  writeEnvelope(inputFile,envelope);
  assert.throws(() => runDownloadedBackupRecoveryDrill(projectRoot,inputFile),
    /exam session recovery preflight failed:.*subject-out-of-scope.*content-scope-mismatch/u);
});

test("downloaded full-backup envelopes require complete coverage and a valid checksum", () => {
  const envelope = emptyFullEnvelope();
  assert.equal(validateDownloadedBackupEnvelope(envelope), envelope);
  envelope.metadata.generatedAt = "2026-08-26T00:00:01.000Z";
  assert.throws(() => validateDownloadedBackupEnvelope(envelope), /checksum verification failed/u);
});

test("downloaded full-backup envelopes permit optional anonymous analytics", () => {
  const envelope = emptyFullEnvelope({ includeAnalytics: true });
  assert.equal(validateDownloadedBackupEnvelope(envelope), envelope);
  assert.equal(envelope.metadata.includedData.at(-1), "analytics_events");
});

test("downloaded full-backup envelopes reject missing recovery tables", () => {
  const envelope = emptyFullEnvelope();
  envelope.metadata.includedData = envelope.metadata.includedData.slice(1);
  assert.throws(() => validateDownloadedBackupEnvelope(envelope), /coverage does not match/u);
});

test("downloaded backups restore learner sessions into a fresh database with trusted course references", (t) => {
  const { inputFile, envelope } = recoveryFixture(t);
  const result = runDownloadedBackupRecoveryDrill(projectRoot, inputFile);
  assert.equal(result.result, "pass");
  assert.equal(result.tableCount, BACKUP_TABLES.full.length);
  assert.equal(result.rowCount, Object.values(envelope.data).reduce((sum, rows) => sum + rows.length, 0));
  assert.equal(result.counts.exam_sessions, 1);
  assert.equal(result.counts.exam_session_items, 1);
  assert.equal(result.counts.exam_active_sessions, 1);
  assert.equal(result.sqliteIntegrity, "pass");
  assert.equal(result.foreignKeys, "pass");
  assert.equal(result.dataIntegrity, "pass");
});

test("downloaded full backup retains valid legacy guest sessions without treating them as member orphans", (t) => {
  const { inputFile, envelope } = recoveryFixture(t, { includeLegacyGuests: true });
  const result = runDownloadedBackupRecoveryDrill(projectRoot, inputFile);
  assert.equal(result.result, "pass");
  assert.equal(result.rowCount, Object.values(envelope.data).reduce((sum, rows) => sum + rows.length, 0));
  assert.equal(result.counts.exam_sessions, 2);
  assert.equal(result.counts.sw_learning_sessions, 1);
  assert.equal(result.dataIntegrity, "pass");
  assert.deepEqual(result.legacyGuestSessions, {
    examSessions: { total: 1, expired: 1 },
    swSessions: { total: 1, expired: 1 },
  });
});

test("downloaded backup preflight still rejects questions outside the session course", (t) => {
  const { inputFile, envelope } = recoveryFixture(t);
  envelope.data.exam_sessions[0].exam_type = "ADP";
  writeEnvelope(inputFile, envelope);
  assert.throws(() => runDownloadedBackupRecoveryDrill(projectRoot, inputFile),
    /exam session recovery preflight failed:.*subject-out-of-scope.*content-scope-mismatch/u);
});

test("theory replacement remaps question links before deleting only the approved rows", () => {
  const source = readFileSync(new URL(
    "../apps/backend/src/modules/admin/admin-backup-use-cases.ts",
    import.meta.url,
  ), "utf8");
  assert.match(source, /missingIds[\s\S]+remappedIds[\s\S]+승인된 ID 통합표/u);
  assert.doesNotMatch(source, /INSERT INTO theory_progress/u);
  assert.match(source, /UPDATE questions[\s\S]+canonicalId/u);
  assert.match(source, /DELETE FROM theories WHERE id NOT IN/u);
});


test("legacy full backups verify retired rows but restore only current tables", (t) => {
  const { inputFile, envelope } = recoveryFixture(t);
  envelope.metadata.schemaVersion = "admin-4";
  envelope.metadata.includedData = allowedBackupTables("full", false, "admin-4");
  envelope.data = Object.fromEntries(envelope.metadata.includedData.map(table => [table, envelope.data[table] ?? []]));
  envelope.data.theory_progress = [{ id: 1, user_key: "owner", theory_id: 1, exam_type: "SQLP", completed: 1, updated_at: "2026-09-08T00:00:00Z" }];
  envelope.data.sw_theory_progress = [{ user_key: "owner", theory_id: "legacy-theory", completed: 1, updated_at: "2026-09-08T00:00:00Z" }];
  writeEnvelope(inputFile, envelope);
  const result = runDownloadedBackupRecoveryDrill(projectRoot, inputFile);
  assert.equal(result.result, "pass");
  assert.equal(result.tableCount, 20);
  assert.equal(result.restoredTableCount, 18);
  assert.deepEqual(result.ignoredRetiredTables, ["theory_progress", "sw_theory_progress"]);
  assert.equal(result.counts.exam_session_items, 1);
  const tampered = JSON.parse(readFileSync(inputFile, "utf8"));
  tampered.data.theory_progress[0].completed = 0;
  assert.throws(() => validateDownloadedBackupEnvelope(tampered), /checksum verification failed/u);
  assert.equal(backupTableSpec("theory_progress"), undefined);
  assert.ok(backupTableSpec("theory_progress", "admin-4"));
  assert.equal(backupTableSpec("toString", "admin-4"), undefined);
});
