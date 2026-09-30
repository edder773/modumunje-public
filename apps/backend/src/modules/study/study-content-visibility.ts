import { PRACTICAL_PAST_EXAMS_PUBLISHED, PRACTICAL_PAST_RANGE } from "@shared/study/ipe-practical-past.mjs";

// SQL identifiers here are repository-owned literals, never request input.
export function learnerQuestionSql(alias = "", column = "id") {
  const prefix = alias ? `${alias}.` : "";
  return PRACTICAL_PAST_EXAMS_PUBLISHED ? "1 = 1"
    : `${prefix}${column} NOT BETWEEN ${PRACTICAL_PAST_RANGE.firstId} AND ${PRACTICAL_PAST_RANGE.lastId}`;
}

export function learnerSessionSql(alias = "exam_sessions") {
  return PRACTICAL_PAST_EXAMS_PUBLISHED ? "1 = 1"
    : `NOT EXISTS (SELECT 1 FROM json_each(${alias}.question_ids) AS hidden_question
        WHERE CAST(hidden_question.value AS INTEGER) BETWEEN ${PRACTICAL_PAST_RANGE.firstId} AND ${PRACTICAL_PAST_RANGE.lastId})`;
}
