import assert from "node:assert/strict";
import test from "node:test";
import {
  saveLearningAttempt,
  StudyRequestError,
} from "../apps/backend/src/modules/study/study-attempt.service";
import { createPracticeFeedbackAuthorization } from "../packages/shared/src/study/exam-feedback-authorization.mjs";
import { POST as saveSwStudy } from "../apps/backend/src/modules/sw-study/sw-study.service";
import { learnerUserHash } from "../apps/backend/src/common/auth/admin-auth";
import { learnerContextDatabase } from "./helpers/learner-context-fake";

const secret = "sec-int-001-integration-secret-at-least-32-characters";
const learnerEmail = "learner@example.test";
const learnerKey = await learnerUserHash(learnerEmail);
const accountDatabase = learnerContextDatabase({
  user_key: learnerKey,
  email: learnerEmail,
  display_name: "Learner",
  status: "active",
  blocked_reason: "",
});
globalThis.__BAEUMZIP_ENV__ = {
  DB: accountDatabase as never,
  GOOGLE_AUTH_SESSION_SECRET: secret,
};
(globalThis as typeof globalThis & { __BAEUMZIP_BUILD_SHA__: string }).__BAEUMZIP_BUILD_SHA__ =
  "cf5f6a83e091c04445b10914273df2926b9aeab6";

const objectiveQuestion = {
  id: 9001,
  examScope: "SQLD",
  kind: "single",
  choices: JSON.stringify(["오답", "정답"]),
  correctAnswers: JSON.stringify([1]),
  explanation: "제출 전 공개 금지 해설",
  scoringCriteria: "[]",
  requiredConcepts: "[]",
  acceptableAlternatives: "[]",
  deductionConditions: "[]",
  errorConditions: "[]",
};

const descriptiveQuestion = {
  ...objectiveQuestion,
  id: 9002,
  kind: "descriptive",
  choices: "[]",
  correctAnswers: "[]",
  scoringCriteria: JSON.stringify(["핵심 기준"]),
};

function repository(options: {
  activeQuestionId?: number;
  blockingStatus?: string;
  duplicate?: boolean;
} = {}) {
  let insertCount = 0;
  return {
    async findPracticeAttemptContext(_userKey: string, questionId: number) {
      return {
        blockingExamItem: questionId === options.activeQuestionId
          ? { id: "exam_session_123456", status: options.blockingStatus ?? "active" }
          : null,
        question: questionId === objectiveQuestion.id
          ? objectiveQuestion
          : questionId === descriptiveQuestion.id
            ? descriptiveQuestion
            : null,
      };
    },
    async findOwnedEvaluation() {
      return null;
    },
    async insertAttemptIdempotent(input: Record<string, unknown>) {
      insertCount += 1;
      return {
        conflict: false,
        created: !options.duplicate && insertCount === 1,
        attempt: {
          id: 1,
          ...input,
          createdAt: "2026-08-31T00:00:00.000Z",
        },
      };
    },
  };
}

async function authorization(userKey: string, questionId: number) {
  return createPracticeFeedbackAuthorization({
    secret,
    userKey,
    engine: "sql",
    questionId,
  });
}

function objectivePayload(feedbackAuthorization: string) {
  return {
    questionId: objectiveQuestion.id,
    examType: "SQLD",
    selectedAnswers: [0],
    mode: "practice",
    clientOperationId: "sec-int-001-objective",
    feedbackAuthorization,
  };
}

test("active SQL exam item is denied before feedback is returned or stored", async () => {
  const userKey = "owner-user";
  const target = repository({ activeQuestionId: objectiveQuestion.id });
  await assert.rejects(
    saveLearningAttempt({
      action: "attempt",
      key: userKey,
      adminActivity: false,
      repository: target as never,
      payload: objectivePayload(await authorization(userKey, objectiveQuestion.id)),
    }),
    (error) => error instanceof StudyRequestError
      && error.status === 403
      && error.code === "STUDY_FEEDBACK_FORBIDDEN",
  );
});

test("grading, expired-unsubmitted, and unknown SQL exam states fail closed", async () => {
  for (const blockingStatus of ["grading", "active", "unknown-state"]) {
    const userKey = `owner-${blockingStatus}`;
    const target = repository({
      activeQuestionId: objectiveQuestion.id,
      blockingStatus,
    });
    await assert.rejects(
      saveLearningAttempt({
        action: "attempt",
        key: userKey,
        adminActivity: false,
        repository: target as never,
        payload: objectivePayload(await authorization(userKey, objectiveQuestion.id)),
      }),
      (error) => error instanceof StudyRequestError
        && error.status === 403
        && error.code === "STUDY_FEEDBACK_FORBIDDEN",
      blockingStatus,
    );
  }
});

test("practice authorization cannot cross users or question ids", async () => {
  const target = repository();
  const otherUserAuthorization = await authorization("other-user", objectiveQuestion.id);
  await assert.rejects(saveLearningAttempt({
    action: "attempt",
    key: "owner-user",
    adminActivity: false,
    repository: target as never,
    payload: objectivePayload(otherUserAuthorization),
  }), (error) => error instanceof StudyRequestError && error.code === "STUDY_FEEDBACK_FORBIDDEN");

  const otherQuestionAuthorization = await authorization("owner-user", descriptiveQuestion.id);
  await assert.rejects(saveLearningAttempt({
    action: "attempt",
    key: "owner-user",
    adminActivity: false,
    repository: target as never,
    payload: objectivePayload(otherQuestionAuthorization),
  }), (error) => error instanceof StudyRequestError && error.code === "STUDY_FEEDBACK_FORBIDDEN");
});

test("authorized objective and descriptive practice keep immediate feedback", async () => {
  const userKey = "practice-user";
  const target = repository();
  const objectiveResponse = await saveLearningAttempt({
    action: "attempt",
    key: userKey,
    adminActivity: false,
    repository: target as never,
    payload: objectivePayload(await authorization(userKey, objectiveQuestion.id)),
  });
  assert.equal(objectiveResponse.status, 201);
  assert.deepEqual((await objectiveResponse.json()).feedback.correctAnswers, [1]);

  const descriptiveResponse = await saveLearningAttempt({
    action: "self-assessment",
    key: userKey,
    adminActivity: false,
    repository: target as never,
    payload: {
      questionId: descriptiveQuestion.id,
      examType: "SQLD",
      mode: "self-assessment",
      answerText: "연습 답안",
      score: 80,
      clientOperationId: "sec-int-001-descriptive",
      feedbackAuthorization: await authorization(userKey, descriptiveQuestion.id),
    },
  });
  assert.equal(descriptiveResponse.status, 200);
  assert.deepEqual((await descriptiveResponse.json()).feedback.scoringCriteria, ["핵심 기준"]);
});

test("authorized practice retry remains idempotent", async () => {
  const userKey = "retry-user";
  const target = repository({ duplicate: true });
  const response = await saveLearningAttempt({
    action: "attempt",
    key: userKey,
    adminActivity: false,
    repository: target as never,
    payload: objectivePayload(await authorization(userKey, objectiveQuestion.id)),
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.duplicate, true);
  assert.deepEqual(body.feedback.correctAnswers, [1]);
});

test("authorized grading reads exam state and answer material in one repository round trip", async () => {
  const userKey = "batched-context-user";
  const target = repository();
  let contextReads = 0;
  const original = target.findPracticeAttemptContext;
  target.findPracticeAttemptContext = async (...args: Parameters<typeof original>) => {
    contextReads += 1;
    return original(...args);
  };
  const response = await saveLearningAttempt({
    action: "attempt",
    key: userKey,
    adminActivity: false,
    repository: target as never,
    payload: objectivePayload(await authorization(userKey, objectiveQuestion.id)),
  });
  assert.equal(response.status, 201);
  assert.equal(contextReads, 1);
});

function swRepository(activeMock = false) {
  const practiceSession = {
    id: "sw_practice_session_123",
    mode: "practice",
    status: "active",
    subjectIds: JSON.stringify(["algorithms"]),
    questionIds: JSON.stringify(["SW-SEC-1"]),
    answers: "{}",
    revealedQuestionIds: "[]",
    currentIndex: 0,
    result: "{}",
    revision: 0,
    createdAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
  };
  return {
    async findSession(userKey: string, sessionId: string) {
      return userKey === learnerKey && sessionId === practiceSession.id ? practiceSession : null;
    },
    async findActiveSession(userKey: string, mode: string) {
      if (userKey !== learnerKey || mode !== "mock" || !activeMock) return null;
      return {
        ...practiceSession,
        id: "sw_mock_session_123456",
        mode: "mock",
      };
    },
    async findPracticeBlockedQuestionIds(userKey: string, questionIds: string[]) {
      return userKey === learnerKey && activeMock && questionIds.includes("SW-SEC-1")
        ? ["SW-SEC-1"]
        : [];
    },
    async findAttemptQuestion(questionId: string) {
      return questionId === "SW-SEC-1" ? {
        id: questionId,
        theory_id: 1,
        subject_group_id: "software",
        subject_id: "algorithms",
        category: "알고리즘",
        topic: "정렬",
        display_order: 1,
        difficulty: "중",
        difficulty_rationale: "통합 테스트",
        kind: "single",
        prompt: "정답을 고르세요.",
        choices: JSON.stringify(["오답", "정답"]),
        correct_answers: JSON.stringify([1]),
        explanation: "SW 제출 전 공개 금지 해설",
        tags: "[]",
      } : null;
    },
    async insertAttemptIdempotent(input: Record<string, unknown>) {
      return {
        conflict: false,
        created: true,
        attempt: {
          id: 1,
          ...input,
          selectedAnswers: JSON.stringify(input.selectedAnswers),
        },
      };
    },
  };
}

async function swAttempt(activeMock = false) {
  const feedbackAuthorization = await createPracticeFeedbackAuthorization({
    secret,
    userKey: learnerKey,
    engine: "sw",
    questionId: "SW-SEC-1",
    contextId: "sw_practice_session_123",
  });
  return saveSwStudy(new Request("https://modumunje.com/api/sw-study", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-sql-study-user-request": "1",
      "x-baeumzip-authenticated-user-email": learnerEmail,
    "x-baeumzip-sw-owner": learnerKey,
    },
    body: JSON.stringify({
      action: "sw-attempt",
      questionId: "SW-SEC-1",
      selectedAnswers: [0],
      mode: "practice",
      sessionId: "sw_practice_session_123",
      clientOperationId: "sec-int-001-sw-attempt",
      feedbackAuthorization,
    }),
  }), swRepository(activeMock) as never);
}

test("active SW mock item is blocked through the generic practice attempt", async () => {
  const response = await swAttempt(true);
  const body = await response.json();
  assert.equal(response.status, 403);
  assert.equal(body.code, "SW_FEEDBACK_FORBIDDEN");
  assert.equal(body.correctAnswers, undefined);
  assert.equal(body.explanation, undefined);
});

test("owned SW practice session preserves immediate feedback", async () => {
  const response = await swAttempt(false);
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.deepEqual(body.feedback.correctAnswers, [1]);
  assert.equal(body.feedback.explanation, "SW 제출 전 공개 금지 해설");
});
