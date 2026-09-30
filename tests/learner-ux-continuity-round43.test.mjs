import { readFeatureSource } from "./helpers/feature-source.mjs";
import assert from "node:assert/strict";
import test from "node:test";

function source(path) {
  return readFeatureSource(new URL(`../${path}`, import.meta.url), "utf8");
}

test("the learner entry groups direct course links in compact field rows", () => {
  const catalog = source("packages/shared/src/study/learning-catalog.ts");
  const registry = source("packages/shared/src/study/course-contract.mjs");
  const swCurriculum = source("packages/shared/src/study/sw-curriculum-contract.mjs");
  const engine = source("packages/shared/src/study/learning-engine.ts");
  const study = source("apps/frontend/src/features/study/components/study-app.tsx");
  const entry = source("apps/frontend/src/features/study/components/catalog/catalog-home.tsx");

  assert.match(registry, /"cardTitle":\s*"SQL 자격증"/u);
  assert.match(registry, /SQLD 기본 과정[\s\S]*SQLP 심화 과정/u);
  assert.match(catalog, /shortLabel:\s*"SW"/u);
  assert.match(swCurriculum, /SW_CURRICULUM_FIELD_ID = "software-major"/u);
  assert.match(engine, /actionLabelSuffix:\s*"학습 범위 선택 →"/u);
  assert.match(study, /\? "무엇을 공부할까요\?"/u);
  assert.match(entry, /learningPath\(\{ examType: course\.examType, page: "home" \}\)/u);
  assert.match(entry, /`\$\{field\.shortLabel\} \$\{engine\.catalog\.actionLabelSuffix\}`/u);
  assert.match(entry, /<a className="catalog-field-link" href=\{field\.href\}/u);
  assert.match(entry, /<a href=\{link\.href\} className="catalog-course-link"/u);
  assert.match(entry, /searchCatalogFields\(fields, query\)/u);
  assert.doesNotMatch(entry, /<button[^>]*className="card learning-field-card/u);
  assert.match(entry, /추천 학습 순서/u);
  assert.match(entry, /모든 학습 메뉴는 필요에 따라 자유롭게 이동할 수 있습니다/u);
});

test("the entry fetch stays lightweight without exposing a recent-progress card", () => {
  const api = source("apps/backend/src/modules/study/study.service.ts");
  const engine = source("packages/shared/src/study/learning-engine.ts");
  const study = source("apps/frontend/src/features/study/components/study-app.tsx");
  const apiClient = source("apps/frontend/src/features/study/model/study-api-client.ts");
  const entry = source("apps/frontend/src/features/study/components/catalog/catalog-home.tsx");

  assert.match(engine, /id:\s*"certification"[\s\S]*apiPath:\s*"\/api\/study"/u);
  assert.match(apiClient, /`\$\{STUDY_CONTENT_ADAPTER\.apiPath\}\?\$\{search\.toString\(\)\}`/u);
  assert.doesNotMatch(apiClient, /["']full["']/u);
  assert.match(api, /lastActivityAt/u);
  assert.match(api, /lastActivityKind/u);
  assert.match(api, /lastTheoryId/u);
  assert.doesNotMatch(entry, /stats\.lastActivityAt|swLearningState\.lastLocation/u);
  assert.doesNotMatch(entry, /이어서 학습하기|continue-learning-card|최근 학습/u);
  assert.match(
    study,
    /loadMarkdownRenderer\s*=\s*\(\)\s*=>\s*import\("@frontend\/features\/content\/components\/markdown-renderer"\)[\s\S]*lazy\(loadMarkdownRenderer\)/u,
  );
  assert.doesNotMatch(study, /from "react-markdown"/u);
});

test("learning routes use stable public locations without exposing database keys", () => {
  const catalog = source("packages/shared/src/study/learning-catalog.ts");
  const study = source("apps/frontend/src/features/study/components/study-app.tsx")
    + source("apps/frontend/src/features/study/components/sw-curriculum-planner.tsx")
    + source("apps/frontend/src/features/study/components/routed-link.tsx");

  assert.match(catalog, /function theoryPublicId/u);
  assert.match(catalog, /function theoryIdFromPublicId/u);
  assert.match(catalog, /\/theories\/\$\{theoryPublicId\(route\.id\)\}/u);
  assert.match(catalog, /\/mock-exams\/active/u);
  assert.match(catalog, /route\.page === "question"\) return `\$\{base\}\/questions\/\$\{route\.id\}`/u);
  assert.match(study, /function RoutedLink/u);
  assert.match(study, /event\.button !== 0[\s\S]*event\.metaKey[\s\S]*event\.ctrlKey/u);
  assert.match(study, /target === "theories" && initialTheoryId[\s\S]*if \(!selectedSubjectIds\.size\)/u);
});

test("ordinary practice starts fresh while mock exams keep resumable progress", () => {
  const study = source("apps/frontend/src/features/study/components/study-app.tsx")
    + source("apps/frontend/src/features/study/components/sw-curriculum-planner.tsx")
    + source("apps/frontend/src/features/study/persistence/guest-learning-store.ts")
    + source("apps/frontend/src/features/study/persistence/sw-learning-store.ts");
  const swApi = source("apps/backend/src/modules/sw-study/sw-study.service.ts");

  assert.doesNotMatch(study, /type PracticeSessionSnapshot|function restorePracticeSession|sql-study-practice:/u);
  assert.match(study, /readRecentSqlPracticeQuestionIds/u);
  assert.match(study, /writeRecentSqlPracticeQuestionIds/u);
  assert.match(study, /SW_CURRICULUM_SELECTION_KEY = "baeumzip-sw-curriculum-selection:v2"/u);
  assert.match(study, /encodeURIComponent\(userKeyHash\)/u);
  assert.match(study, /type SwPersistedSession/u);
  assert.match(study, /view:\s*"session"[\s\S]*ids:\s*requestedSessionIds\.join/u);
  assert.match(swApi, /view === "session"/u);
  assert.match(study, /contentView === "mock"[\s\S]*next\.activeSession/u);
  assert.match(study, /delete next\.activeSession/u);
  assert.match(study, /window\.addEventListener\("beforeunload"/u);
});

test("long content, touch targets, safe areas and focus states share common safeguards", () => {
  const study = source("apps/frontend/src/features/study/components/study-app.tsx");
  const styles = source("apps/frontend/app/globals.css");
  const markdown = source("apps/frontend/src/features/content/components/markdown-renderer.tsx");
  const unifiedStyles = styles.split("/* Unified learner entry, resilient content, and WCAG-oriented interaction. */")[1] ?? "";

  assert.match(study, /className="skip-link" href="#main-content"/u);
  assert.match(study, /id="main-content"/u);
  assert.match(markdown, /function MarkdownCodeBlock/u);
  assert.doesNotMatch(markdown, /navigator\.clipboard|copyCode|>복사</u);
  assert.doesNotMatch(styles, /\.code-block-head button/u);
  assert.match(styles, /\.main-area,[\s\S]*\.question-card,[\s\S]*min-width:\s*0/u);
  assert.match(styles, /\.theory-reader\s*\{[\s\S]*max-width:\s*1180px/u);
  assert.match(styles, /\.theory-content,[\s\S]*max-width:\s*1040px/u);
  assert.match(styles, /overflow-wrap:\s*anywhere/u);
  assert.match(styles, /env\(safe-area-inset-bottom\)/u);
  assert.match(styles, /:focus-visible/u);
  assert.match(styles, /min-height:\s*44px/u);
  assert.match(styles, /grid-auto-rows:\s*1fr/u);
  assert.match(styles, /\.choice\s*\{[\s\S]*?min-height:\s*64px;[\s\S]*?align-items:\s*center/u);
  assert.match(styles, /\.choice > span,[\s\S]*?\.choice > i\s*\{[\s\S]*?margin-top:\s*0/u);
  assert.doesNotMatch(unifiedStyles, /\.main-area,\s*\.page-stack/u);
  assert.match(unifiedStyles, /\.main-area\s*\{\s*min-width:\s*0/u);
  assert.match(source("apps/frontend/src/features/study/components/learning-feedback.tsx"), /function learnerSafeErrorMessage/u);
});

test("mock exams expose answer status and inline unanswered confirmation", () => {
  const study = source("apps/frontend/src/features/study/components/study-app.tsx")
    + source("apps/frontend/src/features/study/components/sw-question-runners.tsx")
    + source("apps/frontend/src/features/study/components/sql/mock/exam-runner.tsx");

  assert.match(study, /응답 <strong>\{answeredCount\}문항<\/strong>/u);
  assert.match(study, /미응답 <strong>\{unansweredCount\}문항<\/strong>/u);
  assert.match(study, /미응답 \{unansweredCount\}문항이 있습니다/u);
  assert.match(study, /미응답 포함 제출/u);
  assert.match(study, /aria-current=\{index === currentIndex \? "step" : undefined\}/u);
  assert.match(study, /const resultBreakdowns/u);
  assert.match(study, /\["과목별"[\s\S]*\["주제별"[\s\S]*\["난이도별"/u);
});
