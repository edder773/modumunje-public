import { GROUP_OWNER_SLOT_RECOVERY_SQL } from "../../packages/shared/src/admin/group-owner-slot-recovery.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  BACKUP_DELETE_ORDER,
  BACKUP_INSERT_ORDER,
  BACKUP_SCHEMA_VERSION,
  BACKUP_TABLES,
  BACKUP_VERSION,
  RESTORE_TABLES,
  splitBackupPayload,
} from "../../packages/shared/src/admin/backup-contract.mjs";
import { openCanonicalDatabase } from "./canonical-database.mjs";
import { buildDataIntegrityReport } from "./data-integrity.mjs";

function quoteIdentifier(value) {
  if (!/^[a-z][a-z0-9_]*$/u.test(value)) throw new Error(`Unsafe identifier: ${value}`);
  return `\`${value}\``;
}

function primaryKeys(spec) {
  return Array.isArray(spec.primaryKey) ? spec.primaryKey : [spec.primaryKey];
}

function orderedRows(database, table, spec) {
  const columns = spec.columns.map(quoteIdentifier).join(", ");
  const order = primaryKeys(spec).map(quoteIdentifier).join(", ");
  return database.prepare(
    `SELECT ${columns} FROM ${quoteIdentifier(table)} ORDER BY ${order}`,
  ).all().map((row) => ({ ...row }));
}

function chunkRows(rows, maxCharacters = 100_000) {
  const groups = [];
  let current = [];
  let size = 2;
  for (const row of rows) {
    const rowSize = JSON.stringify(row).length + 1;
    if (current.length && size + rowSize > maxCharacters) {
      groups.push(current);
      current = [];
      size = 2;
    }
    current.push(row);
    size += rowSize;
  }
  if (current.length) groups.push(current);
  return groups;
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
  const groups = chunkRows(rows);
  for (const group of groups) statement.run(JSON.stringify(group));
  return groups.length;
}

function validateContract(database) {
  const full = new Set(BACKUP_TABLES.full);
  const orderScope = new Set([...full, "analytics_events"]);
  assert.equal(full.size, BACKUP_TABLES.full.length, "full backup tables must be unique");
  for (const table of orderScope) {
    const spec = RESTORE_TABLES[table];
    assert.ok(spec, `${table} needs a restore specification`);
    assert.ok(BACKUP_DELETE_ORDER.includes(table), `${table} needs a delete order`);
    assert.ok(BACKUP_INSERT_ORDER.includes(table), `${table} needs an insert order`);
    const actualColumns = database.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`)
      .all().map((row) => row.name);
    assert.deepEqual(
      [...spec.columns].sort(),
      [...actualColumns].sort(),
      `${table} restore columns drifted from the schema`,
    );
    for (const key of primaryKeys(spec)) {
      assert.ok(actualColumns.includes(key), `${table}.${key} primary key is missing`);
    }
  }

  const insertPosition = new Map(BACKUP_INSERT_ORDER.map((table, index) => [table, index]));
  const deletePosition = new Map(BACKUP_DELETE_ORDER.map((table, index) => [table, index]));
  for (const child of orderScope) {
    const foreignKeys = database.prepare(`PRAGMA foreign_key_list(${quoteIdentifier(child)})`).all();
    for (const foreignKey of foreignKeys) {
      const parent = foreignKey.table;
      if (!orderScope.has(parent)) continue;
      assert.ok(
        insertPosition.get(parent) < insertPosition.get(child),
        `${parent} must be inserted before ${child}`,
      );
      assert.ok(
        deletePosition.get(child) < deletePosition.get(parent),
        `${child} must be deleted before ${parent}`,
      );
    }
  }
}

export function seedRecoverySentinels(database) {
  const sqlQuestion = database.prepare("SELECT id FROM questions ORDER BY id LIMIT 1").get();
  const sqlTheory = database.prepare("SELECT id FROM theories ORDER BY id LIMIT 1").get();
  const swQuestion = database.prepare(
    "SELECT id, theory_id, subject_id FROM sw_questions WHERE theory_id IS NOT NULL ORDER BY id LIMIT 1",
  ).get();
  assert.ok(sqlQuestion && sqlTheory && swQuestion, "canonical content fixtures are required");
  const stamp = "2026-08-22T00:00:00.000Z";
  const userKey = "stage1-recovery-user";
  const sessionId = "stage1-recovery-exam";

  database.prepare(`
    INSERT INTO user_accounts (
      user_key, email, display_name, status, blocked_reason, created_at,
      last_login_at, updated_at
    ) VALUES (?, ?, ?, 'active', '', ?, ?, ?)
  `).run(userKey, "stage1-recovery@example.invalid", "복원 검증", stamp, stamp, stamp);
  database.prepare(`
    INSERT INTO user_settings (user_key, selected_exam, created_at, updated_at)
    VALUES (?, 'SQLP', ?, ?)
  `).run(userKey, stamp, stamp);
  database.prepare(`
    INSERT INTO guest_import_batches (user_key, import_id, imported_at)
    VALUES (?, 'stage1-import', ?)
  `).run(userKey, stamp);
  // Historical migration drills intentionally run before receipt support exists.
  if (database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'guest_import_receipts'").get()) {
    database.prepare(`
      INSERT INTO guest_import_batches (user_key, import_id, imported_at)
      VALUES (?, 'stage1-verified-import', ?)
    `).run(userKey, stamp);
    database.prepare(`
      INSERT INTO guest_import_receipts (user_key, import_id, payload_digest, imported_at)
      VALUES (?, 'stage1-verified-import', ?, ?)
    `).run(userKey, "a".repeat(64), stamp);
  }
  database.prepare(`
    INSERT INTO user_bookmarks (user_key, question_id, created_at) VALUES (?, ?, ?)
  `).run(userKey, sqlQuestion.id, stamp);
  database.prepare(`
    INSERT INTO exam_sessions (
      id, user_key, exam_type, status, question_ids, answers,
      descriptive_answers, descriptive_scores, descriptive_snapshots, flagged,
      current_index, started_at, ends_at, result, revision, is_admin,
      created_at, updated_at
    ) VALUES (?, ?, 'SQLP', 'active', ?, ?, '{}', '{}', '{}', '[]', 0, ?, ?, '{}', 7, 0, ?, ?)
  `).run(
    sessionId,
    userKey,
    JSON.stringify([sqlQuestion.id]),
    JSON.stringify({ [sqlQuestion.id]: [1] }),
    stamp,
    "2026-08-22T01:00:00.000Z",
    stamp,
    stamp,
  );
  database.prepare(`
    INSERT INTO exam_session_items (
      session_id, question_id, position, selected_answers, descriptive_answer,
      descriptive_snapshot, flagged, revision, updated_at
    ) VALUES (?, ?, 0, '[1]', '', '', 0, 7, ?)
  `).run(sessionId, sqlQuestion.id, stamp);
  database.prepare(`
    INSERT INTO exam_active_sessions (user_key, exam_type, session_id, updated_at)
    VALUES (?, 'SQLP', ?, ?)
  `).run(userKey, sessionId, stamp);
  const evaluation = database.prepare(`
    INSERT INTO ai_evaluations (
      user_key, question_id, answer_hash, result, score, created_at
    ) VALUES (?, ?, 'stage1-hash', 'correct', 100, ?)
  `).run(userKey, sqlQuestion.id, stamp);
  database.prepare(`
    INSERT INTO attempts (
      question_id, selected_answers, correct, mode, user_key, exam_type,
      result, score, answer_text, evaluation_id, review_status, is_admin,
      client_operation_id, created_at
    ) VALUES (?, '[1]', 1, 'practice', ?, 'SQLP', 'correct', 100, '', ?,
      'mastered', 0, 'stage1-sql-attempt', ?)
  `).run(sqlQuestion.id, userKey, evaluation.lastInsertRowid, stamp);
  database.prepare(`
    INSERT INTO sw_attempts (
      user_key, question_id, selected_answers, correct, mode,
      client_operation_id, created_at
    ) VALUES (?, ?, '[1]', 1, 'practice', 'stage1-sw-attempt', ?)
  `).run(userKey, swQuestion.id, stamp);
  database.prepare(`
    INSERT INTO sw_learning_sessions (
      id, user_key, mode, status, subject_ids, question_ids, answers,
      revealed_question_ids, current_index, result, revision, created_at, updated_at
    ) VALUES ('stage1-recovery-sw', ?, 'practice', 'active', ?, ?, ?, ?, 0, '{}', 3, ?, ?)
  `).run(
    userKey,
    JSON.stringify([swQuestion.subject_id]),
    JSON.stringify([swQuestion.id]),
    JSON.stringify({ [swQuestion.id]: [1] }),
    JSON.stringify([swQuestion.id]),
    stamp,
    stamp,
  );
  database.prepare(`
    INSERT INTO user_reports (
      id, user_key, category, title, description, page_path, question_id,
      status, admin_note, created_at, updated_at
    ) VALUES ('stage1-recovery-report', ?, 'bug', '복원 검증', '격리 데이터',
      '/stage1', ?, 'new', '', ?, ?)
  `).run(userKey, sqlQuestion.id, stamp, stamp);

  const hasGroupExamSchema = Boolean(database.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'skct_content_releases'",
  ).get());
  if (hasGroupExamSchema) {
    database.exec(`
    INSERT INTO skct_content_releases (
      id, status, dataset, schema_version, completed_folder_id, json_file_id,
      json_sha256, md_file_id, md_sha256, license_note, manifest_json,
      normalized_count, eligible_count, quarantine_count, release_sha256, created_at
    ) VALUES ('stage1-skct-release', 'active', 'SKCT', '1', 'folder', 'json',
      'json-sha', 'md', 'md-sha', 'private-dev replacement planned', '{}', 1, 1, 0, 'release-sha', '${stamp}');
    INSERT INTO skct_question_public (
      release_id, question_uid, content_set, area_code, question_no, kind,
      prompt_md, choices_json, dependency_group_id, asset_refs_json,
      question_source_refs_json, question_hash, eligibility, quarantine_reasons_json
    ) VALUES ('stage1-skct-release', 'q1', 'sentinel', '언어이해', 1, 'single',
      '복원 검증 문항', '["A","B"]', NULL, '[]', '[]', 'question-sha', 'eligible', '[]');
    INSERT INTO skct_question_secret (
      release_id, question_uid, correct_answers_json, explanation_md,
      answer_source_refs_json, secret_hash
    ) VALUES ('stage1-skct-release', 'q1', '[0]', '복원 검증 해설', '[]', 'secret-sha');
    INSERT INTO study_groups (
      id, name, owner_user_key, member_limit, settings_json, status, revision,
      last_mutation_execution_id, created_at, updated_at
    ) VALUES ('stage1-group', '복원 검증 그룹', '${userKey}', 2, '{}', 'active', 1, 'stage1-group-mutation', '${stamp}', '${stamp}');
    INSERT INTO study_group_members (
      group_id, user_key, public_id, public_name, status, membership_epoch,
      last_mutation_execution_id, joined_at
    ) VALUES ('stage1-group', '${userKey}', 'stage1-membership', '복원 검증', 'active', 1, 'stage1-member-mutation', '${stamp}');
    INSERT INTO study_group_membership_events (
      id, group_id, user_key, membership_epoch, event_type, actor_user_key, created_at
    ) VALUES ('stage1-member-event', 'stage1-group', '${userKey}', 1, 'joined', '${userKey}', '${stamp}');
    INSERT INTO study_group_invites (
      id, group_id, token_digest, status, expires_at, created_by_user_key, created_at,
      revision, last_mutation_execution_id
    ) VALUES ('stage1-invite', 'stage1-group', 'stage1-token-digest', 'revoked', '${stamp}', '${userKey}', '${stamp}', 1, 'stage1-invite-mutation');
    INSERT INTO study_group_quota_slots (
      group_id, date_key, slot_no, source, status, reserved_run_id, revision, created_at, updated_at
    ) VALUES ('stage1-group', '2026-08-22', 1, 'base', 'consumed', 'stage1-run', 1, '${stamp}', '${stamp}');
    INSERT INTO study_group_exam_runs (
      id, group_id, start_request_id, mode, status, actual_started_at_utc,
      quota_date_key, quota_slot_no, question_count_snapshot, settings_snapshot_json,
      source_release_id, source_release_sha256, participant_count_snapshot,
      final_deadline_at_utc, revision, created_by_user_key, created_at,
      last_mutation_execution_id
    ) VALUES ('stage1-run', 'stage1-group', 'stage1-start', 'immediate', 'running', '${stamp}',
      '2026-08-22', 1, 1, '{}', 'stage1-skct-release', 'release-sha', 1,
      '2026-08-22T01:00:00.000Z', 1, '${userKey}', '${stamp}', 'stage1-run-mutation');
    INSERT INTO study_group_exam_selection_metadata (
      run_id, algorithm_version, seed, history_cutoff_utc, history_digest_sha256,
      snapshot_digest_sha256, repeat_policy, repeat_fallback, area_policy,
      settings_schema_version, created_at
    ) VALUES ('stage1-run', 'bundle-sha256-v1', 'stage1-seed', '${stamp}',
      'history-sha', 'snapshot-sha', 'allow', 0,
      'validated-release:any-area:dependency-bundle:exact-count-v1', 1, '${stamp}');
    INSERT INTO study_group_active_runs (group_id, run_id, updated_at)
      VALUES ('stage1-group', 'stage1-run', '${stamp}');
    INSERT INTO study_group_quota_events (
      id, idempotency_key, group_id, date_key, slot_no, run_id, event_type, actor_user_key, created_at
    ) VALUES ('stage1-quota-event', 'stage1-quota-key', 'stage1-group', '2026-08-22', 1, 'stage1-run', 'consume', '${userKey}', '${stamp}');
    INSERT INTO study_group_exam_participants (
      run_id, user_key, public_name_snapshot, membership_epoch_snapshot, status,
      last_mutation_execution_id, wrong_positions_json
    ) VALUES ('stage1-run', '${userKey}', '복원 검증', 1, 'in_progress', 'stage1-participant-mutation', '[]');
    INSERT INTO study_group_exam_question_public (
      run_id, position, source_question_uid, area_code_snapshot, prompt_snapshot,
      choices_snapshot_json, asset_refs_snapshot_json, time_limit_seconds,
      opens_at_utc, deadline_at_utc, snapshot_hash
    ) VALUES ('stage1-run', 0, 'q1', '언어이해', '복원 검증 문항', '["A","B"]', '[]', 60,
      '${stamp}', '2026-08-22T01:00:00.000Z', 'snapshot-sha');
    INSERT INTO study_group_exam_question_secret (
      run_id, position, correct_answers_snapshot_json, explanation_snapshot, secret_hash
    ) VALUES ('stage1-run', 0, '[0]', '복원 검증 해설', 'snapshot-secret-sha');
    INSERT INTO study_group_exam_answers (
      run_id, user_key, position, answer_json, revision, last_client_operation_id,
      server_received_at_utc, updated_at
    ) VALUES ('stage1-run', '${userKey}', 0, '[0]', 1, 'stage1-answer-operation', '${stamp}', '${stamp}');
    INSERT INTO study_group_answer_operations (
      operation_id, run_id, user_key, position, answer_hash, result_revision, created_at
    ) VALUES ('stage1-answer-operation', 'stage1-run', '${userKey}', 0, 'answer-sha', 1, '${stamp}');
    INSERT INTO study_group_idempotency (
      actor_user_key, action, idempotency_key, request_digest, execution_id,
      response_status, response_json, created_at
    ) VALUES ('${userKey}', 'sentinel', 'stage1-idempotency', 'request-sha', 'execution', 200, '{"ok":true}', '${stamp}');
    INSERT INTO study_group_audit_events (
      id, group_id, actor_user_key, action, target_id, before_summary, after_summary, created_at
    ) VALUES ('stage1-audit', 'stage1-group', '${userKey}', 'sentinel', 'stage1-run', '{}', '{}', '${stamp}');

    INSERT INTO study_group_owner_slots VALUES ('stage1-group','${userKey}',1);
    INSERT INTO study_group_exam_run_contract_v2 VALUES ('stage1-run','carry_remaining','allow','{}','${stamp}');
    INSERT INTO skct_question_identity VALUES ('stage1-skct-release','q1','identity-q1','bundle-q1','["sentinel"]',1);
    INSERT INTO study_group_exam_question_identity_snapshot VALUES ('stage1-run',0,'identity-q1','bundle-q1','sentinel');
    INSERT INTO study_group_exam_repeat_claims VALUES ('stage1-group','identity-q1','stage1-run');
    INSERT INTO study_group_exam_participant_progress (run_id,user_key,participant_id,roster_position,current_position,current_opened_at_utc,current_deadline_at_utc,started_at_utc)
      VALUES ('stage1-run','${userKey}','participant-sentinel',0,0,'${stamp}','2026-08-22T01:00:00.000Z','${stamp}');
    `);
  }

  return { userKey };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function runBackupRecoveryDrill(projectRoot) {
  const startedAt = Date.now();
  const database = openCanonicalDatabase(projectRoot);
  try {
    validateContract(database);
    const sentinel = seedRecoverySentinels(database);
    const data = Object.fromEntries(
      BACKUP_TABLES.full.map((table) => [
        table,
        orderedRows(database, table, RESTORE_TABLES[table]),
      ]),
    );
    const counts = Object.fromEntries(
      Object.entries(data).map(([table, rows]) => [table, rows.length]),
    );
    const metadata = {
      backupVersion: BACKUP_VERSION,
      appVersion: "stage1-isolated-drill",
      schemaVersion: BACKUP_SCHEMA_VERSION,
      type: "full",
      source: "manual",
      generatedAt: new Date().toISOString(),
      includedData: [...BACKUP_TABLES.full],
      counts,
    };
    const checksum = sha256(JSON.stringify({ metadata, data }));
    const serialized = JSON.stringify({ metadata: { ...metadata, checksum }, data });
    const chunks = splitBackupPayload(serialized);
    const reassembled = chunks.join("");
    assert.equal(reassembled, serialized, "chunk reassembly changed the backup payload");
    const parsed = JSON.parse(reassembled);
    const { checksum: parsedChecksum, ...parsedMetadata } = parsed.metadata;
    assert.equal(
      sha256(JSON.stringify({ metadata: parsedMetadata, data: parsed.data })),
      parsedChecksum,
      "backup checksum verification failed",
    );
    const tampered = `${reassembled.slice(0, -2)}x}`;
    assert.notEqual(sha256(tampered), sha256(reassembled), "tampering must change the digest");

    const tagRowsBefore = database.prepare(
      "SELECT question_id, tag FROM sw_question_tags ORDER BY question_id, tag",
    ).all().map((row) => ({ ...row }));
    let restoreStatementCount = 0;
    database.exec("BEGIN IMMEDIATE");
    try {
      for (const table of BACKUP_DELETE_ORDER) {
        if (BACKUP_TABLES.full.includes(table)) {
          database.exec(`DELETE FROM ${quoteIdentifier(table)}`);
        }
      }
      for (const table of BACKUP_INSERT_ORDER) {
        if (BACKUP_TABLES.full.includes(table)) {
          restoreStatementCount += restoreRows(database, table, parsed.data[table]);
        }
      }
      for (const sql of GROUP_OWNER_SLOT_RECOVERY_SQL) database.exec(sql);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }

    for (const table of BACKUP_TABLES.full) {
      assert.deepEqual(
        orderedRows(database, table, RESTORE_TABLES[table]),
        data[table],
        `${table} changed during restore`,
      );
    }
    assert.deepEqual(
      database.prepare("SELECT question_id, tag FROM sw_question_tags ORDER BY question_id, tag")
        .all().map((row) => ({ ...row })),
      tagRowsBefore,
      "derived SW tag index was not rebuilt after restore",
    );
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM user_accounts WHERE user_key = ?")
        .get(sentinel.userKey).count,
      1,
      "learner account sentinel was not restored",
    );
    const integrity = buildDataIntegrityReport(database, {
      databaseLabel: "stage1-recovery-drill",
    });
    assert.deepEqual(
      integrity.failures,
      [],
      `restored backup failed the data-integrity gate: ${integrity.failures.join(", ")}`,
    );

    return {
      result: "pass",
      dataIntegrity: "pass",
      isolation: "temporary canonical SQLite clone",
      schemaVersion: BACKUP_SCHEMA_VERSION,
      tableCount: BACKUP_TABLES.full.length,
      counts,
      checksum,
      byteSize: Buffer.byteLength(serialized),
      chunkCount: chunks.length,
      restoreStatementCount,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    database.close();
  }
}
