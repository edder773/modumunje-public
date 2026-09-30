import assert from "node:assert/strict";
import test from "node:test";

import { selectSqlPracticeCandidates } from "../apps/frontend/src/features/study/model/practice-candidates.mjs";
import {
  requestedSwSessionQuestionIds,
  restoreSwSessionSnapshot,
} from "../apps/frontend/src/features/study/model/sw-session-restore.mjs";

const keepOrder = () => 0.999;

function sqlQuestion(overrides) {
  return {
    id: 1,
    category: "SQL 기본 및 활용",
    difficulty: "하",
    kind: "single",
    theoryId: 10,
    practiceScope: "general",
    variantGroupId: null,
    bookmarked: false,
    ...overrides,
  };
}

test("SQL practice selection keeps general, theory-linked, and direct-link rules separate", () => {
  const questions = [
    sqlQuestion({ id: 1, bookmarked: true }),
    sqlQuestion({ id: 2, practiceScope: "theory_only" }),
    sqlQuestion({ id: 3, kind: "descriptive", difficulty: "상" }),
    sqlQuestion({ id: 4, category: "데이터 모델링의 이해", kind: "multiple" }),
  ];

  assert.deepEqual(selectSqlPracticeCandidates({
    questions,
    category: "SQL 기본 및 활용",
    difficulty: "하",
    practiceKind: "objective",
    bookmarkOnly: true,
    random: keepOrder,
  }).map((question) => question.id), [1]);

  assert.deepEqual(selectSqlPracticeCandidates({
    questions,
    category: "전체 과목",
    difficulty: "전체",
    practiceKind: "mixed",
    theoryId: 10,
    random: keepOrder,
  }).map((question) => question.id), [2]);

  assert.deepEqual(selectSqlPracticeCandidates({
    questions,
    category: "데이터 모델링의 이해",
    difficulty: "상",
    practiceKind: "descriptive",
    questionId: 2,
    random: keepOrder,
  }).map((question) => question.id), [2]);
});

test("SW session restoration accepts only requested in-scope questions and valid answers", () => {
  const session = {
    subjectIds: ["subject-a"],
    theoryId: 10,
    questionIds: ["q1", "q2", "q3"],
    answers: { q1: [1], q2: [2], q3: [0], extra: [0] },
    revealedQuestionIds: ["q1", "q2", "q3", "extra"],
    currentIndex: 1,
  };
  const questions = [
    { id: "q1", subjectId: "subject-a", theoryId: 10, choices: ["a", "b"], tags: ["profile"] },
    { id: "q2", subjectId: "subject-a", theoryId: 10, choices: ["a", "b"], tags: ["profile"] },
    { id: "q3", subjectId: "subject-b", theoryId: 10, choices: ["a"], tags: ["profile"] },
    { id: "extra", subjectId: "subject-a", theoryId: 10, choices: ["a"], tags: ["profile"] },
  ];

  const restored = restoreSwSessionSnapshot({
    session,
    questions,
    requestedQuestionIds: requestedSwSessionQuestionIds(session.questionIds),
    requiredTag: "profile",
  });

  assert.deepEqual(restored.questions.map((question) => question.id), ["q1", "q2"]);
  assert.deepEqual(restored.answers, { q1: [1] });
  assert.deepEqual(restored.revealedQuestionIds, ["q1"]);
  assert.equal(restored.currentIndex, 1);
  assert.equal(restored.scopeIsComplete, false);
  assert.equal(restored.omittedQuestionCount, 1);
});

test("SW restore request IDs are unique and capped at 100", () => {
  const ids = [...Array.from({ length: 101 }, (_, index) => `q${index}`), "q100"];
  const requested = requestedSwSessionQuestionIds(ids);
  assert.equal(requested.length, 100);
  assert.equal(requested[0], "q1");
  assert.equal(requested.at(-1), "q100");
});
