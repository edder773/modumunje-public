import Link from "next/link";
import type { ExamType } from "@shared/study/study-domain";
import { learningPath, type LearningField } from "@shared/study/learning-catalog";
import RoutedLink from "./routed-link";
import {
  fieldSectionForSwView,
  navItemActive,
  routeForView,
  swNavItemActive,
  type SwNavView,
  type SwPlannerView,
} from "./study-navigation";
import { swNavItems, type CourseNavItem } from "./study-app-config";
import type { View } from "./study-screen-shared";

type LearningLevel = "root" | "field" | "course";

export default function StudySidebar({
  learningLevel,
  selectedField,
  selectedExam,
  selectedExamName,
  activeView,
  swActiveView,
  fieldUsesSectionRoutes,
  hasSwCurriculumSelection,
  adminAccess,
  courseNavItems,
  onLearningRoot,
  onLearningField,
  onCourseView,
  onSwView,
}: {
  learningLevel: LearningLevel;
  selectedField: LearningField;
  selectedExam: ExamType;
  selectedExamName: string;
  activeView: View;
  swActiveView: SwPlannerView;
  fieldUsesSectionRoutes: boolean;
  hasSwCurriculumSelection: boolean;
  adminAccess: boolean;
  courseNavItems: CourseNavItem[];
  onLearningRoot: () => void;
  onLearningField: (fieldId: string) => void;
  onCourseView: (view: View) => void;
  onSwView: (view: SwNavView) => void;
}) {
  const courseContext = learningLevel === "course";
  const fieldContext = learningLevel === "field";
  const brandSubtitleLines = courseContext ? selectedField.brandSubtitleLines : undefined;
  const brandSubtitle = courseContext
    ? `${selectedField.name} 자격 학습`
    : fieldContext
      ? fieldUsesSectionRoutes
        ? `${selectedField.name} 학습 범위`
        : `${selectedField.name} 과정 선택`
      : "학습 분야 탐색";
  const visibleSwNavItems = hasSwCurriculumSelection
    ? swNavItems
    : swNavItems.filter((item) => item.id === "curriculum");

  return (
    <aside className="sidebar" aria-label="주요 메뉴">
      <RoutedLink className="brand" href="/" onNavigate={onLearningRoot} aria-label="모두의 문제집">
        <span className="brand-mark" aria-hidden="true" />
        <span>
          <strong>모두의 문제집</strong>
          <small className={brandSubtitleLines ? "brand-subtitle-stacked" : undefined}>
            {brandSubtitleLines ? (
              <>
                <span style={{ whiteSpace: "nowrap" }}>{brandSubtitleLines[0]}</span>
                <br />
                <span style={{ whiteSpace: "nowrap" }}>{brandSubtitleLines[1]}</span>
              </>
            ) : brandSubtitle}
          </small>
        </span>
      </RoutedLink>
      <nav className="side-nav">
        <RoutedLink
          className={learningLevel === "root" ? "nav-item active" : "nav-item"}
          href="/"
          onNavigate={onLearningRoot}
          aria-current={learningLevel === "root" ? "page" : undefined}
          aria-label="학습 분야"
          data-tooltip="학습 분야"
        >
          <span className="nav-icon" aria-hidden="true">⌂</span>학습 분야
        </RoutedLink>
        {fieldContext && !fieldUsesSectionRoutes && (
          <RoutedLink
            className="nav-item active"
            href={learningPath({ fieldId: selectedField.id, page: "field" })}
            onNavigate={() => onLearningField(selectedField.id)}
            aria-current="page"
            aria-label="학습 홈"
            data-tooltip="학습 홈"
          >
            <span className="nav-icon nav-icon-sql" aria-hidden="true">{selectedField.shortLabel}</span>
            학습 홈
          </RoutedLink>
        )}
        {fieldContext && fieldUsesSectionRoutes && visibleSwNavItems.map((item) => (
          <RoutedLink
            key={item.id}
            className={swNavItemActive(item.id, swActiveView) ? "nav-item active" : "nav-item"}
            href={learningPath({
              fieldId: selectedField.id,
              page: "field",
              section: fieldSectionForSwView(item.id),
            })}
            onNavigate={() => onSwView(item.id)}
            aria-current={swNavItemActive(item.id, swActiveView) ? "page" : undefined}
            aria-label={item.label}
            data-tooltip={item.label}
          >
            <span className="nav-icon" aria-hidden="true">{item.icon}</span>{item.label}
          </RoutedLink>
        ))}
        {courseContext && courseNavItems.map((item) => (
          <RoutedLink
            key={item.id}
            className={navItemActive(item.id, activeView) ? "nav-item active" : "nav-item"}
            href={learningPath(routeForView(item.id, selectedExam))}
            onNavigate={() => onCourseView(item.id)}
            aria-current={navItemActive(item.id, activeView) ? "page" : undefined}
            aria-label={item.label}
            data-tooltip={item.label}
          >
            <span className="nav-icon" aria-hidden="true">{item.icon}</span>{item.label}
          </RoutedLink>
        ))}
      </nav>
      <div className="sidebar-foot">
        {adminAccess && <Link className="admin-entry-link" href="/admin">관리자 운영 페이지 →</Link>}
        <p>
          {courseContext ? (
            <>
              <span>현재 학습 · {selectedField.name} › {selectedExamName}</span>
              <span>모두의 문제집 개인 학습 공간</span>
            </>
          ) : fieldContext ? (
            fieldUsesSectionRoutes ? (
              <>
                <span>대주제·소주제 선택 가능</span>
                <span>이론·객관식 문제 제공</span>
              </>
            ) : (
              <>
                <span>{selectedField.courses.map((course) => course.name).join("·")} 과정 선택</span>
                <span>과정별 학습 공간</span>
              </>
            )
          ) : (
            <>
              <span>분야별 학습 과정 탐색</span>
              <span>모두의 문제집 학습 공간</span>
            </>
          )}
        </p>
      </div>
    </aside>
  );
}
