import { learnerQuestionSql, learnerSessionSql } from "./study-content-visibility";
import { readLearnerRequestContext } from "@backend/common/auth/learner-request-context";
import { DatabaseRepository } from "@backend/infrastructure/database/database.repository";
import { encodeD1IntegerList } from "@backend/common/database/d1-query-bindings.mjs";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  aiEvaluations,
  attempts,
  examSessionItems,
  examSessions,
  questions,
  theories,
  userBookmarks,
  userSettings,
} from "@backend/infrastructure/database/schema";
import {
  answeredAttemptSql,
  readRecordBatch,
  type RecordReadOptions,
} from "./study-records.repository-queries";
import {
  StudySessionRepository,
  type ExamStateRevisionInput,
  type ExamSubmissionInput,
} from "./study-session.repository";
import { buildStudyPracticeQuery } from "./study-practice-query.mjs";
import { commitGuestImport, readGuestImportReceipt } from "./study-guest-import.repository-query";
import {
  sameSqlAttemptMutation,
} from "@shared/study/study-concurrency-contract.mjs";
import {
  readTheoryDetailRow,
  readTheoryDetailContext,
  readTheoryListContext,
  readTheoryListRows,
  readTheoryListAndDetailRows,
  readTheoryListAndDetailWithRevision,
} from "./study-theory.repository-queries";
import {
  DEFAULT_EXAM_TYPE,
  type ExamType,
} from "./domain/study.domain";
import { courseQuestionEligibility } from "./study-course-policy-query";
import { readPracticeBlockedQuestionIds } from "./study-feedback.repository-queries";
import { readExamCandidateMetadata } from "./study-exam-candidate.repository-query";
import {
  readPracticeAttemptContext,
  readPracticeMutationContext,
} from "./study-attempt.repository-query";
import {
  fallbackUserSetting,
  readActiveQuestionsByIds,
  readFeedbackQuestionsByIds,
  readPracticeMetaRows,
  readPracticeMetaWithSetting,
  readPracticeQuestionsWithSetting,
  type ActiveQuestionReadOptions,
  type StudyPracticeQueryInput,
} from "./study-question.repository-queries";

type QueryResult = { results?: unknown[] };

function rowsFrom<T>(result: QueryResult | undefined) {
  return (result?.results ?? []) as T[];
}

export type ExamCandidateMetadataRow = {
  id: number;
  category: string;
  examScope: string;
  kind: string;
  practiceScope: string;
  variantGroupId: string | null;
  choices: string;
};

export type GuestImportAttempt = {
  questionId: number;
  selectedAnswers: number[];
  correct: boolean;
  mode: string;
  examType: ExamType;
  result: "correct" | "partial" | "incorrect";
  score: number;
  answerText?: string;
  reviewStatus: "mastered" | "pending";
  isAdmin: boolean;
  createdAt: string;
  compareCreatedAt?: boolean;
};

export type GuestImportProgress = {
  theoryId: number;
  examType: ExamType;
  completed: boolean;
  updatedAt: string;
};

export class StudyRepository extends DatabaseRepository {
  private readonly sessionRepository = new StudySessionRepository();

  async readStudyRequestContext(userKey: string | null, options: { includeRevision: boolean; includeSetting: boolean }) {
    const context=await readLearnerRequestContext(this.connection(),userKey,options);
    return {
      siteRows: context.siteRows,
      accountRow: context.accountRow,
      setting: userKey && options.includeSetting
        ? (context.settingRow as typeof userSettings.$inferSelect | null) ?? fallbackUserSetting(userKey)
        : null,
      revision: context.revision,
    };
  }

  async ensureUserSetting(userKey: string) {
    const database = this.connection();
    const [, settingResult] = await database.batch([
      database.prepare(`
        INSERT INTO user_settings (user_key, selected_exam, created_at, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(user_key) DO NOTHING
      `).bind(userKey, DEFAULT_EXAM_TYPE),
      database.prepare(`
        SELECT
          user_key AS userKey,
          selected_exam AS selectedExam,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM user_settings
        WHERE user_key = ?
        LIMIT 1
      `).bind(userKey),
    ]);
    const [setting] = rowsFrom<typeof userSettings.$inferSelect>(settingResult);
    if (!setting) throw new Error("사용자 학습 설정을 준비하지 못했습니다.");
    return setting;
  }

  async readUserSetting(userKey: string) {
    const [setting] = await this.orm().select().from(userSettings)
      .where(eq(userSettings.userKey, userKey)).limit(1);
    return setting ?? fallbackUserSetting(userKey);
  }

  async readCourseContentOverview() {
    const result = await this.connection().prepare(`
      SELECT 'question' AS content_type, exam_scope, kind, category,
        COUNT(*) AS item_count,
        SUM(CASE WHEN length(trim(explanation)) > 0 THEN 1 ELSE 0 END) AS explained_count
      FROM questions WHERE active = 1 AND ${learnerQuestionSql()}
      GROUP BY exam_scope, kind, category
      UNION ALL
      SELECT 'theory' AS content_type, exam_scope, '' AS kind, category,
        COUNT(*) AS item_count, 0 AS explained_count
      FROM theories WHERE active = 1
      GROUP BY exam_scope, category
    `).all<{
      content_type: "question" | "theory";
      exam_scope: string;
      kind: string;
      category: string;
      item_count: number;
      explained_count: number;
    }>();
    return result.results ?? [];
  }

  async readCourseUserOverview(userKey: string) {
    const d1 = this.connection();
    const [
      attemptRows,
      bookmarkRows,
      activeSessionRows,
      recentRows,
      attemptDayRows,
      settingRows,
    ] = await d1.batch([
      d1.prepare(`
        SELECT a.exam_type, COUNT(*) AS attempt_count
        FROM attempts AS a
        JOIN questions AS q ON q.id = a.question_id
        WHERE a.user_key = ?
          AND ${answeredAttemptSql("a")}
          AND q.active = 1 AND ${learnerQuestionSql("q")}
          AND (q.kind IN ('single', 'multiple') OR (q.exam_scope = 'IPEP' AND q.kind = 'descriptive' AND a.mode IN ('practice', 'bookmark-practice', 'bookmark-modal', 'incorrect-review', 'mock-exam')))
        GROUP BY a.exam_type
      `).bind(userKey),
      d1.prepare(`
        SELECT q.exam_scope, q.kind, q.category, COUNT(*) AS item_count
        FROM user_bookmarks AS b
        JOIN questions AS q ON q.id = b.question_id
        WHERE b.user_key = ? AND q.active = 1 AND ${learnerQuestionSql("q")}
        GROUP BY q.exam_scope, q.kind, q.category
      `).bind(userKey),
      d1.prepare(`
        SELECT exam_type, COUNT(*) AS active_count, MAX(updated_at) AS active_updated_at
        FROM exam_sessions
        WHERE user_key = ? AND status = 'active' AND ${learnerSessionSql()}
        GROUP BY exam_type
      `).bind(userKey),
      d1.prepare(`
        WITH course_types AS (
          SELECT DISTINCT exam_type FROM course_content_scopes
        ), latest AS (
          SELECT course_types.exam_type, (
            SELECT a.id
            FROM attempts AS a
            JOIN questions AS q ON q.id = a.question_id
            WHERE a.user_key = ? AND a.exam_type = course_types.exam_type
              AND ${answeredAttemptSql("a")}
              AND q.active = 1 AND ${learnerQuestionSql("q")} AND (q.kind IN ('single', 'multiple') OR (q.exam_scope = 'IPEP' AND q.kind = 'descriptive' AND a.mode IN ('practice', 'bookmark-practice', 'bookmark-modal', 'incorrect-review', 'mock-exam')))
            ORDER BY a.created_at DESC, a.id DESC
            LIMIT 1
          ) AS attempt_id
          FROM course_types
        )
        SELECT latest.exam_type, q.category, q.topic, a.created_at
        FROM latest
        JOIN attempts AS a ON a.id = latest.attempt_id
        JOIN questions AS q ON q.id = a.question_id
      `).bind(userKey),
      d1.prepare(`
        SELECT a.exam_type, date(a.created_at, '+9 hours') AS learning_day
        FROM attempts AS a
        JOIN questions AS q ON q.id = a.question_id
        WHERE a.user_key = ? AND ${answeredAttemptSql("a")} AND q.active = 1 AND ${learnerQuestionSql("q")} AND (q.kind IN ('single', 'multiple') OR (q.exam_scope = 'IPEP' AND q.kind = 'descriptive' AND a.mode IN ('practice', 'bookmark-practice', 'bookmark-modal', 'incorrect-review', 'mock-exam')))
          AND a.created_at >= datetime('now', '-400 days')
        GROUP BY a.exam_type, learning_day
      `).bind(userKey),
      d1.prepare(`
        SELECT user_key AS userKey, selected_exam AS selectedExam,
          created_at AS createdAt, updated_at AS updatedAt
        FROM user_settings
        WHERE user_key = ?
        LIMIT 1
      `).bind(userKey),
    ]);
    const [setting] = rowsFrom<{
      userKey: string;
      selectedExam: string;
      createdAt: string;
      updatedAt: string;
    }>(settingRows);
    return {
      attemptRows: rowsFrom<{ exam_type: string; attempt_count: number }>(attemptRows),
      progressRows: rowsFrom<{ exam_type: string; completed_count: number }>(undefined),
      bookmarkRows: rowsFrom<{
        exam_scope: string;
        kind: string;
        category: string;
        item_count: number;
      }>(bookmarkRows),
      activeSessionRows: rowsFrom<{
        exam_type: string;
        active_count: number;
        active_updated_at: string;
      }>(activeSessionRows),
      recentRows: rowsFrom<{
        exam_type: string;
        category: string;
        topic: string;
        created_at: string;
      }>(recentRows),
      recentTheoryRows: rowsFrom<{
        exam_type: string;
        theory_id: number;
        updated_at: string;
        category: string;
        topic: string;
        title: string;
      }>(undefined),
      attemptDayRows: rowsFrom<{ exam_type: string; learning_day: string }>(attemptDayRows),
      setting: setting ?? {
        userKey,
        selectedExam: DEFAULT_EXAM_TYPE,
        createdAt: "",
        updatedAt: "",
      },
    };
  }

  async readCourseOverview(userKey: string | undefined) {
    const [contentRows, userRows] = await Promise.all([
      this.readCourseContentOverview(),
      userKey ? this.readCourseUserOverview(userKey) : Promise.resolve(null),
    ]);
    return userRows ? { contentRows, ...userRows } : { contentRows };
  }

  async findPublicSiteSettings() {
    const rows = await this.connection().prepare(`
      SELECT key, value FROM site_settings
      WHERE key IN ('site_notice', 'maintenance_mode', 'default_exam_mode')
    `).all<{ key: string; value: string }>();
    return rows.results ?? [];
  }

  async findTheoryList(userKey: string | undefined, selectedExam: ExamType) {
    return readTheoryListContext(this.connection(), userKey, selectedExam);
  }

  async findTheoryRows(selectedExam: ExamType) {
    return readTheoryListRows(this.connection(), selectedExam);
  }

  async findTheoryRowsAndDetail(selectedExam: ExamType, theoryId?: number) {
    return readTheoryListAndDetailRows(this.connection(), selectedExam, theoryId);
  }

  async findPublicTheorySnapshot(selectedExam: ExamType, theoryId: number | undefined,
    cachedRevision: [string, string, string] | null) {
    return readTheoryListAndDetailWithRevision(this.connection(), selectedExam, theoryId, cachedRevision);
  }


  async findTheoryDetailContext(
    theoryId: number,
    userKey: string | undefined,
    selectedExam: ExamType,
  ) {
    return readTheoryDetailContext(this.connection(), theoryId, userKey, selectedExam);
  }

  async findTheoryDetailRow(theoryId: number, selectedExam: ExamType) {
    return readTheoryDetailRow(this.connection(), theoryId, selectedExam);
  }


  async findActiveTheory(theoryId: number) {
    const [row] = await this.orm().select().from(theories).where(and(
      eq(theories.id, theoryId),
      eq(theories.active, true),
    )).limit(1);
    return row;
  }

  async countLinkedQuestions(theoryId: number) {
    const row = await this.connection().prepare(`
      SELECT COUNT(*) AS linked_count FROM questions
      WHERE active = 1 AND ${learnerQuestionSql()} AND theory_id = ?
    `).bind(theoryId).first<{ linked_count: number }>();
    return Number(row?.linked_count ?? 0);
  }

  async findPracticeMeta(selectedExam: ExamType) {
    return readPracticeMetaRows(this.connection(), selectedExam);
  }

  async findPracticeMetaWithSetting(selectedExam: ExamType, userKey: string) {
    return readPracticeMetaWithSetting(this.connection(), selectedExam, userKey);
  }

  async readRecords(userKey: string, selectedExam: ExamType, options: RecordReadOptions) {
    return readRecordBatch(this.connection(), userKey, selectedExam, options);
  }

  async readExamSessions(userKey: string, selectedExam: ExamType) {
    const database = this.orm();
    const [sessionRows, settingRows] = await database.batch([
      database.select().from(examSessions).where(and(
        eq(examSessions.userKey, userKey), eq(examSessions.examType, selectedExam),
        sql.raw(learnerSessionSql()),
      )).orderBy(desc(examSessions.updatedAt), desc(examSessions.id)).limit(21),
      database.select().from(userSettings)
        .where(eq(userSettings.userKey, userKey)).limit(1),
    ]);
    return {
      sessionRows,
      setting: settingRows[0] ?? fallbackUserSetting(userKey),
    };
  }

  async guestImportReceipt(userKey: string, importId: string) {
    return readGuestImportReceipt(this.connection(), userKey, importId);
  }

  async guestImportExists(userKey: string, importId: string) {
    return Boolean(await this.guestImportReceipt(userKey, importId));
  }

  async commitGuestImport(input: {
    userKey: string;
    importId: string;
    payloadDigest: string;
    selectedExam: ExamType;
    bookmarkIds: number[];
    attempts: GuestImportAttempt[];
    progress: GuestImportProgress[];
  }) {
    return commitGuestImport(this.connection(), input);
  }

  async setBookmark(userKey: string, questionId: number, bookmarked: boolean) {
    const [question] = await this.orm().select({ id: questions.id }).from(questions)
      .where(and(eq(questions.id, questionId), sql.raw(learnerQuestionSql()))).limit(1);
    if (!question) return false;
    if (bookmarked) {
      await this.orm().insert(userBookmarks).values({ userKey, questionId }).onConflictDoNothing();
    } else {
      await this.orm().delete(userBookmarks).where(and(
        eq(userBookmarks.userKey, userKey), eq(userBookmarks.questionId, questionId),
      ));
    }
    return true;
  }

  async updateUserSetting(userKey: string, selectedExam: ExamType, updatedAt: string) {
    await this.orm().insert(userSettings).values({ userKey, selectedExam, updatedAt })
      .onConflictDoUpdate({ target: userSettings.userKey, set: { selectedExam, updatedAt } });
  }

  async findSessionForUser(userKey: string, sessionId: string) {
    const [session] = await this.orm().select().from(examSessions).where(and(
      eq(examSessions.id, sessionId), eq(examSessions.userKey, userKey),
      sql.raw(learnerSessionSql()),
    )).limit(1);
    return session;
  }

  async findPracticeAttemptContext(userKey: string, questionId: number) {
    return readPracticeAttemptContext(this.connection(), userKey, questionId);
  }

  async findPracticeMutationContext(email: string, userKey: string, questionId: number, adminBypassMaintenance: boolean) {
    return readPracticeMutationContext(this.connection(), { email, userKey, questionId, adminBypassMaintenance });
  }

  async findSessionItems(sessionId: string) {
    return this.sessionRepository.findItems(sessionId);
  }

  async releaseHiddenExamLease(userKey: string, selectedExam: ExamType) {
    return this.sessionRepository.releaseHiddenLease(userKey, selectedExam);
  }

  async findActiveExamSession(userKey: string, selectedExam: ExamType) {
    return this.sessionRepository.findActive(userKey, selectedExam);
  }

  async saveExamStateRevision(input: ExamStateRevisionInput) {
    return this.sessionRepository.saveRevision(input);
  }

  async claimExamForGrading(
    userKey: string,
    sessionId: string,
    updatedAt: string,
    staleBefore: string,
  ) {
    return this.sessionRepository.claimForGrading(userKey, sessionId, updatedAt, staleBefore);
  }

  async restoreExamActive(sessionId: string, updatedAt: string) {
    return this.sessionRepository.restoreActive(sessionId, updatedAt);
  }

  async completeExamSubmission(input: ExamSubmissionInput) {
    return this.sessionRepository.completeSubmission(input);
  }

  async findActiveQuestionsByIds(
    ids: readonly number[],
    userKey?: string,
    options: ActiveQuestionReadOptions = {},
  ) {
    return readActiveQuestionsByIds(this.connection(), ids, userKey, options);
  }

  async findFeedbackQuestionsByIds(ids: readonly number[]) {
    return readFeedbackQuestionsByIds(this.connection(), ids);
  }

  async findPracticeBlockedQuestionIds(userKey: string, questionIds: readonly number[]) {
    return questionIds.length
      ? readPracticeBlockedQuestionIds(this.connection(), userKey, questionIds)
      : [];
  }

  async findPracticeQuestions(input: StudyPracticeQueryInput) {
    const query = buildStudyPracticeQuery({
      ...input,
      eligibility: courseQuestionEligibility(input.selectedExam, "q"),
    });
    const result = await this.connection().prepare(query.sql)
      .bind(...query.values).all<PracticeQuestionRow>();
    return result.results ?? [];
  }

  async findPracticeQuestionsWithSetting(input: StudyPracticeQueryInput, userKey: string) {
    return readPracticeQuestionsWithSetting(this.connection(), input, userKey);
  }

  async findValidationQuestions(ids: readonly number[]) {
    if (ids.length === 0) return [];
    const rows = await this.connection().prepare(`
      SELECT id, kind, choices, correct_answers
      FROM questions
      WHERE active = 1 AND ${learnerQuestionSql()}
        AND id IN (
          SELECT CAST(value AS INTEGER)
          FROM json_each(?)
          WHERE type = 'integer'
        )
    `).bind(encodeD1IntegerList(ids))
      .all<{ id: number; kind: string; choices: string; correct_answers: string }>();
    return rows.results ?? [];
  }

  async findActiveTheoryIds(ids: readonly number[]) {
    if (ids.length === 0) return [];
    const rows = await this.connection().prepare(`
      SELECT id FROM theories
      WHERE active = 1
        AND id IN (
          SELECT CAST(value AS INTEGER)
          FROM json_each(?)
          WHERE type = 'integer'
        )
    `).bind(encodeD1IntegerList(ids)).all<{ id: number }>();
    return (rows.results ?? []).map((row) => Number(row.id));
  }

  async findExamCandidateMetadata(selectedExam: ExamType) {
    return readExamCandidateMetadata(this.connection(), selectedExam);
  }

  async insertExamSessionWithLease(
    values: typeof examSessions.$inferInsert,
    questionIds: number[],
  ) {
    return this.sessionRepository.insertWithLease(values, questionIds);
  }

  async insertAttemptIdempotent(values: typeof attempts.$inferInsert) {
    const [created] = await this.orm().insert(attempts).values(values)
      .onConflictDoNothing()
      .returning();
    if (created) return { attempt: created, created: true, conflict: false };
    const [existing] = await this.orm().select().from(attempts).where(and(
      eq(attempts.userKey, String(values.userKey)),
      eq(attempts.clientOperationId, String(values.clientOperationId)),
    )).limit(1);
    if (!existing) throw new Error("idempotent attempt could not be read");
    return {
      attempt: existing,
      created: false,
      conflict: !sameSqlAttemptMutation(existing, values),
    };
  }

  async findOwnedEvaluation(userKey: string, evaluationId: number, questionId: number) {
    const [evaluation] = await this.orm().select({ id: aiEvaluations.id })
      .from(aiEvaluations).where(and(
        eq(aiEvaluations.id, evaluationId),
        eq(aiEvaluations.userKey, userKey),
        eq(aiEvaluations.questionId, questionId),
      )).limit(1);
    return evaluation;
  }
}

export type QuestionRow = typeof questions.$inferSelect;
export type QuestionDeliveryRow = Omit<QuestionRow,
  | "correctAnswers"
  | "explanation"
  | "scoringCriteria"
  | "requiredConcepts"
  | "acceptableAlternatives"
  | "deductionConditions"
  | "errorConditions"
>;
export type PracticeQuestionRow = QuestionDeliveryRow & { selectedBookmarked: number };
export type SessionRow = typeof examSessions.$inferSelect;
export type ExamItemRow = typeof examSessionItems.$inferSelect;
export type AttemptInsert = typeof attempts.$inferInsert;
export type TheoryRow = typeof theories.$inferSelect;
export type EvaluationRow = typeof aiEvaluations.$inferSelect;
