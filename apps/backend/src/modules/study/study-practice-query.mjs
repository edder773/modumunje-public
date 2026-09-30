// @ts-check
import {
  encodeD1IntegerList,
  encodeD1TextList,
} from "../../common/database/d1-query-bindings.mjs";

/**
 * @param {{eligibility: {sql: string, values: (string | number)[]},
 * selectedExam?: string, theoryId?: number, category?: string, difficulty?: string, kind?: string,
 * excludedIds: number[], excludedVariantGroupIds: string[], bookmarkUserKey?: string | null,
 * selectionOffset?: number, limit: number}} input
 */
export function buildStudyPracticeQuery(input) {
  const clauses = ["q.active = 1"];
  const values = [];
  if (!input.eligibility?.sql || !input.eligibility.values?.length) {
    throw new Error("학습 과정에 허용된 콘텐츠 범위가 없습니다.");
  }
  clauses.push(`(${input.eligibility.sql})`);
  values.push(...input.eligibility.values);
  if (typeof input.theoryId === "number" && Number.isInteger(input.theoryId) && input.theoryId > 0) {
    clauses.push("q.theory_id = ?");
    values.push(input.theoryId);
  } else {
    clauses.push("q.practice_scope = 'general'");
    clauses.push("q.id NOT BETWEEN 88200001 AND 88200400");
  }
  if (input.category && input.category !== "전체 과목") {
    clauses.push("q.category = ?");
    values.push(input.category);
  }
  if (input.difficulty && input.difficulty !== "전체" && input.kind !== "descriptive") {
    clauses.push("q.difficulty = ?");
    values.push(input.difficulty);
  }
  if (input.kind === "descriptive") clauses.push("q.kind = 'descriptive'");
  else if (input.kind === "objective") clauses.push("q.kind IN ('single', 'multiple')");
  // Prefer unseen questions but retain recently seen ones as one-query filler.
  // The JSON list is bound once, before the remaining statement parameters.
  const excludedIdsCte = input.excludedIds.length
    ? `excluded_ids AS MATERIALIZED (
        SELECT CAST(value AS INTEGER) AS id FROM json_each(?) WHERE type = 'integer'
      ),`
    : "";
  const exclusionRank = input.excludedIds.length
    ? "CASE WHEN q.id IN (SELECT id FROM excluded_ids) THEN 1 ELSE 0 END"
    : "0";
  if (input.excludedVariantGroupIds.length) {
    clauses.push(`(
      q.variant_group_id IS NULL OR q.variant_group_id NOT IN (
        SELECT value
        FROM json_each(?)
        WHERE type = 'text'
      )
    )`);
    values.push(encodeD1TextList(input.excludedVariantGroupIds));
  }
  const bookmarkJoin = input.bookmarkUserKey
    ? "JOIN user_bookmarks b ON b.question_id = q.id AND b.user_key = ?"
    : "";
  if (input.bookmarkUserKey) values.unshift(input.bookmarkUserKey);
  const bookmarkProjection = input.bookmarkUserKey
    ? `EXISTS (
        SELECT 1 FROM user_bookmarks selected_bookmark
        WHERE selected_bookmark.question_id = q.id
          AND selected_bookmark.user_key = ?
      )`
    : "0";
  const deterministicOffset = typeof input.selectionOffset === "number" && Number.isSafeInteger(input.selectionOffset)
    && input.selectionOffset >= 0
    ? input.selectionOffset
    : undefined;
  const memberOrder = deterministicOffset === undefined
    ? "RANDOM()"
    : `(
        selected_group_members.member_index
        - ((selected_group_members.member_cycle + selected_group_members.group_index)
          % selected_group_members.member_count)
        + selected_group_members.member_count
      ) % selected_group_members.member_count`;
  const selectionCtes = deterministicOffset === undefined
    ? `randomized_groups AS (
        SELECT group_key, group_anchor, exclusion_rank, RANDOM() AS random_key
        FROM eligible_groups
        ORDER BY exclusion_rank, random_key, group_anchor
        LIMIT ?
      ), selected_groups AS (
        SELECT group_key, group_anchor AS group_index, 0 AS group_count, 0 AS member_cycle,
          ROW_NUMBER() OVER (ORDER BY exclusion_rank, random_key, group_anchor) - 1 AS selection_rank
        FROM randomized_groups
      )`
    : `ordered_groups AS (
        SELECT group_key, group_anchor, member_count, exclusion_rank,
          ROW_NUMBER() OVER (ORDER BY group_anchor, group_key) - 1 AS group_index
        FROM eligible_groups
      ), selection_seed AS (
        SELECT group_count,
          CASE WHEN group_count = 0 THEN 0 ELSE ? % group_count END AS group_offset,
          CAST(? / CASE WHEN group_count = 0 THEN 1 ELSE group_count END AS INTEGER) AS member_cycle
        FROM (SELECT COUNT(*) AS group_count FROM ordered_groups)
      ), rotated_groups AS (
        SELECT ordered_groups.*, selection_seed.group_count,
          selection_seed.member_cycle,
          (
            ordered_groups.group_index - selection_seed.group_offset
            + selection_seed.group_count
          ) % selection_seed.group_count AS selection_rank
        FROM ordered_groups
        CROSS JOIN selection_seed
      ), selected_groups AS (
        SELECT group_key, group_index, group_count, member_cycle,
          ROW_NUMBER() OVER (ORDER BY exclusion_rank, selection_rank) - 1 AS selection_rank
        FROM rotated_groups
        ORDER BY exclusion_rank, selection_rank
        LIMIT ?
      )`;
  const memberMetadata = deterministicOffset === undefined
    ? "0 AS member_index, 1 AS member_count"
    : `ROW_NUMBER() OVER (
        PARTITION BY candidate_members.group_key
        ORDER BY candidate_members.display_order, candidate_members.id
      ) - 1 AS member_index,
      COUNT(*) OVER (
        PARTITION BY candidate_members.group_key
      ) AS member_count`;
  return {
    sql: `
      WITH ${excludedIdsCte} candidate_members AS MATERIALIZED (
        SELECT q.id,
          COALESCE('variant:' || q.variant_group_id, 'question:' || q.id) AS group_key,
          q.display_order,
          ${exclusionRank} AS exclusion_rank
        FROM questions q
        ${bookmarkJoin}
        WHERE ${clauses.join(" AND ")}
      ), eligible_groups AS (
        SELECT group_key, MIN(id) AS group_anchor, COUNT(*) AS member_count,
          MIN(exclusion_rank) AS exclusion_rank
        FROM candidate_members
        GROUP BY group_key
      ), ${selectionCtes}, selected_group_members AS (
        SELECT candidate_members.id, candidate_members.group_key,
          candidate_members.exclusion_rank, selected_groups.selection_rank, selected_groups.group_index,
          selected_groups.group_count, selected_groups.member_cycle,
          ${memberMetadata}
        FROM selected_groups
        JOIN candidate_members
          ON candidate_members.group_key = selected_groups.group_key
      ), selected_member_candidates AS (
        SELECT selected_group_members.id, selected_group_members.selection_rank,
          ROW_NUMBER() OVER (
            PARTITION BY selected_group_members.group_key
            ORDER BY selected_group_members.exclusion_rank, ${memberOrder}, selected_group_members.id
          ) AS selected_member_rank
        FROM selected_group_members
      ), selected_candidates AS (
        SELECT id, selection_rank
        FROM selected_member_candidates
        WHERE selected_member_rank = 1
      )
      SELECT q.id, q.category, q.topic, q.display_order AS displayOrder,
        q.exam_scope AS examScope, q.difficulty,
        q.difficulty_rationale AS difficultyRationale, q.kind, q.prompt, q.choices,
        q.tags, q.theory_id AS theoryId,
        q.practice_scope AS practiceScope, q.variant_group_id AS variantGroupId,
        q.bookmarked, q.active, q.created_at AS createdAt, q.updated_at AS updatedAt,
        ${bookmarkProjection} AS selectedBookmarked
      FROM selected_candidates selected
      JOIN questions q ON q.id = selected.id
      ORDER BY selected.selection_rank, selected.id
    `,
    values: [
      ...(input.excludedIds.length ? [encodeD1IntegerList(input.excludedIds)] : []),
      ...values,
      ...(deterministicOffset === undefined
        ? []
        : [deterministicOffset, deterministicOffset]),
      input.limit,
      ...(input.bookmarkUserKey ? [input.bookmarkUserKey] : []),
    ],
  };
}
