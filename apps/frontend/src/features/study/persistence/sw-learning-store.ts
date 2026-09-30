import type { LearningField } from "@shared/study/learning-catalog";

export type SwLearningLocation = {
  view: "theory" | "practice" | "mock";
  title: string;
  detail: string;
  theoryId?: number;
  updatedAt: string;
};

export type SwPersistedSession = {
  id: string;
  revision: number;
  mode: "practice" | "mock";
  subjectIds: string[];
  theoryId?: number;
  questionIds: string[];
  answers: Record<string, number[]>;
  revealedQuestionIds: string[];
  currentIndex: number;
  mockSubmitted: boolean;
  updatedAt: string;
};

export function createSwSessionDraft(
  id: string,
  mode: "practice" | "mock",
  subjectIds: string[],
  questionIds: string[],
  theoryId?: number,
): SwPersistedSession {
  return {
    id,
    revision: 0,
    mode,
    subjectIds,
    theoryId,
    questionIds,
    answers: {},
    revealedQuestionIds: [],
    currentIndex: 0,
    mockSubmitted: false,
    updatedAt: new Date().toISOString(),
  };
}

export type SwLearningState = {
  version: 4;
  selectedSubjectIds: string[];
  completedTheoryIds: number[];
  recentPracticeQuestionIds?: string[];
  lastLocation?: SwLearningLocation;
  activeSession?: SwPersistedSession;
};

// The unowned v1 key is deliberately left untouched: its records cannot safely
// be assigned to whichever account happens to sign in next.
const SW_CURRICULUM_SELECTION_KEY = "baeumzip-sw-curriculum-selection:v2";
const SW_CURRICULUM_SELECTION_EVENT = "baeumzip:sw-curriculum-selection";
const STORAGE_FAILURE_EVENT = "baeumzip:storage-failure";
export const EMPTY_SW_LEARNING_STATE = JSON.stringify({
  version: 4,
  selectedSubjectIds: [],
  completedTheoryIds: [],
});
const fallbackSnapshots = new Map<string, string>();

export function subjectSelectionsMatch(first: string[], second: string[]) {
  const firstIds = new Set(first);
  const secondIds = new Set(second);
  return firstIds.size === secondIds.size
    && [...firstIds].every((id) => secondIds.has(id));
}

export function parseSwLearningState(serialized: string): SwLearningState {
  try {
    const saved = JSON.parse(serialized) as unknown;
    if (Array.isArray(saved)) {
      return {
        version: 4,
        selectedSubjectIds: [...new Set(saved.filter((id): id is string => typeof id === "string"))],
        completedTheoryIds: [],
      };
    }
    if (!saved || typeof saved !== "object") {
      return { version: 4, selectedSubjectIds: [], completedTheoryIds: [] };
    }
    const candidate = saved as Partial<SwLearningState>;
    const selectedSubjectIds = Array.isArray(candidate.selectedSubjectIds)
      ? [...new Set(candidate.selectedSubjectIds.filter((id): id is string => typeof id === "string"))]
      : [];
    const completedTheoryIds: number[] = [];
    const recentPracticeQuestionIds = Array.isArray(candidate.recentPracticeQuestionIds)
      ? [...new Set(candidate.recentPracticeQuestionIds.filter((id): id is string => (
          typeof id === "string" && /^[A-Z0-9-]{1,64}$/u.test(id)
        )))].slice(-100)
      : [];
    const location = candidate.lastLocation;
    const lastLocation = location
      && ["practice", "mock"].includes(String(location.view))
      && typeof location.title === "string"
      && typeof location.detail === "string"
      && typeof location.updatedAt === "string"
      ? location
      : undefined;
    const session = candidate.activeSession as (Partial<SwPersistedSession> & {
      answers?: Record<string, number | number[]>;
    }) | undefined;
    const sessionAnswers = session?.answers && typeof session.answers === "object"
      ? Object.fromEntries(Object.entries(session.answers).flatMap(([questionId, answer]) => {
          const values = Array.isArray(answer) ? answer : [answer];
          const normalized = [...new Set(values.map(Number).filter(Number.isInteger))];
          return normalized.length ? [[questionId, normalized]] : [];
        }))
      : {};
    const parsedActiveSession = session
      && (session.mode === "practice" || session.mode === "mock")
      && Array.isArray(session.subjectIds)
      && session.subjectIds.every((id) => typeof id === "string")
      && Array.isArray(session.questionIds)
      && session.questionIds.every((id) => typeof id === "string")
      && session.answers && typeof session.answers === "object"
      && Array.isArray(session.revealedQuestionIds)
      && session.revealedQuestionIds.every((id) => typeof id === "string")
      && typeof session.currentIndex === "number"
      && Number.isInteger(session.currentIndex)
      && session.currentIndex >= 0
      && typeof session.mockSubmitted === "boolean"
      && typeof session.updatedAt === "string"
      ? {
          ...session,
          id: typeof session.id === "string" && /^[a-zA-Z0-9_-]{12,100}$/u.test(session.id)
            ? session.id
            : `sw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`,
          revision: Number.isInteger(session.revision) && Number(session.revision) >= 0
            ? Number(session.revision)
            : 0,
          answers: sessionAnswers,
        } as SwPersistedSession
      : undefined;
    const activeSession = parsedActiveSession;
    return {
      version: 4,
      selectedSubjectIds,
      completedTheoryIds,
      recentPracticeQuestionIds,
      lastLocation,
      activeSession,
    };
  } catch {
    return { version: 4, selectedSubjectIds: [], completedTheoryIds: [] };
  }
}

export function createSwLearningStore(userKeyHash: string) {
  if (!userKeyHash.trim()) throw new Error("SW learning storage requires an owner");
  const storageKey = `${SW_CURRICULUM_SELECTION_KEY}:${encodeURIComponent(userKeyHash)}`;

  function readSwCurriculumSelection() {
    const pending = fallbackSnapshots.get(storageKey);
    if (pending !== undefined) return pending;
    try {
      return window.localStorage.getItem(storageKey) ?? EMPTY_SW_LEARNING_STATE;
    } catch {
      return EMPTY_SW_LEARNING_STATE;
    }
  }

  function subscribeSwCurriculumSelection(onStoreChange: () => void) {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== storageKey && event.key !== null) return;
      try {
        if (event.storageArea && event.storageArea !== window.localStorage) return;
      } catch {
        return;
      }
      if (event.key === null) fallbackSnapshots.clear();
      else fallbackSnapshots.delete(storageKey);
      onStoreChange();
    };
    const onLocalChange = (event: Event) => {
      if ((event as CustomEvent<string>).detail === storageKey) onStoreChange();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(SW_CURRICULUM_SELECTION_EVENT, onLocalChange);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(SW_CURRICULUM_SELECTION_EVENT, onLocalChange);
    };
  }

  function writeSwCurriculumSelection(subjectIds: Set<string>) {
    const current = parseSwLearningState(readSwCurriculumSelection());
    const nextSubjectIds = [...subjectIds].sort();
    const selectionChanged = !subjectSelectionsMatch(current.selectedSubjectIds, nextSubjectIds);
    const nextState: SwLearningState = {
      ...current,
      version: 4,
      selectedSubjectIds: nextSubjectIds,
    };
    if (selectionChanged) {
      delete nextState.recentPracticeQuestionIds;
    }
    persist(nextState);
  }

  function writeSwLearningState(update: (current: SwLearningState) => SwLearningState) {
    persist(update(parseSwLearningState(readSwCurriculumSelection())));
  }

  function persist(state: SwLearningState) {
    const serialized = JSON.stringify(state);
    try {
      window.localStorage.setItem(storageKey, serialized);
      fallbackSnapshots.delete(storageKey);
    } catch {
      fallbackSnapshots.set(storageKey, serialized);
      window.dispatchEvent(new CustomEvent(STORAGE_FAILURE_EVENT, {
        detail: { area: "sw-learning" },
      }));
    }
    window.dispatchEvent(new CustomEvent(SW_CURRICULUM_SELECTION_EVENT, { detail: storageKey }));
  }

  return {
    readSwCurriculumSelection,
    subscribeSwCurriculumSelection,
    writeSwCurriculumSelection,
    writeSwLearningState,
  };
}

export function validSwCurriculumSelectionCount(serialized: string, field: LearningField) {
  const availableSubjectIds = new Set(
    (field.subjectGroups ?? []).flatMap((group) => group.subjects.map((subject) => subject.id)),
  );
  const saved = parseSwLearningState(serialized);
  return new Set(saved.selectedSubjectIds.filter((id) => availableSubjectIds.has(id))).size;
}
