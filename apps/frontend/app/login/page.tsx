import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { safeRelativeReturnPath } from "@backend/common/auth/google-session";
import { getSiteUser, siteSignInPath } from "@frontend/server/auth/site-auth";
import { learningCourse, learningField, learningPath, parseLearningPath } from "@shared/study/learning-catalog";
import LoginNotice from "@frontend/features/auth/login-notice";
import "@frontend/features/auth/login-notice.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "로그인이 필요합니다. | 모두의 문제집",
  description: "이론은 로그인 없이 읽고, 문제 풀이·모의고사·학습 기록은 로그인 후 이용하세요.",
  robots: { index: false, follow: false },
  alternates: { canonical: "/login" },
};

export default async function LoginPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  let returnTo = safeRelativeReturnPath(query.return_to);
  let pathname = new URL(returnTo, "https://baeumzip.internal").pathname;
  if (pathname === "/login" || pathname.startsWith("/login/")) {
    returnTo = "/";
    pathname = "/";
  }
  if (await getSiteUser()) redirect(returnTo);

  const route = parseLearningPath(pathname);
  const homePath = route
    ? learningPath(route.page === "field" ? { fieldId: route.fieldId, page: "field" } : { examType: route.examType, page: "home" })
    : "/";
  const destinationName = route
    ? (route.page === "field" ? learningField(route.fieldId)?.cardTitle : learningCourse(route.examType).name) ?? "학습 안내"
    : pathname.startsWith("/admin") ? "관리자 페이지" : "학습 안내";
  return <LoginNotice signInPath={siteSignInPath(returnTo)} homePath={homePath} destinationName={destinationName} isAdmin={/^\/admin(?:\/|$)/u.test(pathname)} />;
}
