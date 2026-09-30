import {
  CONTENT_SCOPE_COURSES,
  COURSE_FIELD_DEFINITIONS,
  COURSE_CONTENT_SCOPE_ROWS,
  COURSE_DEFINITIONS as REGISTERED_COURSE_DEFINITIONS,
  COURSE_SUBJECT_ROWS,
  contentScopeAllowsRegisteredSubjectId,
  contentScopeAllowsRegisteredSubject,
  DEFAULT_REGISTERED_EXAM_TYPE,
  EXAM_TYPE_SUBJECT_IDS,
  EXAM_TYPE_SUBJECTS,
  normalizeRegisteredSubjectId,
  REGISTERED_CONTENT_SCOPES,
  REGISTERED_EXAM_TYPES,
  REGISTERED_SUBJECT_IDS,
  REGISTERED_SUBJECTS,
  registeredSubjectName,
  SUBJECT_DEFINITIONS,
} from "./course-contract.mjs";
import {
  COURSE_CONTENT_RELEASE_VERSION,
  courseReleaseDefinition,
  courseReleaseIsReady,
} from "./course-release-contract.mjs";

export const SUBJECTS = REGISTERED_SUBJECTS;
export const SUBJECT_IDS = REGISTERED_SUBJECT_IDS;
export {
  COURSE_FIELD_DEFINITIONS,
  COURSE_CONTENT_SCOPE_ROWS,
  COURSE_SUBJECT_ROWS,
  SUBJECT_DEFINITIONS,
};

export type Subject = (typeof SUBJECTS)[number];
export type SubjectId = (typeof SUBJECT_IDS)[number];

export type CourseSubject = {
  id: SubjectId;
  name: Subject;
  aliases: readonly string[];
};

export type CourseContentKind = "theory" | "question" | "mock-exam";

export type CourseFieldDefinition = (typeof COURSE_FIELD_DEFINITIONS)[number];
export type CourseFieldId = CourseFieldDefinition["id"];

export type ExamPolicyDefinition = {
  policyVersion: string;
  title: string;
  durationMinutes: number;
  objectiveCounts: Partial<Record<Subject, number>>;
  descriptiveCount: number;
  objectivePoint: number;
  descriptivePoint: number;
  totalQuestions: number;
  totalPoints: number;
  passingScore: number;
  subjectMinimumRate: number;
  practicalMinimumRate: number;
  resultDecimals: number;
};

type CourseDefinitionShape = {
  examType: string;
  fieldId: string;
  courseId: string;
  name: string;
  releaseStage: "intake" | "released";
  summary: string;
  studyMode: string;
  mockExam: string;
  subjects: readonly CourseSubject[];
  releasedSubjects: readonly CourseSubject[];
  contentKinds: readonly CourseContentKind[];
  questionSubjects: readonly CourseSubject[];
  acceptedContentScopes: readonly string[];
  descriptiveSubjects: readonly Subject[];
  examPolicy: ExamPolicyDefinition | null;
};

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

export const COURSE_DEFINITIONS = (
  REGISTERED_COURSE_DEFINITIONS satisfies readonly CourseDefinitionShape[]
);

export type ExamType = (typeof COURSE_DEFINITIONS)[number]["examType"];
export type ExamScope = (typeof REGISTERED_CONTENT_SCOPES)[number];
export type SharedContentScope = Exclude<ExamScope, ExamType>;
export type CourseDefinition = (typeof COURSE_DEFINITIONS)[number];
export type ExamConfig = ExamPolicyDefinition & { examType: ExamType };

export const DEFAULT_EXAM_TYPE = DEFAULT_REGISTERED_EXAM_TYPE satisfies ExamType;
export const EXAM_TYPES = Object.freeze(
  COURSE_DEFINITIONS.map((course) => course.examType),
) as readonly ExamType[];
export const RELEASED_EXAM_TYPES = Object.freeze(
  EXAM_TYPES.filter((examType) => courseReleaseIsReady(examType)),
) as readonly ExamType[];
export const EXAM_SCOPES = REGISTERED_CONTENT_SCOPES as readonly ExamScope[];
export { COURSE_CONTENT_RELEASE_VERSION };

export const COURSE_REGISTRY = Object.freeze(Object.fromEntries(
  COURSE_DEFINITIONS.map((course) => [course.examType, course]),
)) as unknown as Readonly<Record<ExamType, CourseDefinition>>;

export const EXAM_CONFIGS = deepFreeze(Object.fromEntries(
  COURSE_DEFINITIONS.map((course) => [
    course.examType,
    course.examPolicy ? { examType: course.examType, ...course.examPolicy } : null,
  ]),
)) as unknown as Readonly<{
  [T in ExamType]: Extract<CourseDefinition, { examType: T }>["examPolicy"] extends null ? null : ExamConfig;
}>;

export function isExamType(value: unknown): value is ExamType {
  return typeof value === "string"
    && Object.prototype.hasOwnProperty.call(COURSE_REGISTRY, value);
}

export function isReleasedExamType(value: unknown): value is ExamType {
  return isExamType(value) && courseReleaseIsReady(value);
}

export function courseContentRelease(examType: ExamType) {
  return courseReleaseDefinition(examType);
}

export function isExamScope(value: unknown): value is ExamScope {
  return typeof value === "string" && EXAM_SCOPES.includes(value as ExamScope);
}

export function isSubject(value: unknown): value is Subject {
  return typeof value === "string" && SUBJECTS.includes(value as Subject);
}

export function isSubjectId(value: unknown): value is SubjectId {
  return typeof value === "string" && SUBJECT_IDS.includes(value as SubjectId);
}

export function subjectId(value: unknown): SubjectId | null {
  const normalized = normalizeRegisteredSubjectId(value);
  return isSubjectId(normalized) ? normalized : null;
}

export function subjectName(value: unknown): Subject | null {
  const normalized = registeredSubjectName(value);
  return isSubject(normalized) ? normalized : null;
}

export function courseDefinition(examType: ExamType) {
  return COURSE_REGISTRY[examType];
}

export function examDisplayName(examType: ExamType) {
  return courseDefinition(examType).name;
}

export function acceptedContentScopes(examType: ExamType): readonly ExamScope[] {
  return courseDefinition(examType).acceptedContentScopes as readonly ExamScope[];
}

export function courseSubjects(examType: ExamType): readonly CourseSubject[] {
  return courseDefinition(examType).subjects;
}

export function releasedCourseSubjects(examType: ExamType): readonly CourseSubject[] {
  return courseDefinition(examType).releasedSubjects;
}

export function courseContentKinds(examType: ExamType): readonly CourseContentKind[] {
  return courseDefinition(examType).contentKinds;
}

export function courseQuestionSubjects(examType: ExamType): readonly CourseSubject[] {
  return courseDefinition(examType).questionSubjects;
}

export function examTypesForField(fieldId: CourseFieldId): ExamType[] {
  return COURSE_DEFINITIONS
    .filter((course) => course.fieldId === fieldId)
    .map((course) => course.examType);
}

export function contentScopesForField(fieldId: CourseFieldId): ExamScope[] {
  const fieldExamTypes = new Set(examTypesForField(fieldId));
  return EXAM_SCOPES.filter((scope) => {
    const scopeExamTypes = examTypesForContentScope(scope);
    return scopeExamTypes.length > 0
      && scopeExamTypes.every((examType) => fieldExamTypes.has(examType));
  });
}

export function subjectsForField(fieldId: CourseFieldId): Subject[] {
  return [...new Set(
    COURSE_DEFINITIONS
      .filter((course) => course.fieldId === fieldId)
      .flatMap((course) => course.subjects.map((subject) => subject.name)),
  )];
}

export function courseSubjectIds(examType: ExamType): readonly SubjectId[] {
  return courseDefinition(examType).subjects.map((subject) => subject.id);
}

export function descriptiveSubjects(examType: ExamType): readonly Subject[] {
  return courseDefinition(examType).descriptiveSubjects;
}

export function hasDescriptiveQuestions(examType: ExamType) {
  return descriptiveSubjects(examType).length > 0;
}

export function descriptiveExamTypesForSubject(subject: string): ExamType[] {
  return EXAM_TYPES.filter((examType) => (
    descriptiveSubjects(examType).includes(subject as Subject)
  ));
}

export function descriptiveExamTypeForSubject(subject: string): ExamType | null {
  const matches = descriptiveExamTypesForSubject(subject);
  return matches.length === 1 ? matches[0] : null;
}

export function examTypesForContentScope(scope: string): ExamType[] {
  const configured = (CONTENT_SCOPE_COURSES as Readonly<Record<string, readonly string[]>>)[scope] ?? [];
  return configured.filter(isExamType);
}

export function contentScopeAllowsSubject(scope: string, subject: string): boolean {
  return contentScopeAllowsRegisteredSubject(scope, subject);
}

export function contentScopeAllowsSubjectId(scope: string, subject: unknown): boolean {
  return contentScopeAllowsRegisteredSubjectId(scope, subject);
}

export function examScopesCompatible(questionScope: string, theoryScope: string) {
  const questionCourses = examTypesForContentScope(questionScope);
  return questionCourses.length > 0
    && questionCourses.every((examType) => acceptedContentScopes(examType).includes(theoryScope as ExamScope));
}

export function examScopeDisplayLabel(scope: ExamScope) {
  if (isExamType(scope)) return `${examDisplayName(scope)} 전용`;
  const sharedCourses = examTypesForContentScope(scope).map(examDisplayName);
  return `${sharedCourses.join("·")} 공통`;
}

export const EXAM_SCOPE_OPTIONS = deepFreeze([
  ...EXAM_SCOPES.filter((value) => !isExamType(value)).map((value) => ({
    value,
    label: examScopeDisplayLabel(value),
  })),
  ...EXAM_TYPES.map((value) => ({ value, label: examScopeDisplayLabel(value) })),
]);

export function examScopeOptionsForCourse(examType: ExamType) {
  const scopes = new Set(acceptedContentScopes(examType));
  return EXAM_SCOPE_OPTIONS.filter((option) => scopes.has(option.value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parsedPolicy(value: unknown) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export function resolvedExamConfig(examType: ExamType, snapshot: unknown): ExamConfig {
  const configured = EXAM_CONFIGS[examType];
  if (!configured) throw new Error("모의고사 기준을 준비하고 있는 과정입니다.");
  const candidate = parsedPolicy(snapshot);
  if (!isRecord(candidate) || candidate.examType !== examType) return configured;
  const objectiveCounts = candidate.objectiveCounts;
  if (!isRecord(objectiveCounts)) return configured;
  const counts = Object.values(objectiveCounts).map(Number);
  const descriptiveCount = Number(candidate.descriptiveCount);
  const objectivePoint = Number(candidate.objectivePoint);
  const descriptivePoint = Number(candidate.descriptivePoint);
  const totalQuestions = Number(candidate.totalQuestions);
  const totalPoints = Number(candidate.totalPoints);
  const numeric = [
    candidate.durationMinutes,
    descriptiveCount,
    objectivePoint,
    descriptivePoint,
    totalQuestions,
    totalPoints,
    candidate.passingScore,
    candidate.subjectMinimumRate,
    candidate.practicalMinimumRate,
    candidate.resultDecimals,
    ...counts,
  ].map(Number);
  const objectiveCount = counts.reduce((total, count) => total + count, 0);
  const computedPoints = objectiveCount * objectivePoint + descriptiveCount * descriptivePoint;
  if (
    typeof candidate.policyVersion !== "string"
    || !candidate.policyVersion.trim()
    || typeof candidate.title !== "string"
    || counts.length === 0
    || numeric.some((value) => !Number.isFinite(value) || value < 0)
    || objectiveCount + descriptiveCount !== totalQuestions
    || Math.abs(computedPoints - totalPoints) > 0.0001
  ) return configured;
  return candidate as ExamConfig;
}

if (
  EXAM_TYPES.join("|") !== REGISTERED_EXAM_TYPES.join("|")
  || SUBJECTS.join("|") !== REGISTERED_SUBJECTS.join("|")
  || EXAM_TYPES.some((examType) => (
    courseDefinition(examType).subjects.map((subject) => subject.name).join("|")
      !== EXAM_TYPE_SUBJECTS[examType].join("|")
    || courseDefinition(examType).subjects.map((subject) => subject.id).join("|")
      !== EXAM_TYPE_SUBJECT_IDS[examType].join("|")
  ))
) {
  throw new Error("자격증 레지스트리와 콘텐츠 계약이 일치하지 않습니다.");
}

if (!isReleasedExamType(DEFAULT_EXAM_TYPE)) {
  throw new Error("기본 자격증 과정에는 검증된 콘텐츠 릴리스가 필요합니다.");
}
