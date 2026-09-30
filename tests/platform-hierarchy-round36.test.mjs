import { readFeatureSource } from "./helpers/feature-source.mjs";
import assert from "node:assert/strict";
import test from "node:test";

function source(path) {
  return readFeatureSource(new URL(`../${path}`, import.meta.url), "utf8");
}

test("platform metadata and first screen describe an extensible learning service", () => {
  const layout = source("apps/frontend/app/layout.tsx");
  const page = source("apps/frontend/app/page.tsx");
  const study = source("apps/frontend/src/features/study/components/study-app.tsx");
  const registry = source("packages/shared/src/study/course-contract.mjs");
  const catalogHome = source("apps/frontend/src/features/study/components/catalog/catalog-home.tsx");

  assert.match(layout, /모두의 문제집 \| 자격증·전공 학습 플랫폼/u);
  assert.match(layout, /SQL·데이터 아키텍처·빅데이터분석기사·정보처리기사·정보보안기사·SW 전공·SKCT를 이론, 문제 풀이, 모의고사와 실습/u);
  assert.match(page, /title:\s*"모두의 문제집에서 무엇을 공부할까요\? \| 자격증·전공 학습 플랫폼"/u);
  assert.match(study, /\? "무엇을 공부할까요\?"/u);
  assert.match(catalogHome, /<section aria-labelledby="learning-fields-title">/u);
  assert.match(registry, /"cardTitle":\s*"SQL 자격증"/u);
  assert.match(catalogHome, /const courseBased = engine\.catalog\.mode === "courses"/u);
  assert.match(catalogHome, /learningPath\(\{ examType: course\.examType, page: "home" \}\)/u);
  assert.match(catalogHome, /localPracticePath\(course\)/u);
  assert.doesNotMatch(catalogHome, /UPCOMING_LEARNING_FIELDS\.map/u);
  assert.match(catalogHome, /PUBLIC_GUIDE_LINKS\.map/u);
  assert.match(catalogHome, /새 과정은 콘텐츠와 학습 동선의 검수를 마친 뒤 공개합니다/u);
});

test("course pages expose one current-learning control and five clear destinations", () => {
  const study = source("apps/frontend/src/features/study/components/study-app.tsx");

  assert.doesNotMatch(study, /function ExamSwitch|mobile-exam-switch/u);
  assert.match(study, /className="learning-context-bar"/u);
  assert.match(study, /현재 학습:/u);
  assert.match(study, /href="\/" onNavigate=\{onLearningRoot\}>학습 분야/u);
  assert.match(study, /학습 과정 변경/u);
  for (const label of ["학습 홈", "이론", "문제", "모의고사", "학습 기록"]) {
    assert.match(study, new RegExp(`label:\\s*"${label}"`, "u"));
  }
  assert.match(study, /<StudyMobileNavigation/u);
  assert.doesNotMatch(study, /mobileMoreItems|mobile-more-menu/u);
});

test("learning records group attempts, incorrect questions, bookmarks, and mock results", () => {
  const study = source("apps/frontend/src/features/study/components/study-app.tsx");
  const catalog = source("packages/shared/src/study/learning-catalog.ts");
  const records = study.match(
    /function LearningRecordsHub[\s\S]*?function WrongNote/,
  )?.[0] ?? "";

  assert.match(records, /풀이·모의고사 기록/u);
  assert.match(records, /오답 문제/u);
  assert.match(records, /북마크/u);
  assert.match(records, /attempt\.result !== "correct"/u);
  assert.match(catalog, /records\/bookmarks/u);
  assert.match(catalog, /records\/incorrect/u);
});

test("direct learner routes provide route-specific metadata", () => {
  const route = source("apps/frontend/app/learn/[...segments]/page.tsx");
  const catalog = source("packages/shared/src/study/learning-catalog.ts");

  assert.match(route, /export async function generateMetadata/u);
  assert.match(route, /learningPageMeta\(route\)/u);
  assert.match(route, /canonical:\s*article\?\.canonical \?\? learningPath\(route\)/u);
  assert.match(catalog, /\$\{examName\} 학습 홈 \| 모두의 문제집/u);
  assert.match(catalog, /\$\{examName\} 이론 학습 \| 모두의 문제집/u);
  assert.match(catalog, /\$\{examName\} 문제 풀이 \| 모두의 문제집/u);
  assert.match(catalog, /\$\{examName\} 모의고사 \| 모두의 문제집/u);
});
