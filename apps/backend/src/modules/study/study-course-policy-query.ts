import { learnerQuestionSql } from "./study-content-visibility";
import {
  acceptedContentScopes,
  descriptiveSubjects,
  type ExamType,
} from "./domain/study.domain";

export type CourseQuestionEligibility = {
  sql: string;
  values: string[];
};

export function courseQuestionEligibility(
  examType: ExamType,
  alias = "",
): CourseQuestionEligibility {
  const prefix = alias ? `${alias}.` : "";
  const scopes = acceptedContentScopes(examType);
  const descriptive = descriptiveSubjects(examType);
  const scopePlaceholders = scopes.map(() => "?").join(", ");
  const values: string[] = [...scopes];
  let kindClause = `${prefix}kind IN ('single', 'multiple')`;
  if (descriptive.length > 0) {
    const subjectPlaceholders = descriptive.map(() => "?").join(", ");
    kindClause = `(${kindClause} OR (${prefix}kind = 'descriptive' AND ${prefix}category IN (${subjectPlaceholders})))`;
    values.push(...descriptive);
  }
  return {
    sql: `${prefix}exam_scope IN (${scopePlaceholders}) AND ${kindClause} AND ${learnerQuestionSql(alias)}`,
    values,
  };
}
