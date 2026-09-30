import Link from "next/link";

export default function NotFound() {
  return (
    <main className="route-status-page">
      <section className="card route-status-card">
        <span className="section-kicker">404</span>
        <h1>요청한 페이지를 찾을 수 없습니다.</h1>
        <p>주소가 바뀌었거나 존재하지 않는 페이지입니다.</p>
        <div className="route-status-actions"><Link className="primary-button" href="/">홈으로 이동</Link><Link className="outline-button" href="/#catalog-course-search">학습 과정 검색</Link></div>
      </section>
    </main>
  );
}
