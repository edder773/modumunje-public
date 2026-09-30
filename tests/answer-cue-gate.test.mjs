import assert from "node:assert/strict";
import test from "node:test";
import { assertAnswerCueGate, evaluateAnswerCueGate } from "../scripts/lib/answer-cue-gate.mjs";

function item(id, choices, answer, extra = {}) {
  return {
    id, exam_scope: "BAE", active: 1, kind: "single",
    choices: JSON.stringify(choices), correct_answers: JSON.stringify([answer]),
    ...extra,
  };
}

test("ties split expected success uniformly and single-only filters are explicit", () => {
  const rows = [
    item(1, ["a", "long", "long", "b"], 1),
    item(2, ["a", "longest", "bb", "cc"], 0),
    item(3, ["a", "bb", "cc", "longest"], 3),
    item(4, ["a", "bb", "cc", "longest"], 3, { active: 0 }),
    item(5, ["a", "bb", "cc", "longest"], 3, { kind: "multiple" }),
  ];
  const x = evaluateAnswerCueGate(rows).byScope.BAE;
  assert.equal(x.singleItems, 3);
  assert.equal(x.pickLongestExpectedAccuracy, 0.5);
  assert.equal(x.tiedLongestItems, 1);
  assert.equal(x.uniqueLongestCorrectRate, 0.5);
});

test("threshold is exact and actual course membership includes shared questions", () => {
  const rows = [
    ...[0, 1].map((id) => item(id, ["longest", "a", "b", "c"], 0, { exam_scope: "both" })),
    ...[2, 3, 4].map((id) => item(id, ["longest", "a", "b", "c"], 1, { exam_scope: "both" })),
  ];
  assert.equal(assertAnswerCueGate(rows, { requiredCourses: ["SQLD"] }).byCourse.SQLD.pickLongestExpectedAccuracy, 0.4);
  assert.throws(() => assertAnswerCueGate([
    ...rows, item(6, ["longest", "a", "b", "c"], 0, { exam_scope: "SQLP" }),
  ], { requiredCourses: ["SQLD", "SQLP"] }), /SQLP=/);
});

test("absolute cue rates are diagnostic and answers must be valid", () => {
  const rows = [
    item(1, ["항상 같다", "맞는 설명", "무조건 증가", "다른 설명"], 1),
    item(2, ["정상 설명", "즉시 처리", "다른 설명", "맞는 설명"], 3),
  ];
  const x = evaluateAnswerCueGate(rows).byScope.BAE;
  assert.equal(x.correctAbsoluteChoiceRate, 0);
  assert.equal(x.wrongAbsoluteChoiceRate, 0.5);
  assert.throws(() => evaluateAnswerCueGate([item(3, ["a", "b"], 5)]), /invalid single-answer contract/);
  assert.throws(() => evaluateAnswerCueGate([item(4, "broken", 0)]), /invalid choices/);
});

test("five-choice and astral Unicode lengths match Python code-point counting", () => {
  const x = evaluateAnswerCueGate([item(1, ["😀", "ab", "a", "b", "c"], 1)]).byScope.BAE;
  assert.equal(x.pickLongestExpectedAccuracy, 1);
});

test("all-tied items have no unique-longest rate, and unrecognized scopes fail closed", () => {
  const allTied = evaluateAnswerCueGate([item(1, ["aa", "bb", "cc", "dd"], 2)]);
  assert.equal(allTied.byScope.BAE.uniqueLongestCorrectRate, null);
  assert.equal(allTied.byCourse.BAE.pickLongestExpectedAccuracy, 0.25);
  assert.throws(() => evaluateAnswerCueGate([
    item(2, ["long", "a", "b", "c"], 0, { exam_scope: "UNKNOWN" }),
  ]), /unmapped exam scopes: UNKNOWN/);
});

test("release assertion rejects absent or inactive required courses", () => {
  assert.throws(() => assertAnswerCueGate([]), /missing active single items/);
  assert.throws(() => assertAnswerCueGate([
    item(1, ["a", "b", "c", "d"], 0, { active: 0 }),
  ], { requiredCourses: ["BAE"] }), /missing active single items for BAE/);
  assert.throws(() => assertAnswerCueGate([
    item(2, ["a", "b", "c", "d"], 0, { kind: "descriptive" }),
  ], { requiredCourses: ["BAE"] }), /missing active single items for BAE/);
});
