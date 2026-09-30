import type { SwLearningState } from "../persistence/sw-learning-store";
import type { SwAccountState } from "./sw-study-api-client";

// The caller supplies only the state fetched for this store's expected owner.
export function mergeSwAccountState(saved: SwLearningState, account: SwAccountState): SwLearningState {
  const serverActive = account.sessions.find((session) => session.status === "active");
  const localActive = saved.activeSession;
  const shouldUseServer = Boolean(serverActive && (
    !localActive || Date.parse(serverActive.updatedAt) > Date.parse(localActive.updatedAt)
  ));
  return {
    ...saved,
    version: 4,
    selectedSubjectIds: shouldUseServer && serverActive ? serverActive.subjectIds : saved.selectedSubjectIds,
    completedTheoryIds: [],
    activeSession: shouldUseServer && serverActive ? {
      id: serverActive.id,
      revision: serverActive.revision,
      mode: serverActive.mode,
      subjectIds: serverActive.subjectIds,
      questionIds: serverActive.questionIds,
      answers: serverActive.answers,
      revealedQuestionIds: serverActive.revealedQuestionIds,
      currentIndex: serverActive.currentIndex,
      mockSubmitted: false,
      updatedAt: serverActive.updatedAt,
    } : saved.activeSession,
  };
}
