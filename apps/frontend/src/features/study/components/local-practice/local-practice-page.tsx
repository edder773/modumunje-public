import type { LearnerPageSession } from "@shared/auth/page-session";
import { localPracticePath, localPracticeWorkbooks, type parseLocalPracticePath } from "@shared/study/local-practice";
import CatalogPageShell from "../catalog/catalog-page-shell";
import LocalPracticeWorkbook from "./workbook";
import Type2Workbook from "./type2-workbook";
import Type3Workbook from "./type3-workbook";
import "./local-practice.css";

export default function LocalPracticePage({ route, session }: { route: NonNullable<ReturnType<typeof parseLocalPracticePath>>; session: Exclude<LearnerPageSession, { status: "blocked" }> }) {
  const { course, section, release, workbook } = route;
  const authenticated = session.status === "active";
  const home = localPracticePath(course);
  const workbooks = localPracticeWorkbooks(course).map(item => ({ ...item, questionCount: item.release.questionCount, moduleCount: item.release.moduleCount, subquestionCount: item.release.subquestionCount }));
  return <CatalogPageShell displayName={session.displayName} signInPath={session.signInPath} signOutPath={authenticated ? session.signOutPath : ""}
    isAuthenticated={authenticated} adminAccess={authenticated && session.adminAccess}
    groupExamAccess={authenticated && session.groupExamAccess}
    context={{ title: course.name, description: section === "home" ? "유형별 학습" : `${workbook.title} · ${release.questionCount}${release.subquestionCount ? `개 사례 · ${release.subquestionCount}개 소문항` : "문항"}` }}
    navigation={[{ href: home, label: "학습 홈", icon: "⌂", active: section === "home" }, ...workbooks.flatMap(item => item.href ? [{ href: item.href, label: item.title, icon: "✓", active: section === "workbook" && item.id === workbook.id }] : [])]}>
    <div className="local-practice page-stack"><nav className="local-practice-breadcrumb" aria-label="현재 위치"><a href="/">학습 분야</a><span>›</span><a href={`/learn/${course.fieldId}`}>빅데이터 분석</a><span>›</span><a href={home}>{course.name}</a>{section === "workbook" && <><span>›</span><span aria-current="page">{workbook.title}</span></>}</nav>
      {section === "home" ? <section className="local-practice-home" aria-label="실기 유형 선택">
        <div className="local-practice-section-grid">{workbooks.map((item, index) => (
          <article className={`card local-practice-section${item.href ? " is-available" : " is-upcoming"}`} key={item.id}>
            <div className="local-practice-section-head">
              <span className="topic-icon local-practice-type-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
              <div className="local-practice-section-copy"><h2>{item.title}</h2>
                <span className="local-practice-availability">{item.href ? "학습 가능" : "준비 중"}</span>
              </div>
            </div>
            {item.description && <p className="local-practice-note">{item.description}</p>}
            {item.href ? <>
              <div className="local-practice-section-action">
                <p className="local-practice-note"><strong>{item.questionCount}</strong>{item.subquestionCount ? <>개 사례 · <strong>{item.subquestionCount}</strong>개 소문항</> : "문항"}{Boolean(item.moduleCount) && <> <span aria-hidden="true">·</span> <strong>{item.moduleCount}</strong>소단원</>}</p>
                <a className="outline-button local-practice-section-link" href={item.href} aria-label={`${item.title} 학습하기`}>문제집 열기 <span aria-hidden="true">→</span></a>
              </div>
            </> : <p className="local-practice-note local-practice-upcoming-note">학습 자료가 공개되면 이용할 수 있습니다.</p>}
          </article>
        ))}</div>
      </section> : workbook.id === "type-3" ? <Type3Workbook release={release} /> : workbook.id === "type-2" ? <Type2Workbook release={release} /> : <LocalPracticeWorkbook release={release} />}
    </div>
  </CatalogPageShell>;
}
