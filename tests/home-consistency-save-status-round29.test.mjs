import { readFeatureSource } from "./helpers/feature-source.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function source(file) {
  return readFeatureSource(path.join(projectRoot, file), "utf8");
}

test("guest and authenticated visitors share one dynamic learning home", () => {
  const page = source("apps/frontend/app/page.tsx");
  const learnerPage = source("apps/frontend/src/features/study/pages/learner-page.tsx");
  const study = source("apps/frontend/src/features/study/components/study-app.tsx");

  assert.match(page, /export const dynamic = "force-dynamic"/u);
  assert.match(page, /const initialPath = "\/"/u);
  assert.match(page, /loadLearnerPageContext/u);
  assert.match(page, /<LearnerPage[\s\S]*?initialPath=\{initialPath\}[\s\S]*?\{\.\.\.context\}/u);
  assert.match(learnerPage, /isAuthenticated=\{false\}/u);
  assert.match(study, /loading && learningLevel !== "root" && <LearningLoadingState view=\{activeView\} \/>/u);
  assert.match(study, /activeView === "dashboard" && learningLevel === "root"/u);
  assert.match(learnerPage, /rootCatalog=\{<LearningCatalogHome authError=\{authError\} isAuthenticated=\{false\} fields=\{CATALOG_FIELD_CARDS\} filters=\{catalogFilters\} \/>\}/u);
  assert.match(learnerPage, /rootCatalog=\{<LearningCatalogHome authError=\{authError\} isAuthenticated fields=\{CATALOG_FIELD_CARDS\} filters=\{catalogFilters\} \/>\}/u);
  assert.doesNotMatch(study, />동기화 중</u);
});

test("the learning catalog keeps the admin entry available on desktop and compact layouts", () => {
  const session = source("apps/frontend/src/server/auth/page-session.ts");
  const learnerPage = source("apps/frontend/src/features/study/pages/learner-page.tsx");
  const shell = source("apps/frontend/src/features/study/components/catalog/catalog-page-shell.tsx");

  assert.match(session, /adminAccess:\s*isAdminEmail\(user[.]email\)/u);
  assert.match(learnerPage, /adminAccess=\{session[.]status === "active" && session[.]adminAccess\}/u);
  assert.match(shell, /className="admin-entry-link" href="\/admin"/u);
  assert.match(shell, /className="top-admin-link" href="\/admin"/u);
});

test("save operations keep actionable progress and failures without a persistent success badge", () => {
  const study = source("apps/frontend/src/features/study/components/study-app.tsx");
  const feedback = source("apps/frontend/src/features/study/components/learning-feedback.tsx");

  for (const value of ["local-saved", "account-saved", "saving", "error"]) {
    assert.match(`${study}\n${feedback}`, new RegExp(`"${value}"`, "u"));
  }
  assert.match(study, /runTrackedAccountSave/u);
  assert.match(study, /runTrackedLocalSave/u);
  assert.match(study, /withSaveTimeout/u);
  assert.match(feedback, /이 브라우저에 저장됨/u);
  assert.match(feedback, /status === "account-saved"\) return null/u);
  assert.doesNotMatch(feedback, />계정에 저장됨</u);
  assert.match(feedback, /계정에 저장 중/u);
  assert.match(feedback, /저장하지 못했습니다/u);
  assert.match(feedback, /다시 시도/u);
});

test("the first authenticated response exposes administrator access without waiting for navigation", () => {
  const sessionContract = source("packages/shared/src/auth/page-session.ts");
  const pageSession = source("apps/frontend/src/server/auth/page-session.ts");
  const learnerPage = source("apps/frontend/src/features/study/pages/learner-page.tsx");
  const catalogShell = source("apps/frontend/src/features/study/components/catalog/catalog-page-shell.tsx");
  const study = source("apps/frontend/src/features/study/components/study-app.tsx");

  assert.match(sessionContract, /status: "active";[\s\S]*adminAccess: boolean/u);
  assert.match(pageSession, /adminAccess: isAdminEmail\(user\.email\)/u);
  assert.match(learnerPage, /adminAccess=\{session\.status === "active" && session\.adminAccess\}/u);
  assert.match(catalogShell, /\{adminAccess && <a className="top-admin-link" href="\/admin">관리자<\/a>\}/u);
  assert.match(study, /adminAccess=\{adminAccess\}/u);
});

test("switching SQLD and SQLP saves silently while preserving actionable failures", () => {
  const study = source("apps/frontend/src/features/study/components/study-app.tsx");
  const switchFlow = study.match(/async function changeExam[\s\S]*?function practiceCandidates/)?.[0] ?? "";

  assert.match(study, /setSaveStatus\(options\.showProgress === false \? "account-saved" : "saving"\)/u);
  assert.match(switchFlow, /selectedExamSaveQueue\.enqueue\("selected-exam", next\)/u);
  assert.match(study, /setSaveStatus\("error"\)/u);
  assert.match(study, /저장하지 못했습니다/u);
});

test("field and course entry pages avoid redundant introductory hero copy", () => {
  const study = source("apps/frontend/src/features/study/components/study-app.tsx");

  assert.doesNotMatch(study, /무엇을 공부하고 싶으신가요\?/u);
  assert.doesNotMatch(study, /학습할 과정이나 자격증을 선택하세요\./u);
  assert.match(study, /<section aria-labelledby="learning-fields-title">/u);
  assert.match(study, /<section aria-label="학습 과정">/u);
  assert.match(study, /fieldContext \? `\$\{selectedField.name\} 학습 과정` : "학습 분야"/u);
});

test("SQL learning home opens with direct learning actions instead of guide cards", () => {
  const study = source("apps/frontend/src/features/study/components/study-app.tsx");
  const dashboard = study.match(/function Dashboard[\s\S]*?function contentScale/)?.[0] ?? "";

  assert.match(dashboard, /학습 기능/u);
  assert.match(dashboard, /원하는 방식으로 학습하세요\./u);
  assert.match(dashboard, /문제 풀이/u);
  assert.match(dashboard, /이론 학습/u);
  assert.match(dashboard, /모의고사/u);
  assert.match(dashboard, /학습 기록/u);
  assert.doesNotMatch(dashboard, /entry-hero/u);
  assert.doesNotMatch(dashboard, /learner-overview/u);
  assert.doesNotMatch(dashboard, /처음 학습하는 방법/u);
  assert.doesNotMatch(dashboard, /북마크 0/u);
  assert.doesNotMatch(dashboard, /0일/u);
});

test("SQL learning home does not retain the removed learner overview widgets", () => {
  const study = source("apps/frontend/src/features/study/components/study-app.tsx");
  const dashboard = study.match(/function Dashboard[\s\S]*?function contentScale/)?.[0] ?? "";

  assert.doesNotMatch(dashboard, /전체 이론 보기/u);
  assert.doesNotMatch(dashboard, /learner-week-dots/u);
  assert.doesNotMatch(dashboard, /first-learning-steps/u);
  assert.doesNotMatch(dashboard, /연속 학습/u);
});

test("learner-facing decorative labels use Korean consistently", () => {
  const study = source("apps/frontend/src/features/study/components/study-app.tsx");

  for (const label of [
    "학습 분야",
    "학습 과정",
    "학습 기능",
    "모의고사",
    "이론 학습",
    "북마크",
    "연속 학습",
  ]) {
    assert.match(study, new RegExp(label, "u"));
  }
  assert.doesNotMatch(
    study,
    /QUICK START|BOOKMARKS|STREAK|LEARNING MODE|REAL EXAM MODE|MOCK EXAM|QUESTION REVIEW/u,
  );
});

test("canonical redirect preserves path and query while HTML and study data bypass stale caches", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const env = {
    ASSETS: {
      fetch: async () => new Response("Not found", { status: 404 }),
    },
  };
  const context = {
    waitUntil() {},
    passThroughOnException() {},
  };

  const redirect = await worker.fetch(
    new Request("https://baeumzip.site/questions?exam=sqlp", {
      headers: { accept: "text/html" },
    }),
    env,
    context,
  );
  assert.equal(redirect.status, 308);
  assert.equal(
    redirect.headers.get("location"),
    "https://modumunje.com/questions?exam=sqlp",
  );

  const legacyRedirect = await worker.fetch(
    new Request("https://sqlp-study-lab.edder773.chatgpt.site/guides/sqlp?from=search", {
      headers: { accept: "text/html" },
    }),
    env,
    context,
  );
  assert.equal(legacyRedirect.status, 308);
  assert.equal(
    legacyRedirect.headers.get("location"),
    "https://modumunje.com/guides/sqlp?from=search",
  );

  const canonical = await worker.fetch(
    new Request("https://modumunje.com/", {
      headers: { accept: "text/html" },
    }),
    env,
    context,
  );
  assert.equal(canonical.status, 200);
  assert.equal(
    canonical.headers.get("cache-control"),
    "no-cache, no-store, must-revalidate",
  );

  const studyRoute = source("apps/backend/src/modules/study/study.service.ts");
  assert.match(studyRoute, /"Cache-Control": "no-store"/u);
});
