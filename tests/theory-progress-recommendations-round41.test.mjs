import { readFeatureSource } from "./helpers/feature-source.mjs";
import assert from "node:assert/strict";
import test from "node:test";

function source(path) {
  return readFeatureSource(new URL(`../${path}`, import.meta.url), "utf8");
}

test("theory reading has no completion state, controls or save queue", () => {
  const study = source("apps/frontend/src/features/study/components/study-app.tsx");
  const api = source("apps/backend/src/modules/study/study.service.ts");
  assert.doesNotMatch(study, /TheoryCompletionControl|saveTheoryProgress|theoryProgressSaveQueue|setSwTheoryCompletion/u);
  assert.doesNotMatch(source("apps/frontend/src/features/study/components/sql/theory/theory-screen.tsx"), /이론 학습 상태 선택|학습 완료|미학습/u);
  assert.match(api, /THEORY_PROGRESS_RETIRED/u);
});

test("SW curriculum offers three data-driven combinations that remain customizable", () => {
  const catalog = source("packages/shared/src/study/learning-catalog.ts")
    + source("packages/shared/src/study/sw-curriculum-contract.mjs");
  const study = source("apps/frontend/src/features/study/components/study-app.tsx")
    + source("apps/frontend/src/features/study/components/sw-curriculum-selection.tsx");

  for (const name of [
    "전산직·IT 기업 전공 필기",
    "정보처리기사 중심",
    "공공·금융 IT 직무",
  ]) {
    assert.ok(catalog.includes(`"name": "${name}"`));
  }
  assert.match(catalog, /recommendedCombinations:\s*SW_MAJOR_RECOMMENDED_COMBINATIONS/u);
  assert.match(study, /function applyRecommendation\(subjectIds: readonly string\[\]\)/u);
  assert.match(study, /recommendationIsSelected\(availableIds\) \? new Set\(\) : new Set\(availableIds\)/u);
  assert.match(study, /조합을 적용한 뒤 아래에서 필요한 소주제를 자유롭게 추가하거나 해제할 수 있습니다/u);
  assert.match(study, /onClick=\{\(\) => applyRecommendation\(recommendation\.subjectIds\)\}/u);
  assert.match(study, /const action = selected \? "조합 해제" : "이 조합 적용"/u);
  assert.match(study, /\{action\}/u);
  assert.doesNotMatch(study, /disabled=\{selected\}/u);
  assert.doesNotMatch(catalog, /priority:\s*"[123]순위"/u);
});

test("recommendation controls are responsive and expose selected state", () => {
  const styles = source("apps/frontend/app/globals.css")
    + source("apps/frontend/src/features/study/components/sw-curriculum.css");
  const study = source("apps/frontend/src/features/study/components/study-app.tsx")
    + source("apps/frontend/src/features/study/components/sw-curriculum-selection.tsx");

  assert.match(styles, /\.sw-recommendation-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(3/u);
  assert.match(styles, /@media \(max-width: 1024px\)[\s\S]*\.sw-recommendation-grid\s*\{[\s\S]*minmax\(0, 1fr\)/u);
  assert.doesNotMatch(styles, /\.theory-progress-toggle\s*\{[\s\S]*repeat\(2/u);
  assert.doesNotMatch(styles, /\.theory-status-button\[aria-pressed="true"\]/u);
  assert.match(study, /aria-pressed=\{selected\}/u);
  assert.doesNotMatch(study, /aria-pressed=\{!completed\}/u);
  assert.doesNotMatch(study, /aria-pressed=\{completed\}/u);
});

test("theory readers hide transient cards and use one numbered navigation pattern", () => {
  const styles = source("apps/frontend/app/globals.css");
  const study = source("apps/frontend/src/features/study/components/study-app.tsx")
    + source("apps/frontend/src/features/study/components/study-screen-shared.tsx")
    + source("apps/frontend/src/features/study/components/sw-theory-views.tsx")
    + source("apps/frontend/src/features/study/components/sql/theory/theory-screen.tsx");

  assert.match(study, /Suspense fallback=\{<span className="sr-only" role="status">/u);
  assert.match(study, /function SwContentLoadingIndicator/u);
  assert.match(study, /aria-busy=\{contentLoading\}/u);
  assert.doesNotMatch(study, /if \(contentLoading\) \{[\s\S]{0,120}return/u);
  assert.doesNotMatch(study, /markdown-render-loading/u);
  assert.doesNotMatch(styles, /\.markdown-render-loading/u);
  assert.match(study, /function theoryTocItems/u);
  assert.ok((study.match(/theoryTocItems\(/gu) ?? []).length >= 3);
  assert.match(study, /label: label\.replace/u);
  assert.match(study, /<ol>\{tocItems\.map/u);
  assert.match(styles, /\.theory-reading-progress\s*\{[\s\S]*margin-bottom:\s*22px/u);
  assert.ok((study.match(/className="back-button theory-list-back"/gu) ?? []).length >= 2);
  assert.match(styles, /\.theory-reader > \.theory-list-back\s*\{[\s\S]*justify-content:\s*flex-start/u);
  assert.match(styles, /\.field-back-button::before\s*\{[\s\S]*content:\s*"←"/u);
});
