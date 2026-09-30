import {
  EXAM_TYPES,
  examScopeAllows,
  questionAllowedForExam,
  type ExamType,
} from "./domain/study.domain";

export type CourseOverviewStats = {
  contentQuestionCount: number;
  contentExplainedQuestionCount: number;
  contentTheoryCount: number;
  objectiveAttemptCount: number;
  completedTheoryCount: number;
  bookmarkCount: number;
  streak: number;
  hasActiveMock: boolean;
  recentActivity: string;
  lastActivityAt: string;
  lastActivityKind: "" | "practice" | "theory" | "mock";
  lastTheoryId: number | null;
};

type CourseContentCountRow = {
  content_type: string;
  exam_scope: string;
  category: string;
  kind: string;
  item_count: number;
  explained_count: number;
};

function emptyCourseOverviewStats(): CourseOverviewStats {
  return {
    contentQuestionCount: 0,
    contentExplainedQuestionCount: 0,
    contentTheoryCount: 0,
    objectiveAttemptCount: 0,
    completedTheoryCount: 0,
    bookmarkCount: 0,
    streak: 0,
    hasActiveMock: false,
    recentActivity: "",
    lastActivityAt: "",
    lastActivityKind: "",
    lastTheoryId: null,
  };
}

export function buildCourseContentOverview(contentRows: CourseContentCountRow[]) {
  const byExam = Object.fromEntries(
    EXAM_TYPES.map((examType) => [examType, emptyCourseOverviewStats()]),
  ) as Record<ExamType, CourseOverviewStats>;
  let questionCount = 0;
  let explainedQuestionCount = 0;
  let theoryCount = 0;

  for (const row of contentRows) {
    const count = Number(row.item_count ?? 0);
    const explained = Number(row.explained_count ?? 0);
    if (row.content_type === "question") {
      questionCount += count;
      explainedQuestionCount += explained;
    } else if (row.content_type === "theory") {
      theoryCount += count;
    }
    for (const selectedExam of EXAM_TYPES) {
      if (row.content_type === "theory") {
        if (examScopeAllows(row.exam_scope, selectedExam)) {
          byExam[selectedExam].contentTheoryCount += count;
        }
      } else if (questionAllowedForExam({
        examScope: row.exam_scope,
        category: row.category,
        kind: row.kind,
      }, selectedExam)) {
        byExam[selectedExam].contentQuestionCount += count;
        byExam[selectedExam].contentExplainedQuestionCount += explained;
      }
    }
  }
  return { byExam, questionCount, explainedQuestionCount, theoryCount };
}
