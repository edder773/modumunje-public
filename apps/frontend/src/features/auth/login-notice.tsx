export default function LoginNotice({ signInPath, homePath, destinationName, isAdmin = false }: {
  signInPath: string;
  homePath: string;
  destinationName: string;
  isAdmin?: boolean;
}) {
  return <main className="login-notice-page">
    <section className="card login-notice-card" aria-labelledby="login-notice-title">
      <a className="login-notice-brand" href="/">모두의 문제집</a>
      <span className="login-notice-icon" aria-hidden="true">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
        </svg>
      </span>
      <p className="section-kicker">{destinationName}</p>
      <h1 id="login-notice-title">로그인이 필요합니다.</h1>
      <p className="login-notice-description">{isAdmin
        ? "관리자 페이지는 로그인 후 이용할 수 있습니다. 로그인한 계정의 접근 권한을 확인합니다."
        : <>문제 풀이·모의고사·학습 기록은 로그인 후 이용할 수 있습니다.<br />이론은 로그인 없이 계속 읽을 수 있습니다.</>}</p>
      <div className="login-notice-actions">
        <a className="primary-button" href={signInPath}>Google로 로그인</a>
        <a className="outline-button" href={homePath}>학습 홈으로</a>
      </div>
      <p>로그인 시 이메일·표시 이름·Google 계정 식별자를 사용합니다. <a href="/privacy">개인정보처리방침</a></p>
      <p className="login-notice-return">로그인하면 선택한 화면으로 돌아옵니다.</p>
    </section>
  </main>;
}
