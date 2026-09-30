import { SUBJECTS, isObjectiveKind, questionAllowedForExam, type ExamType } from "@shared/study/study-domain";
import { koreaDateKey, koreaDayStreak } from "@shared/date/korea-date.mjs";
import type { Attempt, Question, TheoryArticle } from "../components/study-screen-shared";

const categories: readonly string[] = SUBJECTS;

export function compareTheories(first: TheoryArticle, second: TheoryArticle) {
  return categories.indexOf(first.category) - categories.indexOf(second.category)
    || first.sortOrder - second.sortOrder
    || first.id - second.id;
}

export function calcStreak(attempts: Attempt[], now: Date = new Date()) {
  return koreaDayStreak(attempts.map((item) => koreaDateKey(item.createdAt)), now);
}

export function gradedPracticeAttempts(questions: Question[], attempts: Attempt[], examType: ExamType) {
  const questionIds = new Set(questions
    .filter((question) => isObjectiveKind(question.kind) || (examType === "IPEP" && question.kind === "descriptive"))
    .map((question) => question.id));
  return attempts.filter((attempt) => attempt.examType === examType && questionIds.has(attempt.questionId)
    && (examType !== "IPEP" || ["practice", "bookmark-practice", "bookmark-modal", "incorrect-review", "mock-exam"].includes(attempt.mode)));
}

export function scopeQuestions(questions: Question[], selectedExam: ExamType) {
  return questions.filter((question) => questionAllowedForExam(question, selectedExam));
}
