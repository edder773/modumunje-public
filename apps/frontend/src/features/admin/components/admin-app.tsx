"use client";

import {
  type ReactNode,
  lazy,
  Suspense,
  useEffect,
  useState,
} from "react";
import Link from "next/link";
import SignOutForm from "@frontend/features/auth/sign-out-form";
import type { AdminSection } from "@frontend/features/admin/model/admin-sections";
import { useReportNotification } from "@frontend/features/admin/model/use-report-notification";
import { apiAction } from "@frontend/features/admin/model/admin-api-client";
import {
  AdminNotice,
  LoadingBlock,
  withObjectParticle,
} from "./admin-ui";
import RetryBoundary, {
  installStaleDeploymentRecovery,
} from "@frontend/features/errors/retry-boundary";
import AdminGroupExamsSection from "./admin-group-exams-section";

export type { AdminSection } from "@frontend/features/admin/model/admin-sections";

type AdminMenuIconName =
  | "dashboard"
  | "members"
  | "group-exams"
  | "questions"
  | "theories"
  | "quality"
  | "backups"
  | "transfer"
  | "analytics"
  | "reports"
  | "logs"
  | "settings";

const MENU: Array<{
  id: AdminSection;
  label: string;
  description: string;
  icon: AdminMenuIconName;
}> = [
  { id: "dashboard", label: "대시보드", description: "운영 현황", icon: "dashboard" },
  { id: "members", label: "회원 관리", description: "계정·접근 제어", icon: "members" },
  { id: "group-exams", label: "그룹 SKCT", description: "그룹·횟수·문항 수", icon: "group-exams" },
  { id: "questions", label: "문제 관리", description: "문제은행", icon: "questions" },
  { id: "theories", label: "이론 관리", description: "학습 콘텐츠", icon: "theories" },
  { id: "quality", label: "문제 품질 점검", description: "오류·중복", icon: "quality" },
  { id: "backups", label: "백업 및 복원", description: "데이터 안전성", icon: "backups" },
  { id: "transfer", label: "가져오기·내보내기", description: "데이터 이동", icon: "transfer" },
  { id: "analytics", label: "방문자 및 학습 분석", description: "운영 지표", icon: "analytics" },
  { id: "reports", label: "사용자 제보", description: "버그·개선 요청", icon: "reports" },
  { id: "logs", label: "시스템 로그", description: "작업·오류 기록", icon: "logs" },
  { id: "settings", label: "사이트 설정", description: "운영 정책", icon: "settings" },
];

const LazySettingsSection = lazy(() => import("./admin-settings-section"));
const LazyLogsSection = lazy(() => import("./admin-logs-section"));
const LazyAnalyticsSection = lazy(() => import("./admin-analytics-section"));
const LazyMembersSection = lazy(() => import("./admin-members-section"));
const LazyReportsSection = lazy(() => import("./admin-reports-section"));
const LazyCoreSections = lazy(() => import("./admin-core-sections"));

function AdminMenuIcon({ name }: { name: AdminMenuIconName }) {
  let content: ReactNode;

  switch (name) {
    case "dashboard":
      content = (
        <>
          <rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.4" />
          <rect x="14" y="3.5" width="6.5" height="6.5" rx="1.4" />
          <rect x="3.5" y="14" width="6.5" height="6.5" rx="1.4" />
          <rect x="14" y="14" width="6.5" height="6.5" rx="1.4" />
        </>
      );
      break;
    case "members":
      content = (
        <>
          <circle cx="9" cy="8" r="3" />
          <path d="M3.5 19c.5-3.4 2.3-5.2 5.5-5.2s5 1.8 5.5 5.2" />
          <path d="M15 5.4a3 3 0 0 1 0 5.3M16.4 13.9c2.3.5 3.7 2.2 4.1 5.1" />
        </>
      );
      break;
    case "group-exams":
      content = (
        <>
          <circle cx="8" cy="8" r="3" />
          <circle cx="17" cy="9" r="2.5" />
          <path d="M3 19c.5-3.5 2.2-5.3 5-5.3s4.5 1.8 5 5.3M14 14.5c3.7-.5 6.2 1.1 6.8 4.5" />
        </>
      );
      break;
    case "questions":
      content = (
        <>
          <path d="M6 3.5h8.8L18 6.7v13.8H6z" />
          <path d="M14.5 3.8V7h3.2M9 10.2h6M9 14h3.4" />
          <circle cx="15.7" cy="15.8" r=".65" fill="currentColor" stroke="none" />
        </>
      );
      break;
    case "theories":
      content = (
        <>
          <path d="M3.5 5.2c3.2-.8 5.8-.2 8.5 1.7v13c-2.7-1.9-5.3-2.5-8.5-1.7z" />
          <path d="M20.5 5.2c-3.2-.8-5.8-.2-8.5 1.7v13c2.7-1.9 5.3-2.5 8.5-1.7z" />
        </>
      );
      break;
    case "quality":
      content = (
        <>
          <circle cx="10.3" cy="10.3" r="5.8" />
          <path d="m14.7 14.7 5 5M7.8 10.2l1.7 1.7 3.5-3.6" />
        </>
      );
      break;
    case "backups":
      content = (
        <>
          <ellipse cx="12" cy="5.5" rx="7.5" ry="2.8" />
          <path d="M4.5 5.5v5c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-5M4.5 10.5v5c0 1.5 3.4 2.8 7.5 2.8 1.1 0 2.1-.1 3-.3" />
          <path d="M18.2 14.5v6m-2.3-2.3 2.3 2.3 2.3-2.3" />
        </>
      );
      break;
    case "transfer":
      content = (
        <>
          <path d="M4 8h14M14.5 4.5 18 8l-3.5 3.5M20 16H6M9.5 12.5 6 16l3.5 3.5" />
        </>
      );
      break;
    case "analytics":
      content = (
        <>
          <path d="M4 20.5V12h4v8.5M10 20.5V7h4v13.5M16 20.5V3.5h4v17M3 20.5h18" />
        </>
      );
      break;
    case "reports":
      content = (
        <>
          <path d="M4 4.5h16v12H9l-5 4z" />
          <path d="M12 7.5v4.8" />
          <circle cx="12" cy="14.3" r=".7" fill="currentColor" stroke="none" />
        </>
      );
      break;
    case "logs":
      content = (
        <>
          <path d="M7 4h12v16H7zM4 7v13h12" />
          <path d="M10 8h6M10 12h6M10 16h4" />
        </>
      );
      break;
    case "settings":
      content = (
        <>
          <circle cx="12" cy="12" r="3.1" />
          <path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6 18 18M18 6l-1.4 1.4M7.4 16.6 6 18" />
          <circle cx="12" cy="12" r="7" />
        </>
      );
      break;
  }

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
    >
      {content}
    </svg>
  );
}
export default function AdminApp({
  initialSection,
  displayName,
  signOutPath,
}: {
  initialSection: AdminSection;
  displayName: string;
  signOutPath: string;
}) {
  const { newCount, refresh: refreshReportNotification } = useReportNotification();
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState(initialSection);
  const [notice, setNotice] = useState({ message: "", error: false });
  const current = MENU.find((item) => item.id === activeSection) ?? MENU[0];

  useEffect(() => {
    void apiAction<{ backupScheduleVerified: boolean }>("admin-session")
      .then(({ backupScheduleVerified }) => {
        if (!backupScheduleVerified) return apiAction("backup-auto-if-due");
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => installStaleDeploymentRecovery(), []);

  useEffect(() => {
    const handlePopState = () => {
      const segment = window.location.pathname.split("/").filter(Boolean)[1];
      const next = MENU.find((item) => item.id === segment)?.id ?? "dashboard";
      setActiveSection(next);
      setMenuOpen(false);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    document.title = `${current.label} | 모두의 문제집 관리자`;
  }, [current.label]);

  function showNotice(message: string, error = false) {
    setNotice({ message, error });
  }

  return (
    <div className="admin-shell" data-admin-access="administrator">
      <aside className={menuOpen ? "admin-sidebar open" : "admin-sidebar"} aria-label="관리자 메뉴">
        <Link className="admin-brand" href="/admin">
          <span aria-hidden="true" />
          <strong>모두의 문제집<small>ADMIN CONSOLE</small></strong>
        </Link>
        <nav>
          {MENU.map((item) => (
            <Link
              key={item.id}
              href={item.id === "dashboard" ? "/admin" : `/admin/${item.id}`}
              className={activeSection === item.id ? "active" : ""}
              onClick={(event) => {
                if (
                  event.button !== 0
                  || event.metaKey
                  || event.ctrlKey
                  || event.shiftKey
                  || event.altKey
                ) return;
                event.preventDefault();
                const href = item.id === "dashboard" ? "/admin" : `/admin/${item.id}`;
                if (item.id === "group-exams") performance.mark("admin-group-entry-click");
                window.history.pushState({}, "", href);
                setActiveSection(item.id);
                setMenuOpen(false);
                window.scrollTo({ top: 0, left: 0, behavior: "auto" });
              }}
            >
              <span aria-hidden="true"><AdminMenuIcon name={item.icon} /></span>
              <strong><span className="admin-menu-label">{item.label}{item.id === "reports" && newCount > 0 && <b className="admin-notification-badge" aria-label={`신규 제보 ${newCount}건`}>{newCount > 99 ? "99+" : newCount}</b>}</span><small>{item.description}</small></strong>
            </Link>
          ))}
        </nav>
        <footer>
          <Link href="/">← 학습 사이트로 돌아가기</Link>
          <SignOutForm action={signOutPath} />
        </footer>
      </aside>
      {menuOpen && <button className="admin-sidebar-scrim" type="button" aria-label="메뉴 닫기" onClick={() => setMenuOpen(false)} />}

      <main className="admin-main">
        <header className="admin-topbar">
          <button className="admin-menu-button" type="button" onClick={() => setMenuOpen(true)} aria-label={newCount > 0 ? `관리자 메뉴 열기 · 신규 제보 ${newCount}건` : "관리자 메뉴 열기"}>☰{newCount > 0 && <b className="admin-notification-badge" aria-hidden="true">{newCount > 99 ? "99+" : newCount}</b>}</button>
          <div>
            <span>모두의 문제집 관리자</span>
            <h1>{current.label}</h1>
            <p>{withObjectParticle(current.description)} 안전하게 확인하고 관리합니다.</p>
          </div>
          <div className="admin-user">
            <span>{displayName.slice(0, 1)}</span>
            <strong>{displayName}<small>관리자</small></strong>
          </div>
        </header>

        <div className="admin-content">
          <RetryBoundary
            fallbackTitle="관리자 화면의 최신 파일을 불러오지 못했습니다."
            resetKey={activeSection}
          >
          {(["dashboard", "questions", "theories", "quality", "backups", "transfer"] as AdminSection[]).includes(activeSection) && (
            <Suspense fallback={<LoadingBlock />}>
              <LazyCoreSections section={activeSection} onNotice={showNotice} />
            </Suspense>
          )}
          {activeSection === "members" && (
            <Suspense fallback={<LoadingBlock />}><LazyMembersSection onNotice={showNotice} /></Suspense>
          )}
          {activeSection === "group-exams" && (
            <AdminGroupExamsSection onNotice={showNotice} />
          )}
          {activeSection === "analytics" && (
            <Suspense fallback={<LoadingBlock />}><LazyAnalyticsSection /></Suspense>
          )}
          {activeSection === "reports" && (
            <Suspense fallback={<LoadingBlock />}><LazyReportsSection onNotice={showNotice} onReportsChanged={refreshReportNotification} /></Suspense>
          )}
          {activeSection === "logs" && (
            <Suspense fallback={<LoadingBlock />}>
              <LazyLogsSection onNotice={showNotice} />
            </Suspense>
          )}
          {activeSection === "settings" && (
            <Suspense fallback={<LoadingBlock />}>
              <LazySettingsSection onNotice={showNotice} />
            </Suspense>
          )}
          </RetryBoundary>
        </div>
      </main>
      <AdminNotice
        message={notice.message}
        error={notice.error}
        onClose={() => setNotice({ message: "", error: false })}
      />
    </div>
  );
}
