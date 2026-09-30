"use client";

import { lazy, Suspense } from "react";
import { releasedLocalPracticeCourses, localPracticePath, localPracticeWorkbooks } from "@shared/study/local-practice";
import type { ExamType } from "@shared/study/study-domain";
import {
  learningFieldEngine,
  learningPath,
  type LearningField,
} from "@shared/study/learning-catalog";
import RoutedLink from "./routed-link";
import type { SwNavigationRequest } from "./sw-curriculum-planner";
import type { SwPlannerView } from "./study-navigation";
import { buildCourseCardViewModels } from "../model/learning-field-view-model";

export type { SwNavigationRequest } from "./sw-curriculum-planner";

const SwCurriculumPlanner = lazy(() => import("./sw-curriculum-planner"));

export default function LearningFieldHome({
  field,
  isAuthenticated,
  userKeyHash,
  onBack,
  onCourseSelect,
  swNavigationRequest,
  onSwViewChange,
  initialSwTheoryId,
  onSwTheoryChange,
}: {
  field: LearningField;
  isAuthenticated: boolean;
  userKeyHash: string;
  onBack: () => void;
  onCourseSelect: (examType: ExamType) => void;
  swNavigationRequest: SwNavigationRequest;
  onSwViewChange: (view: SwPlannerView) => void;
  initialSwTheoryId: number | null;
  onSwTheoryChange: (theoryId: number | null) => void;
}) {
  const engine = learningFieldEngine(field);
  if (engine.homeView === "curriculum-planner") {
    return (
      <>
      <a className="outline-button" href={learningPath({ fieldId: field.id, page: "field", section: "theories" })}>전체 이론 읽기 →</a>
      <Suspense fallback={<div className="learning-loading" role="status">SW 학습 화면을 준비하고 있습니다.</div>}>
        <SwCurriculumPlanner
          key={userKeyHash}
          userKeyHash={userKeyHash}
          field={field}
          isAuthenticated={isAuthenticated}
          onBack={onBack}
          navigationRequest={swNavigationRequest}
          onViewChange={onSwViewChange}
          initialTheoryId={initialSwTheoryId}
          onTheoryChange={onSwTheoryChange}
        />
      </Suspense>
      </>
    );
  }

  const courseCards = buildCourseCardViewModels(
    field.courses,
    (examType) => learningPath({ examType, page: "home" }),
  );

  return (
    <div className="page-stack learning-field-home">
      <RoutedLink className="field-back-button" href="/" onNavigate={onBack}>
        학습 분야로 돌아가기
      </RoutedLink>
      <section aria-label="학습 과정">
        <div className="course-choice-grid field-course-grid">
          {releasedLocalPracticeCourses(field.id).map(course => <a className="course-choice field-course-choice" key={course.courseId} href={localPracticePath(course)}><span className="course-choice-state">로컬 실습</span><strong>{course.name}</strong><p>{course.summary}</p><dl><div><dt>학습 구성</dt><dd>{localPracticeWorkbooks(course).map(item => `${item.title} ${item.release.questionCount}문항`).join(" · ")}</dd></div><div><dt>실습 방식</dt><dd>CSV 다운로드 · 개인 컴퓨터에서 Python 실행</dd></div></dl><span className="course-choice-link">실기 학습 시작 →</span></a>)}
          {courseCards.map((course) => (
            <RoutedLink
              className="course-choice field-course-choice"
              key={course.id}
              href={course.href}
              onNavigate={() => onCourseSelect(course.examType)}
              aria-label={`${course.name} 과정 선택`}
            >
              <span className="course-choice-state">과정 선택</span>
              <strong>{course.name}</strong>
              <p>{course.summary}</p>
              <dl>
                <div><dt>학습 구성</dt><dd>{course.studyMode}</dd></div>
                <div><dt>모의고사</dt><dd>{course.mockExam}</dd></div>
              </dl>
              <span className="course-choice-link">{course.name} 학습 시작 →</span>
            </RoutedLink>
          ))}
        </div>
      </section>
    </div>
  );
}
