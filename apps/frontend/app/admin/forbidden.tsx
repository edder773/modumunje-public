import Link from "next/link";
import SignOutForm from "@frontend/features/auth/sign-out-form";
import { applicationSignOutPath } from "@frontend/server/auth/site-auth";

export default function Forbidden() {
  return (
    <main className="admin-access-page">
      <section className="admin-access-card">
        <span>403</span>
        <h1>관리자 권한이 없습니다.</h1>
        <p>이 페이지는 모두의 문제집 운영자 계정으로만 접근할 수 있습니다.</p>
        <div>
          <Link href="/">학습 사이트로 돌아가기</Link>
          <SignOutForm action={applicationSignOutPath("/admin")}>
            다른 계정으로 로그인
          </SignOutForm>
        </div>
      </section>
    </main>
  );
}
