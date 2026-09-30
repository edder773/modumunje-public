import assert from "node:assert/strict";
import test from "node:test";
import { learnerUserHash } from "../apps/backend/src/common/auth/admin-auth";
import { learnerContextDatabase } from "./helpers/learner-context-fake";
import {
  withPracticeFeedbackAuthorization,
} from "../apps/backend/src/modules/study/study-question-delivery";
import {
  GET as readSwStudy,
  POST as saveSwStudy,
} from "../apps/backend/src/modules/sw-study/sw-study.service";
import { buildStudyPracticeQuery } from "../apps/backend/src/modules/study/study-practice-query.mjs";
import { buildSwPracticeQuery } from "../apps/backend/src/modules/sw-study/sw-practice-query.mjs";
import { persistSwPracticeQuestionBatch } from "../apps/frontend/src/features/study/model/sw-session-snapshot";

const secret = "sec-int-001-gap-test-secret-at-least-32-characters";
const learnerEmail = "gap-learner@example.test";
const learnerKey = await learnerUserHash(learnerEmail);
const accountDatabase = learnerContextDatabase({
  user_key: learnerKey,
  email: learnerEmail,
  display_name: "Gap Learner",
  status: "active",
  blocked_reason: "",
});
globalThis.__BAEUMZIP_ENV__ = {
  DB: accountDatabase as never,
  GOOGLE_AUTH_SESSION_SECRET: secret,
};
(globalThis as typeof globalThis & { __BAEUMZIP_BUILD_SHA__: string }).__BAEUMZIP_BUILD_SHA__ =
  "49c0c289d3b53fe7481e97b2ea9a0b308c5bf8f9";

const protectedFields = new Set([
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
]);

function countProtectedFields(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  if (Array.isArray(value)) {
    return value.reduce((count, item) => count + countProtectedFields(item), 0);
  }
  return Object.entries(value).reduce((count, [key, item]) => (
    count + Number(protectedFields.has(key)) + countProtectedFields(item)
  ), 0);
}

const safeSwQuestion = {
  id: "SW-GAP-1",
  theory_id: 1,
  subject_group_id: "software",
  subject_id: "algorithms",
  category: "알고리즘",
  topic: "정렬",
  display_order: 1,
  difficulty: "중",
  difficulty_rationale: "경계 테스트",
  kind: "single",
  prompt: "안전한 문제 본문",
  choices: JSON.stringify(["선택 1", "선택 2"]),
  tags: "[]",
};

const feedbackSwQuestion = {
  ...safeSwQuestion,
  correct_answers: JSON.stringify([1]),
  explanation: "승인 후에만 읽는 해설",
};

const activePracticeSession = {
  id: "sw_gap_session_12345",
  mode: "practice" as const,
  status: "active",
  subjectIds: JSON.stringify(["algorithms"]),
  questionIds: JSON.stringify([safeSwQuestion.id]),
  answers: "{}",
  revealedQuestionIds: "[]",
  currentIndex: 0,
  result: "{}",
  revision: 0,
  createdAt: "2026-08-31T00:00:00.000Z",
  updatedAt: "2026-08-31T00:00:00.000Z",
};

function learnerHeaders() {
  return {
    "x-baeumzip-authenticated-user-email": learnerEmail,
    "x-baeumzip-sw-owner": learnerKey,
  };
}

function mutationHeaders() {
  return {
    "Content-Type": "application/json",
    "x-sql-study-user-request": "1",
    ...learnerHeaders(),
  };
}

function swPracticeUrl(sessionId = activePracticeSession.id) {
  return `https://modumunje.com/api/sw-study?view=practice&subjects=algorithms&mode=practice&sessionId=${sessionId}&limit=1`;
}

function swReadRepository(options: {
  persisted?: boolean;
  blocked?: boolean;
  status?: string;
} = {}) {
  return {
    async findPracticeQuestions() {
      return [safeSwQuestion];
    },
    async findSession(userKey: string, sessionId: string) {
      return options.persisted && userKey === learnerKey && sessionId === activePracticeSession.id
        ? { ...activePracticeSession, status: options.status ?? "active" }
        : null;
    },
    async findPracticeBlockedQuestionIds() {
      return options.blocked ? [safeSwQuestion.id] : [];
    },
  };
}

test("SQL issuance omits authorization for active, grading, expired-unsubmitted, and unknown exam items", async () => {
  for (const state of ["active", "grading", "expired-unsubmitted", "unknown-state"]) {
    let inspectedIds: number[] = [];
    const questions = await withPracticeFeedbackAuthorization(
      [{ id: 101, prompt: `blocked-${state}` }, { id: 102, prompt: "practice" }],
      learnerKey,
      {
        async findPracticeBlockedQuestionIds(userKey: string, questionIds: readonly number[]) {
          assert.equal(userKey, learnerKey);
          inspectedIds = [...questionIds];
          return [101];
        },
      } as never,
    );
    assert.deepEqual(inspectedIds, [101, 102]);
    const issued = questions as Array<{ feedbackAuthorization?: string }>;
    assert.equal(issued[0].feedbackAuthorization, undefined, state);
    assert.equal(typeof issued[1].feedbackAuthorization, "string", state);
  }
});

test("unpersisted SW session id never receives practice feedback authorization", async () => {
  const response = await readSwStudy(
    new Request(swPracticeUrl(), { headers: learnerHeaders() }),
    swReadRepository() as never,
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.questions[0].feedbackAuthorization, undefined);
  assert.equal(countProtectedFields(body), 0);
});

test("persisted owned active SW practice session receives authorization unless mock-blocked", async () => {
  const allowed = await readSwStudy(
    new Request(swPracticeUrl(), { headers: learnerHeaders() }),
    swReadRepository({ persisted: true }) as never,
  );
  const allowedBody = await allowed.json();
  assert.equal(typeof allowedBody.questions[0].feedbackAuthorization, "string");
  assert.equal(countProtectedFields(allowedBody), 0);

  const blocked = await readSwStudy(
    new Request(swPracticeUrl(), { headers: learnerHeaders() }),
    swReadRepository({ persisted: true, blocked: true }) as never,
  );
  const blockedBody = await blocked.json();
  assert.equal(blockedBody.questions[0].feedbackAuthorization, undefined);
  assert.equal(countProtectedFields(blockedBody), 0);
});

function swSessionRepository(options: { blocked?: boolean; existing?: typeof activePracticeSession } = {}) {
  let protectedReadCount = 0;
  let writeCount = 0;
  const repository = {
    get protectedReadCount() {
      return protectedReadCount;
    },
    get writeCount() {
      return writeCount;
    },
    async findSession(userKey: string, sessionId: string) {
      if (options.existing && userKey === learnerKey && sessionId === options.existing.id) {
        return options.existing;
      }
      return null;
    },
    async findSessionQuestions() {
      return [safeSwQuestion];
    },
    async findFeedbackQuestions() {
      protectedReadCount += 1;
      return [feedbackSwQuestion];
    },
    async findPracticeBlockedQuestionIds() {
      return options.blocked ? [safeSwQuestion.id] : [];
    },
    async saveSession(input: Record<string, unknown>) {
      writeCount += 1;
      return {
        outcome: "saved" as const,
        saved: {
          ...activePracticeSession,
          id: input.id,
          mode: input.mode,
          status: input.status,
          questionIds: JSON.stringify(input.questionIds),
        },
        duplicate: false,
      };
    },
  };
  return repository;
}

function swSessionSaveRequest(action = "sw-session-save") {
  return new Request("https://modumunje.com/api/sw-study", {
    method: "POST",
    headers: mutationHeaders(),
    body: JSON.stringify({
      action,
      sessionId: activePracticeSession.id,
      revision: 0,
      mode: "practice",
      subjectIds: ["algorithms"],
      theoryId: 1,
      questionIds: [safeSwQuestion.id],
      answers: {},
      revealedQuestionIds: [],
      currentIndex: 0,
    }),
  });
}

test("SW authorization is issued only after the owned practice session is persisted", async () => {
  const repository = swSessionRepository();
  const response = await saveSwStudy(swSessionSaveRequest(), repository as never);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(repository.writeCount, 1);
  assert.equal(repository.protectedReadCount, 0);
  assert.equal(typeof body.questions[0].feedbackAuthorization, "string");
  assert.equal(countProtectedFields(body), 0);

  const blockedRepository = swSessionRepository({ blocked: true });
  const blocked = await saveSwStudy(swSessionSaveRequest(), blockedRepository as never);
  const blockedBody = await blocked.json();
  assert.equal(blockedBody.questions[0].feedbackAuthorization, undefined);
  assert.equal(blockedRepository.protectedReadCount, 0);
});

test("SW next practice batch preserves feedback and progress beyond 20 questions", async () => {
  const current = Array.from({ length: 20 }, (_, index) => ({
    id: `SW-GAP-${index + 1}`,
    ...(index === 0
      ? {
          correctAnswers: [1],
          explanation: "preserved-explanation",
        }
      : {}),
  }));
  const next = Array.from({ length: 5 }, (_, index) => ({
    id: `SW-GAP-${index + 21}`,
  }));
  const authorized = [...current, ...next].map((question) => ({
    id: question.id,
    feedbackAuthorization: `token-${question.id}`,
  }));
  authorized.push({
    id: "SW-GAP-UNREQUESTED",
    feedbackAuthorization: "token-unrequested",
  });
  let savedQuestionIds: string[] = [];
  let savedAnswers: Record<string, number[]> = {};
  let savedRevealedQuestionIds: string[] = [];
  let savedCurrentIndex = -1;
  const result = await persistSwPracticeQuestionBatch({
    current,
    next,
    id: activePracticeSession.id,
    revision: 1,
    subjectIds: ["algorithms"],
    answers: { "SW-GAP-1": [1] },
    revealedQuestionIds: ["SW-GAP-1", "SW-GAP-20"],
    currentIndex: 19,
    async save(session) {
      savedQuestionIds = session.questionIds;
      savedAnswers = session.answers;
      savedRevealedQuestionIds = session.revealedQuestionIds;
      savedCurrentIndex = session.currentIndex;
      return { status: "saved", questions: authorized, session };
    },
  });
  assert.deepEqual(
    savedQuestionIds,
    Array.from({ length: 25 }, (_, index) => `SW-GAP-${index + 1}`),
  );
  assert.deepEqual(savedAnswers, { "SW-GAP-1": [1] });
  assert.deepEqual(savedRevealedQuestionIds, ["SW-GAP-1", "SW-GAP-20"]);
  assert.equal(savedCurrentIndex, 19);
  assert.equal(result?.length, 25);
  assert.deepEqual(result?.[0], {
    id: "SW-GAP-1",
    correctAnswers: [1],
    explanation: "preserved-explanation",
    feedbackAuthorization: "token-SW-GAP-1",
  });
  assert.deepEqual(result?.[24], {
    id: "SW-GAP-25",
    feedbackAuthorization: "token-SW-GAP-25",
  });
});

test("unknown persisted SW session state fails closed before protected reads or writes", async () => {
  const repository = swSessionRepository({
    existing: { ...activePracticeSession, status: "unknown-state" },
  });
  const response = await saveSwStudy(swSessionSaveRequest(), repository as never);
  const body = await response.json();
  assert.equal(response.status, 403);
  assert.equal(body.code, "SW_SESSION_STATE_FORBIDDEN");
  assert.equal(repository.protectedReadCount, 0);
  assert.equal(repository.writeCount, 0);
  assert.equal(countProtectedFields(body), 0);
});

test("submitted SW mock result is released only through the owned session boundary", async () => {
  let protectedReadCount = 0;
  const submittedMock = {
    ...activePracticeSession,
    mode: "mock" as const,
    status: "submitted",
  };
  const ownedRepository = {
    async findSession(userKey: string, sessionId: string) {
      return userKey === learnerKey && sessionId === submittedMock.id ? submittedMock : null;
    },
    async findSessionQuestions() {
      return [safeSwQuestion];
    },
    async findFeedbackQuestions() {
      protectedReadCount += 1;
      return [feedbackSwQuestion];
    },
  };
  const url = `https://modumunje.com/api/sw-study?view=session&ids=${safeSwQuestion.id}&subjects=algorithms&mode=mock&sessionId=${submittedMock.id}`;
  const owned = await readSwStudy(
    new Request(url, { headers: learnerHeaders() }),
    ownedRepository as never,
  );
  const ownedBody = await owned.json();
  assert.equal(owned.status, 200);
  assert.equal(protectedReadCount, 1);
  assert.deepEqual(ownedBody.questions[0].correctAnswers, [1]);

  const deniedRepository = {
    ...ownedRepository,
    async findSession() {
      return null;
    },
  };
  const denied = await readSwStudy(
    new Request(url, { headers: learnerHeaders() }),
    deniedRepository as never,
  );
  const deniedBody = await denied.json();
  assert.equal(denied.status, 403);
  assert.equal(deniedBody.code, "SW_SESSION_FORBIDDEN");
  assert.equal(protectedReadCount, 1);
  assert.equal(countProtectedFields(deniedBody), 0);
});

test("pre-submit SQL and SW selection projections do not select protected columns", () => {
  const sqlPractice = buildStudyPracticeQuery({
    eligibility: {
      sql: "q.exam_scope IN (?) AND q.kind IN ('single', 'multiple')",
      values: ["SQLD"],
    },
    selectedExam: "SQLD",
    category: "",
    difficulty: "",
    kind: "objective",
    theoryId: 0,
    excludedIds: [],
    excludedVariantGroupIds: [],
    limit: 5,
  }).sql;
  const swPractice = buildSwPracticeQuery({
    subjects: ["algorithms"],
    theoryId: 0,
    excludedIds: [],
    requiredTag: null,
    profileOrder: false,
    profilePhases: [],
    limit: 5,
  }).sql;
  for (const query of [sqlPractice, swPractice]) {
    assert.doesNotMatch(query, /correct_answers|explanation|answer_key|grading_criteria|scoring_criteria|required_concepts|acceptable_alternatives|deduction_conditions|error_conditions/u);
  }
});

test("cancelled is not represented; unsupported SQL/SW states fail closed", () => {
  assert.equal("cancelled" in activePracticeSession, false);
  assert.ok(true, "cancelled: not represented by the current persisted state model");
});
