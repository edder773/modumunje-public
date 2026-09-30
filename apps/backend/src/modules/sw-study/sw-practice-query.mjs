// @ts-check
import { encodeD1TextList } from "../../common/database/d1-query-bindings.mjs";

/**
 * @param {{subjects: string[], theoryId?: number, excludedIds: string[],
 * requiredTag?: string | null, profileOrder: boolean, profilePhases: string[], limit: number}} input
 */
export function buildSwPracticeQuery(input) {
  const clauses = [`subject_id IN (${input.subjects.map(() => "?").join(",")})`];
  /** @type {(string | number)[]} */
  const values = [...input.subjects];
  if (typeof input.theoryId === "number" && Number.isInteger(input.theoryId) && input.theoryId > 0) {
    clauses.push("theory_id = ?");
    values.push(input.theoryId);
  }
  if (input.excludedIds.length) {
    clauses.push(`id NOT IN (
      SELECT CAST(value AS TEXT)
      FROM json_each(?)
      WHERE type = 'text'
    )`);
    values.push(encodeD1TextList(input.excludedIds));
  }
  if (input.requiredTag) {
    clauses.push(`EXISTS (
      SELECT 1 FROM sw_question_tags
      WHERE sw_question_tags.question_id = sw_questions.id
        AND sw_question_tags.tag = ?
    )`);
    values.push(input.requiredTag);
  }
  const rotatedOrder = "CASE WHEN display_order >= request_seed.pivot THEN 0 ELSE 1 END, display_order, id";
  const profileOrder = input.profileOrder
    ? `ROW_NUMBER() OVER (
        PARTITION BY CASE
          ${input.profilePhases.map((_, index) => `WHEN EXISTS (
            SELECT 1 FROM sw_question_tags
            WHERE sw_question_tags.question_id = sw_questions.id
              AND sw_question_tags.tag = ?
          ) THEN ${index + 1}`).join("\n")}
        END
        ORDER BY ${rotatedOrder}
      ), ${rotatedOrder}`
    : rotatedOrder;
  const orderValues = input.profileOrder ? input.profilePhases : [];
  return {
    sql: `
      WITH request_seed AS (
        SELECT 1 + ABS(RANDOM() % COALESCE(NULLIF(MAX(display_order), 0), 1)) AS pivot
        FROM sw_questions INDEXED BY sw_questions_active_display_order_idx
        WHERE active = 1
      )
      SELECT id, theory_id, subject_group_id, subject_id, category, topic,
        display_order, difficulty, difficulty_rationale, kind, prompt, choices,
        tags
      FROM sw_questions INDEXED BY sw_questions_active_subject_order_v2_idx
      CROSS JOIN request_seed
      WHERE active = 1 AND ${clauses.join(" AND ")}
      ORDER BY ${profileOrder}
      LIMIT ?
    `,
    values: [...values, ...orderValues, input.limit],
  };
}
