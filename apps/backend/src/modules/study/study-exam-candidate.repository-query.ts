import { courseQuestionEligibility } from "./study-course-policy-query";
import type { ExamType } from "./domain/study.domain";
import type { ExamCandidateMetadataRow } from "./study.repository";

export async function readExamCandidateMetadata(database: D1Database, selectedExam: ExamType) {
  const eligibility = courseQuestionEligibility(selectedExam);
  const rows = await database.prepare(`
    SELECT id, category, exam_scope AS examScope, kind,
      practice_scope AS practiceScope, variant_group_id AS variantGroupId, choices
    FROM questions
    WHERE active = 1 AND practice_scope = 'general' AND ${eligibility.sql}
      AND (
        kind = 'descriptive'
        OR (
          kind IN ('single', 'multiple')
          AND json_valid(choices) AND json_array_length(choices) >= 2
          AND json_valid(correct_answers) AND json_array_length(correct_answers) >= 1
          AND NOT EXISTS (
            SELECT 1 FROM json_each(correct_answers) answer
            WHERE answer.type != 'integer'
              OR answer.value < 0
              OR answer.value >= json_array_length(choices)
          )
        )
      )
    ORDER BY display_order, id
  `).bind(...eligibility.values).all<ExamCandidateMetadataRow>();
  return rows.results ?? [];
}
