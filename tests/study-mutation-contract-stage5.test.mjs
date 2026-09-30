import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  STUDY_MUTATION_ACTIONS,
  SW_STUDY_MUTATION_ACTIONS,
  isStudyMutationResponse,
  isSwStudyMutationResponse,
  validateStudyMutationRequest,
  validateSwStudyMutationRequest,
} from "../packages/shared/src/study/study-mutation-contract.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("stage5 exposes one explicit mutation action registry without duplicates", () => {
  assert.equal(new Set(STUDY_MUTATION_ACTIONS).size, STUDY_MUTATION_ACTIONS.length);
  assert.equal(new Set(SW_STUDY_MUTATION_ACTIONS).size, SW_STUDY_MUTATION_ACTIONS.length);
  assert.deepEqual(STUDY_MUTATION_ACTIONS, [
    "account-touch",
    "guest-import",
    "question-feedback",
    "attempt",
    "short-answer",
    "self-assessment",
    "bookmark",
    "settings",
    "theory-progress",
    "exam-start",
    "exam-save",
    "exam-submit",
  ]);
});

test("SQL mutation boundary rejects malformed envelopes and coercible state", () => {
  assert.equal(validateStudyMutationRequest(null).code, "STUDY_BODY_INVALID");
  assert.equal(validateStudyMutationRequest({ action: "unknown" }).code, "STUDY_ACTION_UNSUPPORTED");
  assert.equal(validateStudyMutationRequest({
    action: "bookmark",
    questionId: 1,
    bookmarked: "false",
  }).code, "STUDY_MUTATION_INVALID");
  assert.equal(validateStudyMutationRequest({
    action: "theory-progress",
    theoryId: 1,
    examType: "SQLP",
    completed: 1,
  }).code, "STUDY_MUTATION_INVALID");
  assert.equal(validateStudyMutationRequest({
    action: "exam-save",
    sessionId: "12345678-1234-1234-1234-123456789012",
    answers: {},
  }).code, "STUDY_MUTATION_INVALID");
  assert.equal(validateStudyMutationRequest({
    action: "exam-save",
    sessionId: "12345678-1234-1234-1234-123456789012",
    revision: 0,
    answers: { 1: ["0"] },
  }).code, "STUDY_MUTATION_INVALID");
});

test("SQL mutation boundary accepts valid course-scoped writes and exam state", () => {
  assert.equal(validateStudyMutationRequest({
    action: "theory-progress",
    theoryId: 1,
    examType: "SQLP",
    completed: false,
  }).ok, true);
  assert.equal(validateStudyMutationRequest({
    action: "exam-submit",
    sessionId: "12345678-1234-1234-1234-123456789012",
    revision: 4,
    answers: { 1: [0] },
    descriptiveAnswers: { 2: "답안" },
    descriptiveScores: { 2: 80 },
    descriptiveSnapshots: { 2: "답안" },
    flagged: [1],
    currentIndex: 1,
  }).ok, true);
});

test("SW mutation boundary requires booleans, revisions, valid ids, and answer arrays", () => {
  assert.equal(validateSwStudyMutationRequest({
    action: "sw-progress",
    theoryId: 1,
    completed: "false",
  }).code, "SW_MUTATION_INVALID");
  assert.equal(validateSwStudyMutationRequest({
    action: "sw-session-save",
    sessionId: "sw_123456789012",
    mode: "practice",
    subjectIds: ["algorithms"],
    questionIds: ["SW-1"],
  }).code, "SW_MUTATION_INVALID");
  assert.equal(validateSwStudyMutationRequest({
    action: "sw-session-save",
    sessionId: "sw_123456789012",
    revision: 0,
    mode: "practice",
    subjectIds: ["algorithms"],
    questionIds: ["SW-1"],
    answers: { "SW-1": [0] },
    revealedQuestionIds: [],
    currentIndex: 0,
  }).ok, true);
  assert.equal(validateSwStudyMutationRequest({
    action: "sw-import",
    completedTheoryIds: [1, 2],
    activeSession: {
      id: "sw_123456789012",
      revision: 2,
      mode: "mock",
      subjectIds: ["algorithms"],
      questionIds: ["SW-1"],
      answers: { "SW-1": [0] },
      revealedQuestionIds: ["SW-1"],
      currentIndex: 0,
    },
  }).ok, true);
});

test("mutation success payloads are validated before UI state changes", () => {
  assert.equal(isStudyMutationResponse("bookmark", { ok: true }), true);
  assert.equal(isStudyMutationResponse("exam-save", { session: { id: "session-123456" } }), true);
  assert.equal(isStudyMutationResponse("exam-save", { ok: true }), false);
  assert.equal(isSwStudyMutationResponse("sw-attempt", { attempt: {}, feedback: {} }), true);
  assert.equal(isSwStudyMutationResponse("sw-session-submit", {
    session: { id: "sw-session-123" },
    questions: [],
  }), true);
  assert.equal(isSwStudyMutationResponse("sw-session-submit", { session: { id: "sw-session-123" } }), false);
});

test("backend validates mutation envelopes before creating state and keeps booleans strict", () => {
  const sqlService = source("apps/backend/src/modules/study/study.service.ts");
  const swService = source("apps/backend/src/modules/sw-study/sw-study.service.ts");
  const writeHandlers = [
    [sqlService.slice(sqlService.indexOf("async function POST")), "authorizeStudyMutation"],
    [swService.slice(swService.indexOf("async function handlePost")), "authorizeLearnerRequest"],
  ];
  for (const [service, authorizationCall] of writeHandlers) {
    const validation = service.indexOf("validate");
    const authorization = service.indexOf(authorizationCall, validation);
    assert.ok(validation >= 0 && authorization > validation);
  }
  assert.match(sqlService, /const bookmarked = payload\.bookmarked === true/u);
  assert.match(sqlService, /THEORY_PROGRESS_RETIRED/u);
  assert.match(swService, /THEORY_PROGRESS_RETIRED/u);
  assert.doesNotMatch(sqlService, /Boolean\(payload\.(?:bookmarked|completed)\)/u);
  assert.doesNotMatch(swService, /Boolean\(payload\.completed\)/u);
});

test("frontend writes use one non-retrying validated mutation client", () => {
  const client = source("apps/frontend/src/features/study/model/study-mutation-api-client.ts");
  const study = source("apps/frontend/src/features/study/components/study-app.tsx");
  const feedback = source("apps/frontend/src/features/study/model/answer-feedback.ts");
  assert.match(client, /maxAttempts: 1/u);
  assert.match(client, /x-sql-study-user-request/u);
  assert.match(client, /isStudyMutationResponse/u);
  assert.match(client, /isSwStudyMutationResponse/u);
  assert.match(client, /validateStudyMutationRequest/u);
  assert.match(client, /validateSwStudyMutationRequest/u);
  assert.doesNotMatch(study, /fetch\("\/api\/(?:study|sw-study)"/u);
  assert.doesNotMatch(feedback, /fetch\("\/api\/study"/u);
  assert.match(feedback, /requestStudyMutation/u);
});

test("one request keeps the same generated trace id through nested boundaries", () => {
  const responses = source("apps/backend/src/common/http/api-response.ts");
  const errors = source("apps/backend/src/modules/study/study-error-response.ts");
  assert.match(responses, /new WeakMap<Request, string>/u);
  assert.match(responses, /generatedRequestIds\.get\(request\)/u);
  assert.match(responses, /!\["GET", "HEAD"\]\.includes\(requestMethod\.toUpperCase\(\)\)/u);
  assert.match(responses, /headers\.set\("Cache-Control", "no-store"\)/u);
  assert.match(errors, /apiErrorResponse\(request/u);
  assert.match(errors, /code: error\.code/u);
});
