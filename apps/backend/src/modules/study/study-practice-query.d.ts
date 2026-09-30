export type StudyPracticeQueryInput = {
  selectedExam: import("./domain/study.domain").ExamType;
  eligibility: import("./study-course-policy-query").CourseQuestionEligibility;
  category: string;
  difficulty: string;
  kind: string;
  theoryId: number;
  bookmarkUserKey?: string;
  excludedIds: number[];
  excludedVariantGroupIds: string[];
  limit: number;
  /** Test-only deterministic enumeration hook. Production callers must omit it. */
  selectionOffset?: number;
};

export function buildStudyPracticeQuery(input: StudyPracticeQueryInput): {
  sql: string;
  values: Array<string | number>;
};
