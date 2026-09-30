import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { EXPECTED_SCHEMA_VERSION } from "../packages/shared/src/database/schema-contract.mjs";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";
import { buildDataIntegrityReport } from "../scripts/lib/data-integrity.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("stage 3 integrity gate validates content, learner state, and operational metadata", () => {
  const database = openCanonicalTestDatabase(root);
  try {
    const { failures, report } = buildDataIntegrityReport(database, {
      databaseLabel: "stage3-test",
    });
    assert.deepEqual(failures, []);
    assert.equal(report.schemaVersion, EXPECTED_SCHEMA_VERSION);
    assert.equal(report.integrity.foreignKeyViolations, 0);
    assert.equal(report.integrity.courseRegistry.contentScopesMatch, true);
    assert.equal(report.integrity.courseRegistry.subjectsMatch, true);
    assert.ok(Object.values(report.integrity.contentState).every((count) => count === 0));
    assert.ok(Object.values(report.integrity.learnerState).every((count) => count === 0));
    assert.ok(Object.values(report.integrity.operationalState).every((count) => count === 0));
  } finally {
    database.close();
  }
});

test("legacy guest learning sessions are reported separately from missing member accounts", () => {
  const database = openCanonicalTestDatabase(root);
  try {
    const question = database.prepare(`
      SELECT q.id FROM questions q
      JOIN course_subjects subject ON subject.subject = q.category AND subject.exam_type = 'SQLP'
      JOIN course_content_scopes scope ON scope.content_scope = q.exam_scope AND scope.exam_type = 'SQLP'
      WHERE q.active = 1 ORDER BY q.id LIMIT 1
    `).get();
    const swQuestion = database.prepare("SELECT id FROM sw_questions WHERE active = 1 LIMIT 1").get();
    const expiredGuestKey = `guest:${Math.floor(Date.parse("2026-09-02T00:00:00Z") / 1000)}:${"a".repeat(32)}`;
    const liveGuestKey = `guest:${Math.floor(Date.parse("2026-09-04T00:00:00Z") / 1000)}:${"b".repeat(32)}`;
    const nowEpochSeconds = Math.floor(Date.parse("2026-09-03T12:00:00Z") / 1000);
    database.prepare(`
      INSERT INTO exam_sessions (id, user_key, exam_type, status, question_ids, started_at,
        ends_at, submitted_at, policy_version, policy_snapshot, created_at)
      VALUES ('legacy-guest-exam', ?, 'SQLP', 'submitted', ?,
        '2026-09-01T00:00:00Z', '2026-09-01T01:00:00Z', '2026-09-01T01:00:00Z',
        'legacy', '{}', '2026-09-01T00:00:00Z')
    `).run(expiredGuestKey, JSON.stringify([question.id]));
    database.prepare(`
      INSERT INTO exam_session_items (session_id, question_id, position)
      VALUES ('legacy-guest-exam', ?, 0)
    `).run(question.id);
    database.prepare(`
      INSERT INTO sw_learning_sessions (id, user_key, mode, status, question_ids,
        current_index, created_at)
      VALUES ('legacy-guest-sw', ?, 'practice', 'active', ?, 0, '2026-09-03T00:00:00Z')
    `).run(liveGuestKey, JSON.stringify([swQuestion.id]));

    const valid = buildDataIntegrityReport(database, { nowEpochSeconds });
    assert.deepEqual(valid.failures, []);
    assert.equal(valid.report.integrity.orphanedUserRows.examSessions, 0);
    assert.equal(valid.report.integrity.orphanedUserRows.swSessions, 0);
    assert.deepEqual(valid.report.integrity.legacyGuestSessions, {
      examSessions: { total: 1, expired: 1 },
      swSessions: { total: 1, expired: 0 },
    });

    // One-field mutation: a session created an hour after the check time
    // cannot yet be a historical guest session, even with a plausible key.
    database.prepare(`
      UPDATE sw_learning_sessions SET created_at = '2026-09-03T13:00:00Z'
      WHERE id = 'legacy-guest-sw'
    `).run();
    const futureCreation = buildDataIntegrityReport(database, { nowEpochSeconds });
    assert.equal(futureCreation.report.integrity.orphanedUserRows.swSessions, 1);
    assert.ok(futureCreation.failures.includes("orphaned user-owned rows exist"));
    database.prepare(`
      UPDATE sw_learning_sessions SET created_at = '2026-09-03T00:00:00Z'
      WHERE id = 'legacy-guest-sw'
    `).run();

    database.prepare(`
      UPDATE sw_learning_sessions SET created_at = '2026-09-04T00:00:00Z'
      WHERE id = 'legacy-guest-sw'
    `).run();
    const zeroLifetime = buildDataIntegrityReport(database, {
      nowEpochSeconds: Math.floor(Date.parse("2026-09-05T00:00:00Z") / 1000),
    });
    assert.equal(zeroLifetime.report.integrity.orphanedUserRows.swSessions, 1);
    database.prepare(`
      UPDATE sw_learning_sessions SET created_at = '2026-09-03T00:00:00Z'
      WHERE id = 'legacy-guest-sw'
    `).run();

    database.prepare("INSERT INTO user_bookmarks (user_key, question_id) VALUES (?, ?)")
      .run(liveGuestKey, question.id);
    const unrelatedTable = buildDataIntegrityReport(database, { nowEpochSeconds });
    assert.equal(unrelatedTable.report.integrity.orphanedUserRows.bookmarks, 1);
    assert.ok(unrelatedTable.failures.includes("orphaned user-owned rows exist"));
    database.prepare("DELETE FROM user_bookmarks WHERE user_key = ?").run(liveGuestKey);

    database.prepare("UPDATE exam_sessions SET user_key = 'missing-member' WHERE id = 'legacy-guest-exam'").run();
    database.prepare("UPDATE sw_learning_sessions SET user_key = ? WHERE id = 'legacy-guest-sw'")
      .run(`guest:1900000000:${"!".repeat(32)}`);
    const invalid = buildDataIntegrityReport(database, { nowEpochSeconds });
    assert.equal(invalid.report.integrity.orphanedUserRows.examSessions, 1);
    assert.equal(invalid.report.integrity.orphanedUserRows.swSessions, 1);
    assert.ok(invalid.failures.includes("orphaned user-owned rows exist"));

    database.prepare("UPDATE sw_learning_sessions SET user_key = ? WHERE id = 'legacy-guest-sw'")
      .run(`guest:1900000000:${"b".repeat(32)}`);
    const impossibleExpiry = buildDataIntegrityReport(database, { nowEpochSeconds });
    assert.equal(impossibleExpiry.report.integrity.orphanedUserRows.swSessions, 1);
  } finally {
    database.close();
  }
});

test("0332 preserves submitted exam history when a referenced question is retired", () => {
  const database = openCanonicalTestDatabase(root);
  try {
    const question = database.prepare(`
      SELECT id FROM questions
      WHERE active = 1 AND kind = 'single' AND exam_scope IN ('SQLP', 'both')
      LIMIT 1
    `).get();
    database.prepare("UPDATE questions SET active = 0 WHERE id = ?").run(question.id);
    database.prepare(`
      INSERT INTO exam_sessions (
        id, user_key, exam_type, status, question_ids, started_at, ends_at,
        submitted_at, policy_version, policy_snapshot
      ) VALUES ('submitted-history', 'owner', 'SQLP', 'submitted', ?,
        '2026-08-22', '2026-08-23', '2026-08-23', 'historical', '{}')
    `).run(JSON.stringify([question.id]));
    assert.throws(() => database.prepare(`
      INSERT INTO exam_sessions (
        id, user_key, exam_type, status, question_ids, started_at, ends_at,
        policy_version, policy_snapshot
      ) VALUES ('active-retired-question', 'owner', 'SQLP', 'active', ?,
        '2026-08-22', '2026-08-23', 'current', '{}')
    `).run(JSON.stringify([question.id])), /question_ids is inconsistent/u);
    const { report } = buildDataIntegrityReport(database);
    assert.equal(report.integrity.learnerState.invalidExamSessionQuestionSet, 0);
  } finally {
    database.close();
  }
});

test("0297 storage guards reject malformed SQL and SW learning state", () => {
  const database = openCanonicalTestDatabase(root);
  try {
    const question = database.prepare(`
      SELECT id FROM questions
      WHERE active = 1 AND kind = 'single' AND exam_scope IN ('SQLP', 'both')
      LIMIT 1
    `).get();
    const swQuestion = database.prepare(`
      SELECT id FROM sw_questions WHERE active = 1 AND kind = 'single' LIMIT 1
    `).get();

    assert.throws(() => database.prepare(`
      INSERT INTO attempts (
        question_id, selected_answers, correct, user_key, exam_type, result, score
      ) VALUES (?, 'not-json', 0, 'owner', 'SQLP', 'incorrect', 0)
    `).run(question.id), /must be valid JSON/u);
    assert.throws(() => database.prepare(`
      INSERT INTO attempts (
        question_id, selected_answers, correct, user_key, exam_type, result, score
      ) VALUES (?, '[999]', 0, 'owner', 'SQLP', 'incorrect', 0)
    `).run(question.id), /invalid choice/u);

    database.prepare(`
      INSERT INTO exam_sessions (
        id, user_key, exam_type, status, question_ids, started_at, ends_at
      ) VALUES ('stage3-session', 'owner', 'SQLP', 'active', ?, '2026-08-22', '2026-08-23')
    `).run(JSON.stringify([question.id]));
    assert.throws(() => database.prepare(`
      INSERT INTO exam_session_items (session_id, question_id, position)
      VALUES ('stage3-session', ?, 1)
    `).run(question.id), /position does not match/u);
    database.prepare(`
      INSERT INTO exam_session_items (session_id, question_id, position)
      VALUES ('stage3-session', ?, 0)
    `).run(question.id);
    assert.throws(() => database.prepare(`
      INSERT INTO exam_active_sessions (user_key, exam_type, session_id)
      VALUES ('different-user', 'SQLP', 'stage3-session')
    `).run(), /pointer is inconsistent/u);
    database.prepare(`
      INSERT INTO exam_active_sessions (user_key, exam_type, session_id)
      VALUES ('owner', 'SQLP', 'stage3-session')
    `).run();
    assert.throws(() => database.prepare(
      "UPDATE questions SET active = 0 WHERE id = ?",
    ).run(question.id), /locked by an active exam session/u);

    assert.throws(() => database.prepare(`
      INSERT INTO sw_attempts (
        user_key, question_id, selected_answers, correct, mode, client_operation_id
      ) VALUES ('owner', ?, '[999]', 0, 'practice', 'stage3-invalid-sw')
    `).run(swQuestion.id), /invalid choice/u);
    assert.throws(() => database.prepare(`
      INSERT INTO sw_learning_sessions (
        id, user_key, mode, status, question_ids, current_index
      ) VALUES ('stage3-invalid-sw-session', 'owner', 'practice', 'active', '["missing"]', 0)
    `).run(), /question_ids is inconsistent/u);
    database.prepare(`
      INSERT INTO sw_learning_sessions (
        id, user_key, mode, status, question_ids, current_index
      ) VALUES ('stage3-sw-session', 'owner', 'practice', 'active', ?, 0)
    `).run(JSON.stringify([swQuestion.id]));
    assert.throws(() => database.prepare(
      "UPDATE sw_questions SET active = 0 WHERE id = ?",
    ).run(swQuestion.id), /locked by an active learning session/u);
  } finally {
    database.close();
  }
});

test("storage guards remain certificate-neutral for a future course code", () => {
  const database = openCanonicalTestDatabase(root);
  try {
    database.prepare(`
      INSERT INTO questions (
        id, category, display_order, exam_scope, kind, prompt, choices,
        correct_answers, active
      ) VALUES (9000001, '데이터 품질 관리 이해', 9000001, 'DAP', 'single',
        '확장 계약 검증용 문제', '["A","B","C","D"]', '[0]', 1)
    `).run();
    database.prepare(`
      INSERT INTO exam_sessions (
        id, user_key, exam_type, status, question_ids, started_at, ends_at
      ) VALUES ('stage3-dap-session', 'owner', 'DAP', 'active', '[9000001]',
        '2026-08-22', '2026-08-23')
    `).run();
    database.prepare(`
      INSERT INTO exam_session_items (session_id, question_id, position)
      VALUES ('stage3-dap-session', 9000001, 0)
    `).run();
    database.prepare(`
      INSERT INTO exam_active_sessions (user_key, exam_type, session_id)
      VALUES ('owner', 'DAP', 'stage3-dap-session')
    `).run();
    assert.equal(database.prepare(`
      SELECT COUNT(*) AS count FROM exam_active_sessions WHERE exam_type = 'DAP'
    `).get().count, 1);
  } finally {
    database.close();
  }
});

test("the integrity gate detects corruption even when a storage guard is bypassed", () => {
  const database = openCanonicalTestDatabase(root);
  try {
    const questionId = database.prepare("SELECT id FROM questions LIMIT 1").get().id;
    database.exec("DROP TRIGGER attempts_integrity_before_insert");
    database.prepare(`
      INSERT INTO attempts (
        question_id, selected_answers, correct, user_key, exam_type, result, score
      ) VALUES (?, 'not-json', 0, 'owner', 'SQLP', 'incorrect', 0)
    `).run(questionId);
    const { failures, report } = buildDataIntegrityReport(database);
    assert.equal(report.integrity.learnerState.invalidAttemptState, 1);
    assert.ok(failures.includes("invalid learner state exists"));
  } finally {
    database.close();
  }
});
