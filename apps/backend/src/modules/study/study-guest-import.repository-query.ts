import type { GuestImportAttempt, GuestImportProgress } from "./study.repository";
import type { ExamType } from "./domain/study.domain";
import { guestAttemptOperationId } from "@shared/study/study-concurrency-contract.mjs";
import {
  GUEST_IMPORT_ATTEMPT_SQL,
  GUEST_IMPORT_MARKER_SQL,
  GUEST_IMPORT_RECEIPT_SQL,
} from "./study-concurrency-sql.mjs";

export async function readGuestImportReceipt(d1: D1Database, userKey: string, importId: string) {
  return d1.prepare(`
    SELECT receipt.payload_digest AS payloadDigest
    FROM guest_import_batches marker
    LEFT JOIN guest_import_receipts receipt
      ON receipt.user_key = marker.user_key AND receipt.import_id = marker.import_id
    WHERE marker.user_key = ? AND marker.import_id = ?
  `).bind(userKey, importId).first<{ payloadDigest: string | null }>();
}

export async function commitGuestImport(d1: D1Database, input: {
    userKey: string;
    importId: string;
    payloadDigest: string;
    selectedExam: ExamType;
    bookmarkIds: number[];
    attempts: GuestImportAttempt[];
    progress: GuestImportProgress[];
  }) {
    const candidateQuestionIds = JSON.stringify([...new Set([
      ...input.bookmarkIds,
      ...input.attempts.map((attempt) => attempt.questionId),
    ])]);
    const expectedRows = input.attempts.map((attempt, index) => ({
      operationId: guestAttemptOperationId(input.importId, index),
      questionId: attempt.questionId,
      selectedAnswers: JSON.stringify(attempt.selectedAnswers),
      correct: attempt.correct ? 1 : 0,
      mode: attempt.mode,
      examType: attempt.examType,
      result: attempt.result,
      score: attempt.score,
      answerText: attempt.answerText ?? "",
      reviewStatus: attempt.reviewStatus,
      isAdmin: attempt.isAdmin ? 1 : 0,
      createdAt: attempt.createdAt,
      compareCreatedAt: attempt.compareCreatedAt ? 1 : 0,
    }));
    const expectedAttempts = JSON.stringify(expectedRows);
    const expectedByOperation = new Map(expectedRows.map((row) => [row.operationId, row]));
    const operationPattern = `guest_${input.importId}_[0-9][0-9][0-9][0-9]`;
    const hasConflictingExistingAttempt = async () => {
      const existing = await d1.prepare(`
        SELECT client_operation_id AS operationId, question_id AS questionId,
          selected_answers AS selectedAnswers, correct, mode, exam_type AS examType,
          result, score, answer_text AS answerText, review_status AS reviewStatus,
          is_admin AS isAdmin, created_at AS createdAt
        FROM attempts WHERE user_key = ? AND client_operation_id GLOB ?
      `).bind(input.userKey, operationPattern).all<{
        operationId: string; questionId: number; selectedAnswers: string; correct: number;
        mode: string; examType: string; result: string; score: number; answerText: string;
        reviewStatus: string; isAdmin: number; createdAt: string;
      }>();
      return (existing.results ?? []).some((saved) => {
        const expected = expectedByOperation.get(saved.operationId);
        return !expected || saved.questionId !== expected.questionId
          || saved.selectedAnswers !== expected.selectedAnswers
          || saved.correct !== expected.correct || saved.mode !== expected.mode
          || saved.examType !== expected.examType || saved.result !== expected.result
          || saved.score !== expected.score || saved.answerText !== expected.answerText
          || saved.reviewStatus !== expected.reviewStatus || saved.isAdmin !== expected.isAdmin
          || (expected.compareCreatedAt === 1 && saved.createdAt !== expected.createdAt);
      });
    };
    if (await hasConflictingExistingAttempt()) {
      return { imported: false, duplicate: false, conflict: true, attempts: 0 };
    }
    const statements = input.bookmarkIds.map((questionId) => d1.prepare(`
      INSERT OR IGNORE INTO user_bookmarks (user_key, question_id, created_at)
      SELECT ?, ?, CURRENT_TIMESTAMP
      WHERE NOT EXISTS (
        SELECT 1 FROM exam_session_items item
        JOIN exam_sessions session ON session.id = item.session_id
        WHERE item.question_id IN (SELECT value FROM json_each(?))
          AND session.user_key = ? AND session.status != 'submitted'
      ) AND NOT EXISTS (
        SELECT 1 FROM guest_import_batches WHERE user_key = ? AND import_id = ?
      )
    `).bind(input.userKey, questionId, candidateQuestionIds, input.userKey, input.userKey, input.importId));
    for (const [index, attempt] of input.attempts.entries()) statements.push(d1.prepare(
      GUEST_IMPORT_ATTEMPT_SQL,
    ).bind(
      attempt.questionId,
      JSON.stringify(attempt.selectedAnswers),
      attempt.correct ? 1 : 0,
      attempt.mode,
      input.userKey,
      attempt.examType,
      attempt.result,
      attempt.score,
      attempt.answerText ?? "",
      attempt.reviewStatus,
      attempt.isAdmin ? 1 : 0,
      guestAttemptOperationId(input.importId, index),
      attempt.createdAt,
      candidateQuestionIds,
      input.userKey,
      input.userKey,
      input.importId,
    ));
    statements.push(d1.prepare(`
      INSERT INTO user_settings (user_key, selected_exam, created_at, updated_at)
      SELECT ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      WHERE NOT EXISTS (
        SELECT 1 FROM exam_session_items item
        JOIN exam_sessions session ON session.id = item.session_id
        WHERE item.question_id IN (SELECT value FROM json_each(?))
          AND session.user_key = ? AND session.status != 'submitted'
      ) AND NOT EXISTS (
        SELECT 1 FROM guest_import_batches WHERE user_key = ? AND import_id = ?
      )
      ON CONFLICT(user_key)
      DO UPDATE SET selected_exam = excluded.selected_exam, updated_at = CURRENT_TIMESTAMP
    `).bind(input.userKey, input.selectedExam, candidateQuestionIds, input.userKey,
      input.userKey, input.importId));
    const receiptBindings = [
      input.userKey,
      input.importId,
      input.payloadDigest,
      candidateQuestionIds,
      input.userKey,
      expectedAttempts,
      input.userKey,
      input.userKey,
      operationPattern,
      expectedAttempts,
    ] as const;
    statements.push(d1.prepare(GUEST_IMPORT_RECEIPT_SQL).bind(
      ...receiptBindings, input.userKey, input.importId,
    ));
    statements.push(d1.prepare(GUEST_IMPORT_MARKER_SQL).bind(
      input.userKey, input.importId,
      candidateQuestionIds, input.userKey, expectedAttempts, input.userKey,
      input.userKey, operationPattern, expectedAttempts,
      input.userKey, input.importId, input.payloadDigest,
    ));
    const results = await d1.batch(statements);
    const imported = Number(results.at(-1)?.meta?.changes ?? 0) > 0;
    const receipt = !imported ? await readGuestImportReceipt(d1, input.userKey, input.importId) : null;
    const duplicate = Boolean(receipt?.payloadDigest && receipt.payloadDigest === input.payloadDigest);
    return {
      imported,
      duplicate,
      conflict: !imported && (Boolean(receipt && !duplicate) || await hasConflictingExistingAttempt()),
      attempts: imported || duplicate ? input.attempts.length : 0,
    };
 }
