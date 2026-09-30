import { learnerQuestionSql, learnerSessionSql } from "./study-content-visibility";
import type { ExamType } from "./domain/study.domain";
import { courseQuestionEligibility } from "./study-course-policy-query";
import { fallbackUserSetting, QUESTION_DELIVERY_PROJECTION, userSettingStatement } from "./study-question.repository-queries";
import type { QuestionDeliveryRow } from "./study.repository";
import type { userSettings } from "@backend/infrastructure/database/schema";

// Old mock submissions could persist blank items as incorrect attempts. Keep
// those rows untouched while excluding them from answer-based views/counts.
export function answeredAttemptSql(alias: "a" | "attempts" = "a") {
  return `NOT (${alias}.mode = 'mock-exam' AND ${alias}.selected_answers = '[]' AND trim(COALESCE(${alias}.answer_text, '')) = '')`;
}

type RecordBookmarkOptions = {
  limit: number;
  bookmarkCursor?: number;
};

export type RecordStats = {
  totalAttempts: number;
  correctAttempts: number;
  incorrectAttempts: number;
  learningDays: number;
  difficulties: Array<{ level: string; attempts: number; correct: number; incorrect: number }>;
  categories: Array<{
    category: string;
    attempts: number;
    correct: number;
    incorrect: number;
    topics: Array<{ topic: string; attempts: number; correct: number; incorrect: number }>;
  }>;
};

export type RecordAttemptRow = {
  id: number;
  questionId: number;
  selectedAnswers: string;
  correct: boolean | number;
  mode: string;
  userKey: string;
  examType: ExamType;
  result: "correct" | "partial" | "incorrect";
  score: number;
  answerText: string;
  evaluationId: number | null;
  reviewStatus: string;
  isAdmin: boolean | number;
  clientOperationId: string | null;
  createdAt: string;
};

export type RecordReadOptions = {
  limit: number;
  attemptCursor?: number;
  bookmarkCursor?: number;
  view: "stats" | "incorrect" | "bookmarks";
};

export type RecordQuestionDeliveryRow = QuestionDeliveryRow & {
  recordBookmarked: number;
  recordBlocked: number;
};

function recordQuestionPageStatement(database: D1Database, userKey: string, selectedExam: ExamType, options: RecordReadOptions) {
  const cursor = options.view === "bookmarks" ? options.bookmarkCursor : options.attemptCursor;
  const eligibility = courseQuestionEligibility(selectedExam, "q");
  const page = options.view === "stats" ? {
    sql: `SELECT a.question_id FROM attempts AS a
      WHERE a.user_key = ? AND a.exam_type = ?
        AND ${answeredAttemptSql("a")}
        AND ${learnerQuestionSql("a", "question_id")}
        ${cursor ? "AND a.id < ?" : ""}
      ORDER BY a.created_at DESC, a.id DESC LIMIT ?`,
    values: [userKey, selectedExam, ...(cursor ? [cursor] : []), options.limit] as Array<string | number>,
  } : options.view === "incorrect" ? {
    sql: `SELECT question_id FROM (
        SELECT a.id, a.question_id, a.created_at, a.result,
          ROW_NUMBER() OVER (PARTITION BY a.question_id ORDER BY a.created_at DESC, a.id DESC) AS attempt_rank
        FROM attempts AS a JOIN questions AS q ON q.id = a.question_id
        WHERE a.user_key = ? AND a.exam_type = ? AND ${answeredAttemptSql("a")}
          AND q.active = 1 AND ${learnerQuestionSql("q")}
          AND (q.kind IN ('single', 'multiple') OR (q.exam_scope = 'IPEP' AND q.kind = 'descriptive'
            AND a.mode IN ('practice', 'bookmark-practice', 'bookmark-modal', 'incorrect-review', 'mock-exam')))
      ) WHERE attempt_rank = 1 AND result != 'correct'
        ${cursor ? "AND id < ?" : ""}
      ORDER BY created_at DESC, id DESC LIMIT ?`,
    values: [userKey, selectedExam, ...(cursor ? [cursor] : []), options.limit] as Array<string | number>,
  } : {
    sql: `SELECT b.question_id FROM user_bookmarks AS b
      JOIN questions AS q ON q.id = b.question_id
      WHERE b.user_key = ? AND q.active = 1 AND ${learnerQuestionSql("q")}
        AND ${eligibility.sql}
        ${cursor ? "AND b.question_id < ?" : ""}
      ORDER BY b.question_id DESC LIMIT ?`,
    values: [userKey, ...eligibility.values, ...(cursor ? [cursor] : []), options.limit] as Array<string | number>,
  };
  return database.prepare(`
    WITH page_ids AS MATERIALIZED (${page.sql})
    SELECT ${QUESTION_DELIVERY_PROJECTION},
      EXISTS (SELECT 1 FROM user_bookmarks AS b WHERE b.user_key = ? AND b.question_id = questions.id) AS recordBookmarked,
      EXISTS (SELECT 1 FROM exam_session_items AS item
        JOIN exam_sessions AS session ON session.id = item.session_id
        WHERE session.user_key = ? AND session.status != 'submitted' AND item.question_id = questions.id) AS recordBlocked
    FROM questions
    WHERE active = 1 AND ${learnerQuestionSql()}
      AND id IN (SELECT question_id FROM page_ids)
  `).bind(...page.values, userKey, userKey);
}

function recordAttemptRowsStatement(database: D1Database, userKey: string, selectedExam: ExamType, options: RecordReadOptions) {
  return database.prepare(`
    SELECT id, question_id AS questionId, selected_answers AS selectedAnswers,
      correct, mode, user_key AS userKey, exam_type AS examType,
      result, score, answer_text AS answerText, evaluation_id AS evaluationId,
      review_status AS reviewStatus, is_admin AS isAdmin,
      client_operation_id AS clientOperationId, created_at AS createdAt
    FROM attempts
    WHERE user_key = ? AND exam_type = ?
      AND ${answeredAttemptSql("attempts")}
      AND ${learnerQuestionSql("attempts", "question_id")}
      ${options.attemptCursor ? "AND id < ?" : ""}
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).bind(userKey, selectedExam, ...(options.attemptCursor ? [options.attemptCursor] : []), options.limit + 1);
}

type RecordSummary = {
  incorrectQuestionCount: number;
  bookmarkCount: number;
};

export function latestIncorrectAttemptsStatement(
  database: D1Database,
  userKey: string,
  selectedExam: ExamType,
  limit: number,
  cursor?: number,
) {
  const eligibility = courseQuestionEligibility(selectedExam, "q");
  const cursorClause = cursor ? "AND id < ?" : "";
  const values: Array<string | number> = [userKey, selectedExam];
  if (cursor) values.push(cursor);
  values.push(limit + 1);
  values.push(userKey, ...eligibility.values);
  return database.prepare(`
    WITH ranked AS MATERIALIZED (
      SELECT a.*,
        ROW_NUMBER() OVER (
          PARTITION BY a.question_id
          ORDER BY a.created_at DESC, a.id DESC
        ) AS attempt_rank
      FROM attempts AS a
      JOIN questions AS q ON q.id = a.question_id
      WHERE a.user_key = ? AND a.exam_type = ?
        AND ${answeredAttemptSql("a")}
        AND q.active = 1 AND ${learnerQuestionSql("q")} AND (q.kind IN ('single', 'multiple') OR (q.exam_scope = 'IPEP' AND q.kind = 'descriptive' AND a.mode IN ('practice', 'bookmark-practice', 'bookmark-modal', 'incorrect-review', 'mock-exam')))
    ), incorrect AS MATERIALIZED (
      SELECT * FROM ranked
      WHERE attempt_rank = 1 AND result != 'correct'
    ), page AS MATERIALIZED (
      SELECT * FROM incorrect
      WHERE 1 = 1 ${cursorClause}
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    ), counts AS (
      SELECT
        (SELECT COUNT(*) FROM incorrect) AS incorrectQuestionCount,
        (SELECT COUNT(*)
          FROM user_bookmarks AS b
          JOIN questions AS q ON q.id = b.question_id
          WHERE b.user_key = ? AND q.active = 1 AND ${learnerQuestionSql("q")} AND ${eligibility.sql}
        ) AS bookmarkCount
    )
    SELECT * FROM (
      SELECT id,
      question_id AS questionId,
      selected_answers AS selectedAnswers,
      correct,
      mode,
      user_key AS userKey,
      exam_type AS examType,
      result,
      score,
      answer_text AS answerText,
      evaluation_id AS evaluationId,
      review_status AS reviewStatus,
      is_admin AS isAdmin,
      client_operation_id AS clientOperationId,
      created_at AS createdAt,
      counts.incorrectQuestionCount,
      counts.bookmarkCount,
      0 AS summaryOnly
      FROM page CROSS JOIN counts
      UNION ALL
      SELECT NULL, NULL, '[]', 0, 'practice', '', '', 'incorrect', 0, '',
        NULL, 'pending', 0, NULL, '', counts.incorrectQuestionCount,
        counts.bookmarkCount, 1
      FROM counts WHERE NOT EXISTS (SELECT 1 FROM page)
    )
    ORDER BY summaryOnly, createdAt DESC, id DESC
  `).bind(...values);
}

export function parseLatestIncorrectAttemptsResult(resultRows: Array<RecordAttemptRow & RecordSummary & { summaryOnly: number }>) {
  const summaryRow = resultRows[0];
  return {
    rows: resultRows.filter((row) => Number.isInteger(row.id)),
    summary: {
      incorrectQuestionCount: Number(summaryRow?.incorrectQuestionCount ?? 0),
      bookmarkCount: Number(summaryRow?.bookmarkCount ?? 0),
    },
  };
}

export function recordStatsStatement(
  database: D1Database,
  userKey: string,
  selectedExam: ExamType,
) {
  const eligibility = courseQuestionEligibility(selectedExam, "q");
  return database.prepare(`
    WITH eligible AS MATERIALIZED (
      SELECT
        a.id,
        a.question_id,
        a.result,
        a.created_at,
        q.category,
        COALESCE(NULLIF(trim(q.topic), ''), '미분류') AS topic,
        COALESCE(NULLIF(trim(q.difficulty), ''), '기록 없음') AS difficulty
      FROM attempts AS a
      JOIN questions AS q ON q.id = a.question_id
      WHERE a.user_key = ? AND a.exam_type = ?
        AND ${answeredAttemptSql("a")}
        AND q.active = 1 AND ${learnerQuestionSql("q")} AND (q.kind IN ('single', 'multiple') OR (q.exam_scope = 'IPEP' AND q.kind = 'descriptive' AND a.mode IN ('practice', 'bookmark-practice', 'bookmark-modal', 'incorrect-review', 'mock-exam')))
    ), latest AS MATERIALIZED (
      SELECT question_id, result,
        ROW_NUMBER() OVER (
          PARTITION BY question_id
          ORDER BY created_at DESC, id DESC
        ) AS attempt_rank
      FROM eligible
    )
    SELECT 'summary' AS dimension, '' AS group_key, '' AS detail_key,
      COUNT(*) AS attempts,
      SUM(CASE WHEN result = 'correct' THEN 1 ELSE 0 END) AS correct,
      SUM(CASE WHEN result != 'correct' THEN 1 ELSE 0 END) AS incorrect,
      COUNT(DISTINCT date(created_at, '+9 hours')) AS learning_days,
      0 AS incorrect_questions, 0 AS bookmark_count
    FROM eligible
    UNION ALL
    SELECT 'difficulty', difficulty, '', COUNT(*),
      SUM(CASE WHEN result = 'correct' THEN 1 ELSE 0 END),
      SUM(CASE WHEN result != 'correct' THEN 1 ELSE 0 END), 0, 0, 0
    FROM eligible GROUP BY difficulty
    UNION ALL
    SELECT 'topic', category, topic, COUNT(*),
      SUM(CASE WHEN result = 'correct' THEN 1 ELSE 0 END),
      SUM(CASE WHEN result != 'correct' THEN 1 ELSE 0 END), 0, 0, 0
    FROM eligible GROUP BY category, topic
    UNION ALL
    SELECT 'records', '', '', 0, 0, 0, 0,
      (SELECT COUNT(*) FROM latest
        WHERE attempt_rank = 1 AND result != 'correct'),
      (SELECT COUNT(*)
        FROM user_bookmarks AS b
        JOIN questions AS q ON q.id = b.question_id
        WHERE b.user_key = ? AND q.active = 1 AND ${learnerQuestionSql("q")} AND ${eligibility.sql})
  `).bind(userKey, selectedExam, userKey, ...eligibility.values);
}

export type RecordStatsResultRow = {
    dimension: "summary" | "difficulty" | "topic" | "records";
    group_key: string;
    detail_key: string;
    attempts: number;
    correct: number;
    incorrect: number;
    learning_days: number;
    incorrect_questions: number;
    bookmark_count: number;
};

export function parseRecordStatsResult(rows: RecordStatsResultRow[]): {
  stats: RecordStats;
  summary: { incorrectQuestionCount: number; bookmarkCount: number };
} {
  const summary = rows.find((row) => row.dimension === "summary");
  const recordSummary = rows.find((row) => row.dimension === "records");
  const categoryMap = new Map<string, RecordStats["categories"][number]>();
  for (const row of rows) {
    if (row.dimension !== "topic") continue;
    const category = categoryMap.get(row.group_key) ?? {
      category: row.group_key,
      attempts: 0,
      correct: 0,
      incorrect: 0,
      topics: [],
    };
    const topic = {
      topic: row.detail_key,
      attempts: Number(row.attempts),
      correct: Number(row.correct),
      incorrect: Number(row.incorrect),
    };
    category.attempts += topic.attempts;
    category.correct += topic.correct;
    category.incorrect += topic.incorrect;
    category.topics.push(topic);
    categoryMap.set(category.category, category);
  }
  return {
    stats: {
      totalAttempts: Number(summary?.attempts ?? 0),
      correctAttempts: Number(summary?.correct ?? 0),
      incorrectAttempts: Number(summary?.incorrect ?? 0),
      learningDays: Number(summary?.learning_days ?? 0),
      difficulties: rows.filter((row) => row.dimension === "difficulty").map((row) => ({
        level: row.group_key,
        attempts: Number(row.attempts),
        correct: Number(row.correct),
        incorrect: Number(row.incorrect),
      })),
      categories: [...categoryMap.values()],
    },
    summary: {
      incorrectQuestionCount: Number(recordSummary?.incorrect_questions ?? 0),
      bookmarkCount: Number(recordSummary?.bookmark_count ?? 0),
    },
  };
}

export function recordSessionRowsStatement(
  database: D1Database,
  userKey: string,
  selectedExam: ExamType,
) {
  return database.prepare(`
    SELECT id, exam_type AS examType, status, current_index AS currentIndex,
      started_at AS startedAt, ends_at AS endsAt, submitted_at AS submittedAt,
      result, updated_at AS updatedAt, is_admin AS isAdmin
    FROM exam_sessions
    WHERE user_key = ? AND exam_type = ? AND ${learnerSessionSql()}
    ORDER BY updated_at DESC, id DESC
    LIMIT 21
  `).bind(userKey, selectedExam);
}

export type RecordSessionRow = {
    id: string;
    examType: ExamType;
    status: "active" | "submitted";
    currentIndex: number;
    startedAt: string;
    endsAt: string;
    submittedAt: string | null;
    result: string;
    updatedAt: string;
    isAdmin: boolean;
};

export function recordBookmarkRowsStatement(
  database: D1Database,
  userKey: string,
  selectedExam: ExamType,
  options: RecordBookmarkOptions,
) {
  const cursorClause = options.bookmarkCursor ? "AND questionId < ?" : "";
  const eligibility = courseQuestionEligibility(selectedExam, "q");
  const values: Array<string | number> = [
    userKey,
    ...eligibility.values,
  ];
  if (options.bookmarkCursor) values.push(options.bookmarkCursor);
  values.push(options.limit + 1);
  return database.prepare(`
    WITH ranked AS MATERIALIZED (
      SELECT a.question_id, a.result,
        ROW_NUMBER() OVER (
          PARTITION BY a.question_id
          ORDER BY a.created_at DESC, a.id DESC
        ) AS attempt_rank
      FROM attempts AS a
      JOIN questions AS q ON q.id = a.question_id
      WHERE a.user_key = ? AND a.exam_type = ?
        AND ${answeredAttemptSql("a")}
        AND q.active = 1 AND ${learnerQuestionSql("q")} AND (q.kind IN ('single', 'multiple') OR (q.exam_scope = 'IPEP' AND q.kind = 'descriptive' AND a.mode IN ('practice', 'bookmark-practice', 'bookmark-modal', 'incorrect-review', 'mock-exam')))
    ), bookmarks AS MATERIALIZED (
      SELECT b.question_id AS questionId
      FROM user_bookmarks AS b
      JOIN questions AS q ON q.id = b.question_id
      WHERE b.user_key = ? AND q.active = 1 AND ${learnerQuestionSql("q")} AND ${eligibility.sql}
    ), page AS MATERIALIZED (
      SELECT questionId FROM bookmarks
      WHERE 1 = 1 ${cursorClause}
      ORDER BY questionId DESC
      LIMIT ?
    ), counts AS (
      SELECT
        (SELECT COUNT(*) FROM ranked
          WHERE attempt_rank = 1 AND result != 'correct') AS incorrectQuestionCount,
        (SELECT COUNT(*) FROM bookmarks) AS bookmarkCount
    )
    SELECT * FROM (
      SELECT page.questionId, counts.incorrectQuestionCount,
        counts.bookmarkCount, 0 AS summaryOnly
      FROM page CROSS JOIN counts
      UNION ALL
      SELECT NULL, counts.incorrectQuestionCount, counts.bookmarkCount, 1
      FROM counts WHERE NOT EXISTS (SELECT 1 FROM page)
    )
    ORDER BY summaryOnly, questionId DESC
  `).bind(
    userKey,
    selectedExam,
    ...values,
  );
}

export function parseRecordBookmarkRowsResult(resultRows: Array<{ questionId: number | null } & RecordSummary & { summaryOnly: number }>) {
  const summaryRow = resultRows[0];
  return {
    rows: resultRows.filter((row): row is typeof row & { questionId: number } => (
      Number.isInteger(row.questionId)
    )),
    summary: {
      incorrectQuestionCount: Number(summaryRow?.incorrectQuestionCount ?? 0),
      bookmarkCount: Number(summaryRow?.bookmarkCount ?? 0),
    },
  };
}

export async function readRecordBatch(
  database: D1Database,
  userKey: string,
  selectedExam: ExamType,
  options: RecordReadOptions,
) {
  const names: string[] = [];
  const statements: D1PreparedStatement[] = [];
  function add(name: string, statement: D1PreparedStatement) {
    names.push(name);
    statements.push(statement);
  }
  if (options.view === "stats") {
    add("attempts", recordAttemptRowsStatement(database, userKey, selectedExam, options));
    add("sessions", recordSessionRowsStatement(database, userKey, selectedExam));
    add("stats", recordStatsStatement(database, userKey, selectedExam));
  } else if (options.view === "incorrect") {
    add("incorrect", latestIncorrectAttemptsStatement(database, userKey, selectedExam, options.limit, options.attemptCursor));
  } else {
    add("bookmarks", recordBookmarkRowsStatement(database, userKey, selectedExam, options));
  }
  add("setting", userSettingStatement(database, userKey));
  add("questions", recordQuestionPageStatement(database, userKey, selectedExam, options));
  const results = await database.batch(statements);
  const result = (name: string) => results[names.indexOf(name)];
  const rows = <T>(name: string): T[] => (result(name)?.results ?? []) as T[];
  const incorrect = options.view === "incorrect"
    ? parseLatestIncorrectAttemptsResult(rows<RecordAttemptRow & RecordSummary & { summaryOnly: number }>("incorrect"))
    : undefined;
  const bookmarks = options.view === "bookmarks"
    ? parseRecordBookmarkRowsResult(rows<{ questionId: number | null } & RecordSummary & { summaryOnly: number }>("bookmarks"))
    : undefined;
  const stats = options.view === "stats"
    ? parseRecordStatsResult(rows<RecordStatsResultRow>("stats"))
    : undefined;
  return {
    attemptRows: incorrect?.rows ?? rows<RecordAttemptRow>("attempts"),
    sessionRows: rows<RecordSessionRow>("sessions"),
    bookmarkRows: bookmarks?.rows ?? [],
    setting: rows<typeof userSettings.$inferSelect>("setting")[0] ?? fallbackUserSetting(userKey),
    questionRows: rows<RecordQuestionDeliveryRow>("questions"),
    summary: stats?.summary ?? incorrect?.summary ?? bookmarks?.summary,
    stats: stats?.stats,
  };
}
