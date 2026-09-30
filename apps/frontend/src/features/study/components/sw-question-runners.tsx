"use client";

import { choiceLabel } from "@shared/study/choice-label";

import type { LearningField } from "@shared/study/learning-catalog";
import { learningPath } from "@shared/study/learning-catalog";
import RoutedLink from "./routed-link";
import {
  QuestionPromptContent,
  RichContent,
  type Difficulty,
} from "./study-screen-shared";
import { InlineLearningError } from "./learning-feedback";
import { ReservedAdSlot } from "../../advertising/reserved-ad-slot";

export type SwQuestionItem = {
  id: string;
  theoryId: number;
  subjectGroupId: string;
  subjectId: string;
  category: string;
  topic: string;
  displayOrder: number;
  difficulty: Difficulty;
  difficultyRationale: string;
  kind: "single" | "multiple";
  prompt: string;
  choices: string[];
  correctAnswers?: number[];
  explanation?: string;
  feedbackAuthorization?: string;
  tags: string[];
};

export function SwContentLoadingIndicator() {
  return (
    <div className="partial-loading sw-content-loading" role="status" aria-live="polite">
      <span className="loading-indicator" aria-hidden="true" />
      <span>SW 학습 콘텐츠를 불러오고 있습니다.</span>
    </div>
  );
}

type SharedRunnerProps = {
  questions: SwQuestionItem[];
  index: number;
  answers: Record<string, number[]>;
  contentLoading: boolean;
  contentError: string;
  contentRetry: (() => void) | null;
  busy: boolean;
  answerIsCorrect: (question: SwQuestionItem) => boolean;
  onIndexChange: (index: number) => void;
  onToggleAnswer: (question: SwQuestionItem, answer: number) => void;
};

export function SwMockRunner({
  questions,
  index,
  answers,
  contentLoading,
  contentError,
  contentRetry,
  busy,
  answerIsCorrect,
  onIndexChange,
  onToggleAnswer,
  submitted,
  submitWarning,
  onSubmitWarningChange,
  onRequestSubmit,
  onSubmit,
  onShowSetup,
}: SharedRunnerProps & {
  submitted: boolean;
  submitWarning: boolean;
  onSubmitWarningChange: (visible: boolean) => void;
  onRequestSubmit: () => void;
  onSubmit: () => void | Promise<void>;
  onShowSetup: () => void;
}) {
  const current = questions[index] ?? null;
  const answer = current ? answers[current.id] ?? [] : [];
  const answeredCount = questions.filter((question) => Boolean(answers[question.id]?.length)).length;
  const unansweredCount = questions.length - answeredCount;
  const correctCount = submitted ? questions.filter(answerIsCorrect).length : 0;
  const score = questions.length > 0 ? Math.round((correctCount / questions.length) * 100) : 0;
  const resultBreakdowns = submitted ? ([
    ["과목별", (question: SwQuestionItem) => question.category],
    ["주제별", (question: SwQuestionItem) => question.topic],
    ["난이도별", (question: SwQuestionItem) => question.difficulty],
  ] as const).map(([title, keyFor]) => ({
    title,
    rows: [...questions.reduce((rows, question) => {
      const key = keyFor(question);
      const currentRow = rows.get(key) ?? { total: 0, correct: 0 };
      currentRow.total += 1;
      if (answerIsCorrect(question)) currentRow.correct += 1;
      rows.set(key, currentRow);
      return rows;
    }, new Map<string, { total: number; correct: number }>())],
  })) : [];

  function exit() {
    if (!submitted && answeredCount > 0 && !window.confirm("답안은 자동 저장됩니다. 모의고사 구성 화면으로 나갈까요?")) return;
    onSubmitWarningChange(false);
    onShowSetup();
  }

  return (
    <div className="exam-runner sw-mock-runner" aria-busy={contentLoading}>
      {contentLoading && <SwContentLoadingIndicator />}
      {!current && !contentLoading ? (
        <section className="card empty-state"><h2>구성할 수 있는 문제가 없습니다.</h2><p>다른 소주제를 선택하거나 문항 수를 조정해 주세요.</p></section>
      ) : current ? (
        <>
          <header className="card exam-runner-head sw-mock-runner-head">
            <div><span className="section-kicker">SW 전공 모의고사</span><strong>{index + 1} / {questions.length}</strong></div>
            <div className="sw-mock-response-status" aria-live="polite">
              <span>응답 <strong>{answeredCount}문항</strong></span>
              <span>미응답 <strong>{unansweredCount}문항</strong></span>
            </div>
            <button className="outline-button" type="button" disabled={busy} onClick={exit}>나가기·자동 저장</button>
          </header>
          {submitted && (
            <section className="card sw-mock-result" aria-live="polite">
              <div><span>모의고사 결과</span><strong>{score}점</strong></div>
              <dl>
                <div><dt>정답</dt><dd>{correctCount}문항</dd></div>
                <div><dt>오답</dt><dd>{answeredCount - correctCount}문항</dd></div>
                <div><dt>미응답</dt><dd>{unansweredCount}문항</dd></div>
                <div><dt>총 문항</dt><dd>{questions.length}문항</dd></div>
              </dl>
              <button className="outline-button" type="button" onClick={onShowSetup}>새 모의고사 구성</button>
            </section>
          )}
          {submitted && (
            <section className="card sw-mock-breakdown" aria-label="SW 모의고사 세부 결과">
              {resultBreakdowns.map((breakdown) => (
                <div key={breakdown.title}>
                  <h3>{breakdown.title} 결과</h3>
                  <ul>{breakdown.rows.map(([label, values]) => <li key={label}><span>{label}</span><strong>{values.correct}/{values.total}문항</strong></li>)}</ul>
                </div>
              ))}
            </section>
          )}
          <div className="exam-layout">
            <article className="card exam-question-card">
              <div className="quiz-head">
                <div className="exam-question-meta"><span className="category-label">{current.category}</span><span>{current.topic}</span><span className="difficulty-badge">난이도 {current.difficulty}</span></div>
                <span className="sw-question-progress">문제 {index + 1}</span>
              </div>
              <div className="question-prompt"><QuestionPromptContent value={current.prompt} /></div>
              <div className="choices" aria-label="선택지">
                {current.choices.map((choice, answerIndex) => {
                  const chosen = answer.includes(answerIndex);
                  const correct = submitted && Boolean(current.correctAnswers?.includes(answerIndex));
                  const wrongChoice = submitted && chosen && !correct;
                  const className = ["choice", chosen ? "selected" : "", correct ? "correct" : "", wrongChoice ? "incorrect" : ""].filter(Boolean).join(" ");
                  return <button className={className} key={`${current.id}-${answerIndex}`} type="button" disabled={submitted || busy} aria-pressed={chosen} onClick={() => onToggleAnswer(current, answerIndex)}><span>{choiceLabel(answerIndex)}</span><RichContent value={choice} compact choiceValue />{submitted && chosen && <i>{correct ? "내 선택 · 정답" : "내 선택 · 오답"}</i>}{correct && !chosen && <i>정답</i>}</button>;
                })}
              </div>
              {submitted && <section className={answerIsCorrect(current) ? "explanation correct" : "explanation incorrect"}><div className="explanation-title"><span>{answerIsCorrect(current) ? "✓" : "!"}</span><strong>{answerIsCorrect(current) ? "정답입니다." : !answer.length ? "선택하지 않았습니다." : "다시 확인해 보세요."}</strong></div><RichContent value={current.explanation ?? ""} explanation /></section>}
              {submitWarning && !submitted && <section className="inline-confirm" role="alert"><div><strong>미응답 {unansweredCount}문항이 있습니다.</strong><p>제출하면 답안을 더 이상 변경할 수 없습니다.</p></div><div><button className="outline-button" type="button" disabled={busy} onClick={() => onSubmitWarningChange(false)}>계속 풀기</button><button className="primary-button" type="button" disabled={busy} onClick={onSubmit}>{busy ? "제출 확인 중…" : "미응답 포함 제출"}</button></div></section>}
              <footer className="exam-navigation">
                <button className="outline-button" type="button" disabled={busy || index === 0} onClick={() => onIndexChange(Math.max(0, index - 1))}>이전 문제</button>
                {!submitted && <button className="outline-button" type="button" disabled={busy} onClick={onRequestSubmit}>{busy ? "제출 처리 중…" : "모의고사 제출"}</button>}
                <button className="primary-button" type="button" disabled={busy || index === questions.length - 1} onClick={() => onIndexChange(Math.min(questions.length - 1, index + 1))}>다음 문제</button>
              </footer>
            </article>
            <aside className="card exam-answer-map" aria-label="SW 모의고사 문제 이동">
              <div><strong>SW 전공 모의고사</strong><span>{index + 1}/{questions.length}문항 · 응답 {answeredCount}개</span></div>
              <div className="exam-number-grid">
                {questions.map((question, questionIndex) => {
                  const answered = Boolean(answers[question.id]?.length);
                  const resultClass = submitted ? answerIsCorrect(question) ? "correct" : "incorrect" : answered ? "answered completed" : "";
                  return <button key={question.id} className={[questionIndex === index ? "current active" : "", resultClass].filter(Boolean).join(" ")} type="button" disabled={busy} aria-label={`${questionIndex + 1}번 문제${submitted ? resultClass === "correct" ? ", 정답" : ", 오답 또는 미응답" : answered ? ", 응답 완료" : ""}`} aria-current={questionIndex === index ? "step" : undefined} onClick={() => { onIndexChange(questionIndex); window.scrollTo({ top: 0, behavior: "smooth" }); }}>{questionIndex + 1}</button>;
                })}
              </div>
            </aside>
          </div>
        </>
      ) : null}
      {contentError && <InlineLearningError message={contentError} onRetry={contentRetry ?? undefined} />}
    </div>
  );
}

export function SwPracticeRunner({
  field,
  selectedTheoryId,
  questions,
  index,
  answers,
  contentLoading,
  contentError,
  contentRetry,
  answerIsCorrect,
  onToggleAnswer,
  revealedQuestionIds,
  loadingNext,
  busy,
  grading,
  onStop,
  onReveal,
  onNext,
}: Omit<SharedRunnerProps, "onIndexChange"> & {
  field: LearningField;
  selectedTheoryId: number | null;
  revealedQuestionIds: ReadonlySet<string>;
  loadingNext: boolean;
  grading: boolean;
  onStop: () => void | Promise<void>;
  onReveal: (question: SwQuestionItem) => void;
  onNext: () => void;
}) {
  const current = questions[index] ?? null;
  const answer = current ? answers[current.id] ?? [] : [];
  const revealed = current ? revealedQuestionIds.has(current.id) : false;
  const correct = Boolean(current && revealed && answerIsCorrect(current));
  const completed = questions.filter((question) => revealedQuestionIds.has(question.id));
  const correctCount = completed.filter(answerIsCorrect).length;

  return (
    <div className="page-stack sw-content-page" aria-busy={contentLoading}>
      {contentLoading && <SwContentLoadingIndicator />}
      <RoutedLink className="field-back-button" aria-disabled={busy} href={selectedTheoryId ? learningPath({ fieldId: field.id, page: "field", section: "theories", theoryId: selectedTheoryId }) : learningPath({ fieldId: field.id, page: "field" })} onNavigate={busy ? () => undefined : onStop}>{selectedTheoryId ? "이론으로 돌아가기" : "학습 범위로 돌아가기"}</RoutedLink>
      {!current && !contentLoading ? <section className="card empty-state"><h2>구성할 수 있는 문제가 없습니다.</h2><p>다른 소주제를 선택해 주세요.</p></section> : current ? (
        <section className="quiz-layout sw-continuous-practice-layout">
          <article className="card quiz-card sw-continuous-practice-card">
            <div className="quiz-head"><div><span className="difficulty-badge">난이도 {current.difficulty}</span></div><span className="sw-question-progress">문제 {index + 1}</span></div>
            <p className="question-path">{current.category} · {current.topic} · 객관식</p>
            <div className="question-prompt"><QuestionPromptContent value={current.prompt} /></div>
            <div className="choices" aria-label="선택지">
              {current.choices.map((choice, answerIndex) => {
                const chosen = answer.includes(answerIndex);
                const correctAnswer = revealed && Boolean(current.correctAnswers?.includes(answerIndex));
                const wrongChoice = revealed && chosen && !correctAnswer;
                const className = ["choice", chosen ? "selected" : "", correctAnswer ? "correct" : "", wrongChoice ? "incorrect" : ""].filter(Boolean).join(" ");
                return <button className={className} key={`${current.id}-${answerIndex}`} type="button" disabled={revealed || grading || busy} aria-pressed={chosen} onClick={() => onToggleAnswer(current, answerIndex)}><span>{choiceLabel(answerIndex)}</span><RichContent value={choice} compact choiceValue />{revealed && chosen && <i>{correctAnswer ? "내 선택 · 정답" : "내 선택 · 오답"}</i>}{correctAnswer && !chosen && <i>정답</i>}</button>;
              })}
            </div>
            {!revealed ? <div className="answer-submit-group">{!answer.length && <p className="answer-selection-help" role="status">{current.kind === "multiple" ? "정답을 모두 선택하면 채점할 수 있습니다." : "답안을 선택하면 정답을 확인할 수 있습니다."}</p>}<button className="primary-button quiz-submit" type="button" disabled={!answer.length || grading || busy} onClick={() => onReveal(current)}>{grading ? "채점 중…" : "정답 확인"}</button></div> : <section className={correct ? "explanation correct" : "explanation incorrect"} aria-live="polite"><div className="explanation-title"><span>{correct ? "✓" : "!"}</span><strong>{correct ? "정답입니다." : "다시 확인해 보세요."}</strong></div><RichContent value={current.explanation ?? ""} explanation /></section>}
            {revealed && <footer className="explanation-actions"><span className="practice-inline-progress" aria-live="polite">현재까지 {completed.length}문항 풀이 · 정답 {correctCount}문항</span><button className="primary-button" type="button" disabled={loadingNext} onClick={onNext}>{loadingNext ? "다음 문제 준비 중…" : "다음 문제 →"}</button></footer>}
          </article>
          <aside className="quiz-side" aria-label="SW 연속 문제 풀이 안내"><div className="card quiz-map continuous-quiz-map"><span className="section-kicker">이어서 문제 풀기</span><strong>원하는 만큼 이어서 풀기</strong><p>같은 선택 범위의 새 문제를 계속 제공합니다. 이전 풀이 기록은 계정에 보관되며, 화면에는 최근 100문항을 유지합니다.</p><span className="sw-continuous-progress" aria-live="polite">현재 묶음 풀이 완료 {completed.length}문항 · 정답 {correctCount}문항 · 준비된 문제 {questions.length}문항</span><button className="outline-button" type="button" disabled={busy} onClick={() => { void onStop(); }}>{busy ? "진행 상태 종료 중…" : "문제 풀이 마치기"}</button></div><div className="card mini-tip"><strong>문제 풀이 팁</strong><p>답을 선택하고 정답을 확인하면 다음 문제가 열립니다.</p></div></aside>
          <ReservedAdSlot placement="practiceFooter" suppressed={Boolean(contentError)} />
        </section>
      ) : null}
      {contentError && <InlineLearningError message={contentError} onRetry={contentRetry ?? undefined} />}
    </div>
  );
}
