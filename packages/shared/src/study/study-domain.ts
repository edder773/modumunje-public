import {
  acceptedContentScopes,
  descriptiveSubjects,
  examScopeDisplayLabel,
  isReleasedExamType,
  type ExamScope,
  type ExamType,
} from "./course-registry";

export {
  acceptedContentScopes,
  COURSE_DEFINITIONS,
  COURSE_FIELD_DEFINITIONS,
  COURSE_CONTENT_RELEASE_VERSION,
  COURSE_REGISTRY,
  contentScopeAllowsSubject,
  contentScopesForField,
  courseContentRelease,
  courseContentKinds,
  courseQuestionSubjects,
  courseDefinition,
  courseSubjects,
  DEFAULT_EXAM_TYPE,
  descriptiveExamTypesForSubject,
  descriptiveExamTypeForSubject,
  descriptiveSubjects,
  examDisplayName,
  examTypesForField,
  examScopeOptionsForCourse,
  examScopesCompatible,
  examTypesForContentScope,
  EXAM_CONFIGS,
  EXAM_SCOPE_OPTIONS,
  EXAM_SCOPES,
  EXAM_TYPES,
  hasDescriptiveQuestions,
  isExamScope,
  isExamType,
  isReleasedExamType,
  isSubject,
  RELEASED_EXAM_TYPES,
  releasedCourseSubjects,
  resolvedExamConfig,
  SUBJECTS,
  subjectsForField,
} from "./course-registry";
export type {
  CourseDefinition,
  CourseContentKind,
  CourseFieldDefinition,
  CourseFieldId,
  CourseSubject,
  ExamConfig,
  ExamScope,
  ExamType,
  SharedContentScope,
  Subject,
} from "./course-registry";

export type QuestionKind = "single" | "multiple" | "descriptive";
export type PracticeKind = "objective" | "descriptive" | "mixed";
export type EvaluationVerdict = "correct" | "partial" | "incorrect";

export type DescriptiveEvaluation = {
  id?: number;
  result: EvaluationVerdict;
  score: number;
  feedback: string;
  modelAnswer: string;
  detailedExplanation: string;
  provider: "exact" | "openai" | "rubric" | "self";
  cached?: boolean;
  answerParts?: Array<{ label: string; correct: boolean }>;
};

export type ExamQuestionResult = {
  questionId: number;
  position: number;
  category: string;
  kind: QuestionKind;
  result: EvaluationVerdict | "unanswered";
  score: number | null;
  convertedScore: number;
  selectedAnswers: number[];
  correctAnswers: number[];
  choices?: string[];
  answerText: string;
};

export type ExamResultBreakdown = Record<
  string,
  {
    total: number;
    correct: number;
  }
>;

export type PastExamForm = { id: string; year: number; round: number; title: string };

export type ExamResult = {
  examForm?: PastExamForm;
  examType: ExamType;
  objectiveScore: number;
  descriptiveScore: number;
  totalScore: number;
  correctCount: number;
  incorrectCount: number;
  partialCount?: number;
  unansweredCount: number;
  subjectScores: Record<
    string,
    {
      earned: number;
      possible: number;
      rate: number;
      failedMinimum: boolean;
    }
  >;
  practicalEvaluations: Record<string, DescriptiveEvaluation>;
  questionResults: ExamQuestionResult[];
  breakdowns?: {
    topics: ExamResultBreakdown;
    difficulties: ExamResultBreakdown;
  };
  passed: boolean;
  failedMinimum: boolean;
  autoSubmitted?: boolean;
  submittedAt: string;
};

export function examScopeAllows(scope: string, examType: ExamType) {
  return acceptedContentScopes(examType).includes(scope as ExamScope);
}

export function isObjectiveKind(kind: string) {
  return kind === "single" || kind === "multiple";
}

export function isDescriptiveAllowed(examType: string, category: string) {
  return isReleasedExamType(examType)
    && descriptiveSubjects(examType).includes(category as never);
}

export function questionAllowedForExam(
  question: { active?: boolean; examScope: string; category: string; kind: string },
  examType: ExamType,
) {
  return question.active !== false
    && examScopeAllows(question.examScope, examType)
    && (isObjectiveKind(question.kind) || isDescriptiveAllowed(examType, question.category));
}

export function questionKindLabel(kind: QuestionKind) {
  if (kind === "multiple") return "복수정답";
  if (kind === "descriptive") return "서술형";
  return "단일정답";
}

export function examScopeLabel(scope: ExamScope) {
  return examScopeDisplayLabel(scope);
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return (value as T) ?? fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function uniqueStrings(value: unknown): string[] {
  const source = Array.isArray(value) ? value : parseJson<unknown[]>(value, []);
  return [...new Set(source.map(String).map((item) => item.trim()).filter(Boolean))];
}
