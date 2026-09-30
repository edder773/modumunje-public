import { learnerQuestionSql } from "./study-content-visibility";
import { learnerContextPlan } from "@backend/common/auth/learner-request-context";
import type { questions } from "@backend/infrastructure/database/schema";

type QueryResult = { results?: unknown[] };

export type PracticeAttemptQuestion = Pick<typeof questions.$inferSelect,
  | "id"
  | "examScope"
  | "kind"
  | "choices"
  | "correctAnswers"
  | "prompt"
  | "explanation"
  | "scoringCriteria"
  | "requiredConcepts"
  | "acceptableAlternatives"
  | "deductionConditions"
  | "errorConditions"
>;

export type PracticeAttemptContext = {
  blockingExamItem: { id: string; status: string } | null;
  question: PracticeAttemptQuestion | null;
};

export type PracticeMutationContext = PracticeAttemptContext & {
  account: {
    userKey: string;
    email: string;
    displayName: string;
    status: "active" | "blocked";
    blockedReason: string;
  } | null;
  siteSettings: Array<{ key: string; value: string }>;
  contentRevision: string;
};

function rowsFrom<T>(result: QueryResult | undefined) {
  return (result?.results ?? []) as T[];
}

export async function readPracticeAttemptContext(
  database: D1Database,
  userKey: string,
  questionId: number,
) {
  const [blockingResult, questionResult] = await database.batch([
    database.prepare(`
      SELECT exam_sessions.id, exam_sessions.status
      FROM exam_session_items
      INNER JOIN exam_sessions ON exam_sessions.id = exam_session_items.session_id
      WHERE exam_sessions.user_key = ?
        AND exam_session_items.question_id = ?
        AND exam_sessions.status != 'submitted'
      LIMIT 1
    `).bind(userKey, questionId),
    database.prepare(`
      SELECT
        id,
        exam_scope AS examScope,
        kind,
        choices,
        correct_answers AS correctAnswers,
        prompt,
        explanation,
        scoring_criteria AS scoringCriteria,
        required_concepts AS requiredConcepts,
        acceptable_alternatives AS acceptableAlternatives,
        deduction_conditions AS deductionConditions,
        error_conditions AS errorConditions
      FROM questions
      WHERE id = ? AND active = 1 AND ${learnerQuestionSql()}
      LIMIT 1
    `).bind(questionId),
  ]);
  return {
    blockingExamItem: rowsFrom<{ id: string; status: string }>(blockingResult)[0] ?? null,
    question: rowsFrom<PracticeAttemptQuestion>(questionResult)[0] ?? null,
  };
}

export async function readPracticeMutationContext(
  database: D1Database,
  input: { email: string; userKey: string; questionId: number; adminBypassMaintenance: boolean },
): Promise<PracticeMutationContext> {
  const contextPlan = learnerContextPlan(database, input.userKey, { includeRevision: true });
  const [, ...results] = await database.batch([
    database.prepare(`
      INSERT INTO user_accounts (
        user_key, email, display_name, status, created_at, last_login_at, updated_at
      ) SELECT ?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      WHERE ? = 1 OR NOT EXISTS (
        SELECT 1 FROM site_settings WHERE key = 'maintenance_mode' AND value = 'true'
      )
      ON CONFLICT(user_key) DO NOTHING
    `).bind(input.userKey, input.email, input.email, input.adminBypassMaintenance ? 1 : 0),
    ...contextPlan.statements,
    database.prepare(`
      SELECT exam_sessions.id, exam_sessions.status
      FROM exam_session_items
      INNER JOIN exam_sessions ON exam_sessions.id = exam_session_items.session_id
      WHERE exam_sessions.user_key = ?
        AND exam_session_items.question_id = ?
        AND exam_sessions.status != 'submitted'
      LIMIT 1
    `).bind(input.userKey, input.questionId),
    database.prepare(`
      SELECT
        id,
        exam_scope AS examScope,
        kind,
        choices,
        correct_answers AS correctAnswers,
        prompt,
        explanation,
        scoring_criteria AS scoringCriteria,
        required_concepts AS requiredConcepts,
        acceptable_alternatives AS acceptableAlternatives,
        deduction_conditions AS deductionConditions,
        error_conditions AS errorConditions
      FROM questions
      WHERE id = ? AND active = 1 AND ${learnerQuestionSql()}
      LIMIT 1
    `).bind(input.questionId),
  ]);
  const context = contextPlan.parse(results.slice(0, contextPlan.statements.length));
  const blockingResult = results[contextPlan.statements.length];
  const questionResult = results[contextPlan.statements.length + 1];
  return {
    account: context.accountRow ? {
      userKey: context.accountRow.user_key,
      email: context.accountRow.email,
      displayName: context.accountRow.display_name,
      status: context.accountRow.status,
      blockedReason: context.accountRow.blocked_reason,
    } : null,
    siteSettings: context.siteRows,
    contentRevision: context.revision,
    blockingExamItem: rowsFrom<{ id: string; status: string }>(blockingResult)[0] ?? null,
    question: rowsFrom<PracticeAttemptQuestion>(questionResult)[0] ?? null,
  };
}
