import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import { EXAM_CONFIGS } from "../packages/shared/src/study/study-domain";
import { MockExamHome } from "../apps/frontend/src/features/study/components/sql/mock/mock-home";
import { ExamRunner, ExamResultView } from "../apps/frontend/src/features/study/components/sql/mock/exam-runner";
import { examQuestionAnswered } from "../apps/frontend/src/features/study/model/exam-answer-state";
import { gradedPracticeAttempts } from "../apps/frontend/src/features/study/components/study-screen-shared";

const noOp = () => {};
const ids = Array.from({ length: 20 }, (_, index) => 88100001 + index);
const session = {
  id: "practical-mock-test", examType: "IPEP", status: "active", questionIds: ids,
  answers: {}, descriptiveAnswers: {}, descriptiveScores: {}, descriptiveSnapshots: {},
  flagged: [], currentIndex: 0, startedAt: "2026-09-08T00:00:00Z", endsAt: "2026-09-08T02:30:00Z",
  result: {}, policySnapshot: EXAM_CONFIGS.IPEP,
} as unknown as Parameters<typeof ExamRunner>[0]["session"];
const question = {
  id: ids[0], examScope: "IPEP", kind: "descriptive", category: "정보처리실무", topic: "프로그래밍", difficulty: "중",
  prompt: "코드의 실행 결과를 쓰시오.", choices: [], correctAnswers: [],
  explanation: "제출 뒤에만 공개할 해설", scoringCriteria: ["제출 뒤에만 공개할 채점 기준"], requiredConcepts: [],
  shortAnswerInput: { hint: "출력의 공백과 줄바꿈을 유지하세요.", multiline: true },
} as unknown as Parameters<typeof ExamRunner>[0]["questions"][number];

test("practical mock entry explains 20 typed answers, 150 minutes and the simulated scoring policy", () => {
  const config = EXAM_CONFIGS.IPEP;
  assert.equal(config.totalQuestions, 20);
  assert.equal(config.descriptivePoint * config.descriptiveCount, 100);
  assert.equal(config.durationMinutes, 150);
  assert.equal(config.passingScore, 60);
  const html = renderToStaticMarkup(<MockExamHome examType="IPEP" sessions={[]} busy={false} error={null} onStart={noOp} onResume={noOp} />);
  assert.match(html, /단답형 20문항/u);
  assert.match(html, /150분/u);
  assert.match(html, /문항당 5점/u);
  assert.match(html, /5점\/항목 수의 부분점수/u);
  assert.doesNotMatch(html, /객관식 0|과목별 0%/u);
});

test("practical input preserves raw text, counts unloaded answers, and does not reveal cached feedback", () => {
  const html = renderToStaticMarkup(<ExamRunner session={session} questions={[question]} answers={{}}
    descriptiveAnswers={{ [ids[0]]: "  A\nB  ", [ids[14]]: "Stub" }} descriptiveScores={{}} descriptiveSnapshots={{}}
    flagged={[]} currentIndex={0} busy={false} questionLoadError="" onAnswers={noOp} onDescriptiveAnswers={noOp}
    onDescriptiveScores={noOp} onDescriptiveSnapshots={noOp} onFlagged={noOp} onIndex={noOp}
    onSubmit={noOp} onRetryQuestion={noOp} onExit={noOp} />);
  assert.match(html, /응답 2\/20 · 미응답 18/u);
  assert.match(html, /aria-label="내 답안"/u);
  assert.match(html, /<textarea[^>]+rows="5"[^>]*>  A\nB  <\/textarea>/u);
  assert.match(html, /<details class="exam-map-disclosure">/u);
  assert.doesNotMatch(html, /제출 뒤에만 공개할|내 예상 점수|평가 자료|직접 채점/u);
});

test("answer completeness distinguishes practical typing from existing SQLP self-assessment", () => {
  const state = { examType: "IPEP" as const, answers: {}, descriptiveAnswers: { "1": " 0\n" }, descriptiveScores: {}, descriptiveSnapshots: {} };
  assert.equal(examQuestionAnswered(state, 1), true);
  assert.equal(examQuestionAnswered({ ...state, descriptiveAnswers: { "1": " \n" } }, 1), false);
  assert.equal(examQuestionAnswered({ ...state, examType: "SQLP" }, 1, "descriptive"), false);
  assert.equal(examQuestionAnswered({ ...state, examType: "SQLP", descriptiveScores: { "1": 70 }, descriptiveSnapshots: { "1": "0" } }, 1, "descriptive"), true);
  assert.equal(examQuestionAnswered({ ...state, examType: "IPEW", answers: { "1": [0] } }, 1, "single"), true);
});

test("submitted practical results expose exact grading and raw answers without self-score controls", async () => {
  const result = {
    examType: "IPEP", passed: false, failedMinimum: false, totalScore: 5, objectiveScore: 0, descriptiveScore: 5,
    correctCount: 1, incorrectCount: 1, unansweredCount: 18, submittedAt: "2026-09-08T00:10:00Z",
    subjectScores: { "정보처리실무": { earned: 5, possible: 100, rate: 5, failedMinimum: false } },
    questionResults: [{ questionId: ids[0], position: 1, category: "정보처리실무", kind: "descriptive", result: "incorrect", score: 0, convertedScore: 0, selectedAnswers: [], correctAnswers: [], choices: [], answerText: "  A\nB  " }],
    practicalEvaluations: { [ids[0]]: { result: "incorrect", score: 0, feedback: "허용 정답과 일치하지 않습니다.", modelAnswer: "", detailedExplanation: "", provider: "exact" } },
  } as Parameters<typeof ExamResultView>[0]["result"];
  const stream = await renderToReadableStream(<ExamResultView result={result} questions={[question]} session={{ ...session, status: "submitted", result }} onExit={noOp} />);
  await stream.allReady;
  const html = await new Response(stream).text();
  assert.match(html, /실기 점수/u);
  assert.match(html, /<pre>  A\nB  <\/pre>/u);
  assert.match(html, /허용 정답과 일치하지 않습니다/u);
  assert.match(html, /제출 뒤에만 공개할 해설/u);
  assert.doesNotMatch(html, /객관식 점수|내 예상 점수|<textarea/u);
});

test("automatically graded practical mock attempts enter practice records", () => {
  const attempts = [
    { questionId: ids[0], examType: "IPEP", mode: "mock-exam", result: "correct" },
    { questionId: ids[0], examType: "IPEP", mode: "mock-exam-self-assessment", result: "correct" },
  ] as Parameters<typeof gradedPracticeAttempts>[1];
  assert.deepEqual(gradedPracticeAttempts([question], attempts, "IPEP"), [attempts[0]]);
});
