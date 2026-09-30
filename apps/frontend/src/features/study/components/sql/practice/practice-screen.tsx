"use client";

import { choiceLabel } from "@shared/study/choice-label";

import { useEffect, useRef, useState } from "react";
import { ReservedAdSlot } from "../../../../advertising/reserved-ad-slot";
import { PracticalAnswerFields } from "../practical-answer-input";
import { IPE_S3_PRACTICE_SETS } from "@shared/study/ipe-s3-practice-sets.mjs";
import { IPE_S4_PRACTICE_SETS } from "@shared/study/ipe-s4-practice-sets.mjs";
import { IPE_S5_PRACTICE_SETS } from "@shared/study/ipe-s5-practice-sets.mjs";

import {
  courseDefinition,
  courseQuestionSubjects,
  examScopeLabel,
  isDescriptiveAllowed,
  isObjectiveKind,
  questionKindLabel,
  type DescriptiveEvaluation,
  type ExamType,
  type PracticeKind,
} from "@shared/study/study-domain";
import {
  QuestionPromptContent,
  RichContent,
  DescriptiveGuidance,
  resolvedTopic,
  sameAnswers,
  SelfAssessmentSummary,
  type Question,
  type TheoryArticle,
} from "../../study-screen-shared";

export function Practice(props: {
  adSuppressed?: boolean;
  examType: ExamType;
  questions: Question[];
  availableCount: number;
  queue: number[];
  cursor: number;
  currentQuestion?: Question;
  selected: number[];
  revealed: boolean;
  quizDone: boolean;
  quizCorrect: number;
  category: string;
  difficulty: string;
  practiceKind: PracticeKind;
  descriptiveAnswer: string;
  descriptiveSelfScore: string;
  evaluation: DescriptiveEvaluation | null;
  starting: boolean;
  grading: boolean;
  advancing?: boolean;
  originTheory?: TheoryArticle;
  onCategory: (value: string) => void;
  onDifficulty: (value: string) => void;
  onPracticeKind: (value: PracticeKind) => void;
  onStart: () => void;
  onStartForm: (formId: string) => void;
  onAnswer: (index: number) => void;
  onGrade: () => void;
  onDescriptiveAnswer: (value: string) => void;
  onDescriptiveSelfScore: (value: string) => void;
  onSubmitDescriptive: () => void;
  onResetDescriptive: () => void;
  onRevealDescriptive: () => void;
  onNext: () => void;
  onStop: () => void;
  continuous: boolean;
  bookmarkMode: boolean;
  completedQuestionIds: number[];
  onIndex: (index: number) => void;
  onBookmark: (question: Question) => void;
  onReportQuestion: () => void;
  theory?: TheoryArticle;
  onOpenTheory: (id: number) => void;
  onReturnTheory: () => void;
}) {
  const {
    examType, questions, availableCount, queue, cursor, currentQuestion, selected, revealed, quizDone, quizCorrect,
    category, difficulty, practiceKind, descriptiveAnswer, descriptiveSelfScore, evaluation, starting, grading, advancing = false,
    originTheory, onCategory, onDifficulty, onPracticeKind, onStart, onAnswer, onGrade,
    onDescriptiveAnswer, onDescriptiveSelfScore, onSubmitDescriptive, onResetDescriptive, onRevealDescriptive, onNext,
    onStop, continuous, bookmarkMode, completedQuestionIds, onIndex, onBookmark, onReportQuestion, theory,
    onOpenTheory, onReturnTheory,
  } = props;
  const [formId, setFormId] = useState(IPE_S3_PRACTICE_SETS[0].id);
  const resultRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (revealed) resultRef.current?.focus();
  }, [revealed, currentQuestion?.id]);
  const practiceSets = category === "데이터베이스 구축" ? IPE_S3_PRACTICE_SETS
    : category === "프로그래밍 언어 활용" ? IPE_S4_PRACTICE_SETS
      : category === "정보시스템 구축 관리" ? IPE_S5_PRACTICE_SETS : [];
  const selectedFormId = practiceSets.some((form) => form.id === formId) ? formId : practiceSets[0]?.id;
  const course = courseDefinition(examType);
  const isPractical = examType === "IPEP";
  const questionSubjects = courseQuestionSubjects(examType);
  if (quizDone) {
    const objectiveCount = queue.reduce((count, questionId) => {
      const question = questions.find((item) => item.id === questionId);
      return count + (question && (isObjectiveKind(question.kind) || isPractical) ? 1 : 0);
    }, 0);
    const rate = objectiveCount ? Math.round(quizCorrect / objectiveCount * 100) : null;
    return <section className="card result-card"><span className="result-icon">✓</span><span className="section-kicker">학습 완료</span><h2>문제 풀이를 마쳤어요.</h2><div className="result-score">{rate === null ? <strong>완료</strong> : <strong>{rate}%</strong>}<span>{objectiveCount ? `${objectiveCount}문항 중 ${quizCorrect}문항 정답` : "서술형 답안과 직접 채점 점수를 저장했습니다."}</span></div><div className="result-actions">{originTheory && <button className="outline-button" onClick={onReturnTheory}>← {originTheory.title}로 돌아가기</button>}<button className="primary-button" onClick={onStart} disabled={starting}>{starting ? "문제 준비 중…" : "새 문제 풀기"}</button></div></section>;
  }
  if (!currentQuestion) {
    const descriptiveAvailable = isDescriptiveAllowed(examType, category);
    const type = isPractical ? "descriptive" : descriptiveAvailable ? practiceKind : "objective";
    const optionalPracticeKinds = descriptiveAvailable ? [["descriptive", "서술형"], ["mixed", "객관식 + 서술형"]] : [];
    const loadedCount = questions.filter((item) => (category === "전체 과목" || item.category === category)
      && (
        type === "descriptive"
        || difficulty === "전체"
        || (type === "mixed" && item.kind === "descriptive")
        || item.difficulty === difficulty
      )
      && (type === "objective" ? isObjectiveKind(item.kind) : type === "descriptive" ? item.kind === "descriptive" : true)).length;
    const count = availableCount || loadedCount;
    return (
      <div className="page-stack practice-home">
        <section className="practice-intro">
          <div>
            <span className="section-kicker">{course.name} 문제 풀이</span>
            <h2>배운 개념을 문제로 확인하세요.</h2>
            <p>{isPractical ? "코드 실행 결과, SQL, 계산과 핵심 용어를 직접 작성하며 실기 이론을 확인합니다. 단답을 입력하면 정답 일치 여부와 해설을 확인할 수 있습니다." : "과목과 난이도를 고르면 선택한 시험 범위 안에서 문제를 구성합니다. 풀이 뒤에는 정답 근거와 선택지별 판단을 바로 확인할 수 있습니다."}</p>
          </div>
        </section>
        <section className="practice-setup">
          <article className="card setup-card">
            <span className="section-kicker">{course.name} 문제 설정</span>
            <h2>어떤 문제를 풀까요?</h2>
            <p>{isPractical ? "실기 문제는 단답을 직접 입력합니다. 정답 확인을 누르면 판정 결과와 입력 답안이 학습 기록에 저장됩니다." : course.descriptiveSubjects.length
              ? `기본값은 객관식입니다. 서술형은 ${course.name}의 지정 과목을 선택한 경우에만 풀 수 있습니다.`
              : `${course.name} 과정은 객관식 문제로 출제 범위와 핵심 개념을 확인합니다.`}</p>
            {isPractical ? <div className="fixed-question-kind"><span>문제 유형</span><strong>단답형</strong></div> : descriptiveAvailable ? (
              <fieldset className="segmented-field"><legend>문제 유형</legend><div className="segmented practice-kind">{[
                ["objective", "객관식"],
                ...optionalPracticeKinds,
              ].map(([value, label]) => <button type="button" key={value} className={type === value ? "active" : ""} aria-pressed={type === value} onClick={() => { onPracticeKind(value as PracticeKind); if (value === "descriptive") onDifficulty("전체"); }}>{label}</button>)}</div></fieldset>
            ) : (
              <div className="fixed-question-kind"><span>문제 유형</span><strong>객관식</strong></div>
            )}
            <label>과목<select value={category} onChange={(event) => { const next = event.target.value; onCategory(next); if (!isDescriptiveAllowed(examType, next)) onPracticeKind("objective"); }}><option>전체 과목</option>{questionSubjects.map((item) => <option key={item.id}>{item.name}</option>)}</select></label>
            {type !== "descriptive" && <fieldset className="segmented-field"><legend>난이도</legend><div className="segmented">{["전체", "하", "중", "상"].map((item) => <button type="button" key={item} className={difficulty === item ? "active" : ""} aria-pressed={difficulty === item} onClick={() => onDifficulty(item)}>{item}</button>)}</div></fieldset>}
            <div className="setup-summary"><span>문제 구성</span><strong>{count ? "선택 조건에 맞춰 무작위 출제" : "조건에 맞는 문제가 없습니다."}</strong></div>
            <button className="primary-button" onClick={onStart} disabled={!count || starting} aria-busy={starting}>{starting ? "문제 준비 중…" : "문제 풀이 시작 →"}</button>
            {examType === "IPEW" && selectedFormId && <fieldset className="segmented-field">
              <legend>{category === "데이터베이스 구축" ? "3단원" : "4단원"} 연습 세트</legend>
              <p>20문항씩 정해진 순서로 학습합니다. 세트에는 모든 난이도가 포함됩니다.</p>
              <label>연습 세트<select value={selectedFormId} onChange={event => setFormId(event.target.value)}>{practiceSets.map(form => <option key={form.id} value={form.id}>{form.label} · 20문항</option>)}</select></label>
              <button className="outline-button" onClick={() => props.onStartForm(selectedFormId)} disabled={starting}>선택한 20문항 풀기 →</button>
            </fieldset>}
          </article>
          <aside className="study-tip"><span>TIP</span><h3>{isPractical ? "답을 직접 작성해 보세요." : course.descriptiveSubjects.length ? "문제 유형이 섞이지 않아요." : "선택의 근거를 확인하세요."}</h3><p>{isPractical ? "학습용 창작 문제입니다. 용어는 등록된 동의어를 인정하고, 출력·SQL 결과는 문제에서 요구한 형식을 확인합니다. 공식 부분점수 판정은 아닙니다." : course.descriptiveSubjects.length ? "객관식을 선택하면 서술형은 제외됩니다. 서술형은 직접 답안을 작성한 뒤 평가 기준과 모범답안을 비교해 스스로 점수를 기록합니다." : "답을 고른 뒤 정답 확인을 눌러 판단 근거를 살펴보세요. 헷갈린 문제는 북마크로 다시 풀 수 있습니다."}</p></aside>
        </section>
      </div>
    );
  }
  const isDescriptive = currentQuestion.kind === "descriptive";
  const isCorrect = isDescriptive ? evaluation?.result === "correct" : sameAnswers(selected, currentQuestion.correctAnswers);
  return (
    <section className="quiz-layout">
      <article className="card quiz-card">
        {originTheory && <div className="origin-theory-banner"><span>연결 학습</span><strong>{originTheory.title}</strong><button onClick={onReturnTheory}>이론으로 돌아가기</button></div>}
        <div className="quiz-head">
          <div><span className="difficulty-badge">난이도 {currentQuestion.difficulty}</span><span className="scope-badge">{examScopeLabel(currentQuestion.examScope)}</span></div>
          <div className="quiz-head-actions">
            <button className="question-report-button" type="button" onClick={onReportQuestion}>문제 오류 신고</button>
            <button className={currentQuestion.bookmarked ? "bookmark-button active" : "bookmark-button"} type="button" onClick={() => onBookmark(currentQuestion)} aria-label={currentQuestion.bookmarked ? "북마크 해제" : "북마크 추가"}>{currentQuestion.bookmarked ? "★" : "☆"}</button>
          </div>
        </div>
        <p className="question-path">{currentQuestion.category} · {resolvedTopic(currentQuestion)} · {isPractical ? "단답형" : questionKindLabel(currentQuestion.kind)}</p>
        <div className="question-prompt"><QuestionPromptContent value={currentQuestion.prompt} /></div>
        {currentQuestion.kind === "multiple" && <p className="multi-hint">복수정답 문제입니다. 해당하는 답을 모두 선택하세요.</p>}
        {!isDescriptive && <div className="choices">{currentQuestion.choices.map((choice, index) => {
          const chosen = selected.includes(index);
          const right = currentQuestion.correctAnswers.includes(index);
          let className = chosen ? "choice selected" : "choice";
          if (revealed && right) className += " correct";
          if (revealed && chosen && !right) className += " incorrect";
          return <button key={index} className={className} disabled={grading} onClick={() => onAnswer(index)} aria-pressed={chosen}><span>{choiceLabel(index)}</span><RichContent value={choice} compact choiceValue />{revealed && chosen && <i>{right ? "내 선택 · 정답" : "내 선택 · 오답"}</i>}{revealed && right && !chosen && <i>정답</i>}</button>;
        })}</div>}
        {isDescriptive && (
          <section className="descriptive-answer-panel">
            <div><strong>내 답안</strong><span>{isPractical ? currentQuestion.shortAnswerInput?.hint ?? "문제에서 요구한 답만 입력하세요. 여러 답은 문제 순서대로 쉼표 또는 줄바꿈으로 구분하세요." : "문제의 요구사항과 판단 근거를 여러 줄로 작성할 수 있습니다."}</span></div>
            {isPractical ? <PracticalAnswerFields input={currentQuestion.shortAnswerInput} value={descriptiveAnswer} onChange={onDescriptiveAnswer} disabled={revealed || Boolean(evaluation) || grading} /> : <textarea value={descriptiveAnswer} onChange={(event) => onDescriptiveAnswer(event.target.value)} aria-label="내 답안" rows={12} placeholder="문제의 요구사항, 판단 근거와 개선안을 작성하세요." spellCheck={false} disabled={revealed || Boolean(evaluation) || grading} />}
            <div className="descriptive-actions">
              <button className="outline-button" onClick={onResetDescriptive} disabled={grading || (isPractical && revealed)}>답안 초기화</button>
              <button className="outline-button" onClick={onRevealDescriptive} disabled={!descriptiveAnswer.trim() || revealed || grading}>{grading ? "확인 중…" : isPractical ? "정답 확인" : "평가 기준·모범답안 확인"}</button>
            </div>
          </section>
        )}
        {!isDescriptive && !revealed && <div className="answer-submit-group">{!selected.length && <p className="answer-selection-help" role="status">답안을 선택하면 정답을 확인할 수 있습니다.</p>}<button className="primary-button quiz-submit" disabled={!selected.length || grading} aria-busy={grading} onClick={onGrade}>{grading ? "채점 중…" : "정답 확인"}</button></div>}
        {revealed && <div ref={resultRef} tabIndex={-1} role="region" aria-label="채점 결과">
        {isPractical && evaluation && <SelfAssessmentSummary evaluation={evaluation} />}
        {isDescriptive && revealed && <DescriptiveGuidance question={currentQuestion} />}
        {isDescriptive && !isPractical && revealed && !evaluation && (
          <section className="self-score-control">
            <div>
              <strong>내 답안 직접 채점하기</strong>
              <span>자동 채점은 사용하지 않습니다. 내 답안을 아래 평가 기준·모범답안과 비교해 예상 점수를 기록하세요.</span>
            </div>
            <label>
              <span>점수 (0~100)</span>
              <input
                type="number"
                min="0"
                max="100"
                inputMode="numeric"
                value={descriptiveSelfScore}
                onChange={(event) => onDescriptiveSelfScore(event.target.value)}
                aria-describedby="practice-self-score-help"
              />
              <b>점</b>
            </label>
            <small id="practice-self-score-help">예상 점수는 개인 학습 기록에 저장되며, 객관식 풀이 수와 정답·오답 통계에는 포함되지 않습니다.</small>
            <button className="primary-button" onClick={onSubmitDescriptive} disabled={!descriptiveAnswer.trim() || descriptiveSelfScore === "" || grading}>{grading ? "저장 중…" : "내 점수 저장"}</button>
          </section>
        )}
        {!isPractical && evaluation && <SelfAssessmentSummary evaluation={evaluation} />}
        {!isDescriptive && revealed && <div className={isCorrect ? "explanation correct" : "explanation incorrect"}><div className="explanation-title"><span>{isCorrect ? "✓" : "!"}</span><strong>{isCorrect ? "정답입니다." : "오답입니다."}</strong></div><RichContent value={currentQuestion.explanation} explanation /></div>}
        </div>}
        {revealed && (!isDescriptive || evaluation) && (
          <div className={`explanation-actions ${isCorrect ? "correct" : ""}`}>
            <span className="practice-inline-progress" aria-live="polite">
              {continuous ? `현재까지 ${cursor + 1}문항 풀이` : `${cursor + 1} / ${queue.length}문항`}
            </span>
            {currentQuestion.theoryId && <button className="text-button" onClick={() => onOpenTheory(currentQuestion.theoryId!)}>연결 이론: {theory?.title ?? "개념 다시 읽기"} →</button>}
            <button className="primary-button" onClick={onNext} disabled={advancing || grading} aria-busy={advancing}>{advancing ? "다음 문제 준비 중…" : `${continuous ? "다음 문제" : cursor + 1 === queue.length ? "결과 보기" : "다음 문제"} →`}</button>
          </div>
        )}

      </article>
      {bookmarkMode ? (
        <aside className="card exam-answer-map bookmark-practice-map">
          <div><strong>북마크 문제</strong><span>{cursor + 1} / {queue.length} · 풀이 완료 {completedQuestionIds.length}</span></div>
          <div className="exam-number-grid" aria-label="북마크 문제 이동">
            {queue.map((questionId, index) => (
              <button
                key={questionId}
                type="button"
                className={`${index === cursor ? "current " : ""}${completedQuestionIds.includes(questionId) ? "answered" : ""}`}
                disabled={grading || advancing}
                onClick={() => onIndex(index)}
                aria-label={`북마크 문제 ${index + 1}${completedQuestionIds.includes(questionId) ? " 풀이 완료" : ""}`}
                aria-current={index === cursor ? "step" : undefined}
              >
                {index + 1}
              </button>
            ))}
          </div>
          <button className="outline-button bookmark-practice-stop" onClick={onStop}>북마크 풀이 마치기</button>
        </aside>
      ) : (
        <aside className="quiz-side">
          <div className={continuous ? "card quiz-map continuous-quiz-map" : "card quiz-map"}>
            <span className="section-kicker">{continuous ? "이어서 문제 풀기" : "문제 풀이"}</span>
            <strong>{continuous ? "원하는 만큼 이어서 풀기" : "선택한 문제 학습"}</strong>
            <p>{continuous ? "같은 조건의 문제를 중단할 때까지 계속 제공합니다." : "선택한 학습 범위의 문제를 차례로 확인합니다."}</p>
            {continuous && <span className="continuous-practice-progress" aria-live="polite">풀이 완료 {cursor + (revealed ? 1 : 0)}문항 · 준비된 문제 {queue.length}문항</span>}
            {continuous && <button className="outline-button" onClick={onStop}>문제 풀이 마치기</button>}
          </div>
          <div className="card mini-tip"><strong>문제 풀이 팁</strong><p>{isPractical ? "코드 출력은 공백·줄바꿈·대소문자를 확인하고, 여러 항목은 문제 순서대로 입력하세요." : isDescriptive ? "서술형은 결론뿐 아니라 조건과 판단 근거까지 작성한 뒤 평가 기준과 대조해 보세요." : "각 선택지의 조건을 비교하고, 정답 확인 뒤 선택의 근거를 살펴보세요."}</p></div>
        </aside>
      )}
      {!bookmarkMode && <ReservedAdSlot placement="practiceFooter" suppressed={props.adSuppressed} />}
    </section>
  );
}


export default Practice;
