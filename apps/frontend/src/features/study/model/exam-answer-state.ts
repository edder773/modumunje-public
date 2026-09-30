import type { ExamType } from "@shared/study/study-domain";
import { hasPracticalAnswer } from "@shared/study/practical-answer-presence";

type ExamAnswerState = {
  examType: ExamType;
  answers: Record<string, number[]>;
  descriptiveAnswers: Record<string, string>;
  descriptiveScores: Record<string, number>;
  descriptiveSnapshots: Record<string, string>;
};

export function examQuestionAnswered(state: ExamAnswerState, id: number, kind?: string) {
  const answer = state.descriptiveAnswers[String(id)]?.trim() ?? "";
  if (state.examType === "IPEP") return hasPracticalAnswer(answer);
  if (kind !== "descriptive") return Boolean(state.answers[String(id)]?.length);
  const score = Number(state.descriptiveScores[String(id)]);
  return Boolean(answer) && answer === state.descriptiveSnapshots[String(id)]
    && Number.isFinite(score) && score >= 0 && score <= 100;
}
