import { readFeatureSource } from "./helpers/feature-source.mjs";
import assert from "node:assert/strict";
import test from "node:test";

function source(path) {
  return readFeatureSource(new URL(`../${path}`, import.meta.url), "utf8");
}

test("SW major is a selectable content field with an isolated learning flow", () => {
  const catalog = source("packages/shared/src/study/learning-catalog.ts");
  const engine = source("packages/shared/src/study/learning-engine.ts");
  const study = source("apps/frontend/src/features/study/components/study-app.tsx")
    + source("apps/frontend/src/features/study/components/sw-curriculum-selection.tsx")
    + source("apps/frontend/src/features/study/model/sw-study-api-client.ts");

  assert.match(
    catalog,
    /id:\s*"software-major"[\s\S]*?engineId:\s*"curriculum"[\s\S]*?status:\s*"content-ready"[\s\S]*?courses:\s*\[\][\s\S]*?subjectGroups:\s*SW_MAJOR_SUBJECT_GROUPS/u,
  );
  assert.match(catalog, /segments\.length === 2[\s\S]*LEARNING_CATALOG\.some/u);
  assert.match(study, /engine\.homeView === "curriculum-planner"/u);
  assert.match(study, /fieldUsesSectionRoutes/u);
  assert.match(study, /이론·객관식 문제 제공/u);
  assert.match(catalog, /shortLabel:\s*"SW"/u);
  assert.match(engine, /actionLabelSuffix:\s*"학습 범위 선택 →"/u);
});

test("SW major curriculum uses topic hierarchy without fixed priority labels", () => {
  const catalog = source("packages/shared/src/study/learning-catalog.ts")
    + source("packages/shared/src/study/sw-curriculum-contract.mjs");
  const expectedSubjects = [
    "자료구조",
    "알고리즘",
    "운영체제",
    "컴퓨터구조",
    "데이터베이스·SQL",
    "네트워크·데이터통신",
    "프로그래밍 언어·객체지향",
    "소프트웨어공학·시스템 분석설계",
    "정보보안·개인정보보호",
    "시스템 운영·Linux·미들웨어",
    "IT 서비스·프로젝트·거버넌스",
    "클라우드·분산시스템·DevOps",
    "데이터분석·확률통계 기초",
    "AI·머신러닝·생성형 AI 기초",
    "디지털 신기술·IT 상식",
  ];

  for (const subject of expectedSubjects) {
    assert.ok(catalog.includes(`"name": "${subject}"`));
  }
  for (const group of [
    "컴퓨터과학 기초",
    "데이터와 통신",
    "소프트웨어 개발과 설계",
    "보안과 시스템 운영",
    "데이터·AI와 디지털 기술",
  ]) {
    assert.ok(catalog.includes(`"name": "${group}"`));
  }
  assert.doesNotMatch(catalog, /priority:\s*"[123]순위"/u);
  assert.doesNotMatch(catalog, /futureTracks/u);
});

test("SW curriculum supports cross-topic selection and browser persistence", () => {
  const study = source("apps/frontend/src/features/study/components/study-app.tsx")
    + source("apps/frontend/src/features/study/components/sw-curriculum-selection.tsx")
    + source("apps/frontend/src/features/study/persistence/sw-learning-store.ts");

  assert.match(study, /function SwCurriculumPlanner/u);
  assert.match(study, /baeumzip-sw-curriculum-selection:v2/u);
  assert.match(study, /toggleGroup\(subjectIds: string\[\]\)/u);
  assert.match(study, /toggleSubject\(subjectId: string\)/u);
  assert.match(study, /대주제 전체 선택/u);
  assert.match(study, /선택한 소주제 \{selectedSubjects\.length\}개/u);
  assert.match(study, /aria-label=\{`\$\{subject\.name\} 선택 해제`\}/u);
  assert.match(study, /onClick=\{\(\) => toggleSubject\(subject\.id\)\}/u);
  assert.match(study, /학습 메뉴에서 이론, 문제 또는 문항 수를 지정한 모의고사/u);
  assert.match(study, /requestSwStudyData/u);
  assert.match(study, /view:\s*"theories"/u);
  assert.match(study, /view:\s*"practice"/u);
});

test("SW learning uses restorable navigation and configurable mock exams", () => {
  const catalog = source("packages/shared/src/study/learning-catalog.ts");
  const study = source("apps/frontend/src/features/study/components/study-app.tsx")
    + source("apps/frontend/src/features/study/components/sw-mock-setup.tsx");
  const api = source("apps/backend/src/modules/sw-study/sw-study.service.ts");
  const styles = source("apps/frontend/app/globals.css");

  assert.match(catalog, /LearningFieldSection = "home" \| "theories" \| "practice" \| "mock-exams"/u);
  assert.match(catalog, /if \(!route\.section \|\| route\.section === "home"\) return base/u);
  assert.match(catalog, /theoryPublicId\(route\.theoryId\)/u);
  assert.match(study, /const swNavItems:[\s\S]*학습 홈[\s\S]*이론[\s\S]*문제[\s\S]*모의고사/u);
  assert.match(study, /const visibleSwNavItems = hasSwCurriculumSelection[\s\S]*swNavItems[\s\S]*item[.]id === "curriculum"/u);
  assert.match(study, /fieldContext && fieldUsesSectionRoutes && visibleSwNavItems[.]map/u);
  assert.match(study, /fieldContext && fieldUsesSectionRoutes && \(/u);
  assert.match(study, /className="mobile-nav sw-mobile-nav"/u);
  assert.match(study, /type="number"[\s\S]*min=\{5\}[\s\S]*max=\{100\}/u);
  assert.match(study, /startPractice\(undefined, mockQuestionCount, "mock"\)/u);
  assert.match(study, /모의고사 제출/u);
  assert.match(study, /모의고사 결과/u);
  assert.match(api, /Math\.min\([\s\S]*100,[\s\S]*Math\.max\(1/u);
  assert.match(styles, /\.sw-mobile-nav\s*\{[\s\S]*repeat\(4, minmax\(0, 1fr\)\)/u);
});

test("SW content routes require a saved scope and fall back to curriculum selection", () => {
  const study = source("apps/frontend/src/features/study/components/study-app.tsx")
    + source("apps/frontend/src/features/study/persistence/sw-learning-store.ts");

  assert.match(study, /function validSwCurriculumSelectionCount/u);
  assert.match(study, /if \(!selectedSubjectIds[.]size\) \{[\s\S]*setContentError\(""\)[\s\S]*showView\("curriculum"\)/u);
  assert.match(study, /if \(selectedSubjectIds[.]size \|\| contentView === "curriculum"\) return/u);
  assert.match(study, /학습 범위가 비어 있어 범위 선택 화면으로 돌아왔습니다[.]/u);
});

test("SW curriculum selection cards stay readable and collapse only on mobile", () => {
  const styles = source("apps/frontend/src/features/study/components/sw-curriculum.css");
  const study = source("apps/frontend/src/features/study/components/sw-curriculum-selection.tsx");
  const mobileBreakpoint = styles.indexOf("@media (max-width: 680px)");

  assert.match(styles, /\.sw-subject-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(3/u);
  assert.match(styles, /@media \(max-width: 1024px\)[\s\S]*\.sw-subject-grid\s*\{[\s\S]*repeat\(2/u);
  assert.match(styles, /@media \(max-width: 680px\)[\s\S]*\.sw-subject-grid\s*\{[\s\S]*minmax\(0, 1fr\)/u);
  assert.match(styles, /\.sw-subject-card h3[\s\S]*overflow-wrap:\s*anywhere/u);
  assert.match(styles, /\.sw-subject-card:has\(input:focus-visible\)/u);
  assert.match(study, /type="checkbox"[\s\S]*aria-label=\{`\$\{subject\.name\} 소주제 선택`\}/u);
  assert.match(study, /aria-pressed=\{groupIsSelected\}/u);
  assert.match(study, /sw-mobile-group-toggle[\s\S]*aria-expanded=\{!mobileCollapsed\}/u);
  assert.ok(mobileBreakpoint > 0);
  assert.match(styles.slice(0, mobileBreakpoint), /\.sw-mobile-group-toggle\s*\{\s*display:\s*none/u);
  assert.doesNotMatch(styles.slice(0, mobileBreakpoint), /data-mobile-collapsed/u);
  assert.match(styles.slice(mobileBreakpoint), /data-mobile-collapsed="true"[\s\S]*display:\s*none/u);
});
