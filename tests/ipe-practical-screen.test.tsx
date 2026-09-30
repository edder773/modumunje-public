import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import usePracticeSession from "../apps/frontend/src/features/study/model/use-practice-session";
import { Practice } from "../apps/frontend/src/features/study/components/sql/practice/practice-screen";
import type { ExamType } from "../packages/shared/src/study/study-domain";
import { TheoryView } from "../apps/frontend/src/features/study/components/sql/theory/theory-screen";
import { StatsView } from "../apps/frontend/src/features/study/components/sql/records/records-screen";
import { gradedPracticeAttempts, type TheoryArticle } from "../apps/frontend/src/features/study/components/study-screen-shared";

function initialPractice(examType: ExamType, kind?: "single" | "descriptive") {
  function Screen() {
    const state = usePracticeSession({
      selectedExam: examType,
      availableQuestions: [],
      data: {
        questions: [], theories: [],
        practiceMeta: {
          counts: [{ category: "정보처리실무", kind: "descriptive", difficulty: "중", count: 397 }],
        },
      },
    } as unknown as Parameters<typeof usePracticeSession>[0]);
    const question: Parameters<typeof Practice>[0]["currentQuestion"] = kind ? {
      id: 1, displayOrder: 1, examScope: examType, category: "정보처리실무", topic: "프로그래밍",
      difficulty: "중", kind, prompt: "학습 조건을 확인하세요.", choices: ["첫 보기", "둘째 보기"],
      correctAnswers: [], explanation: "", tags: [], scoringCriteria: [], requiredConcepts: [],
      acceptableAlternatives: [], deductionConditions: [], errorConditions: [], theoryId: null,
      bookmarked: false, active: true, difficultyRationale: "합성 검증", practiceScope: "general",
      variantGroupId: null, createdAt: "2026-09-30T00:00:00Z", updatedAt: "2026-09-30T00:00:00Z",
    } : undefined;
    return <Practice {...state.practiceBindings}
      {...(question ? { currentQuestion: question, questions: [question], queue: [question.id] } : {})}
      onReportQuestion={() => {}} onOpenTheory={() => {}} onReturnTheory={() => {}} />;
  }
  return renderToStaticMarkup(<Screen />);
}

test("the practical course opens with available short-answer practice and accurate instructions", () => {
  const html = initialPractice("IPEP");
  assert.match(html, /<strong>단답형<\/strong>/u);
  assert.doesNotMatch(html, /기본값은 객관식|>객관식<|조건에 맞는 문제가 없습니다/u);
  assert.match(html, /단답을 직접 입력/u);
  assert.match(html, /공식 부분점수 판정은 아닙니다/u);
  assert.match(html, /<button class="primary-button" aria-busy="false">문제 풀이 시작/u);
});

test("written and mixed courses keep their existing objective defaults", () => {
  assert.match(initialPractice("IPEW"), /<strong>객관식<\/strong>/u);
  assert.match(initialPractice("SQLP"), /기본값은 객관식/u);
});

test("practical theory labels use the released subject instead of a legacy written ordinal", () => {
  const article = { id: 88000001, category: "정보처리실무", title: "실기 이론", topic: "프로그래밍", summary: "코드 추적", keywords: [], sortOrder: 1 } as unknown as TheoryArticle;
  const html = renderToStaticMarkup(<TheoryView examType="IPEP" articles={[article]} questions={[]}
    search="" selected={null} returnToQuestion={false} onSearch={() => {}}
    onSelect={() => {}} onClose={() => {}} onPractice={() => {}} onReturnQuestion={() => {}} />);
  assert.match(html, /<span class="category-label">정보처리실무<\/span>/u);
  assert.doesNotMatch(html, /[1-6]과목/u);
});

test("practical statistics count automatic short-answer attempts without old self scores", () => {
  const props = {
    examType: "IPEP", sessions: [], streak: 1,
    questions: [{ id: 88100001, examScope: "IPEP", kind: "descriptive", category: "정보처리실무", topic: "프로그래밍", difficulty: "중" }],
    attempts: [
      { questionId: 88100001, mode: "practice", result: "correct", createdAt: "2026-09-08T05:00:00Z" },
      { questionId: 88100001, mode: "incorrect-review", result: "incorrect", createdAt: "2026-09-08T05:01:00Z" },
      { questionId: 88100001, mode: "self-assessment", result: "incorrect", createdAt: "2026-09-08T05:02:00Z" },
    ],
  } as unknown as Parameters<typeof StatsView>[0];
  const html = renderToStaticMarkup(<StatsView {...props} />);
  assert.match(html, /단답형<!-- --> 풀이 요약|단답형 풀이 요약/u);
  assert.match(html, /총 풀이 수<\/span><strong>2<small>/u);
  assert.match(html, /오답 수<\/span><strong>1<small>/u);
  assert.match(html, /정보처리실무/u);
  assert.doesNotMatch(html, /객관식/u);
});

test("the record screen receives both correct and incorrect practical answers while excluding self scores", () => {
  type Input = Parameters<typeof gradedPracticeAttempts>;
  const questions = [{ id: 1, kind: "descriptive" }, { id: 2, kind: "single" }] as Input[0];
  const attempts = [
    { id: "wrong", questionId: 1, examType: "IPEP", mode: "practice", result: "incorrect" },
    { id: "correct", questionId: 1, examType: "IPEP", mode: "bookmark-modal", result: "correct" },
    { id: "manual", questionId: 1, examType: "IPEP", mode: "self-assessment", result: "incorrect" },
    { id: "sql-manual", questionId: 1, examType: "SQLP", mode: "self-assessment", result: "incorrect" },
    { id: "sql-objective", questionId: 2, examType: "SQLP", mode: "practice", result: "correct" },
  ] as unknown as Input[1];
  assert.deepEqual(gradedPracticeAttempts(questions, attempts, "IPEP").map(a => a.id), ["wrong", "correct"]);
  assert.deepEqual(gradedPracticeAttempts(questions, attempts, "SQLP").map(a => a.id), ["sql-objective"]);
});


test("objective-only course tips describe objective practice without irrelevant self-scoring advice", () => {
  const html = initialPractice("SQLD");
  assert.match(html, /선택의 근거를 확인하세요/u);
  assert.doesNotMatch(html, /서술형은 직접 답안을 작성/u);
});


test("active practice tips follow the displayed question type in objective, mixed and practical courses", () => {
  for (const examType of ["SQLD", "IPEW", "SQLP", "DAP"] as const) {
    const html = initialPractice(examType, "single");
    assert.match(html, /각 선택지의 조건을 비교/u, `${examType} active objective tip`);
    assert.doesNotMatch(html, /서술형은 결론/u, `${examType} active objective tip`);
  }
  for (const examType of ["SQLP", "DAP"] as const) {
    assert.match(initialPractice(examType, "descriptive"), /서술형은 결론뿐 아니라 조건과 판단 근거/u);
  }
  const practical = initialPractice("IPEP", "descriptive");
  assert.match(practical, /코드 출력은 공백·줄바꿈·대소문자를 확인/u);
  assert.doesNotMatch(practical, /서술형은 결론/u);
});
