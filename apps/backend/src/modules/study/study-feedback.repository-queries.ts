import { encodeD1IntegerList } from "@backend/common/database/d1-query-bindings.mjs";

export async function readPracticeBlockedQuestionIds(
  database: D1Database,
  userKey: string,
  questionIds: readonly number[],
) {
  if (questionIds.length === 0) return [];
  const result = await practiceBlockedQuestionIdsStatement(database, userKey, questionIds).all<{ questionId: number }>();
  return (result.results ?? []).map((row) => Number(row.questionId));
}

export function practiceBlockedQuestionIdsStatement(
  database: D1Database,
  userKey: string,
  questionIds: readonly number[],
) {
  return database.prepare(`
    SELECT DISTINCT item.question_id AS questionId
    FROM exam_session_items item
    JOIN exam_sessions session ON session.id = item.session_id
    WHERE session.user_key = ?
      AND session.status != 'submitted'
      AND item.question_id IN (
        SELECT CAST(value AS INTEGER)
        FROM json_each(?)
        WHERE type = 'integer'
      )
  `).bind(userKey, encodeD1IntegerList(questionIds));
}
