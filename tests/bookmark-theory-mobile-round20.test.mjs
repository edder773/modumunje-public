import { readFeatureSource } from "./helpers/feature-source.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const component = readFeatureSource(path.join(projectRoot, "apps/frontend/src/features/study/components/study-app.tsx"), "utf8");
const styles = readFeatureSource(path.join(projectRoot, "apps/frontend/app/globals.css"), "utf8");

test("bookmark cards open a hidden-answer practice modal without a separate row action", () => {
  const bookmarkView = readFeatureSource(path.join(projectRoot, "apps/frontend/src/features/study/components/sql/records/records-screen.tsx"), "utf8");

  assert.match(bookmarkView, /className="card wrong-summary-card"[\s\S]*?onClick=\{\(\) => setSelectedId\(question\.id\)\}/u);
  assert.match(bookmarkView, /title="북마크 문제 풀기"/u);
  assert.match(bookmarkView, /toggleModalAnswer/u);
  assert.match(bookmarkView, /gradeModalAnswer/u);
  assert.doesNotMatch(bookmarkView, /bookmark-row-practice|이 문제 풀기 →|정답을 보지 않고 풀기/u);
});

test("bookmark batch practice uses an exam-style numbered navigator", () => {
  assert.match(component, /setBookmarkPractice\(Boolean\(options\?\.bookmarkOnly\)\)/u);
  assert.match(component, /bookmarkMode \? \([\s\S]*?className="card exam-answer-map bookmark-practice-map"/u);
  assert.match(component, /queue\.map\(\(questionId, index\) =>/u);
  assert.match(component, /onClick=\{\(\) => onIndex\(index\)\}/u);
  assert.match(component, /bookmarkAnswers\[String\(questionId\)\]/u);
});

test("theory reader uses one context-aware in-flow return control", () => {
  const theoryView = component.match(/function TheoryView[\s\S]*?function WrongNote/)?.[0] ?? "";
  assert.match(theoryView, /returnToQuestion \? \(/u);
  assert.match(theoryView, /className="back-button theory-list-back"/u);
  assert.match(theoryView, /← 문제로 돌아가기/u);
  assert.match(theoryView, /className="theory-list-back-icon"[\s\S]*?←[\s\S]*?이론 목록으로 돌아가기/u);
  assert.doesNotMatch(component, /className="theory-mid-back"/u);
  assert.doesNotMatch(styles, /\.theory-mid-back\s*\{[\s\S]*?position:\s*fixed/u);
});

test("mobile navigation keeps all five course destinations directly visible", () => {
  assert.match(component, /label:\s*"학습 홈"[\s\S]*?label:\s*"이론"[\s\S]*?label:\s*"문제"[\s\S]*?label:\s*"모의고사"[\s\S]*?label:\s*"학습 기록"/u);
  assert.match(component, /<StudyMobileNavigation/u);
  assert.doesNotMatch(component, /mobileMoreItems/u);
  assert.match(styles, /@media \(max-width:\s*680px\)\s*\{[\s\S]*?\.mobile-nav\s*\{[\s\S]*?grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/u);
  assert.doesNotMatch(component, /aria-controls="mobile-more-menu"/u);
  assert.match(styles, /@media \(max-width:\s*680px\)\s*\{[\s\S]*?\.topbar\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/u);
  assert.match(styles, /@media \(max-width:\s*760px\)\s*\{[\s\S]*?\.top-report-button\s*\{[\s\S]*?display:\s*none/u);
  assert.match(styles, /\.topbar h1\s*\{[\s\S]*?font-size:\s*clamp\(18px,\s*5\.8vw,\s*21px\)/u);
});
