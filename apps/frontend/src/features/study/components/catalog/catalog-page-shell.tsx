import type { ReactNode } from "react";
import SignOutForm from "@frontend/features/auth/sign-out-form";
import StudyTopbar from "../study-topbar";
import CatalogReportAction from "./catalog-report-action";

export default function CatalogPageShell({
  displayName,
  signInPath,
  signOutPath,
  isAuthenticated,
  adminAccess,
  groupExamAccess = false,
  children,
  context,
  navigation,
}: {
  displayName: string;
  signInPath: string;
  signOutPath: string;
  isAuthenticated: boolean;
  adminAccess: boolean;
  groupExamAccess?: boolean;
  children: ReactNode;
  context?: { title: string; description: string };
  navigation?: { href: string; label: string; icon: string; active?: boolean }[];
}) {
  return (
    <div className="app-shell catalog-context">
      <a className="skip-link" href="#main-content">본문으로 건너뛰기</a>
      <aside className="sidebar" aria-label="주요 메뉴">
        <a className="brand" href="/" aria-label="모두의 문제집">
          <span className="brand-mark" aria-hidden="true" />
          <span><strong>모두의 문제집</strong><small>학습 분야 탐색</small></span>
        </a>
        <nav className="side-nav">
          <a className={`nav-item${context ? "" : " active"}`} href="/" aria-current={context ? undefined : "page"} aria-label="학습 분야" data-tooltip="학습 분야">
            <span className="nav-icon" aria-hidden="true">⌂</span>학습 분야
          </a>
          {navigation?.map(item => (
            <a key={item.href} className={`nav-item${item.active ? " active" : ""}`} href={item.href}
              aria-current={item.active ? "page" : undefined} aria-label={item.label} data-tooltip={item.label}>
              <span className="nav-icon" aria-hidden="true">{item.icon}</span>{item.label}
            </a>
          ))}
        </nav>
        <div className="sidebar-foot">
          {adminAccess && <a className="admin-entry-link" href="/admin">관리자 운영 페이지 →</a>}
          <p><span>분야별 학습 과정 탐색</span><span>모두의 문제집 학습 공간</span></p>
        </div>
      </aside>

      <main className="main-area" id="main-content" tabIndex={-1}>
        <StudyTopbar
          eyebrow={<span className="catalog-brand"><span className="brand-mark" aria-hidden="true" />모두의 문제집</span>}
          title={context?.title ?? "모두의 문제집에서 무엇을 공부할까요?"}
          description={context?.description ?? "원하는 학습 분야를 선택해 이론부터 문제 풀이와 모의고사까지 학습하세요."}
          contentUsesPrimaryHeading={false}
          actions={(
            <>
              {isAuthenticated && <CatalogReportAction />}
              {isAuthenticated && adminAccess && groupExamAccess && <a className="top-admin-link" href="/groups">그룹 SKCT</a>}
              {adminAccess && <a className="top-admin-link" href="/admin">관리자</a>}
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
        {children}
      </main>
    </div>
  );
}
