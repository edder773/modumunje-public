import type { Metadata } from "next";
import Link from "next/link";
import {
  PublicContentShell,
  publicContentStyles as styles,
} from "@frontend/features/public-content/public-content-shell";

export const metadata: Metadata = {
  title: "배운 내용을 문제와 기록으로 연결하는 학습 공간입니다. | 모두의 문제집",
  description: "모두의 문제집이 이론, 문제 풀이, 오답 복습과 모의고사를 연결하는 방법과 콘텐츠 검수 원칙을 안내합니다.",
  alternates: { canonical: "/about" },
  openGraph: {
    title: "모두의 문제집 소개와 콘텐츠 원칙",
    description: "자격증과 전공 학습을 구조화하는 모두의 문제집의 학습 설계와 콘텐츠 검수 원칙입니다.",
    type: "website",
    url: "/about",
    locale: "ko_KR",
    siteName: "모두의 문제집",
  },
};

export default function AboutPage() {
  return (
    <PublicContentShell
      eyebrow="서비스 소개"
      title="배운 내용을 문제와 기록으로 연결하는 학습 공간입니다."
      description="모두의 문제집은 자격증과 소프트웨어 전공 학습자가 이론을 읽는 데서 멈추지 않고 문제로 확인하고, 오답과 학습 기록을 다음 공부로 이어 가도록 설계한 독립적인 학습 서비스입니다."
    >
      <section className={styles.section} aria-labelledby="why-title">
        <div className={styles.contentCard}>
          <h2 id="why-title">왜 모두의 문제집을 만들었나요?</h2>
          <p>자격시험 공부는 범위가 넓고 비슷한 용어가 많아 정답만 반복해서 외우기 쉽습니다. 그러나 표현이 달라지거나 여러 개념이 한 문제에 섞이면 암기한 문장만으로 판단하기 어렵습니다. 모두의 문제집은 과목과 단원 구조를 먼저 보여 주고, 이론과 문제를 직접 연결하며, 틀린 이유를 다시 확인할 수 있도록 학습 흐름을 구성합니다.</p>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="learning-design-title">
        <div className={styles.sectionHeading}>
          <h2 id="learning-design-title">학습 흐름</h2>
          <p>각 기능은 따로 존재하는 메뉴가 아니라 다음 학습을 결정하는 하나의 순환 과정입니다.</p>
        </div>
        <div className={styles.principleGrid}>
          <article><h3>1. 범위 이해</h3><p>과정, 과목과 단원 순서를 확인하고 현재 학습할 범위를 선택합니다.</p></article>
          <article><h3>2. 개념 학습</h3><p>핵심 개념, 비교 기준과 적용 조건을 읽고 연결 문제로 이해를 확인합니다.</p></article>
          <article><h3>3. 문제 풀이</h3><p>답을 선택하거나 직접 입력하고, 파일 실습에서는 코드를 실행해 참고 풀이와 비교합니다.</p></article>
          <article><h3>4. 복습 결정</h3><p>오답, 북마크와 모의고사 결과를 모아 다음에 읽을 이론과 풀 문제를 정합니다.</p></article>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="content-principles-title">
        <div className={styles.sectionHeading}>
          <h2 id="content-principles-title">콘텐츠 작성과 검수 원칙</h2>
          <p>문제 수를 늘리는 것보다 학습자가 근거를 확인할 수 있는 상태를 우선합니다.</p>
        </div>
        <div className={styles.contentCard}>
          <p>문제 초안 작성에는 ChatGPT를 활용합니다. AI 생성 여부 자체가 정확성이나 독창성을 보증하지는 않습니다. 자동 검사는 데이터 형식·정답 연결·실행 결과 등을 확인하는 도구이며, 모든 설명에 대한 전문가 검수나 시험 시행기관의 인증을 의미하지 않습니다.</p>
          <ul className={styles.bulletList}>
            <li>문제에는 답만 제시하지 않고 정답 근거와 오답 판단 기준을 함께 제공합니다.</li>
            <li>객관식 선택지와 정답 번호, 서술형 채점 기준, 실기 단답형의 정답표 일치를 문제 형식에 맞게 검사합니다.</li>
            <li>이론과 문제의 연결이 실제 과목 및 주제 관계를 따르는지 확인합니다.</li>
            <li>중복·표현만 바꾼 문항, 답을 노출하는 제목과 출처가 불분명한 자료는 검토·수정 대상으로 관리합니다. 생성형 AI가 만든 자료라도 제3자의 저작권 검토가 면제되지는 않습니다.</li>
            <li>새 과정은 콘텐츠, 데이터 정합성, 학습 동선과 운영 검증을 통과한 뒤 공개합니다.</li>
          </ul>
          <p>잘못된 설명을 발견하면 <a href="mailto:maintainer@example.com">운영자 이메일</a>로 페이지 주소, 오류 문장과 판단 근거를 보내 주세요. 개인정보나 실제 시험의 비공개 자료는 보내지 않아도 됩니다. 자료의 법규·제품 버전·시험 범위는 해당 기관의 최신 원문과 함께 확인하세요.</p>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="public-private-title">
        <div className={styles.contentCard}>
          <h2 id="public-private-title">공개 안내와 개인 학습 영역을 구분합니다.</h2>
          <p>이론과 학습 가이드는 로그인 없이 이용할 수 있습니다. 문제 풀이·채점·해설·모의고사·실습 문제·학습 기록은 로그인 후 이용하세요. 풀이 기록·오답·북마크·모의고사 결과를 계정에 보관하고 다른 기기에서 이어갈 수 있습니다. 이론 진도는 기록하지 않습니다.</p>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="advertising-principle-title">
        <div className={styles.contentCard}>
          <h2 id="advertising-principle-title">광고가 학습 판단을 방해하지 않게 운영합니다.</h2>
          <p>현재 모두의 문제집에는 Google AdSense 광고가 활성화되어 있지 않습니다. 향후 광고를 도입하더라도 문제 선택지, 정답 확인, 이전·다음 이동 버튼과 인접한 위치에는 배치하지 않습니다. 관리자·모의고사 화면은 광고 없이 유지하고, 공개 가이드 및 일반 문제풀이 화면의 하단처럼 학습 조작과 충분히 떨어진 위치만 검토합니다.</p>
        </div>
      </section>

      <aside className={styles.notice} aria-labelledby="independent-service-title">
        <h2 id="independent-service-title">모두의 문제집은 시험 시행기관이 아닙니다.</h2>
        <p>시험 일정, 접수, 응시 자격, 합격 기준과 자격 발급에 관한 최종 정보는 각 시행기관의 최신 공고를 확인해야 합니다. 콘텐츠 오류나 개인정보 관련 문의는 운영자 이메일로 알려 주세요.</p>
        <div className={styles.actions}>
          <Link className={styles.primaryAction} href="/guides">공개 학습 가이드</Link>
          <a className={styles.secondaryAction} href="mailto:maintainer@example.com">운영자에게 문의</a>
        </div>
      </aside>
    </PublicContentShell>
  );
}
