import CommonTheoryChecklist from "@frontend/features/public-content/common-theory-checklists";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ReservedAdSlot } from "@frontend/features/advertising/reserved-ad-slot";
import {
  PublicContentShell,
  publicContentStyles as styles,
} from "@frontend/features/public-content/public-content-shell";
import {
  publicCourseGuide,
  guideLearningCourse,
  guideTheoryPath,
} from "@frontend/features/public-content/public-guide-data";
import { GUIDE_EXAMPLES } from "@frontend/features/public-content/public-guide-examples";
import {
  isPublicGuideSlug,
  PUBLIC_GUIDE_LINKS,
} from "@frontend/features/public-content/public-guide-links";

export const dynamicParams = false;

export function generateStaticParams() {
  return PUBLIC_GUIDE_LINKS.map(({ slug }) => ({ course: slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ course: string }>;
}): Promise<Metadata> {
  const { course: slug } = await params;
  if (!isPublicGuideSlug(slug)) return {};
  const guide = publicCourseGuide(slug);
  const course = guideLearningCourse(guide);
  const title = `${guide.title} | 모두의 문제집`;
  const socialTitle = `${course.name} 학습 가이드 | 모두의 문제집`;
  const description = `${course.name} 과목별 학습 초점, 단계별 공부 순서와 실전 점검 질문을 확인하세요.`;
  return {
    title,
    description,
    alternates: { canonical: `/guides/${slug}` },
    twitter: { card: "summary_large_image", title: socialTitle, description, images: ["/brand/modu-social-preview-v2.jpg"] },
    openGraph: {
      title: socialTitle,
      description,
      type: "article",
      url: `/guides/${slug}`,
      locale: "ko_KR",
      siteName: "모두의 문제집",
      images: [{
        url: "/brand/modu-social-preview-v2.jpg",
        width: 1730,
        height: 909,
        alt: "모두의 문제집 문제 풀이·오답 복습·모의시험 학습 플랫폼",
      }],
    },
  };
}

export default async function PublicCourseGuidePage({
  params,
}: {
  params: Promise<{ course: string }>;
}) {
  const { course: slug } = await params;
  if (!isPublicGuideSlug(slug)) notFound();
  const guide = publicCourseGuide(slug);
  const course = guideLearningCourse(guide);

  return (
    <PublicContentShell
      eyebrow={guide.eyebrow}
      title={guide.title}
      description={guide.description}
    >
      <div className="ad-guide-layout">
        <div className="ad-guide-article">
          <nav className={styles.sourceList} aria-label="가이드 바로가기">
            {GUIDE_EXAMPLES[slug] && <a href="#worked-example">풀이 과정이 있는 개념 예제</a>}
            {guideTheoryPath(guide) && <Link href={guideTheoryPath(guide)!}>로그인 없이 이론 읽기</Link>}
            <Link href="/about#content-principles-title">콘텐츠 작성 방식과 오류 제보</Link>
          </nav>
          {GUIDE_EXAMPLES[slug] && (() => {
            const example = GUIDE_EXAMPLES[slug]!;
            return <section className={styles.section} aria-labelledby="worked-example">
              <div className={styles.sectionHeading}>
                <p>공개 개념 해설 · 2026년 9월 21일 작성</p>
                <h2 id="worked-example">{example.title}</h2>
                <p>{example.context}</p>
              </div>
              <div className={styles.contentCard}>
                <h3>입력에서 결과까지 따라가기</h3>
                <ol className={styles.bulletList}>{example.steps.map(step => <li key={step}>{step}</li>)}</ol>
                <h3>재현 코드</h3>
                <pre className={styles.exampleCode} tabIndex={0} aria-label="개념 예제 코드"><code>{example.code}</code></pre>
                <h3>실행 결과</h3>
                <pre className={styles.exampleCode} tabIndex={0} aria-label="예제 실행 결과"><code>{example.result}</code></pre>
                <h3>잘못 적용하기 쉬운 부분</h3><p>{example.pitfall}</p>
                <h3>다른 상황에 적용하기</h3><p>{example.next}</p>
                <p>위 입력과 해설은 이 가이드의 학습용 예제입니다. 규칙의 원문은 <a href={example.source.href} target="_blank" rel="noreferrer">{example.source.label}</a>에서 확인할 수 있습니다. 실제 기출 문항이나 공식 채점 기준을 뜻하지 않습니다.</p>
              </div>
            </section>;
          })()}
          <section className={styles.section} aria-labelledby="guide-snapshot-title">
            <div className={styles.sectionHeading}>
              <h2 id="guide-snapshot-title">모두의 문제집 학습 구성</h2>
              <p>아래 정보는 공식 시험 공고를 대신하는 내용이 아니라 모두의 문제집에서 제공하는 학습 과정과 모의고사 구성입니다.</p>
            </div>
            <dl className={styles.factList}>
              <div><dt>과정</dt><dd>{course.name}</dd></div>
              <div><dt>학습 범위</dt><dd>{course.studyMode}</dd></div>
              <div><dt>모의고사</dt><dd>{course.mockExam}</dd></div>
            </dl>
          </section>

          <section className={styles.section} aria-labelledby="guide-audience-title">
            <div className={styles.sectionHeading}>
              <h2 id="guide-audience-title">이런 학습자에게 맞습니다.</h2>
            </div>
            <div className={styles.contentCard}>
              <ul className={styles.bulletList}>
                {guide.audience.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          </section>

          <section className={styles.section} aria-labelledby="subject-focus-title">
            <div className={styles.sectionHeading}>
              <h2 id="subject-focus-title">과목별 학습 초점</h2>
              <p>각 과목에서 무엇을 이해하고 어떤 방식으로 확인할지 먼저 정하면 문제 수에만 끌려가지 않을 수 있습니다.</p>
            </div>
            <div className={styles.subjectGrid}>
              {course.subjects.map((subject) => {
                const guidance = guide.subjectGuidance[subject.id];
                if (!guidance) return null;
                return (
                  <article className={styles.subjectCard} key={subject.id}>
                    <h3>{subject.name}</h3>
                    <p><strong>이해할 것.</strong> {guidance.focus}</p>
                    <p><strong>연습할 것.</strong> {guidance.practice}</p>
                  </article>
                );
              })}
            </div>
          </section>

          <section className={styles.section} aria-labelledby="learning-order-title">
            <div className={styles.sectionHeading}>
              <h2 id="learning-order-title">권장 학습 순서</h2>
              <p>진도를 한 번에 끝내려 하지 말고 이해, 확인, 오답 분류와 실전 재현을 짧은 주기로 반복합니다.</p>
            </div>
            <div className={styles.steps}>
              {guide.learningSteps.map((step) => (
                <article className={styles.stepCard} key={step.label}>
                  <span className={styles.stepLabel}>{step.label}</span>
                  <div>
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className={styles.section} aria-labelledby="self-check-title">
            <div className={styles.sectionHeading}>
              <h2 id="self-check-title">실전 전 자가 점검</h2>
              <p>다음 질문을 정답 보기 없이 자신의 말과 예제로 설명할 수 있는지 확인하세요.</p>
            </div>
            <div className={styles.contentCard}>
              <ul className={styles.checkList}>
                {guide.checkpoints.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          </section>

          <CommonTheoryChecklist slug={slug} />

          <section className={styles.section} aria-labelledby="guide-closing-title">
            <div className={styles.contentCard}>
              <h2 id="guide-closing-title">마지막으로 기억할 점</h2>
              <p>{guide.closing}</p>
            </div>
          </section>

        </div>
        <ReservedAdSlot placement="guideSidebar" />
      </div>

      <ReservedAdSlot placement="guideFooter" />

      <aside className={styles.notice} aria-labelledby="official-information-title">
        <h2 id="official-information-title">{["software-major", "skct-personal"].includes(guide.slug) ? "선택한 범위로 학습 이어가기" : "시험 정보는 해당 주관기관에서 확인하세요."}</h2>
        {!["software-major", "skct-personal"].includes(guide.slug) && <p>시험 일정, 접수, 응시 자격과 최신 세부 규정은 해당 시험 주관기관의 공고에서 확인하세요.</p>}
        <div className={styles.actions}>
          {guideTheoryPath(guide) && <Link className={styles.secondaryAction} href={guideTheoryPath(guide)!}>공개 이론 읽기</Link>}
          <Link className={styles.primaryAction} href={course.href}>{course.name} 학습 시작</Link>
          <Link className={styles.secondaryAction} href="/guides">다른 과정 가이드</Link>
          {!["software-major", "skct-personal"].includes(guide.slug) && <a className={styles.secondaryAction} href={guide.examType === "ISEW" ? "https://www.cq.or.kr/qh_quagm01_020.do" : guide.examType === "IPEW" || guide.examType === "IPEP" ? "https://www.q-net.or.kr/" : "https://www.dataq.or.kr/www/main.do"} rel="noreferrer" target="_blank">공식 시험 정보 ↗</a>}
        </div>
      </aside>
    </PublicContentShell>
  );
}
