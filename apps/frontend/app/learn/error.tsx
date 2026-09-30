"use client";

import Link from "next/link";

export default function LearningError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="route-status-page">
      <section className="card route-status-card" role="alert">
        <span className="section-kicker">학습 데이터 오류</span>
        <h1>이 학습 화면을 준비하지 못했습니다.</h1>
        <p>화면을 불러오지 못했습니다. 진행 중인 시험이 있다면 새로고침 후 상태를 확인해 주세요.</p>
        <div className="route-status-actions">
          <button className="primary-button" type="button" onClick={reset}>다시 시도</button>
          <Link className="secondary-button" href="/">학습 분야로 이동</Link>
        </div>
      </section>
    </main>
  );
}
