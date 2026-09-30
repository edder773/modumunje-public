import { practicalPastFormForQuestionIds } from "@shared/study/ipe-practical-past.mjs";
import {
  parseJson,
  resolvedExamConfig,
  type ExamResult,
  type ExamType,
} from "./domain/study.domain";
import type { ExamItemRow, SessionRow } from "./study.repository";

export type SessionWithItems = SessionRow & { items?: ExamItemRow[] };
export const MOCK_QUESTION_WINDOW = 10;

type PersistedExamState = {
  answers: Record<string, number[]>;
  descriptiveAnswers: Record<string, string>;
  descriptiveScores: Record<string, number>;
  descriptiveSnapshots: Record<string, string>;
  flagged: number[];
};

function numberList(value: unknown) {
  const items = Array.isArray(value) ? value : parseJson<unknown[]>(value, []);
  return items.map(Number).filter(Number.isInteger);
}

function sameAnswers(first: number[], second: number[]) {
  return [...first].sort((a, b) => a - b).join(",") === [...second].sort((a, b) => a - b).join(",");
}

export function mockQuestionWindow(questionIds: number[], currentIndex: number) {
  const safeIndex = Math.min(
    Math.max(0, Number(currentIndex) || 0),
    Math.max(0, questionIds.length - 1),
  );
  const start = Math.floor(safeIndex / MOCK_QUESTION_WINDOW) * MOCK_QUESTION_WINDOW;
  return questionIds.slice(start, start + MOCK_QUESTION_WINDOW);
}

export function changedExamItemState(session: SessionWithItems, state: PersistedExamState) {
  const storedItems = new Map((session.items ?? []).map((item) => [item.questionId, item]));
  return parseExamSession(session).questionIds.map((questionId, position) => ({
    questionId,
    position,
    selectedAnswers: state.answers[String(questionId)] ?? [],
    descriptiveAnswer: state.descriptiveAnswers[String(questionId)] ?? "",
    descriptiveScore: Number.isFinite(Number(state.descriptiveScores[String(questionId)]))
      ? Number(state.descriptiveScores[String(questionId)])
      : null,
    descriptiveSnapshot: state.descriptiveSnapshots[String(questionId)] ?? "",
    flagged: state.flagged.includes(questionId),
  })).filter((item) => {
    const stored = storedItems.get(item.questionId);
    if (!stored) return true;
    const storedScore = stored.descriptiveScore === null ? null : Number(stored.descriptiveScore);
    return stored.position !== item.position
      || !sameAnswers(numberList(stored.selectedAnswers), item.selectedAnswers)
      || stored.descriptiveAnswer !== item.descriptiveAnswer
      || storedScore !== item.descriptiveScore
      || stored.descriptiveSnapshot !== item.descriptiveSnapshot
      || Boolean(stored.flagged) !== item.flagged;
  });
}

export function parseExamSession(row: SessionWithItems) {
  const examType = row.examType as ExamType;
  // Practical scores are written by the final grading transaction. Its complete
  // session state is authoritative once submitted; active item rows hold drafts.
  const itemRows = row.items?.length && !(row.examType === "IPEP" && row.status === "submitted")
    ? [...row.items].sort((first, second) => first.position - second.position)
    : null;
  const questionIds = itemRows?.map((item) => item.questionId) ?? numberList(row.questionIds);
  const itemAnswers = itemRows
    ? Object.fromEntries(itemRows.filter((item) => numberList(item.selectedAnswers).length)
      .map((item) => [String(item.questionId), numberList(item.selectedAnswers)]))
    : null;
  const itemDescriptiveAnswers = itemRows
    ? Object.fromEntries(itemRows.filter((item) => item.descriptiveAnswer)
      .map((item) => [String(item.questionId), item.descriptiveAnswer]))
    : null;
  const itemDescriptiveScores = itemRows
    ? Object.fromEntries(itemRows.filter((item) => item.descriptiveScore !== null)
      .map((item) => [String(item.questionId), Number(item.descriptiveScore)]))
    : null;
  const itemDescriptiveSnapshots = itemRows
    ? Object.fromEntries(itemRows.filter((item) => item.descriptiveSnapshot)
      .map((item) => [String(item.questionId), item.descriptiveSnapshot]))
    : null;
  return {
    ...row,
    items: undefined,
    questionIds,
    examForm: examType === "IPEP" ? practicalPastFormForQuestionIds(questionIds) : undefined,
    answers: itemAnswers ?? parseJson<Record<string, number[]>>(row.answers, {}),
    descriptiveAnswers: itemDescriptiveAnswers ?? parseJson<Record<string, string>>(row.descriptiveAnswers, {}),
    descriptiveScores: itemDescriptiveScores ?? parseJson<Record<string, number>>(row.descriptiveScores, {}),
    descriptiveSnapshots: itemDescriptiveSnapshots ?? parseJson<Record<string, string>>(row.descriptiveSnapshots, {}),
    flagged: itemRows?.filter((item) => item.flagged).map((item) => item.questionId)
      ?? numberList(row.flagged),
    result: parseJson<ExamResult | Record<string, never>>(row.result, {}),
    policySnapshot: resolvedExamConfig(examType, row.policySnapshot),
    isAdmin: Boolean(row.isAdmin),
  };
}

export function parseExamSessionSummary(row: Pick<SessionRow,
  | "id"
  | "examType"
  | "status"
  | "currentIndex"
  | "startedAt"
  | "endsAt"
  | "submittedAt"
  | "result"
  | "updatedAt"
  | "isAdmin"
>) {
  const result = parseJson<ExamResult | Record<string, never>>(row.result, {});
  return {
    id: row.id,
    examType: row.examType as ExamType,
    examForm: result.examForm,
    status: row.status,
    questionIds: [],
    answers: {},
    descriptiveAnswers: {},
    descriptiveScores: {},
    descriptiveSnapshots: {},
    flagged: [],
    currentIndex: row.currentIndex,
    startedAt: row.startedAt,
    endsAt: row.endsAt,
    submittedAt: row.submittedAt,
    result: "totalScore" in result ? {
      examType: result.examType,
      examForm: result.examForm,
      totalScore: result.totalScore,
      passed: result.passed,
      autoSubmitted: result.autoSubmitted,
      submittedAt: result.submittedAt,
    } : {},
    updatedAt: row.updatedAt,
    isAdmin: Boolean(row.isAdmin),
  };
}
