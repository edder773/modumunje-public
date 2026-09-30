import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { isSwStudyPayload } from "../packages/shared/src/study/sw-study-contract.mjs";
import { isStudyApiPayload } from "../packages/shared/src/study/study-api-contract.mjs";
import { DatabaseSync } from "node:sqlite";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function source(file) {
  return fs.readFileSync(path.join(projectRoot, file), "utf8");
}

test("direct API and SW failures are structured, traceable, and non-cacheable", () => {
  const swService = source("apps/backend/src/modules/sw-study/sw-study.service.ts");
  const responses = source("apps/backend/src/common/http/api-response.ts");
  const swRoute = source("apps/frontend/app/api/sw-study/route.ts");
  const directRoutes = [
    "apps/frontend/app/api/auth/google/start/route.ts",
    "apps/frontend/app/api/auth/google/callback/route.ts",
    "apps/frontend/app/api/auth/google/logout/route.ts",
    "apps/frontend/app/api/events/route.ts",
    "apps/frontend/app/api/reports/route.ts",
  ].map(source).join("\n");

  assert.match(directRoutes, /withApiErrorBoundary/u);
  assert.match(directRoutes, /BACKEND_UNAVAILABLE/u);
  assert.doesNotMatch(directRoutes, /invokeBackend|Controller|AppModule/u);
  assert.match(swService, /withApiErrorBoundary/u);
  assert.match(swService, /apiErrorResponse/u);
  assert.match(responses, /"Cache-Control": "no-store"/u);
  assert.match(responses, /requestId/u);
  assert.match(responses, /x-request-id/u);
  assert.match(swRoute, /GET as handleSwStudyGet/u);
  assert.doesNotMatch(swRoute, /invokeBackend|AppModule|SwStudyController/u);
});

test("root navigation remains renderable after returning from a deep route", () => {
  const learnerPage = source("apps/frontend/src/features/study/pages/learner-page.tsx");
  const study = source("apps/frontend/src/features/study/components/study-app.tsx");
  const learningRouter = source("apps/frontend/src/features/study/routing/use-learning-router.ts");
  const learnRoute = source("apps/frontend/app/learn/[...segments]/page.tsx");

  assert.equal((learnerPage.match(/rootCatalog=\{<LearningCatalogHome authError=\{authError\}[^>]*\/>\}/gu) ?? []).length, 2);
  assert.match(learnRoute, /if \(!route\) notFound\(\)/u);
  assert.match(study, /useLearningRouter\(\)/u);
  assert.match(learningRouter, /router\[mode === "push" \? "push" : "replace"\]/u);
  assert.match(learningRouter, /router\.push\("\/", \{ scroll: false \}\)/u);
  assert.match(
    study,
    /initialLearningLevel === "course"[\s\S]*initialLearningRoute\?\.page !== "home"[\s\S]*!initialData/u,
  );
  assert.match(study, /activeView === "dashboard" && learningLevel === "root"/u);
  assert.doesNotMatch(study, /window\.location\.assign\("\/"\)/u);

  for (const file of [
    "apps/frontend/app/error.tsx",
    "apps/frontend/app/global-error.tsx",
    "apps/frontend/app/not-found.tsx",
    "apps/frontend/app/learn/error.tsx",
  ]) assert.equal(fs.existsSync(path.join(projectRoot, file)), true, `${file} should exist`);
});

test("SW responses are validated by view and retried once before state updates", () => {
  const client = source("apps/frontend/src/features/study/model/sw-study-api-client.ts");
  const contract = source("packages/shared/src/study/sw-study-contract.mjs");
  const catalog = source("packages/shared/src/study/learning-catalog.ts");
  const service = source("apps/backend/src/modules/sw-study/sw-study.service.ts");

  assert.match(client, /isSwStudyPayload/u);
  assert.match(client, /maxAttempts: prefetch \? 1 : 2/u);
  assert.match(contract, /value\.theories\.every\(isSwTheory\)/u);
  assert.match(contract, /value\.questions\.every\(isSwQuestion\)/u);
  assert.match(client, /ApiRequestError/u);
  assert.match(catalog, /export const SW_MAJOR_SUBJECT_IDS/u);
  assert.match(service, /new Set<string>\(SW_CURRICULUM_SUBJECT_IDS\)/u);

  assert.equal(isSwStudyPayload("theories", { theories: "invalid" }), false);
  assert.equal(isSwStudyPayload("practice", { questions: [{ id: "broken" }] }), false);
});

test("SQL study responses reject malformed scope payloads before rendering", () => {
  assert.equal(isStudyApiPayload("practice", { questions: "invalid" }), false);
  assert.equal(isStudyApiPayload("theory", { theories: [], theoryNavigation: null }), false);
  assert.equal(isStudyApiPayload("practice", {
    questions: [{
      id: 1,
      prompt: "valid",
      choices: ["A", "B"],
      correctAnswers: [0],
    }],
  }), true);
});

test("twenty concurrent first-write attempts remain idempotent", async () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE user_settings (
      user_key TEXT PRIMARY KEY,
      selected_exam TEXT NOT NULL DEFAULT 'SQLP'
    );
  `);
  const insert = database.prepare(`
    INSERT INTO user_settings (user_key, selected_exam)
    VALUES (?, 'SQLP')
    ON CONFLICT(user_key) DO NOTHING
  `);
  await Promise.all(Array.from({ length: 20 }, async () => {
    insert.run("same-user");
  }));
  const row = database.prepare("SELECT COUNT(*) AS count FROM user_settings WHERE user_key = ?")
    .get("same-user");
  assert.equal(row.count, 1);
  database.close();
});

test("first-write account setup is idempotent while server page reads stay read-only", () => {
  const auth = source("apps/backend/src/common/auth/admin-auth.ts");
  const pageSession = source("apps/frontend/src/server/auth/page-session.ts");
  const repository = source("apps/backend/src/modules/study/study.repository.ts");
  const service = source("apps/backend/src/modules/study/study.service.ts");
  const study = source("apps/frontend/src/features/study/components/study-app.tsx");

  const ensureSetting = repository.match(
    /async ensureUserSetting[\s\S]*?\r?\n  \}\r?\n\r?\n  async readUserSetting/u,
  )?.[0] ?? "";
  assert.match(ensureSetting, /database\.batch\(\[/u);
  assert.match(ensureSetting, /ON CONFLICT\(user_key\) DO NOTHING/u);
  assert.match(ensureSetting, /WHERE user_key = \?/u);
  assert.doesNotMatch(ensureSetting, /if \(existing\) return existing/u);
  assert.match(auth, /export async function readLearnerAccount/u);
  assert.match(auth, /ON CONFLICT\(user_key\) DO UPDATE/u);
  assert.match(pageSession, /readLearnerAccount/u);
  assert.doesNotMatch(pageSession, /ensureLearnerAccount/u);
  assert.match(study, /requestStudyMutation\("account-touch"/u);
  assert.match(service, /action === "account-touch"/u);
  const getHandler = service.slice(service.indexOf("async function GET"), service.indexOf("async function POST"));
  assert.doesNotMatch(getHandler, /ensureUserSetting/u);
});

test("lazy Markdown rendering has local retry recovery", () => {
  const study = source("apps/frontend/src/features/study/components/study-app.tsx")
    + source("apps/frontend/src/features/study/components/sw-curriculum-planner.tsx")
    + source("apps/frontend/src/features/study/components/sw-curriculum-content.tsx");
  const shared = source("apps/frontend/src/features/study/components/study-screen-shared.tsx");
  const boundary = source("apps/frontend/src/features/errors/retry-boundary.tsx");

  assert.match(shared, /<RetryBoundary/u);
  assert.match(study, /\$\{selectedField\.name\} 학습 화면을 표시하지 못했습니다/u);
  assert.match(study, /SW 학습 범위를 표시하지 못했습니다/u);
  assert.match(boundary, /getDerivedStateFromError/u);
  assert.match(boundary, /CHUNK_RELOAD_KEY/u);
  assert.match(boundary, /다시 시도/u);
});
