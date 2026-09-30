import {
  examDisplayName,
  type ExamType,
} from "@shared/study/study-domain";
import type {
  LearningFieldSection,
  LearningRoute,
} from "@shared/study/learning-catalog";
import type { View } from "./study-screen-shared";

export type LearningLevel = "root" | "field" | "course";
export type SwNavView = "curriculum" | "theories" | "practice" | "mock-setup";
export type SwPlannerView = SwNavView | "theory" | "mock";

export function swNavItemActive(item: SwNavView, activeView: SwPlannerView) {
  if (item === "theories") return activeView === "theories" || activeView === "theory";
  if (item === "mock-setup") return activeView === "mock-setup" || activeView === "mock";
  return item === activeView;
}

export function swViewForFieldSection(section?: LearningFieldSection): SwNavView {
  if (section === "theories") return "theories";
  if (section === "practice") return "practice";
  if (section === "mock-exams") return "mock-setup";
  return "curriculum";
}

export function fieldSectionForSwView(view: SwPlannerView): LearningFieldSection {
  if (view === "theories" || view === "theory") return "theories";
  if (view === "practice") return "practice";
  if (view === "mock-setup" || view === "mock") return "mock-exams";
  return "home";
}

export function swViewTitle(view: SwPlannerView) {
  if (view === "theories" || view === "theory") return "SW 전공 이론 학습";
  if (view === "practice") return "SW 전공 문제 풀이";
  if (view === "mock-setup" || view === "mock") return "SW 전공 모의고사";
  return "SW 전공 학습 범위";
}

export function navItemActive(item: View, activeView: View) {
  if (item === "stats") {
    return activeView === "stats" || activeView === "wrong" || activeView === "incorrect";
  }
  return item === activeView;
}

export function courseViewTitle(view: View, examType: ExamType, _fieldName: string) {
  void _fieldName;
  const examName = examDisplayName(examType);
  if (view === "dashboard") return `${examName} 학습 홈`;
  if (view === "theory") return `${examName} 이론 학습`;
  if (view === "practice") return `${examName} 문제 풀이`;
  if (view === "mock") return `${examName} 모의고사`;
  return "학습 기록";
}

export function viewForLearningRoute(route: LearningRoute | null): View {
  if (!route || route.page === "field" || route.page === "home") return "dashboard";
  if (route.page === "practice" || route.page === "question") return "practice";
  if (route.page === "theories" || route.page === "theory") return "theory";
  if (route.page === "mock-exams" || route.page === "mock-exam") return "mock";
  if (route.page === "bookmarks") return "wrong";
  if (route.page === "incorrect") return "incorrect";
  return "stats";
}

export function learningLevelForRoute(route: LearningRoute | null): LearningLevel {
  if (!route) return "root";
  return route.page === "field" ? "field" : "course";
}

export function examForLearningRoute(route: LearningRoute | null): ExamType | null {
  return route && route.page !== "field" ? route.examType : null;
}

export function routeForView(view: View, examType: ExamType): LearningRoute {
  if (view === "dashboard") return { examType, page: "home" };
  if (view === "practice") return { examType, page: "practice" };
  if (view === "theory") return { examType, page: "theories" };
  if (view === "mock") return { examType, page: "mock-exams" };
  if (view === "wrong") return { examType, page: "bookmarks" };
  if (view === "incorrect") return { examType, page: "incorrect" };
  return { examType, page: "records" };
}

export function shuffle<T>(items: T[]) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}
