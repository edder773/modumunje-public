import type { LearnerPageSession } from "@shared/auth/page-session";
import { PREPARING_COURSES, preparingCoursePath, type PreparingLearningRoute } from "@shared/study/preparing-courses";
import CatalogPageShell from "./catalog-page-shell";

export default function CoursePreparation({ route, session }: {
  route: PreparingLearningRoute;
  session: Exclude<LearnerPageSession, { status: "blocked" }>;
}) {
  const { field, course } = route;
  const courses = PREPARING_COURSES.filter(item => item.fieldId === field.id);
  const visible = course ? [course] : courses;
  const authenticated = session.status === "active";
  return <CatalogPageShell
    displayName={session.displayName} signInPath={session.signInPath}
    signOutPath={authenticated ? session.signOutPath : ""}
    isAuthenticated={authenticated} adminAccess={authenticated && session.adminAccess}
    groupExamAccess={authenticated && session.groupExamAccess}
    context={{ title: course?.name ?? field.cardTitle, description: "학습 자료 준비 중" }}
    navigation={courses.map(item => ({ href: preparingCoursePath(item), label: item.name.replace(`${field.cardTitle} `, "") + " 학습 홈", icon: "▤", active: item.courseId === course?.courseId }))}>
    <div className="page-stack course-preparation">
      <nav className="preparation-breadcrumb" aria-label="현재 위치"><a href="/">학습 분야</a><span aria-hidden="true">›</span><a href={`/learn/${field.id}`}>{field.cardTitle}</a>{course && <><span aria-hidden="true">›</span><span aria-current="page">{course.name.replace(`${field.cardTitle} `, "")}</span></>}</nav>
      <section className="card preparation-notice"><span className="preparation-badge">준비 중</span><p>이론과 문제를 준비하고 있습니다. 자료 검수를 마친 과정부터 학습할 수 있습니다.</p></section>
      <div className={`preparation-courses${course ? " single" : ""}`}>
        {visible.map(item => <section className="card preparation-course" key={item.examType}>
          <div><span className="section-kicker">{item.studyMode}</span><h2>{item.name}</h2><p>{item.summary}</p></div>
          <div><h3>학습 범위</h3><ol>{item.subjects.map(subject => <li key={subject.id}>{subject.name}</li>)}</ol></div>
          <p className="preparation-features">이론 · 문제 풀이 · 모의고사 준비 중</p>
          {!course && <a className="outline-button" href={preparingCoursePath(item)}>{item.name.replace(`${field.cardTitle} `, "")} 학습 홈 <span aria-hidden="true">→</span></a>}
        </section>)}
      </div>
      {field.id === "information-security" && <p className="preparation-source">학습 범위 기준: <a href="https://www.cq.or.kr/qh_quagm01_020.do" target="_blank" rel="noreferrer">한국방송통신전파진흥원 자격검정 안내</a></p>}
    </div>
  </CatalogPageShell>;
}
