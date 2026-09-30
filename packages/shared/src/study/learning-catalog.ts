import {
  COURSE_FIELD_DEFINITIONS,
  COURSE_DEFINITIONS,
  examDisplayName,
  isReleasedExamType,
  type ExamType,
  type Subject,
} from "./course-registry";
import {
  learningEngineForField,
  type LearningEngineId,
} from "./learning-engine";
import {
  SW_CURRICULUM_SUMMARY_RECOMMENDATIONS,
  SW_CURRICULUM_SUMMARY_SUBJECT_GROUPS,
  SW_CURRICULUM_SUMMARY_SUBJECT_IDS,
} from "./sw-curriculum-summary.mjs";

export type LearningContentKind = "theory" | "question" | "mock-exam";

export type LearningSubject = {
  id: string;
  name: Subject;
  unitField: "topic";
  contentKinds: LearningContentKind[];
};

export type LearningCourse = {
  id: string;
  fieldId: string;
  examType: ExamType;
  name: string;
  summary: string;
  studyMode: string;
  mockExam: string;
  contentKinds: LearningContentKind[];
  subjects: LearningSubject[];
};

export type PlannedLearningSubject = {
  id: string;
  name: string;
  summary: string;
  topics: readonly string[];
};

export type PlannedSubjectGroup = {
  id: string;
  name: string;
  summary: string;
  subjects: readonly PlannedLearningSubject[];
};

export type PlannedSubjectRecommendation = {
  id: string;
  name: string;
  summary: string;
  subjectIds: readonly string[];
  questionProfileId?: string;
};

export type LearningField = {
  id: string;
  engineId: LearningEngineId;
  name: string;
  shortLabel: string;
  brandSubtitleLines?: readonly [string, string];
  analyticsScope?: "SW";
  cardTitle: string;
  summary: string;
  status: "available" | "content-ready";
  courses: LearningCourse[];
  subjectGroups?: readonly PlannedSubjectGroup[];
  recommendedCombinations?: readonly PlannedSubjectRecommendation[];
};

export type UpcomingLearningField = {
  id: string;
  name: string;
  summary: string;
  status: "coming-soon";
};

function registeredCourses(fieldId: string): LearningCourse[] {
  return COURSE_DEFINITIONS
    .filter((course) => (
      course.fieldId === fieldId && isReleasedExamType(course.examType)
    ))
    .map((course) => ({
      id: course.courseId,
      fieldId: course.fieldId,
      examType: course.examType,
      name: course.name,
      summary: course.summary,
      studyMode: course.studyMode,
      mockExam: course.mockExam,
      contentKinds: [...course.contentKinds] as LearningContentKind[],
      subjects: course.releasedSubjects.map((subject) => ({
        ...subject,
        unitField: "topic" as const,
        contentKinds: course.contentKinds.filter((kind) => (
          kind !== "question"
          || course.questionSubjects.some((candidate) => candidate.id === subject.id)
        )) as LearningContentKind[],
      })),
    }));
}

export const SW_MAJOR_SUBJECT_GROUPS = SW_CURRICULUM_SUMMARY_SUBJECT_GROUPS satisfies readonly PlannedSubjectGroup[];
export const SW_MAJOR_SUBJECT_IDS = SW_CURRICULUM_SUMMARY_SUBJECT_IDS;
export const SW_MAJOR_RECOMMENDED_COMBINATIONS = SW_CURRICULUM_SUMMARY_RECOMMENDATIONS satisfies readonly PlannedSubjectRecommendation[];

function registeredCertificationFields(): LearningField[] {
  return COURSE_FIELD_DEFINITIONS.flatMap((field) => {
    const courses = registeredCourses(field.id);
    return courses.length ? [{
      ...field,
      engineId: "certification",
      courses,
    }] : [];
  });
}

export const LEARNING_CATALOG: LearningField[] = [
  ...registeredCertificationFields(),
  {
    id: "software-major",
    engineId: "curriculum",
    name: "SW 전공",
    shortLabel: "SW",
    analyticsScope: "SW",
    cardTitle: "SW 전공 필기",
    summary: "공기업·금융권·IT 기업 전공 필기에 필요한 과목을 골라 이론, 문제 풀이와 모의고사로 학습합니다.",
    status: "content-ready",
    courses: [],
    subjectGroups: SW_MAJOR_SUBJECT_GROUPS,
    recommendedCombinations: SW_MAJOR_RECOMMENDED_COMBINATIONS,
  },
];

// Preserve common course entry URLs without introducing another page variant.
export function canonicalLearningEntry(pathname: string): string | null {
  if (pathname === "/learn/software-major/home") return "/learn/software-major";
  for (const field of LEARNING_CATALOG) {
    for (const course of field.courses) {
      const root = `/learn/${field.id}/${course.id}`;
      if (pathname === root) return `${root}/home`;
    }
  }
  return null;
}

export const UPCOMING_LEARNING_FIELDS: UpcomingLearningField[] = [
  {
    id: "certifications",
    name: "다른 자격증",
    summary: "새로운 자격증 학습 과정을 준비하고 있습니다.",
    status: "coming-soon",
  },
];

export const CONTENT_CATALOG_META = Object.freeze({
  reviewedAt: "2026-07-31",
  scopeLabel: "SQLD·SQLP 출제 범위",
});

export type LearningFieldSection = "home" | "theories" | "practice" | "mock-exams";

export type LearningRoute =
  | { fieldId: string; page: "field"; section?: LearningFieldSection; theoryId?: number; activeMock?: boolean }
  | { examType: ExamType; page: "home" }
  | { examType: ExamType; page: "practice" }
  | { examType: ExamType; page: "question"; id: number }
  | { examType: ExamType; page: "theories" }
  | { examType: ExamType; page: "theory"; id: number }
  | { examType: ExamType; page: "mock-exams" }
  | { examType: ExamType; page: "mock-exam"; id: string }
  | { examType: ExamType; page: "bookmarks" }
  | { examType: ExamType; page: "incorrect" }
  | { examType: ExamType; page: "records" };

const THEORY_PUBLIC_ID_OFFSET = 104_729;

export function theoryPublicId(id: number) {
  return `lesson-${(id + THEORY_PUBLIC_ID_OFFSET).toString(36)}`;
}

export function theoryIdFromPublicId(value: string) {
  const match = /^lesson-([0-9a-z]+)$/u.exec(value.toLowerCase());
  if (!match) return null;
  const id = Number.parseInt(match[1], 36) - THEORY_PUBLIC_ID_OFFSET;
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function learningField(fieldId: string) {
  return LEARNING_CATALOG.find((field) => field.id === fieldId) ?? null;
}

export function learningFieldEngine(field: LearningField) {
  return learningEngineForField(field);
}

export function learningFieldUsesSectionRoutes(
  field: LearningField | null | undefined,
) {
  return Boolean(field && learningFieldEngine(field).routeModel === "field-sections");
}

export function learningFieldForCourse(examType: ExamType) {
  return LEARNING_CATALOG.find((field) => (
    field.courses.some((course) => course.examType === examType)
  )) ?? null;
}

export function learningCourse(examType: ExamType) {
  const course = LEARNING_CATALOG
    .flatMap((field) => field.courses)
    .find((item) => item.examType === examType);
  if (!course) throw new Error(`등록되지 않은 학습 과정입니다: ${examType}`);
  return course;
}

export function learningPath(route: LearningRoute) {
  if (route.page === "field") {
    const base = `/learn/${route.fieldId}`;
    if (!route.section || route.section === "home") return base;
    if (route.section === "mock-exams" && route.activeMock) return `${base}/mock-exams/active`;
    if (route.section === "theories" && route.theoryId) {
      return `${base}/theories/${theoryPublicId(route.theoryId)}`;
    }
    return `${base}/${route.section}`;
  }
  const field = learningFieldForCourse(route.examType);
  const course = learningCourse(route.examType);
  if (!field) throw new Error(`학습 분야를 찾을 수 없습니다: ${route.examType}`);
  const base = `/learn/${field.id}/${course.id}`;
  if (route.page === "home") return `${base}/home`;
  if (route.page === "practice") return `${base}/practice`;
  if (route.page === "question") return `${base}/questions/${route.id}`;
  if (route.page === "theories") return `${base}/theories`;
  if (route.page === "theory") return `${base}/theories/${theoryPublicId(route.id)}`;
  if (route.page === "mock-exams") return `${base}/mock-exams`;
  if (route.page === "mock-exam") return `${base}/mock-exams/active`;
  if (route.page === "bookmarks") return `${base}/records/bookmarks`;
  if (route.page === "incorrect") return `${base}/records/incorrect`;
  return `${base}/records`;
}

export function parseLearningPath(pathname: string): LearningRoute | null {
  const segments = pathname.split("/").filter(Boolean);
  if (
    segments.length === 2
    && segments[0] === "learn"
    && LEARNING_CATALOG.some((field) => field.id === segments[1])
  ) {
    return { fieldId: segments[1], page: "field" };
  }
  if (
    segments.length === 4
    && segments[0] === "learn"
    && learningFieldUsesSectionRoutes(learningField(segments[1]))
    && segments[2] === "mock-exams"
    && segments[3] === "active"
  ) {
    return { fieldId: segments[1], page: "field", section: "mock-exams", activeMock: true };
  }
  if (
    segments.length === 3
    && segments[0] === "learn"
    && learningFieldUsesSectionRoutes(learningField(segments[1]))
    && ["theories", "practice", "mock-exams"].includes(segments[2])
  ) {
    return {
      fieldId: segments[1],
      page: "field",
      section: segments[2] as Exclude<LearningFieldSection, "home">,
    };
  }
  if (
    segments.length === 4
    && segments[0] === "learn"
    && learningFieldUsesSectionRoutes(learningField(segments[1]))
    && segments[2] === "theories"
  ) {
    const theoryId = theoryIdFromPublicId(segments[3]);
    if (!theoryId) return null;
    return {
      fieldId: segments[1],
      page: "field",
      section: "theories",
      theoryId,
    };
  }
  if (segments.length < 4 || segments[0] !== "learn") {
    return null;
  }
  const field = learningField(segments[1]);
  const course = field?.courses.find((item) => item.id === segments[2]);
  if (!course) return null;
  const examType = course.examType;

  const page = segments[3];
  if (["practice", "questions", "records", "bookmarks"].includes(page) && !course.contentKinds.includes("question")) return null;
  if (page === "mock-exams" && !course.contentKinds.includes("mock-exam")) return null;
  if (page === "theories" && !course.contentKinds.includes("theory")) return null;
  if (page === "home" && segments.length === 4) return { examType, page: "home" };
  if (page === "practice" && segments.length === 4) return { examType, page: "practice" };
  if (page === "questions" && segments.length === 5) {
    const id = Number(segments[4]);
    return Number.isInteger(id) && id > 0 ? { examType, page: "question", id } : null;
  }
  if (page === "theories" && segments.length === 4) return { examType, page: "theories" };
  if (page === "theories" && segments.length === 5) {
    const id = theoryIdFromPublicId(segments[4]) ?? Number(segments[4]);
    return Number.isInteger(id) && id > 0 ? { examType, page: "theory", id } : null;
  }
  if (page === "mock-exams" && segments.length === 4) return { examType, page: "mock-exams" };
  if (page === "mock-exams" && segments.length === 5 && segments[4]) {
    return { examType, page: "mock-exam", id: decodeURIComponent(segments[4]) };
  }
  if (page === "bookmarks" && segments.length === 4) return { examType, page: "bookmarks" };
  if (page === "records" && segments.length === 5 && segments[4] === "bookmarks") {
    return { examType, page: "bookmarks" };
  }
  if (page === "records" && segments.length === 5 && segments[4] === "incorrect") {
    return { examType, page: "incorrect" };
  }
  if (page === "records" && segments.length === 4) return { examType, page: "records" };
  return null;
}

export function learningPageMeta(route: LearningRoute | null) {
  if (!route) {
    return {
      title: "학습 분야 | 모두의 문제집",
      description: "원하는 학습 분야를 선택해 이론부터 문제 풀이와 모의고사까지 학습하세요.",
    };
  }
  if (route.page === "field") {
    const field = LEARNING_CATALOG.find((item) => item.id === route.fieldId);
    if (field && learningFieldUsesSectionRoutes(field)) {
      if (route.section === "theories") {
        return {
          title: `${field.name} 이론 학습 | 모두의 문제집`,
          description: `선택한 ${field.name} 소주제의 핵심 이론을 학습하세요.`,
        };
      }
      if (route.section === "practice") {
        return {
          title: `${field.name} 문제 풀이 | 모두의 문제집`,
          description: `선택한 ${field.name} 소주제의 객관식 문제를 풀고 해설을 확인하세요.`,
        };
      }
      if (route.section === "mock-exams") {
        return {
          title: `${field.name} 모의고사 | 모두의 문제집`,
          description: `선택한 ${field.name} 범위와 문항 수로 모의고사를 구성하세요.`,
        };
      }
      return {
        title: `${field.name} 학습 범위 | 모두의 문제집`,
        description: `${field.name} 전공 필기의 대주제와 소주제를 조합해 학습 범위를 만드세요.`,
      };
    }
    return {
      title: `${field?.name ?? "학습"} 학습 과정 | 모두의 문제집`,
      description: `${field?.name ?? "학습"} 분야에서 학습할 과정이나 자격증을 선택하세요.`,
    };
  }
  const examName = examDisplayName(route.examType);
  if (route.page === "home") {
    return {
      title: `${examName} 학습 홈 | 모두의 문제집`,
      description: `${examName} 과정의 이론, 문제 풀이, 모의고사와 학습 기록을 확인하세요.`,
    };
  }
  if (route.page === "practice" || route.page === "question") {
    return {
      title: `${examName} 문제 풀이 | 모두의 문제집`,
      description: `${examName} 과목과 단원에 맞춘 문제를 풀고 해설을 확인하세요.`,
    };
  }
  if (route.page === "theories" || route.page === "theory") {
    return {
      title: `${examName} 이론 학습 | 모두의 문제집`,
      description: `${examName} 시험 범위의 이론과 예제를 과목·단원 순서로 학습하세요.`,
    };
  }
  if (route.page === "mock-exams" || route.page === "mock-exam") {
    return {
      title: `${examName} 모의고사 | 모두의 문제집`,
      description: `${examName} 시험 구성에 맞춘 모의고사를 응시하고 결과를 확인하세요.`,
    };
  }
  return {
    title: "학습 기록 | 모두의 문제집",
    description: `${examName} 문제 풀이 기록, 오답 문제, 북마크와 모의고사 결과를 확인하세요.`,
  };
}

export function learningLocation(
  examType: ExamType,
  subject: string,
  unit: string,
) {
  const course = learningCourse(examType);
  const field = learningFieldForCourse(examType);
  return {
    field: field ? { id: field.id, name: field.name } : null,
    course: { id: course.id, name: course.name },
    subject: course.subjects.find((item) => item.name === subject) ?? null,
    unit: unit.trim() || null,
  };
}
