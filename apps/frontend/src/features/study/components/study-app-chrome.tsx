"use client";

import { Suspense } from "react";
import { learningPath, type LearningField } from "@shared/study/learning-catalog";
import type { ExamType } from "@shared/study/study-domain";
import RoutedLink from "./routed-link";
import type { CourseNavItem } from "./study-app-config";
import { UserReportModal } from "./study-lazy-screens";
import {
  fieldSectionForSwView,
  navItemActive,
  routeForView,
  swNavItemActive,
  type SwNavView,
  type SwPlannerView,
} from "./study-navigation";
import type { View } from "./study-screen-shared";

export type StudyReportRequest = {
  mode: "general" | "question";
  questionId?: number;
};

type SwNavItem = {
  id: SwNavView;
  label: string;
  mobileLabel: string;
  icon: string;
};

export function StudyMobileNavigation({
  courseContext,
  fieldContext,
  fieldUsesSectionRoutes,
  courseItems,
  activeView,
  selectedExam,
  onCourseNavigate,
  swItems,
  swActiveView,
  selectedField,
  onSwNavigate,
}: {
  courseContext: boolean;
  fieldContext: boolean;
  fieldUsesSectionRoutes: boolean;
  courseItems: CourseNavItem[];
  activeView: View;
  selectedExam: ExamType;
  onCourseNavigate: (view: View) => void;
  swItems: SwNavItem[];
  swActiveView: SwPlannerView;
  selectedField: LearningField;
  onSwNavigate: (view: SwNavView) => void;
}) {
  return (
    <>
      {courseContext && (
        <nav className="mobile-nav" aria-label="모바일 메뉴">
          {courseItems.map((item) => {
            const active = navItemActive(item.id, activeView);
            return (
              <RoutedLink
                key={item.id}
                className={`mobile-nav-item${active ? " active" : ""}`}
                href={learningPath(routeForView(item.id, selectedExam))}
                onNavigate={() => onCourseNavigate(item.id)}
                aria-current={active ? "page" : undefined}
              >
                <span aria-hidden="true">{item.icon}</span>{item.mobileLabel}
              </RoutedLink>
            );
          })}
        </nav>
      )}
      {fieldContext && fieldUsesSectionRoutes && (
        <nav className="mobile-nav sw-mobile-nav" aria-label="SW 전공 모바일 메뉴">
          {swItems.map((item) => {
            const active = swNavItemActive(item.id, swActiveView);
            return (
              <RoutedLink
                key={item.id}
                className={`mobile-nav-item${active ? " active" : ""}`}
                href={learningPath({
                  fieldId: selectedField.id,
                  page: "field",
                  section: fieldSectionForSwView(item.id),
                })}
                onNavigate={() => onSwNavigate(item.id)}
                aria-current={active ? "page" : undefined}
              >
                <span aria-hidden="true">{item.icon}</span>{item.mobileLabel}
              </RoutedLink>
            );
          })}
        </nav>
      )}
    </>
  );
}

export function StudyTransientFeedback({
  reportRequest,
  notice,
  noticeIsError,
  onCloseReport,
  onReportSubmitted,
  onCloseNotice,
}: {
  reportRequest: StudyReportRequest | null;
  notice: string;
  noticeIsError: boolean;
  onCloseReport: () => void;
  onReportSubmitted: () => void;
  onCloseNotice: () => void;
}) {
  return (
    <>
      {reportRequest && (
        <Suspense fallback={null}>
          <UserReportModal
            mode={reportRequest.mode}
            questionId={reportRequest.questionId}
            onClose={onCloseReport}
            onSubmitted={onReportSubmitted}
          />
        </Suspense>
      )}
      {notice && (
        <div className={noticeIsError ? "toast error" : "toast"} role={noticeIsError ? "alert" : "status"}>
          <span>{notice}</span>
          {noticeIsError && <button type="button" onClick={onCloseNotice} aria-label="알림 닫기">×</button>}
        </div>
      )}
    </>
  );
}
