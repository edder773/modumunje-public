import { readFeatureSource } from "./helpers/feature-source.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { koreaDateKey, koreaDayStreak } from "../packages/shared/src/date/korea-date.mjs";
import { uniqueMarkdownHeadingIds } from "../packages/shared/src/content/markdown-heading.mjs";

function source(path) {
  return readFeatureSource(new URL(`../${path}`, import.meta.url), "utf8");
}

test("KST date keys and learning streaks use Korean calendar boundaries", () => {
  assert.equal(koreaDateKey("2026-08-09T14:59:59.000Z"), "2026-08-09");
  assert.equal(koreaDateKey("2026-08-09T15:00:00.000Z"), "2026-08-10");
  assert.equal(koreaDateKey("2026-08-09T15:30:00.000Z"), "2026-08-10", "KST 00:30");
  assert.equal(koreaDateKey("2026-08-09T23:59:00.000Z"), "2026-08-10", "KST 08:59");
  assert.equal(koreaDateKey("2026-08-10T00:00:00.000Z"), "2026-08-10", "KST 09:00");
  assert.equal(koreaDateKey("2026-02-28T15:00:00.000Z"), "2026-03-01", "월 경계");
  assert.equal(koreaDateKey("2026-12-31T15:00:00.000Z"), "2027-01-01", "연도 경계");
  assert.equal(
    koreaDayStreak(["2026-08-08", "2026-08-09", "2026-08-10"], new Date("2026-08-10T03:00:00.000Z")),
    3,
  );
  assert.equal(
    koreaDayStreak(["2026-08-08", "2026-08-09"], new Date("2026-08-10T03:00:00.000Z")),
    2,
  );
});

test("duplicate Markdown headings receive collision-free renderer and outline IDs", () => {
  assert.deepEqual(uniqueMarkdownHeadingIds(["실행 계획", "실행 계획", "실행 계획!"]), [
    "section-실행-계획",
    "section-실행-계획-2",
    "section-실행-계획-3",
  ]);
  const renderer = source("apps/frontend/src/features/content/components/markdown-renderer.tsx");
  const shared = source("apps/frontend/src/features/study/components/study-screen-shared.tsx");
  assert.match(renderer, /markdownHeadingEntries\(learnerValue\)/u);
  assert.match(shared, /markdownHeadingEntries\(learnerFacingMarkdown\(content\)\)/u);
});

test("SQL screens use route chunks and isolate the mock-exam timer from parent renders", () => {
  const app = source("apps/frontend/src/features/study/components/study-app.tsx");
  const lazyScreens = source("apps/frontend/src/features/study/components/study-lazy-screens.ts");
  const runner = source("apps/frontend/src/features/study/components/sql/mock/exam-runner.tsx");
  assert.doesNotMatch(app, /sql-study-screens/u);
  for (const chunk of ["dashboard", "practice", "mock", "theory", "records", "reports"]) {
    assert.match(`${app}\n${lazyScreens}`, new RegExp(`\\./sql/${chunk}`, "u"));
  }
  assert.match(runner, /const ExamTimer = memo/u);
  assert.match(runner, /setInterval\(update, 1000\)/u);
  assert.doesNotMatch(runner, /from ["'].*study-app["']/u);
});

test("records and mock-exam lists are bounded and avoid a global store singleton", () => {
  const repository = source("apps/backend/src/modules/study/study.repository.ts");
  const recordQueries = source("apps/backend/src/modules/study/study-records.repository-queries.ts");
  const service = source("apps/backend/src/modules/study/study.service.ts");
  assert.match(recordQueries, /options\.limit \+ 1\);/u);
  assert.match(recordQueries, /values\.push\(options\.limit \+ 1\)/u);
  assert.match(service, /recordsPagination/u);
  assert.match(service, /mockPagination/u);
  assert.match(service, /sessionRows\.slice\(0, 20\)/u);
  assert.doesNotMatch(repository, /export const studyRepository/u);
  assert.match(service, /function createStudyHandlers\(studyRepository: StudyRepository\)/u);
  const app = source("apps/frontend/src/features/study/components/study-app.tsx");
  assert.match(app, /initialLearningRoute\?\.page === "mock-exam" && initialLearningRoute\.id !== "active"/u);
  assert.match(app, /requestedScope === "mock-session"/u);
  assert.match(app, /id: session\.status === "active" \? "active" : session\.id/u);
});
