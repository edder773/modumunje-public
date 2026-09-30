import Link from "next/link";
import type { ReactNode } from "react";
import { learningField, learningFieldForCourse, learningPath, parseLearningPath } from "@shared/study/learning-catalog";
import { courseNavItems, swNavItems } from "@frontend/features/study/components/study-app-config";
import { fieldSectionForSwView, routeForView } from "@frontend/features/study/components/study-navigation";
import StudyTopbar from "@frontend/features/study/components/study-topbar";

export default function PublicTheoryShell({ name, listPath, practicePath, selected, children }: {
  name: string; listPath: string; practicePath: string | null; selected: boolean; children: ReactNode;
}) {
  const route = parseLearningPath(listPath)!;
  const course = route.page !== "field";
  const field = course ? learningFieldForCourse(route.examType)! : learningField(route.fieldId)!;
  const items = course
    ? courseNavItems(route.examType).map((item) => ({ ...item, active: item.id === "theory", href: learningPath(routeForView(item.id, route.examType)) }))
    : swNavItems.map((item) => ({ ...item, active: item.id === "theories", href: learningPath({ fieldId: field.id, page: "field", section: fieldSectionForSwView(item.id) }) }));
  return <div className={course ? "app-shell course-context" : "app-shell catalog-context"}>
    <a className="skip-link" href="#public-content">본문으로 건너뛰기</a>
    <aside className="sidebar" aria-label="주요 메뉴">
      <Link className="brand" href="/" aria-label="모두의 문제집 홈">
        <span className="brand-mark" aria-hidden="true" />
        <span><strong>모두의 문제집</strong><small>{field.name} 학습 공간</small></span>
      </Link>
      <nav className="side-nav">
        <Link className="nav-item" href="/" aria-label="학습 분야" data-tooltip="학습 분야"><span className="nav-icon" aria-hidden="true">⌂</span>학습 분야</Link>
        {items.map((item) => <Link key={item.id} className={`nav-item${item.active ? " active" : ""}`} href={item.href} aria-label={item.label} data-tooltip={item.label} aria-current={item.active ? "page" : undefined}>
          <span className="nav-icon" aria-hidden="true">{item.icon}</span>{item.label}
        </Link>)}
      </nav>
      <div className="sidebar-foot"><p><span>현재 학습 · {name}</span><span>이론은 로그인 없이 읽을 수 있습니다.</span></p></div>
    </aside>
    <main className="main-area" id="public-content" tabIndex={-1}>
      <StudyTopbar eyebrow={course ? `현재 선택한 ${field.name} 과정` : field.name} title={`${name} 이론 학습`} contentUsesPrimaryHeading={selected}
        actions={practicePath ? <a className="top-login-link" href={practicePath}>문제 풀기</a> : undefined} />
      <nav className="learning-context-bar" aria-label="현재 학습 과정">
        <div><span>현재 학습:</span><strong>{field.name}</strong>{course && <><i aria-hidden="true">›</i><strong>{name}</strong></>}</div>
        <div className="learning-context-actions"><Link href="/">학습 분야</Link><Link href={learningPath({ fieldId: field.id, page: "field" })}>{course ? "학습 과정 변경" : "학습 범위"}</Link></div>
      </nav>
      {children}
    </main>
    <nav className={`mobile-nav${course ? "" : " sw-mobile-nav"}`} aria-label="모바일 메뉴">
      {items.map((item) => <Link key={item.id} className={`mobile-nav-item${item.active ? " active" : ""}`} href={item.href} aria-current={item.active ? "page" : undefined}>
        <span aria-hidden="true">{item.icon}</span>{item.mobileLabel}
      </Link>)}
    </nav>
  </div>;
}
