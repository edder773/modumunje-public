import {
  LEARNING_CATALOG,
  learningField,
  learningFieldEngine,
  learningFieldForCourse,
} from "@shared/study/learning-catalog";
import { examDisplayName, type ExamType } from "@shared/study/study-domain";
import { validSwCurriculumSelectionCount } from "../persistence/sw-learning-store";
import { courseNavItems, swNavItems } from "./study-app-config";
import {
  courseViewTitle,
  swViewTitle,
  type LearningLevel,
  type SwPlannerView,
} from "./study-navigation";
import type { View } from "./study-screen-shared";

export function studyAppViewState({
  learningLevel,
  selectedFieldId,
  selectedExam,
  serializedSwCurriculumSelection,
  loadError,
  activeView,
  swActiveView,
  selectedTheoryId,
  swSelectedTheoryId,
}: {
  learningLevel: LearningLevel;
  selectedFieldId: string;
  selectedExam: ExamType;
  serializedSwCurriculumSelection: string;
  loadError: string;
  activeView: View;
  swActiveView: SwPlannerView;
  selectedTheoryId: number | null;
  swSelectedTheoryId: number | null;
}) {
  const courseContext = learningLevel === "course";
  const fieldContext = learningLevel === "field";
  const selectedField = learningField(selectedFieldId)
    ?? learningFieldForCourse(selectedExam)
    ?? LEARNING_CATALOG[0];
  const fieldUsesSectionRoutes = learningFieldEngine(selectedField).routeModel === "field-sections";
  const selectedExamName = examDisplayName(selectedExam);
  const selectedCourseNavItems = courseNavItems(selectedExam);
  const hasSwCurriculumSelection = validSwCurriculumSelectionCount(
    serializedSwCurriculumSelection,
    selectedField,
  ) > 0;
  const visibleSwNavItems = hasSwCurriculumSelection
    ? swNavItems
    : swNavItems.filter((item) => item.id === "curriculum");
  const courseReady = courseContext && !loadError;
  const fieldTopbarTitle = fieldContext ? `${selectedField.name} 학습 과정` : "학습 분야";
  const topbarTitle = learningLevel === "root"
    ? "무엇을 공부할까요?"
    : courseContext
      ? courseViewTitle(activeView, selectedExam, selectedField.name)
      : fieldContext && fieldUsesSectionRoutes
        ? swViewTitle(swActiveView)
        : fieldTopbarTitle;
  const contentUsesPrimaryHeading = Boolean(
    (courseContext && activeView === "theory" && selectedTheoryId)
    || (fieldContext && swActiveView === "theory" && swSelectedTheoryId),
  );

  return {
    contentUsesPrimaryHeading,
    courseContext,
    courseReady,
    fieldContext,
    fieldUsesSectionRoutes,
    hasSwCurriculumSelection,
    selectedCourseNavItems,
    selectedExamName,
    selectedField,
    topbarTitle,
    visibleSwNavItems,
  };
}
