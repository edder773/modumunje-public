import { DatabaseRepository } from "@backend/infrastructure/database/database.repository";
import { isGuestLearningKey } from "@backend/common/auth/guest-learning-session";
import { sha256 } from "@backend/common/auth/admin-auth";
import { GUEST_SW_MOCK_EVENTS_SQL } from "../events/guest-mock-submission-sql";
import { encodeD1TextList } from "@backend/common/database/d1-query-bindings.mjs";
import { buildSwPracticeQuery } from "./sw-practice-query.mjs";
import {
  CONTENT_REVISION_CHANGED_SQL, contentCacheRevisionFromRow,
  contentCacheRevisionReadStatement, contentRevisionChangedBindings,
  type RevisionRow,
} from "@backend/common/content/content-cache-revision";
import {
  SW_SESSION_INSERT_SQL,
  SW_SESSION_UPDATE_SQL,
} from "./sw-study-concurrency-sql.mjs";
import {
  sameSwActiveSessionMutation,
  sameSwAttemptMutation,
  sameSwSubmittedSessionMutation,
} from "@shared/study/study-concurrency-contract.mjs";

export type SwTheoryRow = {
  updated_at?: string;
  id: number;
  subject_group_id: string;
  subject_id: string;
  category: string;
  topic: string;
  title: string;
  summary: string;
  content?: string;
  review_answers?: string;
  keywords: string;
  sort_order: number;
};

export type SwQuestionRow = {
  id: string;
  theory_id: number;
  subject_group_id: string;
  subject_id: string;
  category: string;
  topic: string;
  display_order: number;
  difficulty: string;
  difficulty_rationale: string;
  kind: string;
  prompt: string;
  choices: string;
  correct_answers: string;
  explanation: string;
  tags: string;
};

export type SwQuestionDeliveryRow = Omit<SwQuestionRow, "correct_answers" | "explanation">;

export class SwStudyRepository extends DatabaseRepository {
  async subjectCount() {
    const summary = await this.connection().prepare(`
      SELECT COUNT(DISTINCT subject_id) AS subject_count
      FROM sw_theories WHERE active = 1
    `).first<{ subject_count: number }>();
    return Number(summary?.subject_count ?? 0);
  }

  async findTheories(subjects: string[]) {
    const placeholders = subjects.map(() => "?").join(",");
    const result = await this.connection().prepare(`
      SELECT t.id, t.subject_group_id, t.subject_id, t.category, t.topic,
        t.title, t.summary, t.keywords, t.sort_order, t.updated_at
      FROM sw_theories AS t INDEXED BY sw_theories_active_subject_order_v2_idx
      WHERE t.active = 1 AND t.subject_id IN (${placeholders})
      ORDER BY t.sort_order, t.id
    `).bind(...subjects).all<SwTheoryRow>();
    return result.results ?? [];
  }

  async findTheory(id: number) {
    return this.connection().prepare(`
      SELECT t.id, t.subject_group_id, t.subject_id, t.category, t.topic,
        t.title, t.summary, t.content, t.review_answers, t.keywords, t.sort_order
      FROM sw_theories t
      WHERE t.active = 1 AND t.id = ?
    `).bind(id).first<SwTheoryRow>();
  }

  async findTheoriesAndDetail(subjects: string[], id?: number) {
    return this.findTheoriesAndDetailSnapshot(subjects, id);
  }

  async findPublicTheorySnapshot(subjects: string[], id: number | undefined,
    cachedRevision: [string, string, string] | null) {
    const result = await this.findTheoriesAndDetailSnapshot(subjects, id, cachedRevision);
    return { ...result, revision: result.revision! };
  }

  private async findTheoriesAndDetailSnapshot(subjects: string[], id?: number,
    cachedRevision?: [string, string, string] | null) {
    const placeholders = subjects.map(() => "?").join(",");
    const gated = cachedRevision !== undefined;
    const database = this.connection();
    const statements = gated ? [contentCacheRevisionReadStatement(database)] : [];
    statements.push(database.prepare(`
      ${gated ? `WITH cache_gate AS MATERIALIZED (SELECT 1 WHERE ${CONTENT_REVISION_CHANGED_SQL})` : ""}
      SELECT t.id, t.subject_group_id, t.subject_id, t.category, t.topic,
        t.title, t.summary, t.keywords, t.sort_order, t.updated_at
      FROM ${gated ? "cache_gate CROSS JOIN " : ""}sw_theories AS t INDEXED BY sw_theories_active_subject_order_v2_idx
      WHERE t.active = 1 AND t.subject_id IN (${placeholders})
      ORDER BY t.sort_order, t.id
    `).bind(...(gated ? contentRevisionChangedBindings(cachedRevision!) : []), ...subjects));
    if (id) statements.push(database.prepare(`
      ${gated ? `WITH cache_gate AS MATERIALIZED (SELECT 1 WHERE ${CONTENT_REVISION_CHANGED_SQL})` : ""}
      SELECT t.id, t.subject_group_id, t.subject_id, t.category, t.topic,
        t.title, t.summary, t.content, t.review_answers, t.keywords, t.sort_order
      FROM ${gated ? "cache_gate CROSS JOIN " : ""}sw_theories t
      WHERE t.active = 1 AND t.id = ?
    `).bind(...(gated ? contentRevisionChangedBindings(cachedRevision!) : []), id));
    const results = await database.batch(statements);
    const offset = gated ? 1 : 0;
    const listResult = results[offset], detailResult = results[offset + 1];
    return {
      rows: (listResult?.results ?? []) as SwTheoryRow[],
      selected: ((detailResult?.results ?? []) as SwTheoryRow[])[0] ?? null,
      ...(gated ? { revision: contentCacheRevisionFromRow((results[0]?.results ?? [])[0] as RevisionRow | undefined) } : {}),
    };
  }

  async findSessionQuestions(input: {
    ids: string[];
    subjects: string[];
    theoryId: number;
    requiredTag: string | null;
  }) {
    if (!input.ids.length) return [];
    const clauses = [`id IN (
      SELECT CAST(value AS TEXT)
      FROM json_each(?)
      WHERE type = 'text'
    )`];
    const values: Array<string | number> = [encodeD1TextList(input.ids)];
    if (input.subjects.length) {
      clauses.push(`subject_id IN (${input.subjects.map(() => "?").join(",")})`);
      values.push(...input.subjects);
    }
    if (Number.isInteger(input.theoryId) && input.theoryId > 0) {
      clauses.push("theory_id = ?");
      values.push(input.theoryId);
    }
    if (input.requiredTag) {
      clauses.push(`EXISTS (
        SELECT 1 FROM sw_question_tags
        WHERE sw_question_tags.question_id = sw_questions.id
          AND sw_question_tags.tag = ?
      )`);
      values.push(input.requiredTag);
    }
    const result = await this.connection().prepare(`
      SELECT id, theory_id, subject_group_id, subject_id, category, topic,
        display_order, difficulty, difficulty_rationale, kind, prompt, choices, tags
      FROM sw_questions
      WHERE active = 1 AND ${clauses.join(" AND ")}
    `).bind(...values).all<SwQuestionDeliveryRow>();
    return result.results ?? [];
  }

  async findPracticeQuestions(input: {
    subjects: string[];
    theoryId: number;
    excludedIds: string[];
    requiredTag: string | null;
    profileOrder: boolean;
    profilePhases: string[];
    limit: number;
  }) {
    const query = buildSwPracticeQuery(input);
    const result = await this.connection().prepare(query.sql)
      .bind(...query.values).all<SwQuestionDeliveryRow>();
    return result.results ?? [];
  }

  async findAttemptQuestion(id: string) {
    return this.connection().prepare(`
      SELECT id, theory_id, subject_group_id, subject_id, category, topic,
        display_order, difficulty, difficulty_rationale, kind, prompt, choices,
        correct_answers, explanation, tags
      FROM sw_questions
      WHERE active = 1 AND id = ?
    `).bind(id).first<SwQuestionRow>();
  }

  async findFeedbackQuestions(ids: readonly string[]) {
    if (!ids.length) return [];
    const result = await this.connection().prepare(`
      SELECT id, theory_id, subject_group_id, subject_id, category, topic,
        display_order, difficulty, difficulty_rationale, kind, prompt, choices,
        correct_answers, explanation, tags
      FROM sw_questions
      WHERE active = 1
        AND id IN (
          SELECT CAST(value AS TEXT)
          FROM json_each(?)
          WHERE type = 'text'
        )
    `).bind(encodeD1TextList(ids)).all<SwQuestionRow>();
    return result.results ?? [];
  }

  async findPracticeBlockedQuestionIds(userKey: string, questionIds: readonly string[]) {
    if (!questionIds.length) return [];
    const result = await this.connection().prepare(`
      SELECT DISTINCT CAST(item.value AS TEXT) AS questionId
      FROM sw_learning_sessions session, json_each(session.question_ids) item
      WHERE session.user_key = ?
        AND session.mode = 'mock'
        AND session.status != 'submitted'
        AND CAST(item.value AS TEXT) IN (
          SELECT CAST(value AS TEXT)
          FROM json_each(?)
          WHERE type = 'text'
        )
    `).bind(userKey, encodeD1TextList(questionIds)).all<{ questionId: string }>();
    return (result.results ?? []).map((row) => String(row.questionId));
  }

  async insertAttemptIdempotent(input: {
    userKey: string;
    questionId: string;
    selectedAnswers: number[];
    correct: boolean;
    mode: "practice" | "mock";
    clientOperationId: string;
    createdAt: string;
  }) {
    const inserted = await this.connection().prepare(`
      INSERT OR IGNORE INTO sw_attempts (
        user_key, question_id, selected_answers, correct, mode,
        client_operation_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      input.userKey,
      input.questionId,
      JSON.stringify(input.selectedAnswers),
      input.correct ? 1 : 0,
      input.mode,
      input.clientOperationId,
      input.createdAt,
    ).run();
    const attempt = await this.connection().prepare(`
      SELECT id, question_id AS questionId, selected_answers AS selectedAnswers,
        correct, mode, client_operation_id AS clientOperationId, created_at AS createdAt
      FROM sw_attempts
      WHERE user_key = ? AND client_operation_id = ?
    `).bind(input.userKey, input.clientOperationId).first<{
      id: number;
      questionId: string;
      selectedAnswers: string;
      correct: number;
      mode: "practice" | "mock";
      clientOperationId: string;
      createdAt: string;
    }>();
    if (!attempt) throw new Error("SW attempt could not be stored");
    return {
      attempt,
      created: Number(inserted.meta.changes ?? 0) > 0,
      conflict: !sameSwAttemptMutation(attempt, input),
    };
  }

  async readUserState(userKey: string) {
    const database = this.connection();
    const [sessionResult, attemptSummaryResult] = await database.batch([
      database.prepare(`
        SELECT id, mode, status, subject_ids AS subjectIds, question_ids AS questionIds,
          answers, revealed_question_ids AS revealedQuestionIds,
          current_index AS currentIndex, result, revision,
          created_at AS createdAt, updated_at AS updatedAt
        FROM sw_learning_sessions
        WHERE user_key = ?
        ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, updated_at DESC, id DESC
        LIMIT 20
      `).bind(userKey),
      database.prepare(`
        SELECT COUNT(*) AS total,
          SUM(CASE WHEN correct = 1 THEN 1 ELSE 0 END) AS correct,
          COUNT(DISTINCT date(created_at, '+9 hours')) AS learningDays
        FROM sw_attempts WHERE user_key = ?
      `).bind(userKey),
    ]);
    const [attemptSummary] = (attemptSummaryResult.results ?? []) as Array<{
      total: number;
      correct: number;
      learningDays: number;
    }>;
    return {
      progress: [] as Array<{
        theoryId: number;
        completed: number;
        updatedAt: string;
      }>,
      sessions: (sessionResult.results ?? []) as Array<{
        id: string;
        mode: "practice" | "mock";
        status: "active" | "submitted";
        subjectIds: string;
        questionIds: string;
        answers: string;
        revealedQuestionIds: string;
        currentIndex: number;
        result: string;
        revision: number;
        createdAt: string;
        updatedAt: string;
      }>,
      attemptSummary: {
        total: Number(attemptSummary?.total ?? 0),
        correct: Number(attemptSummary?.correct ?? 0),
        learningDays: Number(attemptSummary?.learningDays ?? 0),
      },
    };
  }

  async findActiveSession(userKey: string, mode: "practice" | "mock") {
    return this.connection().prepare(`
      SELECT id, mode, status, subject_ids AS subjectIds, question_ids AS questionIds,
        answers, revealed_question_ids AS revealedQuestionIds,
        current_index AS currentIndex, result, revision,
        created_at AS createdAt, updated_at AS updatedAt
      FROM sw_learning_sessions
      WHERE user_key = ? AND mode = ? AND status = 'active'
      LIMIT 1
    `).bind(userKey, mode).first<{
      id: string;
      mode: "practice" | "mock";
      status: string;
      subjectIds: string;
      questionIds: string;
      answers: string;
      revealedQuestionIds: string;
      currentIndex: number;
      result: string;
      revision: number;
      createdAt: string;
      updatedAt: string;
    }>();
  }

  async findSession(userKey: string, id: string) {
    return this.connection().prepare(`
      SELECT id, mode, status, subject_ids AS subjectIds, question_ids AS questionIds,
        answers, revealed_question_ids AS revealedQuestionIds,
        current_index AS currentIndex, result, revision,
        created_at AS createdAt, updated_at AS updatedAt
      FROM sw_learning_sessions
      WHERE id = ? AND user_key = ?
    `).bind(id, userKey).first<{
      id: string;
      mode: "practice" | "mock";
      status: string;
      subjectIds: string;
      questionIds: string;
      answers: string;
      revealedQuestionIds: string;
      currentIndex: number;
      result: string;
      revision: number;
      createdAt: string;
      updatedAt: string;
    }>();
  }

  async saveSession(input: {
    recordGuestAnalytics?: boolean;
    id: string;
    userKey: string;
    mode: "practice" | "mock";
    status: "active" | "submitted";
    subjectIds: string[];
    questionIds: string[];
    answers: Record<string, number[]>;
    revealedQuestionIds: string[];
    currentIndex: number;
    result: Record<string, unknown>;
    expectedRevision: number;
    updatedAt: string;
  }) {
    const database = this.connection();
    const inserted = await database.prepare(SW_SESSION_INSERT_SQL).bind(
      input.id,
      input.userKey,
      input.mode,
      input.status,
      JSON.stringify(input.subjectIds),
      JSON.stringify(input.questionIds),
      JSON.stringify(input.answers),
      JSON.stringify(input.revealedQuestionIds),
      input.currentIndex,
      JSON.stringify(input.result),
      input.updatedAt,
      input.updatedAt,
    ).run();
    let current = await this.findSession(input.userKey, input.id);
    if (Number(inserted.meta.changes ?? 0) > 0) {
      if (!current) throw new Error("SW session could not be created");
      return { outcome: "saved" as const, saved: current, duplicate: false };
    }
    if (!current) {
      return {
        outcome: "conflict" as const,
        conflict: await this.findActiveSession(input.userKey, input.mode) ?? null,
      };
    }
    if (current.status === "submitted") {
      return input.status === "submitted" && sameSwSubmittedSessionMutation(current, input)
        ? { outcome: "saved" as const, saved: current, duplicate: true }
        : { outcome: "conflict" as const, conflict: current };
    }
    if (current.mode !== input.mode) {
      return { outcome: "conflict" as const, conflict: current };
    }
    if (sameSwActiveSessionMutation(current, input)) {
      return { outcome: "saved" as const, saved: current, duplicate: true };
    }

    const update = database.prepare(SW_SESSION_UPDATE_SQL).bind(
      input.status,
      JSON.stringify(input.subjectIds),
      JSON.stringify(input.questionIds),
      JSON.stringify(input.answers),
      JSON.stringify(input.revealedQuestionIds),
      input.currentIndex,
      JSON.stringify(input.result),
      input.updatedAt,
      input.id,
      input.userKey,
      input.expectedRevision,
    );
    const updated = isGuestLearningKey(input.userKey) && input.recordGuestAnalytics !== false && input.status === "submitted" && input.mode === "mock"
      ? (await database.batch([update, database.prepare(GUEST_SW_MOCK_EVENTS_SQL).bind(
        await sha256(`guest-submissions:${input.userKey}`), input.id, input.userKey,
        input.updatedAt, input.expectedRevision + 1, JSON.stringify(input.answers),
      )]))[0]
      : await update.run();
    if (!Number(updated.meta.changes ?? 0)) {
      current = await this.findSession(input.userKey, input.id);
      return { outcome: "conflict" as const, conflict: current ?? null };
    }
    const saved = await this.findSession(input.userKey, input.id);
    if (!saved) throw new Error("SW session could not be read after save");
    return { outcome: "saved" as const, saved, duplicate: false };
  }
}
