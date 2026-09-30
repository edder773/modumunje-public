import type { Metadata } from "next";
import LearnerPage from "@frontend/features/study/pages/learner-page";
import { loadLearnerPageContext } from "@frontend/server/auth/page-session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "모두의 문제집에서 무엇을 공부할까요? | 자격증·전공 학습 플랫폼",
  description: "SQL·데이터 아키텍처·빅데이터분석기사·정보처리기사·정보보안기사·SW 전공·SKCT의 필기, 실기와 전공 과정을 선택하세요.",
  alternates: {
    canonical: "/",
  },
};

const websiteStructuredData = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": "https://modumunje.com/#website",
  url: "https://modumunje.com/",
  name: "모두의 문제집",
  alternateName: ["모두의문제집", "모두의 문제집 자격증 학습"],
  inLanguage: "ko-KR",
} as const;

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ auth_error?: string; q?: string; field?: string; page?: string }>;
}) {
  const initialPath = "/";
  const { auth_error: authError, q, field, page } = await searchParams;
  const context = await loadLearnerPageContext(initialPath);
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteStructuredData) }}
      />
      <LearnerPage
        initialPath={initialPath}
        authError={Boolean(authError)}
        catalogFilters={{ query: typeof q === "string" ? q : "", fieldId: typeof field === "string" ? field : "", page: typeof page === "string" && /^\d+$/u.test(page) ? Number(page) : 1 }}
        {...context}
      />
    </>
  );
}
