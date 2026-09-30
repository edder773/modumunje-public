import type { Metadata, Viewport } from "next";
import "./globals.css";
import "@frontend/features/errors/route-status.css";
import PageViewTracker from "@frontend/features/study/telemetry/page-view-tracker";
import type { PageViewScope } from "@frontend/features/study/telemetry/page-view-scope";
import { LEARNING_CATALOG } from "@shared/study/learning-catalog";

// Serialize only route prefixes; the full registry stays out of the root client tracker.
const PAGE_VIEW_SCOPES: PageViewScope[] = [...LEARNING_CATALOG.flatMap(field => [
  ...field.courses.map(course => ({ prefix: `/learn/${field.id}/${course.id}`, examScope: course.examType })),
  ...(field.analyticsScope ? [{ prefix: `/learn/${field.id}`, examScope: field.analyticsScope }] : []),
]),{prefix:"/groups",examScope:"GROUP_SKCT"}];

export const metadata: Metadata = {
  metadataBase: new URL("https://modumunje.com"),
  title: "모두의 문제집 | 자격증·전공 학습 플랫폼",
  description: "SQL·데이터 아키텍처·빅데이터분석기사·정보처리기사·정보보안기사·SW 전공·SKCT를 이론, 문제 풀이, 모의고사와 실습으로 학습하세요.",
  openGraph: {
    title: "모두의 문제집 | 자격증·전공 학습 플랫폼",
    description: "SQL·데이터 아키텍처·빅데이터분석기사·정보처리기사·정보보안기사·SW 전공·SKCT를 이론, 문제 풀이, 모의고사와 실습으로 학습하세요.",
    type: "website",
    url: "/",
    locale: "ko_KR",
    siteName: "모두의 문제집",
    images: [{
      url: "/brand/modu-social-preview-v2.jpg",
      width: 1730,
      height: 909,
      alt: "모두의 문제집 문제 풀이·오답 복습·모의시험 학습 플랫폼",
    }],
  },
  twitter: {
    card: "summary_large_image",
    title: "모두의 문제집 | 자격증·전공 학습 플랫폼",
    description: "SQL·데이터 아키텍처·빅데이터분석기사·정보처리기사·정보보안기사·SW 전공·SKCT를 이론, 문제 풀이, 모의고사와 실습으로 학습하세요.",
    images: ["/brand/modu-social-preview-v2.jpg"],
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <head>
        <link rel="icon" href="/favicon.png" type="image/png" sizes="96x96" />
        <meta name="google-adsense-account" content="ca-pub-4499860671643104" />
      </head>
      <body className="antialiased">{children}<PageViewTracker scopes={PAGE_VIEW_SCOPES} /></body>
    </html>
  );
}
