import Link from "next/link";
import SignOutForm from "@frontend/features/auth/sign-out-form";
import { learningPath, type LearningField } from "@shared/study/learning-catalog";
import RoutedLink from "./routed-link";
import StudyTopbar from "./study-topbar";
import { SaveStatus, type SaveStatusValue } from "./learning-feedback";

export default function StudyHeader({
  learningLevel,
  selectedField,
  selectedExamName,
  topbarTitle,
  contentUsesPrimaryHeading,
  isAuthenticated,
  saveStatus,
  onRetrySave,
  onReport,
  adminAccess,
  groupExamAccess,
  displayName,
  signInPath,
  signOutPath,
  onLearningRoot,
  onLearningField,
  notice,
  maintenanceMode,
}: {
  learningLevel: "root" | "field" | "course";
  selectedField: LearningField;
  selectedExamName: string;
  topbarTitle: string;
  contentUsesPrimaryHeading: boolean;
  isAuthenticated: boolean;
  saveStatus: SaveStatusValue;
  onRetrySave: () => void;
  onReport: () => void;
  adminAccess: boolean;
  groupExamAccess: boolean;
  displayName: string;
  signInPath: string;
  signOutPath: string;
  onLearningRoot: () => void;
  onLearningField: (fieldId: string) => void;
  notice: string;
  maintenanceMode: boolean;
}) {
  const visibleNotice = /^사이트 개선 중입니다[.!]?$/u.test(notice.trim()) ? "" : notice;
  const courseContext = learningLevel === "course";
  const fieldContext = learningLevel === "field";

  return (
    <>
      <StudyTopbar
        eyebrow={courseContext
          ? `현재 선택한 ${selectedField.name} 과정`
          : fieldContext ? selectedField.name : "모두의 문제집"}
        title={topbarTitle}
        description={learningLevel === "root"
          ? "원하는 학습 분야를 선택해 이론부터 문제 풀이와 모의고사까지 학습하세요."
          : undefined}
        contentUsesPrimaryHeading={contentUsesPrimaryHeading}
        actions={(
          <>
            {isAuthenticated && <SaveStatus status={saveStatus} onRetry={onRetrySave} />}
            {!isAuthenticated && saveStatus === "error" && <span className="save-status error" role="alert">학습 상태를 임시 보관하지 못했습니다. <button type="button" onClick={onRetrySave}>다시 시도</button></span>}
            {isAuthenticated && <button className="top-report-button" type="button" onClick={onReport}>버그·개선 제보</button>}
            {isAuthenticated && adminAccess && groupExamAccess && <Link className="top-admin-link" href="/groups">그룹 SKCT</Link>}
            {adminAccess && <Link className="top-admin-link" href="/admin">관리자</Link>}
            {isAuthenticated ? (
              <div className="user-account">
                <span className="avatar">{displayName.slice(0, 1)}</span>
                <span><strong>{displayName}</strong><SignOutForm action={signOutPath} /></span>
              </div>
            ) : (
              <a className="top-login-link" href={signInPath}>로그인</a>
            )}
          </>
        )}
      />

      {courseContext && (
        <nav className="learning-context-bar" aria-label="현재 학습 과정">
          <div>
            <span>현재 학습:</span>
            <strong>{selectedField.name}</strong>
            <i aria-hidden="true">›</i>
            <strong>{selectedExamName}</strong>
          </div>
          <div className="learning-context-actions">
            <RoutedLink href="/" onNavigate={onLearningRoot}>학습 분야</RoutedLink>
            <RoutedLink
              href={learningPath({ fieldId: selectedField.id, page: "field" })}
              onNavigate={() => onLearningField(selectedField.id)}
            >
              학습 과정 변경
            </RoutedLink>
          </div>
        </nav>
      )}

      {(visibleNotice || maintenanceMode) && (
        <aside className={maintenanceMode ? "site-notice maintenance" : "site-notice"} role="status">
          <strong>{maintenanceMode ? "유지보수 안내" : "사이트 공지"}</strong>
          <span>{visibleNotice || "현재 유지보수 중이며 학습 기록 저장이 잠시 제한됩니다."}</span>
        </aside>
      )}
    </>
  );
}
