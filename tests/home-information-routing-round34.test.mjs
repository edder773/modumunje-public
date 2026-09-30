import { readFeatureSource } from "./helpers/feature-source.mjs";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFeatureSource(new URL(`../${path}`, import.meta.url), "utf8");
}

test("learning catalog models field, course, subject, unit, and content without changing content rows", () => {
  const catalog = source("packages/shared/src/study/learning-catalog.ts");
  const registry = source("packages/shared/src/study/course-contract.mjs");

  assert.match(catalog, /export const LEARNING_CATALOG/u);
  assert.match(registry, /"id":\s*"sql"[\s\S]*"name":\s*"SQL"/u);
  assert.match(registry, /"examType":\s*"SQLD"/u);
  assert.match(registry, /"examType":\s*"SQLP"/u);
  assert.match(catalog, /COURSE_FIELD_DEFINITIONS\.flatMap/u);
  assert.match(catalog, /const courses = registeredCourses\(field\.id\)/u);
  assert.match(catalog, /subjects:\s*course\.releasedSubjects\.map/u);
  assert.match(catalog, /unitField:\s*"topic"/u);
  assert.match(catalog, /contentKinds:\s*\[\.\.\.course\.contentKinds\]/u);
  assert.match(catalog, /function learningLocation/u);
});

test("question routes are directly restorable while learner answers stay private", () => {
  const catalog = source("packages/shared/src/study/learning-catalog.ts");
  const route = source("apps/frontend/app/learn/[...segments]/page.tsx");
  const study = source("apps/frontend/src/features/study/components/study-app.tsx");
  const learningRouter = source("apps/frontend/src/features/study/routing/use-learning-router.ts");

  assert.match(catalog, /route\.page === "question"\) return `\$\{base\}\/questions\/\$\{route\.id\}`/u);
  assert.match(catalog, /route\.page === "field"[\s\S]*`\/learn\/\$\{route\.fieldId\}`/u);
  assert.match(catalog, /\/theories\/\$\{theoryPublicId\(route\.id\)\}/u);
  assert.match(catalog, /\/mock-exams\/active/u);
  assert.match(catalog, /page === "questions" && segments\.length === 5/u);
  assert.match(catalog, /parseLearningPath/u);
  assert.match(route, /if \(!route\) notFound\(\)/u);
  assert.match(route, /LearnerPage initialPath=\{initialPath\}/u);
  assert.match(study, /useLearningRouter\(\)/u);
  assert.match(study, /const hiddenQuestionRoute = currentHiddenQuestionRoute\(\)[\s\S]*isInitialRestore[\s\S]*\? initialLearningRoute/u);
  assert.doesNotMatch(study, /restorePracticeSession/u);
  assert.match(learningRouter, /window\.addEventListener\("popstate", handlePopState\)/u);
  assert.match(learningRouter, /strategy: "router" \| "client" = "client"/u);
  assert.match(learningRouter, /router\[mode === "push" \? "push" : "replace"\]/u);
  assert.match(
    learningRouter,
    /if \(strategy === "client"\)[\s\S]*window\.history\.pushState/u,
  );
  assert.match(learningRouter, /function hiddenQuestionRouteFromHistory/u);
});

test("home separates learning field, course selection, and course learning actions", () => {
  const study = source("apps/frontend/src/features/study/components/study-app.tsx");
  const fieldHome = source("apps/frontend/src/features/study/components/learning-field-home.tsx");
  const catalogHome = source("apps/frontend/src/features/study/components/catalog/catalog-home.tsx");
  const dashboard = source("apps/frontend/src/features/study/components/sql/dashboard/dashboard-screen.tsx");
  const styles = source("apps/frontend/app/globals.css");

  assert.doesNotMatch(catalogHome, /무엇을 공부하고 싶으신가요/u);
  assert.match(catalogHome, /<section aria-labelledby="learning-fields-title">/u);
  assert.match(catalogHome, /LEARNING_CATALOG\.map/u);
  assert.doesNotMatch(catalogHome, /UPCOMING_LEARNING_FIELDS\.map/u);
  assert.match(catalogHome, /href: learningPath\(\{ fieldId: field\.id, page: "field" \}\)/u);
  assert.doesNotMatch(catalogHome, /"use client"|from "next\/link"/u);
  assert.match(catalogHome, /<a className="catalog-field-link" href=\{field\.href\}/u);
  assert.match(catalogHome, /action="\/" method="get"/u);
  assert.match(catalogHome, /type="submit"/u);
  assert.match(catalogHome, /href=\{pageHref/u);
  assert.match(catalogHome, /이론은 로그인 없이 읽을 수 있습니다\. 문제 풀이·모의고사·학습 기록은 로그인 후/u);
  assert.equal(existsSync(new URL("../apps/frontend/app/learn/loading.tsx", import.meta.url)), false);
  assert.doesNotMatch(catalogHome, /이어서 학습하기|continue-learning-card|최근 학습/u);
  assert.match(fieldHome, /buildCourseCardViewModels\([\s\S]*field\.courses/u);
  assert.match(fieldHome, /courseCards\.map/u);
  assert.match(fieldHome, /onCourseSelect\(course\.examType\)/u);
  assert.doesNotMatch(fieldHome, /학습할 과정이나 자격증을 선택하세요/u);
  assert.match(fieldHome, /<section aria-label="학습 과정">/u);
  assert.doesNotMatch(dashboard, /LEARNING_CATALOG\.map/u);
  assert.doesNotMatch(dashboard, /이론부터 모의고사까지 이어서 학습하세요|학습 안내|내 학습 안내/u);
  assert.match(dashboard, /title:\s*"문제 풀이"/u);
  assert.match(dashboard, /title:\s*"이론 학습"/u);
  assert.match(dashboard, /title:\s*"모의고사"/u);
  assert.match(dashboard, /title:\s*"학습 기록"/u);
  assert.match(dashboard, /오답 문제, 북마크와 모의고사 결과/u);
  assert.doesNotMatch(dashboard, /objectiveAttemptCount|최근 활동:/u);
  assert.doesNotMatch(dashboard, /최근 학습 이어하기/u);
  assert.doesNotMatch(dashboard, /onResume/u);
  assert.match(dashboard, /learning-actions-section/u);
  assert.doesNotMatch(dashboard, /<ExamSwitch/u);
  assert.match(study, /learningLevel === "root"[\s\S]*rootCatalog/u);
  assert.match(study, /fieldContext[\s\S]*<LearningFieldHome/u);
  assert.match(study, /courseContext[\s\S]*<Dashboard/u);
  assert.match(styles, /\.course-choice-grid\s*\{/u);
  assert.match(styles, /\.learning-action-grid\s*\{/u);
  assert.match(styles, /\.learning-action-grid\s*\{/u);
});

test("login plumbing and the direct five-item mobile navigation structure stay intact", () => {
  const learner = source("apps/frontend/src/features/study/pages/learner-page.tsx");
  const pageSession = source("apps/frontend/src/server/auth/page-session.ts");
  const study = source("apps/frontend/src/features/study/components/study-app.tsx");

  assert.match(pageSession, /getSiteUser\(\)/u);
  assert.match(pageSession, /siteSignInPath\(initialPath\)/u);
  assert.match(learner, /session\.status === "guest"/u);
  assert.match(study, /<StudyMobileNavigation/u);
  assert.match(study, /label:\s*"이론"/u);
  assert.match(study, /<nav className="mobile-nav"/u);
  assert.doesNotMatch(study, /mobile-more-menu|>더보기</u);
});
