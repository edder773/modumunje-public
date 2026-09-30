import { readFeatureSource } from "./helpers/feature-source.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function source(file) {
  return readFeatureSource(path.join(projectRoot, file), "utf8");
}

test("learner-facing theory details omit update timestamps and use a visible return action", () => {
  const component = source("apps/frontend/src/features/study/components/sql/theory/theory-screen.tsx");
  const styles = source("apps/frontend/app/globals.css");

  assert.doesNotMatch(component, /최근 수정|최근 갱신|updatedAt/);
  assert.match(component, /className="theory-list-back-icon"[\s\S]*?←[\s\S]*?이론 목록으로 돌아가기/);
  assert.match(styles, /\.back-button\s*\{[\s\S]*min-height:\s*40px[\s\S]*padding:\s*9px 13px/);
});

test("practice hides visible question numbers while mock exams retain session navigation", () => {
  const practice = source("apps/frontend/src/features/study/components/sql/practice/practice-screen.tsx");
  const runner = source("apps/frontend/src/features/study/components/sql/mock/exam-runner.tsx");

  assert.doesNotMatch(practice, /문제 \{cursor \+ 1\}/);
  assert.match(runner, /문제 \{currentIndex \+ 1\}/);
  assert.doesNotMatch(practice, /displayOrder|표시 번호/);
  assert.doesNotMatch(runner, /displayOrder|표시 번호/);
});

test("learning records separate incorrect questions and bookmarks while keeping bookmark practice", () => {
  const component = source("apps/frontend/src/features/study/components/sql/records/records-screen.tsx")
    + source("apps/frontend/src/features/study/components/study-app.tsx");
  const styles = source("apps/frontend/app/globals.css");

  assert.match(component, /function LearningRecordsHub/);
  assert.match(component, /풀이·모의고사 기록/);
  assert.match(component, /오답 문제/);
  assert.match(component, /북마크/);
  assert.match(component, /mode="incorrect"/);
  assert.match(component, /mode="bookmarks"/);
  assert.match(component, /question\.bookmarked/);
  assert.match(component, /bookmarkOnly/);
  assert.match(component, /북마크 문제 풀기/);
  assert.match(component, /title="북마크 문제 풀기"/);
  assert.match(component, /bookmark-practice-map/);
  assert.doesNotMatch(component, /정답을 보지 않고 풀기|bookmark-row-practice/);
  assert.match(styles, /\.bookmark-modal-quiz\s*\{/);
  assert.match(styles, /\.bookmark-list \.wrong-card-foot strong/);
});

test("admin dashboard provides fixed KST DAU and rolling 30-day MAU", () => {
  const api = source("apps/backend/src/modules/admin/admin-request-handlers.ts");
  const component = source("apps/frontend/src/features/admin/components/admin-dashboard-section.tsx");
  const styles = source("apps/frontend/app/admin/admin.css");

  assert.match(api, /const dailyStart = startOfKoreanDay\(now\)\.toISOString\(\)/);
  assert.match(api, /const monthlyStart = new Date\(now\.getTime\(\) - 30 \* 86_400_000\)\.toISOString\(\)/);
  assert.match(api, /COUNT\(DISTINCT e\.anonymous_session_id\) AS count/);
  assert.match(api, /dailyActiveUsers:\s*Number\(dailyActiveUsers\?\.count \?\? 0\)/);
  assert.match(api, /monthlyActiveUsers:\s*Number\(monthlyActiveUsers\?\.count \?\? 0\)/);
  assert.match(component, /일간 활성 사용자 \(DAU\)/);
  assert.match(component, /월간 활성 사용자 \(MAU\)/);
  assert.match(component, /오늘 한국 시간 · 익명 방문 식별자 기준/);
  assert.match(component, /최근 30일 · 익명 방문 식별자 기준/);
  assert.match(component, /묶어서 보기/);
  assert.match(component, /각각 보기/);
  assert.match(component, /admin-trend-y-axis/);
  assert.match(styles, /\.admin-active-user-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(styles, /\.admin-trend-y-axis\s*\{/);
});
