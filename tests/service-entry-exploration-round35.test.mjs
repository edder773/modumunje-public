import { readFeatureSource } from "./helpers/feature-source.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function source(file) {
  return readFeatureSource(path.join(root, file), "utf8");
}

test("the learning catalog can expand from field to course, subject, unit, and content", () => {
  const catalog = source("packages/shared/src/study/learning-catalog.ts");
  const registry = source("packages/shared/src/study/course-contract.mjs");

  assert.match(catalog, /export type LearningField/u);
  assert.match(catalog, /summary:\s*string/u);
  assert.match(catalog, /courses:\s*LearningCourse\[\]/u);
  assert.match(catalog, /subjects:\s*LearningSubject\[\]/u);
  assert.match(catalog, /unitField:\s*"topic"/u);
  assert.match(catalog, /contentKinds:\s*LearningContentKind\[\]/u);
  assert.match(registry, /"cardTitle":\s*"SQL 자격증"/u);
  assert.match(registry, /"summary":\s*"SQLD 기본 과정부터 SQLP 심화 과정까지 이론, 문제 풀이와 모의고사로 학습합니다\."/u);
  assert.match(catalog, /COURSE_FIELD_DEFINITIONS\.flatMap/u);
});

test("course selection precedes the SQL learning shell without duplicate exam switches", () => {
  const study = source("apps/frontend/src/features/study/components/study-app.tsx");
  const catalogHome = source("apps/frontend/src/features/study/components/catalog/catalog-home.tsx");
  const fieldHome = study.match(/function LearningFieldHome[\s\S]*$/)?.[0] ?? "";
  const dashboard = source("apps/frontend/src/features/study/components/sql/dashboard/dashboard-screen.tsx");

  assert.doesNotMatch(study, /function ExamSwitch|mobile-exam-switch/u);
  assert.match(study, /className="learning-context-bar"/u);
  assert.match(study, /학습 과정 변경/u);
  assert.doesNotMatch(dashboard, /<ExamSwitch/u);
  assert.doesNotMatch(catalogHome, /<ExamSwitch/u);
  assert.doesNotMatch(fieldHome, /<ExamSwitch/u);
  assert.match(catalogHome, /LEARNING_CATALOG\.map/u);
  assert.match(fieldHome, /field\.courses\.map/u);
  assert.match(fieldHome, /onCourseSelect\(course\.examType\)/u);
  assert.doesNotMatch(dashboard, /field\.courses\.map/u);
});

test("SQL learning home removes both guide cards and keeps direct learning destinations", () => {
  const study = source("apps/frontend/src/features/study/components/study-app.tsx");
  const dashboard = study.match(/function Dashboard[\s\S]*?function contentScale/)?.[0] ?? "";

  assert.doesNotMatch(dashboard, /entry-hero|learner-overview|학습 안내|내 학습 안내/u);
  assert.match(dashboard, /learning-actions-section/u);
  for (const destination of [
    "문제 풀이",
    "이론 학습",
    "모의고사",
    "학습 기록",
  ]) {
    assert.match(dashboard, new RegExp(destination, "u"));
  }
  assert.match(study, /questionCount=\{dashboardQuestionCount\}/u);
  assert.match(study, /theoryCount=\{dashboardTheoryCount\}/u);
  assert.match(study, /const dashboardQuestionCount = courseOverview\?\.contentQuestionCount[\s\S]*?data\.overview\?\.questionCount/u);
  assert.match(study, /const dashboardTheoryCount = courseOverview\?\.contentTheoryCount[\s\S]*?data\.overview\?\.theoryCount/u);
  assert.match(study, /const releasedCourse = courseContentRelease\(selectedExam\)/u);
  assert.match(study, /courseOverview\?\.contentQuestionCount\s*\?\? releasedCourse\?\.questionCount/u);
  assert.match(study, /courseOverview\?\.contentTheoryCount\s*\?\? releasedCourse\?\.theoryCount/u);
  assert.match(dashboard, /explainedQuestionCount/u);
  assert.match(dashboard, /공개 범위/u);
  assert.match(dashboard, /최근 검수 반영/u);
  assert.match(dashboard, /내부 문제은행의 정확한 전체 수량은 공개하지 않습니다/u);
});

test("catalog and sidebar expose certificate and learning hierarchy in order", () => {
  const study = source("apps/frontend/src/features/study/components/study-app.tsx");
  const catalogHome = source("apps/frontend/src/features/study/components/catalog/catalog-home.tsx");
  const sidebar = study.match(/<nav className="side-nav">[\s\S]*?<\/nav>/u)?.[0] ?? "";

  assert.match(catalogHome, /const courseBased = engine\.catalog\.mode === "courses"/u);
  assert.match(catalogHome, /learningPath\(\{ examType: course\.examType, page: "home" \}\)/u);
  assert.match(catalogHome, /localPracticePath\(course\)/u);
  assert.ok(sidebar.indexOf("학습 분야") < sidebar.indexOf("courseNavItems.map"));
  assert.match(sidebar, />\s*학습 홈\s*</u);
});

test("mobile exposes the five primary course destinations directly", () => {
  const study = source("apps/frontend/src/features/study/components/study-app.tsx");
  const styles = source("apps/frontend/app/globals.css");

  assert.match(study, /<StudyMobileNavigation/u);
  assert.match(study, /label:\s*"학습 홈"/u);
  assert.match(study, /label:\s*"이론"/u);
  assert.match(study, /label:\s*"문제"/u);
  assert.match(study, /label:\s*"모의고사"/u);
  assert.match(study, /label:\s*"학습 기록"/u);
  assert.doesNotMatch(study, /mobileMoreItems|mobile-more-menu|>더보기</u);
  assert.match(study, /\{item\.mobileLabel\}/u);
  assert.match(study, /\{courseContext && \(\s*<nav className="mobile-nav"/u);
  assert.match(styles, /\.mobile-nav\s*\{[\s\S]*?grid-template-columns:\s*repeat\(5/u);
});

test("service-entry controls remain usable across desktop and mobile widths", () => {
  const styles = source("apps/frontend/app/globals.css");

  assert.match(styles, /\.entry-hero\s*\{[\s\S]*?grid-template-columns:/u);
  assert.match(styles, /\.learning-action-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(4/u);
  assert.match(styles, /\.course-choice\s*\{[\s\S]*?min-height:\s*168px/u);
  assert.match(styles, /\.course-choice\.selected/u);
  assert.match(styles, /@media \(max-width:\s*680px\)[\s\S]*?\.course-choice-grid,[\s\S]*?\.learning-action-grid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/u);
});
