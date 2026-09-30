import { learnerQuestionSql } from "./study-content-visibility";
import { userSettings } from "@backend/infrastructure/database/schema";
import { buildStudyPracticeQuery } from "./study-practice-query.mjs";
import {
  DEFAULT_EXAM_TYPE,
  type ExamType,
} from "./domain/study.domain";
import { courseQuestionEligibility } from "./study-course-policy-query";
import { encodeD1IntegerList } from "@backend/common/database/d1-query-bindings.mjs";
import type {
  PracticeQuestionRow,
  QuestionDeliveryRow,
  QuestionRow,
} from "./study.repository";

type QueryResult = { results?: unknown[] };
type UserSettingRow = typeof userSettings.$inferSelect;

export type StudyPracticeQueryInput = {
  selectedExam: ExamType;
  category: string;
  difficulty: string;
  kind: string;
  theoryId: number;
  bookmarkUserKey?: string;
  excludedIds: number[];
  excludedVariantGroupIds: string[];
  limit: number;
};

export type PracticeMetaRow = {
  category: string;
  difficulty: string;
  kind: string;
  item_count: number;
  eligible_group_count: number;
};

export type PracticeMetaSummary = {
  item_count: number;
  eligible_group_count: number;
};

export type ActiveQuestionReadOptions = {
  knownBookmarkedIds?: readonly number[];
  includeSetting?: boolean;
};

function rowsFrom<T>(result: QueryResult | undefined) {
  return (result?.results ?? []) as T[];
}

export function fallbackUserSetting(userKey: string): UserSettingRow {
  return {
    userKey,
    selectedExam: DEFAULT_EXAM_TYPE,
    createdAt: "",
    updatedAt: "",
  };
}

export function userSettingStatement(database: D1Database, userKey: string) {
  return database.prepare(`
    SELECT user_key AS userKey, selected_exam AS selectedExam,
      created_at AS createdAt, updated_at AS updatedAt
    FROM user_settings
    WHERE user_key = ?
    LIMIT 1
  `).bind(userKey);
}

function practiceMetaStatement(database: D1Database, selectedExam: ExamType) {
  const eligibility = courseQuestionEligibility(selectedExam);
  return database.prepare(`
    WITH eligible AS (
      SELECT category, difficulty, kind,
        COALESCE('variant:' || variant_group_id, 'question:' || id) AS group_key
      FROM questions
      WHERE active = 1 AND practice_scope = 'general' AND id NOT BETWEEN 88200001 AND 88200400 AND ${eligibility.sql}
    ), practice_meta AS (
      SELECT 'bucket' AS metric_type, category, difficulty, kind,
        COUNT(*) AS item_count,
        COUNT(DISTINCT group_key) AS eligible_group_count
      FROM eligible
      GROUP BY category, difficulty, kind
      UNION ALL
      SELECT 'summary' AS metric_type, NULL AS category, NULL AS difficulty, NULL AS kind,
        COUNT(*) AS item_count,
        COUNT(DISTINCT group_key) AS eligible_group_count
      FROM eligible
    )
    SELECT metric_type, category, difficulty, kind, item_count, eligible_group_count
    FROM practice_meta
    ORDER BY metric_type, category, difficulty, kind
  `).bind(...eligibility.values);
}

function parsePracticeMetaResult(result: QueryResult | undefined) {
  const resultRows = rowsFrom<{
    metric_type: "bucket" | "summary";
    category: string | null;
    difficulty: string | null;
    kind: string | null;
    item_count: number;
    eligible_group_count: number;
  }>(result);
  const summary = resultRows.find((row) => row.metric_type === "summary");
  return {
    rows: resultRows.filter((row): row is typeof row & {
      category: string;
      difficulty: string;
      kind: string;
    } => row.metric_type === "bucket"),
    summary: {
      item_count: Number(summary?.item_count ?? 0),
      eligible_group_count: Number(summary?.eligible_group_count ?? 0),
    },
  };
}

export const QUESTION_DELIVERY_PROJECTION = `
  id, category, topic, display_order AS displayOrder,
  exam_scope AS examScope, difficulty,
  difficulty_rationale AS difficultyRationale, kind, prompt, choices,
  tags, theory_id AS theoryId,
  practice_scope AS practiceScope, variant_group_id AS variantGroupId,
  bookmarked, active, created_at AS createdAt, updated_at AS updatedAt
`;

const QUESTION_FEEDBACK_PROJECTION = `
  ${QUESTION_DELIVERY_PROJECTION},
  correct_answers AS correctAnswers, explanation,
  scoring_criteria AS scoringCriteria, required_concepts AS requiredConcepts,
  acceptable_alternatives AS acceptableAlternatives,
  deduction_conditions AS deductionConditions,
  error_conditions AS errorConditions
`;

async function readQuestionsByIds<T>(
  database: D1Database,
  ids: readonly number[],
  projection: string,
) {
  if (ids.length === 0) return [];
  const result = await database.prepare(`
    SELECT ${projection}
    FROM questions
    WHERE active = 1 AND ${learnerQuestionSql()}
      AND id IN (
        SELECT CAST(value AS INTEGER)
        FROM json_each(?)
        WHERE type = 'integer'
      )
  `).bind(encodeD1IntegerList(ids)).all<T>();
  return result.results ?? [];
}

export function readFeedbackQuestionsByIds(database: D1Database, ids: readonly number[]) {
  return readQuestionsByIds<QuestionRow>(database, ids, QUESTION_FEEDBACK_PROJECTION);
}

export async function readActiveQuestionsByIds(
  database: D1Database,
  ids: readonly number[],
  userKey?: string,
  options: ActiveQuestionReadOptions = {},
) {
  if (ids.length === 0 && !(userKey && options.includeSetting)) {
    return { rows: [], bookmarkedIds: [], setting: undefined };
  }
  const encodedIds = ids.length ? encodeD1IntegerList(ids) : "";
  const questionStatements = ids.length
    ? [database.prepare(`
        SELECT ${QUESTION_DELIVERY_PROJECTION}
        FROM questions
        WHERE active = 1 AND ${learnerQuestionSql()}
          AND id IN (
            SELECT CAST(value AS INTEGER)
            FROM json_each(?)
            WHERE type = 'integer'
          )
      `).bind(encodedIds)]
    : [];
  const shouldReadBookmarks = Boolean(userKey) && options.knownBookmarkedIds === undefined;
  const bookmarkStatements = shouldReadBookmarks && ids.length
    ? [database.prepare(`
        SELECT question_id AS questionId
        FROM user_bookmarks
        WHERE user_key = ?
          AND question_id IN (
            SELECT CAST(value AS INTEGER)
            FROM json_each(?)
            WHERE type = 'integer'
          )
      `).bind(userKey, encodedIds)]
    : [];
  const settingStatements = userKey && options.includeSetting
    ? [userSettingStatement(database, userKey)]
    : [];
  const statements = [...questionStatements, ...bookmarkStatements, ...settingStatements];
  const results = statements.length ? await database.batch(statements) : [];
  const rows = results.slice(0, questionStatements.length)
    .flatMap((result) => rowsFrom<QuestionDeliveryRow>(result));
  const requestedIds = new Set(ids);
  const bookmarkedIds = options.knownBookmarkedIds === undefined
    ? results.slice(questionStatements.length, questionStatements.length + bookmarkStatements.length)
        .flatMap((result) => rowsFrom<{ questionId: number }>(result))
        .map((row) => row.questionId)
    : [...new Set(options.knownBookmarkedIds.filter((id) => requestedIds.has(id)))];
  const settingResult = results[questionStatements.length + bookmarkStatements.length];
  return {
    rows,
    bookmarkedIds: userKey ? bookmarkedIds : [],
    setting: userKey && options.includeSetting
      ? rowsFrom<UserSettingRow>(settingResult)[0] ?? fallbackUserSetting(userKey)
      : undefined,
  };
}

export async function readPracticeMetaWithSetting(
  database: D1Database,
  selectedExam: ExamType,
  userKey: string,
) {
  const [metaResult, settingResult] = await database.batch([
    practiceMetaStatement(database, selectedExam),
    userSettingStatement(database, userKey),
  ]);
  const meta = parsePracticeMetaResult(metaResult);
  return {
    ...meta,
    setting: rowsFrom<UserSettingRow>(settingResult)[0] ?? fallbackUserSetting(userKey),
  };
}

export async function readPracticeMetaRows(
  database: D1Database,
  selectedExam: ExamType,
) {
  return parsePracticeMetaResult(await practiceMetaStatement(database, selectedExam).all());
}

export async function readPracticeQuestionsWithSetting(
  database: D1Database,
  input: StudyPracticeQueryInput,
  userKey: string,
) {
  const query = buildStudyPracticeQuery({
    ...input,
    eligibility: courseQuestionEligibility(input.selectedExam, "q"),
  });
  const [questionResult, settingResult] = await database.batch([
    database.prepare(query.sql).bind(...query.values),
    userSettingStatement(database, userKey),
  ]);
  return {
    rows: rowsFrom<PracticeQuestionRow>(questionResult),
    setting: rowsFrom<UserSettingRow>(settingResult)[0] ?? fallbackUserSetting(userKey),
  };
}
