"use client";

import Link from "next/link";

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="route-status-page">
      <section className="card route-status-card" role="alert">
        <span className="section-kicker">일시적인 오류</span>
        <h1>학습 화면을 불러오지 못했습니다.</h1>
        <p>현재 페이지에서 다시 시도하거나 학습 분야로 돌아갈 수 있습니다.</p>
        <div className="route-status-actions">
          <button className="primary-button" type="button" onClick={reset}>다시 시도</button>
          <Link className="secondary-button" href="/">학습 분야로 이동</Link>
        </div>
      </section>
    </main>
  );
}
