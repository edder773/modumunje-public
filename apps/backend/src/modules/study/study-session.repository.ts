import { learnerSessionSql } from "./study-content-visibility";
import { DatabaseRepository } from "@backend/infrastructure/database/database.repository";
import { isGuestLearningKey } from "@backend/common/auth/guest-learning-session";
import { sha256 } from "@backend/common/auth/admin-auth";
import { GUEST_SQL_MOCK_EVENTS_SQL } from "../events/guest-mock-submission-sql";
import {
  examActiveSessions,
  examSessionItems,
  examSessions,
} from "@backend/infrastructure/database/schema";
import { and, asc, eq, or, sql } from "drizzle-orm";
import type { AttemptInsert } from "./study.repository";
import type { ExamType } from "./domain/study.domain";
import {
  examAttemptOperationId,
} from "@shared/study/study-concurrency-contract.mjs";
import {
  EXAM_SUBMISSION_ATTEMPT_SQL,
  EXAM_SUBMISSION_LEASE_DELETE_SQL,
  EXAM_SUBMISSION_UPDATE_SQL,
  EXAM_SUPERSEDE_UNLEASED_SQL,
} from "./study-concurrency-sql.mjs";

export type ExamStateRevisionInput = {
  userKey: string;
  sessionId: string;
  expectedRevision: number;
  values: {
    answers: string;
    descriptiveAnswers: string;
    descriptiveScores: string;
    descriptiveSnapshots: string;
    flagged: string;
    currentIndex: number;
    revision: number;
    updatedAt: string;
  };
  items: Array<{
    questionId: number;
    position: number;
    selectedAnswers: number[];
    descriptiveAnswer: string;
    descriptiveScore: number | null;
    descriptiveSnapshot: string;
    flagged: boolean;
  }>;
};

export type ExamSubmissionInput = {
  recordGuestAnalytics?: boolean;
  attempts: AttemptInsert[];
  sessionId: string;
  userKey: string;
  answers: string;
  descriptiveAnswers: string;
  descriptiveScores: string;
  descriptiveSnapshots: string;
  flagged: string;
  currentIndex: number;
  submittedAt: string;
  result: string;
};

export class StudySessionRepository extends DatabaseRepository {
  async findItems(sessionId: string) {
    return this.orm().select().from(examSessionItems)
      .where(eq(examSessionItems.sessionId, sessionId))
      .orderBy(asc(examSessionItems.position));
  }

  async releaseHiddenLease(userKey: string, selectedExam: ExamType) {
    // Release only the current-session pointer. Preserve the hidden session and every answer.
    await this.connection().prepare(`
      DELETE FROM exam_active_sessions
      WHERE user_key = ? AND exam_type = ? AND session_id IN (
        SELECT id FROM exam_sessions WHERE user_key = ? AND exam_type = ?
          AND NOT (${learnerSessionSql()})
      )
    `).bind(userKey, selectedExam, userKey, selectedExam).run();
  }

  async findActive(userKey: string, selectedExam: ExamType) {
    const [active] = await this.orm().select({ session: examSessions })
      .from(examActiveSessions)
      .innerJoin(examSessions, eq(examSessions.id, examActiveSessions.sessionId))
      .where(and(
        eq(examActiveSessions.userKey, userKey),
        eq(examActiveSessions.examType, selectedExam),
        eq(examSessions.status, "active"),
      )).limit(1);
    return active?.session;
  }

  async saveRevision(input: ExamStateRevisionInput) {
    const database = this.connection();
    const values = input.values;
    const statements = [database.prepare(`
      UPDATE exam_sessions
      SET answers = ?, descriptive_answers = ?, descriptive_scores = ?,
        descriptive_snapshots = ?, flagged = ?, current_index = ?, revision = ?, updated_at = ?
      WHERE id = ? AND user_key = ? AND status = 'active' AND revision = ?
    `).bind(
      values.answers,
      values.descriptiveAnswers,
      values.descriptiveScores,
      values.descriptiveSnapshots,
      values.flagged,
      values.currentIndex,
      values.revision,
      values.updatedAt,
      input.sessionId,
      input.userKey,
      input.expectedRevision,
    )];
    for (const item of input.items) {
      statements.push(database.prepare(`
        UPDATE exam_session_items
        SET position = ?, selected_answers = ?, descriptive_answer = ?,
          descriptive_score = ?, descriptive_snapshot = ?, flagged = ?, revision = ?, updated_at = ?
        WHERE session_id = ? AND question_id = ? AND revision < ?
          AND EXISTS (
            SELECT 1
            FROM exam_sessions
            WHERE id = ? AND user_key = ? AND status = 'active'
              AND revision = ? AND updated_at = ?
              AND answers = ? AND descriptive_answers = ? AND descriptive_scores = ?
              AND descriptive_snapshots = ? AND flagged = ? AND current_index = ?
          )
      `).bind(
        item.position,
        JSON.stringify(item.selectedAnswers),
        item.descriptiveAnswer,
        item.descriptiveScore,
        item.descriptiveSnapshot,
        item.flagged ? 1 : 0,
        values.revision,
        values.updatedAt,
        input.sessionId,
        item.questionId,
        values.revision,
        input.sessionId,
        input.userKey,
        values.revision,
        values.updatedAt,
        values.answers,
        values.descriptiveAnswers,
        values.descriptiveScores,
        values.descriptiveSnapshots,
        values.flagged,
        values.currentIndex,
      ));
    }
    const [revisionResult] = await database.batch(statements);
    return Number(revisionResult?.meta?.changes ?? 0) > 0;
  }

  async claimForGrading(
    userKey: string,
    sessionId: string,
    updatedAt: string,
    staleBefore: string,
  ) {
    const [stored] = await this.orm().update(examSessions)
      .set({ status: "grading", updatedAt })
      .where(and(
        eq(examSessions.id, sessionId),
        eq(examSessions.userKey, userKey),
        or(
          eq(examSessions.status, "active"),
          and(
            eq(examSessions.status, "grading"),
            sql`datetime(${examSessions.updatedAt}) <= datetime(${staleBefore})`,
          ),
        ),
      )).returning();
    return stored;
  }

  async restoreActive(sessionId: string, updatedAt: string) {
    await this.orm().update(examSessions).set({ status: "active", updatedAt })
      .where(and(eq(examSessions.id, sessionId), eq(examSessions.status, "grading")));
  }

  async completeSubmission(input: ExamSubmissionInput) {
    const database = this.connection();
    const statements = [database.prepare(EXAM_SUBMISSION_UPDATE_SQL).bind(
      input.answers,
      input.descriptiveAnswers,
      input.descriptiveScores,
      input.descriptiveSnapshots,
      input.flagged,
      input.currentIndex,
      input.submittedAt,
      input.result,
      input.submittedAt,
      input.sessionId,
      input.userKey,
    )];
    statements.push(...input.attempts.map((attempt) => database.prepare(
      EXAM_SUBMISSION_ATTEMPT_SQL,
    ).bind(
      attempt.questionId,
      attempt.selectedAnswers,
      attempt.correct ? 1 : 0,
      attempt.mode,
      attempt.userKey,
      attempt.examType,
      attempt.result,
      attempt.score,
      attempt.answerText ?? "",
      attempt.evaluationId ?? null,
      attempt.reviewStatus,
      attempt.isAdmin ? 1 : 0,
      examAttemptOperationId(input.sessionId, Number(attempt.questionId)),
      input.sessionId,
      input.userKey,
      input.submittedAt,
    )));
    statements.push(database.prepare(EXAM_SUBMISSION_LEASE_DELETE_SQL).bind(
      input.userKey,
      input.sessionId,
      input.sessionId,
      input.userKey,
      input.submittedAt,
    ));
    if (isGuestLearningKey(input.userKey) && input.recordGuestAnalytics !== false) {
      statements.push(database.prepare(GUEST_SQL_MOCK_EVENTS_SQL).bind(
        await sha256(`guest-submissions:${input.userKey}`),
        input.sessionId, input.userKey, input.submittedAt,
      ));
    }
    const [submission] = await database.batch(statements);
    if (Number(submission?.meta?.changes ?? 0) < 1) {
      throw new Error("exam submission state could not be committed");
    }
  }

  async insertWithLease(
    values: typeof examSessions.$inferInsert,
    questionIds: number[],
  ) {
    const database = this.connection();
    const createdAt = String(values.updatedAt ?? values.startedAt);
    const statements = [database.prepare(`
      INSERT INTO exam_sessions (
        id, user_key, exam_type, status, question_ids, answers,
        descriptive_answers, descriptive_scores, descriptive_snapshots,
        flagged, current_index, started_at, ends_at, result, policy_version,
        policy_snapshot, revision, is_admin, created_at, updated_at
      ) VALUES (?, ?, ?, 'active', ?, '{}', '{}', '{}', '{}', '[]', 0, ?, ?, '{}', ?, ?, 0, ?, ?, ?)
    `).bind(
      values.id,
      values.userKey,
      values.examType,
      JSON.stringify(questionIds),
      values.startedAt,
      values.endsAt,
      values.policyVersion,
      values.policySnapshot,
      values.isAdmin ? 1 : 0,
      createdAt,
      createdAt,
    )];
    for (const [position, questionId] of questionIds.entries()) {
      statements.push(database.prepare(`
        INSERT INTO exam_session_items (
          session_id, question_id, position, selected_answers,
          descriptive_answer, descriptive_snapshot, flagged, revision, updated_at
        ) VALUES (?, ?, ?, '[]', '', '', 0, 0, ?)
      `).bind(values.id, questionId, position, createdAt));
    }
    statements.push(database.prepare(`
      INSERT INTO exam_active_sessions (user_key, exam_type, session_id, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_key, exam_type) DO NOTHING
    `).bind(values.userKey, values.examType, values.id, createdAt));
    statements.push(database.prepare(EXAM_SUPERSEDE_UNLEASED_SQL).bind(
      createdAt,
      JSON.stringify({ superseded: true }),
      createdAt,
      values.id,
      values.userKey,
      values.id,
    ));
    await database.batch(statements);

    const active = await this.findActive(String(values.userKey), values.examType as ExamType);
    if (!active) throw new Error("active exam session could not be created");
    return { session: active, created: active.id === values.id };
  }
}
