import { readFeatureSource } from "./helpers/feature-source.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { isStudyApiPayload } from "../packages/shared/src/study/study-api-contract.mjs";
import { isSwStudyPayload } from "../packages/shared/src/study/sw-study-contract.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (file) => readFeatureSource(path.join(root, file), "utf8");

test("pre-submit SQL and SW question contracts do not require answer feedback", () => {
  assert.equal(isStudyApiPayload("practice", {
    questions: [{ id: 1, prompt: "질문", choices: ["A", "B"] }],
  }), true);
  assert.equal(isSwStudyPayload("practice", {
    questions: [{
      id: "SW-1",
      theoryId: 1,
      subjectGroupId: "group",
      subjectId: "subject",
      category: "category",
      topic: "topic",
      displayOrder: 1,
      prompt: "질문",
      kind: "single",
      difficulty: "중",
      difficultyRationale: "기본 개념 확인",
      choices: ["A", "B"],
      tags: [],
    }],
  }), true);
});

test("answer feedback is withheld until a server-graded action", () => {
  const sqlService = source("apps/backend/src/modules/study/study.service.ts");
  const sqlDelivery = source("apps/backend/src/modules/study/study-question-delivery.ts");
  const sqlAttempt = source("apps/backend/src/modules/study/study-attempt.service.ts");
  const swService = source("apps/backend/src/modules/sw-study/sw-study.service.ts");
  const client = source("apps/frontend/src/features/study/components/study-app.tsx")
    + source("apps/frontend/src/features/study/components/sw-curriculum-planner.tsx");

  assert.match(sqlDelivery, /function questionAttemptPayload/u);
  const attemptPayloadStart = sqlDelivery.indexOf("function questionAttemptPayload");
  const attemptPayloadEnd = sqlDelivery.length;
  assert.ok(attemptPayloadStart >= 0 && attemptPayloadEnd > attemptPayloadStart);
  const attemptPayload = sqlDelivery.slice(attemptPayloadStart, attemptPayloadEnd);
  assert.doesNotMatch(attemptPayload, /correctAnswers|explanation|scoringCriteria|requiredConcepts/u);
  assert.match(sqlDelivery, /rows\.map\(\(row\) => questionAttemptPayload\(/u);
  assert.match(sqlDelivery, /withPracticeFeedbackAuthorization/u);
  assert.match(sqlService, /action === "question-feedback"/u);
  assert.match(sqlAttempt, /feedback: questionFeedbackPayload\(question\)/u);
  assert.match(swService, /function questionPayload\([\s\S]*includeFeedback = false/u);
  assert.match(swService, /issuePracticeFeedbackAuthorization/u);
  assert.match(swService, /feedback: questionFeedbackPayload\(question\)/u);
  assert.match(client, /applyQuestionFeedback/u);
  assert.match(client, /applySwQuestionFeedback/u);
  assert.doesNotMatch(client, /const correct = sameAnswers\(selectedAnswers, question\.correctAnswers\)/u);
});

test("all learner data API methods use the Google session and private caching", () => {
  const route = source("apps/frontend/app/api/study/route.ts");
  const swRoute = source("apps/frontend/app/api/sw-study/route.ts");
  const auth = source("apps/frontend/src/server/auth/site-auth.ts");
  const scopes = source("apps/backend/src/modules/study/study-read-scope.ts");
  const service = source("apps/backend/src/modules/study/study.service.ts");

  assert.equal((route.match(/withSiteIdentity\(/gu) ?? []).length, 4);
  assert.equal((swRoute.match(/withSiteIdentity\(/gu) ?? []).length, 2);
  assert.match(auth, /googleUserFromRequest/u);
  assert.match(auth, /googleSignInPath/u);
  assert.match(auth, /googleSignOutPath/u);
  assert.doesNotMatch(auth, /oai-authenticated-user/u);
  assert.match(scopes, /scope === "practice"/u);
  assert.match(scopes, /scope === "questions"/u);
  assert.match(service, /Boolean\(userKey\) \|\| privateStudyReadScope\(scope\) \|\| scope === "shell"/u);
});

test("SEO, social asset budget, and deploy verification hooks are present", () => {
  const layout = source("apps/frontend/app/layout.tsx");
  const workflow = source(".github/workflows/post-deploy.yml");
  const deployedConfig = source("playwright.deployed.config.ts");
  const imagePath = path.join(root, "apps/frontend/public/brand/modu-social-preview-v2.jpg");

  assert.equal(fs.existsSync(path.join(root, "apps/frontend/app/robots.ts")), true);
  assert.equal(fs.existsSync(path.join(root, "apps/frontend/app/sitemap.ts")), true);
  assert.match(layout, /url: "\/brand\/modu-social-preview-v2\.jpg"/u);
  assert.doesNotMatch(layout, /og\.png/u);
  assert.ok(fs.statSync(imagePath).size < 500 * 1024, "OG image should stay below 500 KiB");
  assert.match(workflow, /workflow_call:/u);
  assert.match(workflow, /repository_dispatch:/u);
  assert.match(deployedConfig, /name: "guest"/u);
  assert.match(deployedConfig, /DEPLOYED_AUTH_STORAGE_STATE/u);
});

test("data integrity gate checks user ownership and finite domain values", () => {
  const integrity = source("scripts/lib/data-integrity.mjs");
  assert.match(integrity, /orphanedUserRows/u);
  assert.match(integrity, /invalidDomainValues/u);
  assert.match(integrity, /invalid domain values exist/u);
});
