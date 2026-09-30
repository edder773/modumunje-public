"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ko">
      <body>
        <main style={{ maxWidth: 720, margin: "10vh auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
          <h1>모두의 문제집을 불러오지 못했습니다.</h1>
          <p>일시적인 오류가 발생했습니다. 다시 시도하거나 첫 화면으로 이동해 주세요.</p>
          <button type="button" onClick={reset} style={{ marginRight: 12, padding: "12px 18px" }}>
            다시 시도
          </button>
          <a href="/">첫 화면으로 이동</a>
        </main>
      </body>
    </html>
  );
}
