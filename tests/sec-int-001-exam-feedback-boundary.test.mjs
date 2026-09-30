import { readFeatureSource } from "./helpers/feature-source.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  createPracticeFeedbackAuthorization,
  feedbackRevealDecision,
  releasedFeedbackProjection,
  verifyPracticeFeedbackAuthorization,
} from "../packages/shared/src/study/exam-feedback-authorization.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (file) => readFeatureSource(path.join(root, file), "utf8");
const protectedFields = [
  "correctAnswer",
  "correctAnswers",
  "explanation",
  "answerKey",
  "gradingCriteria",
  "scoringCriteria",
  "requiredConcepts",
  "acceptableAlternatives",
  "deductionConditions",
  "errorConditions",
];

function practiceDecision(overrides = {}) {
  return feedbackRevealDecision({
    activity: "practice",
    authorizationValid: true,
    session: null,
    ...overrides,
  });
}

function examDecision(overrides = {}) {
  return feedbackRevealDecision({
    activity: "exam",
    authorizationValid: false,
    session: {
      ownerMatches: true,
      containsQuestion: true,
      status: "submitted",
    },
    ...overrides,
  });
}

test("SEC-INT-001 blocks non-submitted exam questions sent through generic feedback APIs", () => {
  for (const status of ["active", "grading", "expired", "unknown-state"]) {
    const decision = practiceDecision({
      session: { ownerMatches: true, containsQuestion: true, status },
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, "EXAM_FEEDBACK_NOT_RELEASED");
  }
});

test("SEC-INT-001 rejects other owners, missing sessions, and question/session mismatches", () => {
  assert.equal(examDecision({
    session: { ownerMatches: false, containsQuestion: true, status: "submitted" },
  }).allowed, false);
  assert.equal(examDecision({ session: null }).allowed, false);
  assert.equal(examDecision({
    session: { ownerMatches: true, containsQuestion: false, status: "submitted" },
  }).allowed, false);
});

test("SEC-INT-001 releases submitted exam results only to the owner", () => {
  assert.equal(examDecision().allowed, true);
  assert.equal(examDecision({
    session: { ownerMatches: true, containsQuestion: true, status: "active" },
  }).allowed, false);
  assert.equal(examDecision({
    session: { ownerMatches: false, containsQuestion: true, status: "submitted" },
  }).allowed, false);
});

test("SEC-INT-001 preserves authorized practice and rejects exam-as-practice disguise", () => {
  assert.equal(practiceDecision().allowed, true);
  assert.equal(practiceDecision({ authorizationValid: false }).allowed, false);
  assert.equal(practiceDecision({
    session: { ownerMatches: true, containsQuestion: true, status: "active" },
  }).allowed, false);
});

test("SEC-INT-001 practice authorization binds user, engine, question, session, and expiry", async () => {
  const base = {
    secret: "sec-int-001-test-secret-at-least-32-characters",
    userKey: "owner-user-key",
    engine: "sw",
    questionId: "SW-1",
    contextId: "sw_session_123456",
    now: Date.UTC(2026, 7, 31, 0, 0, 0),
  };
  const authorization = await createPracticeFeedbackAuthorization(base);
  assert.equal(await verifyPracticeFeedbackAuthorization({ ...base, authorization }), true);
  assert.equal(await verifyPracticeFeedbackAuthorization({ ...base, userKey: "other-user", authorization }), false);
  assert.equal(await verifyPracticeFeedbackAuthorization({ ...base, engine: "sql", authorization }), false);
  assert.equal(await verifyPracticeFeedbackAuthorization({ ...base, questionId: "SW-2", authorization }), false);
  assert.equal(await verifyPracticeFeedbackAuthorization({ ...base, contextId: "sw_session_other", authorization }), false);
  assert.equal(await verifyPracticeFeedbackAuthorization({
    ...base,
    now: base.now + 31 * 60_000,
    authorization,
  }), false);
  assert.equal(await verifyPracticeFeedbackAuthorization({
    ...base,
    authorization: `${authorization.slice(0, -1)}x`,
  }), false);
});

test("SEC-INT-001 applies one boundary to SQL, SW, objective, descriptive, and mixed exams", () => {
  for (const engine of ["sql", "sw"]) {
    for (const questionKind of ["single", "multiple", "descriptive", "mixed"]) {
      const decision = feedbackRevealDecision({
        activity: "practice",
        authorizationValid: true,
        engine,
        questionKind,
        session: { ownerMatches: true, containsQuestion: true, status: "active" },
      });
      assert.equal(decision.allowed, false, `${engine}/${questionKind}`);
    }
  }
});

test("SEC-INT-001 pre-submit projections contain zero answer or explanation fields", () => {
  const sourceFeedback = Object.fromEntries(protectedFields.map((field, index) => [field, index]));
  const beforeSubmit = releasedFeedbackProjection(sourceFeedback, false);
  const afterSubmit = releasedFeedbackProjection(sourceFeedback, true);
  assert.deepEqual(Object.keys(beforeSubmit).filter((field) => protectedFields.includes(field)), []);
  assert.deepEqual(
    Object.keys(afterSubmit).filter((field) => protectedFields.includes(field)).sort(),
    [...protectedFields].sort(),
  );
});

test("SEC-INT-001 retry decisions are deterministic and do not weaken duplicate-submit policy", () => {
  const input = {
    activity: "exam",
    authorizationValid: false,
    session: { ownerMatches: true, containsQuestion: true, status: "submitted" },
  };
  assert.deepEqual(feedbackRevealDecision(input), feedbackRevealDecision(input));
  assert.equal(feedbackRevealDecision(input).allowed, true);
});

test("SEC-INT-001 production paths enforce server authorization and separate SW mock reveal", () => {
  const contract = source("packages/shared/src/study/study-mutation-contract.mjs");
  const sqlService = source("apps/backend/src/modules/study/study.service.ts");
  const sqlAttempt = source("apps/backend/src/modules/study/study-attempt.service.ts");
  const sqlRepository = source("apps/backend/src/modules/study/study.repository.ts");
  const sqlAttemptQuery = source("apps/backend/src/modules/study/study-attempt.repository-query.ts");
  const swService = source("apps/backend/src/modules/sw-study/sw-study.service.ts");
  const frontend = source("apps/frontend/src/features/study/components/study-app.tsx");
  const swFrontend = source("apps/frontend/src/features/study/components/sw-curriculum-planner.tsx");

  assert.match(contract, /feedbackAuthorization/u);
  assert.match(sqlService, /feedbackRevealDecision/u);
  assert.match(sqlAttempt, /decidePracticeFeedbackAccess/u);
  assert.match(sqlRepository, /findPracticeAttemptContext/u);
  assert.match(sqlAttemptQuery, /await database\.batch\(\[/u);
  assert.match(swService, /decidePracticeFeedbackAccess/u);
  assert.match(frontend, /feedbackAuthorization:\s*question\.feedbackAuthorization/u);
  assert.match(swFrontend, /feedbackAuthorization:\s*question\.feedbackAuthorization/u);
  assert.doesNotMatch(
    swFrontend,
    /answeredQuestions[\s\S]{0,300}map\(trackSwAnswer\)/u,
  );
});
