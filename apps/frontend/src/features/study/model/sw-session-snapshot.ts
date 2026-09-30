import { SW_SESSION_QUESTION_LIMIT } from "@shared/study/study-mutation-contract.mjs";
import type { SwPersistedSession } from "../persistence/sw-learning-store";

export function swSessionSnapshot(input: {
  id: string;
  revision: number;
  mode: "practice" | "mock";
  subjectIds: string[];
  theoryId?: number;
  questionIds: string[];
  answers: Record<string, number[]>;
  revealedQuestionIds: string[];
  currentIndex: number;
  updatedAt?: string;
}): SwPersistedSession {
  return {
    ...input,
    mockSubmitted: false,
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  };
}

export async function persistSwPracticeQuestionBatch<T extends { id: string }>(input: {
  current: T[];
  next: T[];
  id: string;
  revision: number;
  subjectIds: string[];
  theoryId?: number;
  answers: Record<string, number[]>;
  revealedQuestionIds: string[];
  currentIndex: number;
  save: (
    session: SwPersistedSession,
    action: "sw-session-save",
  ) => Promise<{ status: string; questions?: T[]; session?: SwPersistedSession | null }>;
}) {
  const combined = [...new Map([...input.current, ...input.next].map((question) => [question.id, question])).values()];
  const removedCount = Math.max(0, combined.length - SW_SESSION_QUESTION_LIMIT);
  const revealed = new Set(input.revealedQuestionIds);
  if (combined.slice(0, removedCount).some((question) => !revealed.has(question.id))) {
    throw new Error("아직 풀이를 마치지 않은 문제가 있어 다음 묶음을 저장할 수 없습니다.");
  }
  const questions = combined.slice(removedCount);
  const retainedIds = new Set(questions.map((question) => question.id));
  const session = swSessionSnapshot({
    id: input.id,
    revision: input.revision,
    mode: "practice",
    subjectIds: input.subjectIds,
    theoryId: input.theoryId,
    questionIds: questions.map((question) => question.id),
    answers: Object.fromEntries(Object.entries(input.answers).filter(([id]) => retainedIds.has(id))),
    revealedQuestionIds: input.revealedQuestionIds.filter((id) => retainedIds.has(id)),
    currentIndex: Math.max(0, Math.min(questions.length - 1, input.currentIndex - removedCount)),
  });
  const saved = await input.save(session, "sw-session-save");
  if (saved.status !== "saved") {
    return null;
  }

  if (!saved.session || saved.session.id !== session.id
    || saved.session.currentIndex !== session.currentIndex
    || JSON.stringify(saved.session.questionIds) !== JSON.stringify(session.questionIds)) {
    throw new Error("저장된 학습 범위가 일치하지 않습니다. 새로고침 후 다시 시도해 주세요.");
  }

  const mergedQuestions = new Map(questions.map((question) => [question.id, question]));

  for (const authorizedQuestion of saved.questions ?? []) {
    const currentQuestion = mergedQuestions.get(authorizedQuestion.id);
    if (!currentQuestion) continue;
    mergedQuestions.set(authorizedQuestion.id, {
      ...currentQuestion,
      ...authorizedQuestion,
    });
  }

  return [...mergedQuestions.values()];
}
