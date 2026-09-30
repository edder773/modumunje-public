import type { Metadata } from "next";
import { parseLocalPracticePath } from "@shared/study/local-practice";
import LocalPracticePage from "@frontend/features/study/components/local-practice/local-practice-page";
import { notFound, permanentRedirect } from "next/navigation";
import { isIndexableLearningRoute, isTheoryReadingRoute } from "@shared/study/learning-access";
import PublicTheoryPage from "@frontend/features/public-content/public-theory-page";
import { publicTheoryPage } from "@frontend/server/public-theory";
import LearnerPage from "@frontend/features/study/pages/learner-page";
import {
  canonicalLearningEntry,
  learningPageMeta,
  learningPath,
  parseLearningPath,
} from "@shared/study/learning-catalog";
import { loadLearnerPageContext } from "@frontend/server/auth/page-session";
import { parsePreparingLearningPath } from "@shared/study/preparing-courses";
import CoursePreparation from "@frontend/features/study/components/catalog/course-preparation";
import SkctPersonalPage from "@frontend/features/study/components/skct-personal/skct-personal-page";
import "@frontend/features/study/components/catalog/course-preparation.css";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ segments: string[] }>;
}): Promise<Metadata> {
  const { segments } = await params;
  const initialPath = `/learn/${segments.map(encodeURIComponent).join("/")}`;
  const canonicalEntry = canonicalLearningEntry(initialPath);
  if (canonicalEntry) permanentRedirect(canonicalEntry);
  if (["/learn/skct-personal", "/learn/skct-personal/practice", "/learn/skct-personal/mock-exams", "/learn/skct-personal/records"].includes(initialPath))
    return { title: "SKCT 개인학습 | 모두의 문제집", robots: { index: false, follow: true } };
  const preparing = parsePreparingLearningPath(initialPath);
  if (preparing) return { title: `${preparing.course?.name ?? preparing.field.cardTitle} | 모두의 문제집`, description: "이론과 문제 학습 자료를 준비하고 있습니다.", robots: { index: false, follow: true }, alternates: { canonical: initialPath } };
  const localPractice = parseLocalPracticePath(initialPath);
  if (localPractice) return { title: localPractice.section === "home"
    ? `${localPractice.course.name} | 모두의 문제집`
    : `${localPractice.course.name} · ${localPractice.workbook.title} | 모두의 문제집`, description: localPractice.course.summary,
    robots: { index: localPractice.section === "home", follow: true }, alternates: { canonical: initialPath } };
  const route = parseLearningPath(initialPath);
  if (!route) return {};
  const pageMeta = learningPageMeta(route);
  const document = isTheoryReadingRoute(route) ? await publicTheoryPage(initialPath) : null;
  if (isTheoryReadingRoute(route) && !document) notFound();
  const article = document?.selected;
  const metadata = article ? {
    title: `${article.title} | ${document.name} | 모두의 문제집`,
    description: article.summary || `${article.title}의 핵심 개념과 예제를 읽어 보세요.`,
  } : pageMeta;
  return {
    ...metadata,
    robots: {
      index: isIndexableLearningRoute(route),
      follow: true,
    },
    alternates: {
      canonical: article?.canonical ?? learningPath(route),
    },
    openGraph: {
      ...metadata,
      type: "website",
      url: article?.canonical ?? learningPath(route),
      locale: "ko_KR",
      siteName: "모두의 문제집",
    },
  };
}

export default async function LearningPage({
  params, searchParams,
}: {
  params: Promise<{ segments: string[] }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { segments } = await params;
  const initialPath = `/learn/${segments.map(encodeURIComponent).join("/")}`;
  const canonicalEntry = canonicalLearningEntry(initialPath);
  if (canonicalEntry) permanentRedirect(canonicalEntry);
  const skctView = initialPath === "/learn/skct-personal" ? "home"
    : initialPath === "/learn/skct-personal/practice" ? "practice"
      : initialPath === "/learn/skct-personal/mock-exams" ? "mock"
        : initialPath === "/learn/skct-personal/records" ? "records" : null;
  if (skctView) {
    const search = await searchParams ?? {};
    const attemptId = typeof search.attempt === "string" && /^[a-fA-F0-9-]{36}$/u.test(search.attempt) ? search.attempt : null;
    const returnTo = attemptId ? `${initialPath}?attempt=${encodeURIComponent(attemptId)}` : initialPath;
    const context = await loadLearnerPageContext(initialPath, returnTo);
    if (context.session.status === "blocked") return <LearnerPage initialPath={initialPath} {...context} />;
    return <SkctPersonalPage session={context.session} view={skctView} initialAttemptId={attemptId} />;
  }
  const search = await searchParams ?? {};
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item);
  }
  const returnTo = initialPath + (query.size ? `?${query}` : "");
  const preparing = parsePreparingLearningPath(initialPath);
  if (preparing) {
    const context = await loadLearnerPageContext(initialPath);
    if (context.session.status === "blocked") return <LearnerPage initialPath={initialPath} {...context} />;
    return <CoursePreparation route={preparing} session={context.session} />;
  }
  const localPractice = parseLocalPracticePath(initialPath);
  if (localPractice) {
    const context = await loadLearnerPageContext(initialPath, returnTo);
    if (context.session.status === "blocked") return <LearnerPage initialPath={initialPath} {...context} />;
    return <LocalPracticePage route={localPractice} session={context.session} />;
  }
  const route = parseLearningPath(initialPath);
  if (!route) notFound();
  if (isTheoryReadingRoute(route)) {
    if (initialPath !== learningPath(route)) permanentRedirect(learningPath(route));
    const scalar = (key: string) => typeof search[key] === "string" ? search[key] : undefined;
    return <PublicTheoryPage pathname={initialPath} filters={{ category: scalar("category"), topic: scalar("topic"), q: scalar("q") }} />;
  }
  const context = await loadLearnerPageContext(initialPath, returnTo);
  return <LearnerPage initialPath={initialPath} {...context} />;
}
