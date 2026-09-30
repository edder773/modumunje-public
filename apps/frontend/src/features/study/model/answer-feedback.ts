import { requestStudyMutation } from "./study-mutation-api-client";

export type QuestionFeedback = {
  correctAnswers: number[];
  explanation: string;
  scoringCriteria: string[];
  requiredConcepts: string[];
  acceptableAlternatives: string[];
  deductionConditions: string[];
  errorConditions: string[];
};

export type SwQuestionFeedback = {
  correctAnswers: number[];
  explanation: string;
};

export type AttemptSavePayload<TAttempt> = {
  attempt: TAttempt;
  feedback: QuestionFeedback;
  duplicate: boolean;
  grading?: Pick<import("@shared/study/study-domain").DescriptiveEvaluation, "score" | "result" | "feedback" | "answerParts">;
};

export type SwAttemptPayload = {
  attempt: { correct: boolean };
  feedback: SwQuestionFeedback;
};

export function mergeQuestionFeedback<T extends { id: number }>(
  questions: T[],
  questionId: number,
  feedback: QuestionFeedback,
) {
  return questions.map((question) => question.id === questionId
    ? { ...question, ...feedback }
    : question);
}

export function mergeSwQuestionFeedback<T extends { id: string }>(
  questions: T[],
  questionId: string,
  feedback: SwQuestionFeedback,
) {
  return questions.map((question) => question.id === questionId
    ? { ...question, ...feedback }
    : question);
}

export function mergeById<T extends { id: number | string }>(current: T[], incoming: T[]) {
  const merged = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) {
    const previous = merged.get(item.id);
    merged.set(item.id, previous ? { ...previous, ...item } : item);
  }
  return [...merged.values()];
}

export async function requestQuestionFeedback(input: {
  questionId: number;
  examType: string;
  answerText: string;
  feedbackAuthorization: string;
}) {
  const payload = await requestStudyMutation<{ feedback: QuestionFeedback }>(
    "question-feedback",
    input,
  );
  return payload.feedback;
}
