import type { Metadata } from "next";
import Link from "next/link";
import {
  PublicContentShell,
  publicContentStyles as styles,
} from "@frontend/features/public-content/public-content-shell";
import { PUBLIC_GUIDE_LINKS } from "@frontend/features/public-content/public-guide-links";

export const metadata: Metadata = {
  title: "과정에 맞는 학습 순서를 확인하세요. | 모두의 문제집",
  description: "SQL·데이터 아키텍처·빅데이터분석기사·정보처리기사·SW 전공을 과목의 연결 관계와 단계별 복습 방법으로 학습하는 공개 가이드입니다.",
  alternates: { canonical: "/guides" },
  openGraph: {
    title: "과정별 학습 가이드 | 모두의 문제집",
    description: "필기·실기·SW 전공을 이해 중심으로 준비하는 학습 순서를 확인하세요.",
    type: "website",
    url: "/guides",
    locale: "ko_KR",
    siteName: "모두의 문제집",
  },
};

export default function PublicGuidesPage() {
  return (
    <PublicContentShell
      eyebrow="모두의 문제집 공개 학습 자료"
      title="과정에 맞는 학습 순서를 확인하세요."
      description="문제를 많이 푸는 것만으로는 흔들리는 개념을 찾기 어렵습니다. 모두의 문제집 공개 가이드는 각 과정의 과목이 어떻게 연결되는지, 오답을 어떤 기준으로 분류할지, 모의고사를 어떻게 복습할지 설명합니다."
    >
      <section className={styles.section} aria-labelledby="course-guides-title">
        <div className={styles.sectionHeading}>
          <h2 id="course-guides-title">과정별 학습 가이드</h2>
          <p>공개된 모든 과정의 학습 방향을 안내합니다. 가이드와 이론은 로그인 없이 읽고, 빅분기 파일 실습 문제는 로그인 후 이용하세요.</p>
        </div>
        <div className={styles.guideGrid}>
          {PUBLIC_GUIDE_LINKS.map((guide) => (
            <Link className={styles.guideCard} href={`/guides/${guide.slug}`} key={guide.slug}>
              <span>{guide.name} 학습 설계</span>
              <h2>{guide.title}</h2>
              <p>{guide.summary}</p>
              <strong>가이드 읽기 →</strong>
            </Link>
          ))}
        </div>
      </section>

      <section className={styles.section} aria-labelledby="shared-method-title">
        <div className={styles.sectionHeading}>
          <h2 id="shared-method-title">모든 과정에 적용하는 학습 원칙</h2>
          <p>과정의 범위는 달라도 개념을 이해하고 문제로 확인한 뒤 오답을 다시 학습하는 순서는 같습니다.</p>
        </div>
        <div className={styles.principleGrid}>
          <article>
            <h3>범위를 구조로 먼저 본다</h3>
            <p>과목명을 암기하기 전에 상위 개념, 세부 주제와 산출물의 관계를 한 장으로 정리합니다.</p>
          </article>
          <article>
            <h3>정답보다 판단 근거를 남긴다</h3>
            <p>맞고 틀린 결과만 저장하지 않고 선택지를 제외한 이유와 다시 적용할 규칙을 기록합니다.</p>
          </article>
          <article>
            <h3>이론과 문제를 왕복한다</h3>
            <p>이론을 모두 읽은 뒤 문제를 시작하기보다 단원마다 문제로 확인하고 부족한 부분으로 돌아갑니다.</p>
          </article>
          <article>
            <h3>모의고사는 복습 자료로 쓴다</h3>
            <p>점수뿐 아니라 풀이 시간, 확신 정도와 과목별 약점을 확인해 다음 학습 범위를 결정합니다.</p>
          </article>
        </div>
      </section>

      <aside className={styles.notice} aria-labelledby="guide-boundary-title">
        <h2 id="guide-boundary-title">시험 일정과 접수 정보는 공식 공고를 확인하세요.</h2>
        <p>모두의 문제집은 학습 흐름과 개념 복습을 지원합니다. 시험 일정, 응시 자격, 수수료와 세부 운영 규정은 변경될 수 있으므로 반드시 해당 시험 주관기관의 최신 공고를 기준으로 판단해야 합니다.</p>
        <div className={styles.actions}>
          <a className={styles.secondaryAction} href="https://www.dataq.or.kr/www/main.do" rel="noreferrer" target="_blank">데이터자격시험 공식 사이트 ↗</a>
          <a className={styles.secondaryAction} href="https://www.q-net.or.kr/" rel="noreferrer" target="_blank">Q-Net 정보처리기사 시험 정보 ↗</a>
          <Link className={styles.primaryAction} href="/">모두의 문제집 학습 시작</Link>
        </div>
      </aside>
    </PublicContentShell>
  );
}
