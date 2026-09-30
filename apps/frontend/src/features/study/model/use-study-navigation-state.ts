import { useMemo, useState } from "react";
import { DEFAULT_EXAM_TYPE } from "@shared/study/study-domain";
import {
  LEARNING_CATALOG,
  learningFieldForCourse,
  parseLearningPath,
} from "@shared/study/learning-catalog";
import {
  examForLearningRoute,
  learningLevelForRoute,
  swViewForFieldSection,
  viewForLearningRoute,
  type SwPlannerView,
} from "../components/study-navigation";

export default function useStudyNavigationState(initialPath: string) {
  const initialLearningRoute = useMemo(
    () => parseLearningPath(initialPath),
    [initialPath],
  );
  const initialLearningLevel = learningLevelForRoute(initialLearningRoute);
  const initialRouteExam = examForLearningRoute(initialLearningRoute);
  const initialSwView: SwPlannerView = initialLearningRoute?.page === "field"
    ? initialLearningRoute.activeMock
      ? "mock"
      : swViewForFieldSection(initialLearningRoute.section)
    : "curriculum";
  const [activeView, setActiveView] = useState(
    viewForLearningRoute(initialLearningRoute),
  );
  const [learningLevel, setLearningLevel] = useState(initialLearningLevel);
  const [selectedFieldId, setSelectedFieldId] = useState(
    initialLearningRoute?.page === "field"
      ? initialLearningRoute.fieldId
      : initialRouteExam
        ? learningFieldForCourse(initialRouteExam)?.id ?? LEARNING_CATALOG[0].id
        : LEARNING_CATALOG[0].id,
  );
  const [swActiveView, setSwActiveView] = useState<SwPlannerView>(initialSwView);
  const [swSelectedTheoryId, setSwSelectedTheoryId] = useState<number | null>(
    initialLearningRoute?.page === "field"
      ? initialLearningRoute.theoryId ?? null
      : null,
  );
  const [swNavigationRequest, setSwNavigationRequest] = useState({
    target: initialSwView,
    token: 0,
  });
  const [selectedExam, setSelectedExam] = useState(
    initialRouteExam ?? DEFAULT_EXAM_TYPE,
  );

  return {
    initialLearningRoute,
    initialLearningLevel,
    activeView,
    setActiveView,
    learningLevel,
    setLearningLevel,
    selectedFieldId,
    setSelectedFieldId,
    swActiveView,
    setSwActiveView,
    swSelectedTheoryId,
    setSwSelectedTheoryId,
    swNavigationRequest,
    setSwNavigationRequest,
    selectedExam,
    setSelectedExam,
  };
}
