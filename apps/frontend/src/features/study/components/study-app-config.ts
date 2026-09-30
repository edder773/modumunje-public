import {
  courseContentKinds,
  DEFAULT_EXAM_TYPE,
  type CourseContentKind,
  type ExamType,
} from "@shared/study/study-domain";
import type { SqlExamDraft } from "../persistence/exam-draft";
import type { ExamSession, StudyData, View } from "./study-screen-shared";
import type { SwNavView } from "./study-navigation";

export const EMPTY_DATA: StudyData = {
  questions: [],
  theories: [],
  attempts: [],
  examSessions: [],
  evaluations: [],
  theoryProgress: [],
  settings: { selectedExam: DEFAULT_EXAM_TYPE },
  site: {
    notice: "",
    maintenanceMode: false,
    defaultExamMode: DEFAULT_EXAM_TYPE,
  },
  adminAccess: false,
};

export type CourseNavItem = {
  id: View;
  label: string;
  mobileLabel: string;
  icon: string;
  contentKind?: CourseContentKind;
};

export const navItems: CourseNavItem[] = [
  { id: "dashboard", label: "학습 홈", mobileLabel: "학습 홈", icon: "⌂" },
  { id: "theory", label: "이론", mobileLabel: "이론", icon: "▤", contentKind: "theory" },
  { id: "practice", label: "문제", mobileLabel: "문제", icon: "✓", contentKind: "question" },
  { id: "mock", label: "모의고사", mobileLabel: "모의고사", icon: "◷", contentKind: "mock-exam" },
  { id: "stats", label: "학습 기록", mobileLabel: "학습 기록", icon: "↗", contentKind: "question" },
];
export function courseNavItems(examType: ExamType) {
  const contentKinds = new Set(courseContentKinds(examType));
  return navItems.filter((item) => !item.contentKind || contentKinds.has(item.contentKind));
}

export function courseViewAvailable(examType: ExamType, view: View) {
  const contentKinds = new Set(courseContentKinds(examType));
  if (view === "theory") return contentKinds.has("theory");
  if (view === "practice" || view === "wrong" || view === "incorrect" || view === "stats") {
    return contentKinds.has("question");
  }
  if (view === "mock") return contentKinds.has("mock-exam");
  return true;
}
export const swNavItems: { id: SwNavView; label: string; mobileLabel: string; icon: string }[] = [
  { id: "curriculum", label: "학습 홈", mobileLabel: "학습 홈", icon: "⌂" },
  { id: "theories", label: "이론", mobileLabel: "이론", icon: "▤" },
  { id: "practice", label: "문제", mobileLabel: "문제", icon: "✓" },
  { id: "mock-setup", label: "모의고사", mobileLabel: "모의고사", icon: "◷" },
];

export const QUESTION_CHUNK_SIZE = 10;
export const QUESTION_PREFETCH_CHUNKS = 2;
export type ExamSaveSnapshot = Omit<SqlExamDraft, "revision" | "updatedAt">;
export type ExamSaveErrorPayload = {
  code?: string;
  error?: string;
  session?: ExamSession;
};

export class ExamSaveRequestError extends Error {
  constructor(readonly payload: ExamSaveErrorPayload) {
    super(payload.error ?? "모의고사 답안을 저장하지 못했습니다.");
  }
}
