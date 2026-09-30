import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Practice } from "../apps/frontend/src/features/study/components/sql/practice/practice-screen";
import usePracticeSession from "../apps/frontend/src/features/study/model/use-practice-session";
import { SwMockRunner, SwPracticeRunner, type SwQuestionItem } from "../apps/frontend/src/features/study/components/sw-question-runners";
import { learningField } from "../packages/shared/src/study/learning-catalog";

type PracticeProps = Parameters<typeof Practice>[0];
const question: NonNullable<PracticeProps["currentQuestion"]> = {
  id: 1, displayOrder: 1, kind: "single", examScope: "both", category: "데이터 모델링의 이해",
  topic: "모델링", difficulty: "하", prompt: "모델링의 목적은?", choices: ["현실의 핵심을 구조화한다", "삭제한다"],
  correctAnswers: [0], explanation: "핵심을 구조화합니다.", tags: [], bookmarked: false,
  difficultyRationale: "핵심 개념", scoringCriteria: [], requiredConcepts: [], acceptableAlternatives: [],
  deductionConditions: [], errorConditions: [], theoryId: null, practiceScope: "general", variantGroupId: null,
  active: true, createdAt: "2026-09-11T00:00:00Z", updatedAt: "2026-09-11T00:00:00Z",
};

function practiceMarkup(overrides: Partial<PracticeProps> = {}) {
  function Screen() {
    const state = usePracticeSession({
      selectedExam: "SQLD", availableQuestions: [], data: { questions: [], theories: [] },
    } as unknown as Parameters<typeof usePracticeSession>[0]);
    return <Practice {...state.practiceBindings} currentQuestion={question} questions={[question!]}
      queue={[1]} onReportQuestion={() => {}} onOpenTheory={() => {}} onReturnTheory={() => {}} {...overrides} />;
  }
  return renderToStaticMarkup(<Screen />);
}

test("SQL practice only reserves an inert footer while a normal question is active", () => {
  const markup = practiceMarkup();
  assert.equal((markup.match(/data-ad-placement="practice-footer"/gu) ?? []).length, 1);
  assert.match(markup, /data-ad-status="reserved-only" hidden=""/u);
  assert.doesNotMatch(markup, /광고 위치 미리보기|<iframe|adsbygoogle/u);
  for (const state of [{ currentQuestion: undefined }, { quizDone: true }, { bookmarkMode: true }]) {
    assert.doesNotMatch(practiceMarkup(state), /data-ad-placement/u);
  }
  assert.match(practiceMarkup({ adSuppressed: true }), /data-ad-status="suppressed" hidden=""/u);
});

test("SW mock running and results have no slots; ordinary practice has one except empty states", () => {
  const questions: SwQuestionItem[] = [{ ...question, kind: "single", id: "SW-1", subjectGroupId: "computer-science-foundations", subjectId: "data-structures", theoryId: 1 }];
  const shared = {
    questions, index: 0, answers: {}, contentLoading: false, contentError: "", contentRetry: null, busy: false,
    answerIsCorrect: () => true, onIndexChange: () => {}, onToggleAnswer: () => {},
  };
  const practiceProps: Parameters<typeof SwPracticeRunner>[0] = {
    ...shared, field: learningField("software-major")!, selectedTheoryId: null, revealedQuestionIds: new Set<string>(),
    loadingNext: false, grading: false, onStop: () => {}, onReveal: () => {}, onNext: () => {},
  };
  assert.match(renderToStaticMarkup(<SwPracticeRunner {...practiceProps} />), /data-ad-placement="practice-footer"/u);
  assert.doesNotMatch(renderToStaticMarkup(<SwPracticeRunner {...practiceProps} questions={[]} />), /data-ad-placement/u);
  assert.match(renderToStaticMarkup(<SwPracticeRunner {...practiceProps} contentError="읽기 실패" />), /data-ad-status="suppressed"/u);
  for (const submitted of [false, true]) {
    const markup = renderToStaticMarkup(<SwMockRunner {...shared} submitted={submitted} submitWarning={false}
      onSubmitWarningChange={() => {}} onRequestSubmit={() => {}} onSubmit={() => {}} onShowSetup={() => {}} />);
    assert.doesNotMatch(markup, /data-ad-placement/u);
  }
});
