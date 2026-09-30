"use client";

import { useMemo, useSyncExternalStore } from "react";
import type { LearningField } from "@shared/study/learning-catalog";
import { swCurriculumQuestionProfileForSubjects } from "@shared/study/sw-curriculum-contract.mjs";
import {
  EMPTY_SW_LEARNING_STATE,
  parseSwLearningState,
  createSwLearningStore,
} from "../persistence/sw-learning-store";

export default function useSwCurriculumState(field: LearningField, userKeyHash: string) {
  const subjectGroups = useMemo(() => field.subjectGroups ?? [], [field.subjectGroups]);
  const allSubjectIds = useMemo(
    () => new Set(subjectGroups.flatMap((group) => group.subjects.map((subject) => subject.id))),
    [subjectGroups],
  );
  const learningStore = useMemo(() => createSwLearningStore(userKeyHash), [userKeyHash]);
  const serializedSelection = useSyncExternalStore(
    learningStore.subscribeSwCurriculumSelection,
    learningStore.readSwCurriculumSelection,
    () => EMPTY_SW_LEARNING_STATE,
  );
  const persistedLearningState = useMemo(
    () => parseSwLearningState(serializedSelection),
    [serializedSelection],
  );
  const selectedSubjectIds = useMemo(
    () => new Set(persistedLearningState.selectedSubjectIds.filter((id) => allSubjectIds.has(id))),
    [allSubjectIds, persistedLearningState.selectedSubjectIds],
  );
  const selectedSubjects = subjectGroups
    .flatMap((group) => group.subjects)
    .filter((subject) => selectedSubjectIds.has(subject.id));
  const selectedSubjectIdsKey = [...selectedSubjectIds].sort().join(",");
  const selectedQuestionProfile = useMemo(
    () => swCurriculumQuestionProfileForSubjects(
      selectedSubjectIdsKey ? selectedSubjectIdsKey.split(",") : [],
    ),
    [selectedSubjectIdsKey],
  );

  return {
    learningStore,
    persistedLearningState,
    selectedQuestionProfile,
    selectedSubjectIds,
    selectedSubjectIdsKey,
    selectedSubjects,
  };
}
