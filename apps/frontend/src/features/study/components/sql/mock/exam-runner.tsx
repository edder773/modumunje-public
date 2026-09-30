"use client";

import { choiceLabel } from "@shared/study/choice-label";

import { PracticalAnswerFields } from "../practical-answer-input";
import { displayPracticalAnswer, hasPracticalAnswer } from "@shared/study/practical-answer-fields";

import { practicalPastQuestion } from "@shared/study/ipe-practical-past.mjs";

import {
  memo,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  examDisplayName,
  resolvedExamConfig,
  type ExamQuestionResult,
  type ExamResult,
} from "@shared/study/study-domain";
import {
  QuestionPromptContent,
  RichContent,
  answerLetters,
  contentSummary,
  createSelfEvaluation,
  DescriptiveGuidance,
  sameAnswers,
  SelfAssessmentSummary,
  type ExamSession,
  type Question,
} from "../../study-screen-shared";
import { examQuestionAnswered } from "../../../model/exam-answer-state";

type ExamAnswerStatus = { id: number; answered: boolean; flagged: boolean };
const ANSWER_MAP_PAGE_SIZE = 20;

export function nextExamStatusIndex(items: ExamAnswerStatus[], currentIndex: number, kind: "unanswered" | "flagged") {
  for (let offset = 1; offset <= items.length; offset += 1) {
    const index = (currentIndex + offset) % items.length;
    if (kind === "flagged" ? items[index].flagged : !items[index].answered) return index;
  }
  return null;
}

export function ExamAnswerMap({ items, currentIndex, onIndex }: {
  items: ExamAnswerStatus[];
  currentIndex: number;
  onIndex: (index: number) => void;
}) {
  const panelId = useId();
  const currentPage = Math.floor(currentIndex / ANSWER_MAP_PAGE_SIZE);
  const [range, setRange] = useState({ currentIndex, page: currentPage });
  const pageCount = Math.ceil(items.length / ANSWER_MAP_PAGE_SIZE);
  const page = Math.max(0, Math.min(pageCount - 1, range.currentIndex === currentIndex ? range.page : currentPage));
  const start = page * ANSWER_MAP_PAGE_SIZE;
  const answeredCount = items.filter((item) => item.answered).length;
  const flaggedCount = items.filter((item) => item.flagged).length;
  const nextUnanswered = nextExamStatusIndex(items, currentIndex, "unanswered");
  const nextFlagged = nextExamStatusIndex(items, currentIndex, "flagged");
  const selectPage = (next: number) => setRange({ currentIndex, page: next });

  return <aside className="card exam-answer-map exam-answer-map-compact" aria-label="답안 현황">
    <div className="exam-map-summary"><strong>답안 현황</strong><span>응답 {answeredCount}/{items.length} · 미응답 {items.length - answeredCount} · 다시 볼 문제 {flaggedCount}</span></div>
    <div className="exam-map-shortcuts">
      <button className="outline-button" type="button" disabled={nextUnanswered === null} onClick={() => nextUnanswered !== null && onIndex(nextUnanswered)}>미응답 이동</button>
      <button className="outline-button" type="button" disabled={nextFlagged === null} onClick={() => nextFlagged !== null && onIndex(nextFlagged)}>다시 볼 문제 이동</button>
    </div>
    <details className="exam-map-disclosure">
      <summary><span className="exam-map-open-label">문제 번호 펼치기</span><span className="exam-map-close-label">문제 번호 접기</span><span className="exam-map-current">현재 {currentIndex + 1}번</span><span className="exam-map-chevron" aria-hidden="true">⌄</span></summary>
      <div className="exam-map-pages">
        <button className="outline-button" type="button" aria-label="이전 번호 구간" disabled={page === 0} onClick={() => selectPage(page - 1)}>←</button>
        <select aria-label="문제 번호 구간" aria-controls={panelId} value={page} onChange={(event) => selectPage(Number(event.target.value))}>
          {Array.from({ length: pageCount }, (_, index) => <option key={index} value={index}>{index * ANSWER_MAP_PAGE_SIZE + 1}–{Math.min((index + 1) * ANSWER_MAP_PAGE_SIZE, items.length)}번</option>)}
        </select>
        <button className="outline-button" type="button" aria-label="다음 번호 구간" disabled={page >= pageCount - 1} onClick={() => selectPage(page + 1)}>→</button>
      </div>
      <nav className="exam-number-grid" id={panelId} aria-label={`${start + 1}–${Math.min(start + ANSWER_MAP_PAGE_SIZE, items.length)}번 문제 이동`}>
        {items.slice(start, start + ANSWER_MAP_PAGE_SIZE).map((item, offset) => {
          const index = start + offset;
          return <button type="button" key={item.id} className={`${index === currentIndex ? "current " : ""}${item.answered ? "answered " : ""}${item.flagged ? "flagged" : ""}`} aria-label={`${index + 1}번 문제, ${item.answered ? "응답 완료" : "미응답"}${item.flagged ? ", 다시 볼 문제" : ""}`} aria-current={index === currentIndex ? "step" : undefined} onClick={() => onIndex(index)}>{index + 1}</button>;
        })}
      </nav>
    </details>
  </aside>;
}

const ExamTimer = memo(function ExamTimer({ endsAt, onExpired }: {
  endsAt: string;
  onExpired: () => void;
}) {
  const [remaining, setRemaining] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const expired = useRef(false);
  const onExpiredRef = useRef(onExpired);
  const announcedThresholds = useRef(new Set<number>());

  useEffect(() => {
    onExpiredRef.current = onExpired;
  }, [onExpired]);

  useEffect(() => {
    expired.current = false;
    announcedThresholds.current.clear();
    const update = () => {
      const next = Math.max(0, +new Date(endsAt) - Date.now());
      setRemaining((current) => current === next ? current : next);
      for (const threshold of [300_000, 60_000, 10_000]) {
        if (next <= threshold && !announcedThresholds.current.has(threshold)) {
          announcedThresholds.current.add(threshold);
          setAnnouncement(threshold === 300_000
            ? "시험 종료 5분 전입니다."
            : threshold === 60_000
              ? "시험 종료 1분 전입니다."
              : "시험 종료가 임박했습니다.");
          break;
        }
      }
      if (next === 0 && !expired.current) {
        expired.current = true;
        onExpiredRef.current();
      }
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [endsAt]);

  const safeRemaining = remaining ?? 0;
  const hours = Math.floor(safeRemaining / 3_600_000);
  const minutes = Math.floor((safeRemaining % 3_600_000) / 60_000);
  const seconds = Math.floor((safeRemaining % 60_000) / 1000);
  return (
    <>
      <div className={remaining !== null && remaining < 300_000 ? "exam-timer urgent" : "exam-timer"} role="timer" aria-label="시험 남은 시간">
        {remaining === null ? "--:--" : <>{hours ? `${hours}:` : ""}{String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}</>}
      </div>
      <span className="sr-only" aria-live="polite">{announcement}</span>
    </>
  );
});

export function ExamRunner({ session, questions, answers, descriptiveAnswers, descriptiveScores, descriptiveSnapshots, flagged, currentIndex, busy, questionLoadError, onAnswers, onDescriptiveAnswers, onDescriptiveScores, onDescriptiveSnapshots, onFlagged, onIndex, onSubmit, onRetryQuestion, onExit }: {
  session: ExamSession;
  questions: Question[];
  answers: Record<string, number[]>;
  descriptiveAnswers: Record<string, string>;
  descriptiveScores: Record<string, number>;
  descriptiveSnapshots: Record<string, string>;
  flagged: number[];
  currentIndex: number;
  busy: boolean;
  questionLoadError: string;
  onAnswers: (value: Record<string, number[]>) => void;
  onDescriptiveAnswers: (value: Record<string, string>) => void;
  onDescriptiveScores: (value: Record<string, number>) => void;
  onDescriptiveSnapshots: (value: Record<string, string>) => void;
  onFlagged: (value: number[]) => void;
  onIndex: (value: number) => void;
  onSubmit: (autoSubmit?: boolean) => void;
  onRetryQuestion: () => void;
  onExit: () => void;
}) {
  const submitted = session.status === "submitted";
  const result = session.result as ExamResult;
  const config = resolvedExamConfig(session.examType, session.policySnapshot);
  const examName = examDisplayName(session.examType);
  const isPractical = session.examType === "IPEP";
  const questionById = useMemo(
    () => new Map(questions.map((question) => [question.id, question])),
    [questions],
  );
  const id = session.questionIds[currentIndex];
  const question = questionById.get(id);
  const answerStatuses = useMemo(() => session.questionIds.map((questionId) => {
    const target = questionById.get(questionId);
    const answered = examQuestionAnswered({ examType: session.examType, answers, descriptiveAnswers, descriptiveScores, descriptiveSnapshots }, questionId, target?.kind);
    return { id: questionId, answered, flagged: flagged.includes(questionId) };
  }), [answers, descriptiveAnswers, descriptiveScores, descriptiveSnapshots, flagged, questionById, session.questionIds, session.examType]);
  const unanswered = answerStatuses.filter((item) => !item.answered).length;
  const answeredCount = session.questionIds.length - unanswered;
  const hasProgress = Object.values(answers).some((value) => value.length > 0)
    || Object.values(descriptiveAnswers).some((value) => session.examType === "IPEP" ? hasPracticalAnswer(value) : value.trim().length > 0);
  useEffect(() => {
    if (submitted || !hasProgress) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [hasProgress, submitted]);
  if (submitted && result?.submittedAt) return <>
    {questionLoadError && <section className="card exam-question-load-error" role="alert"><span>{questionLoadError}</span><button className="outline-button" type="button" onClick={onRetryQuestion}>다시 시도</button></section>}
    <ExamResultView result={result} questions={questions} session={session} onExit={onExit} />
  </>;
  if (!question) return <section className="card exam-question-loading" role={questionLoadError ? "alert" : "status"} aria-live="polite">
    {!questionLoadError && <span className="loading-indicator" aria-hidden="true" />}
    <strong>{questionLoadError ? "문항을 불러오지 못했습니다." : "문항을 불러오는 중입니다."}</strong>
    <p>{questionLoadError || "현재 문항과 다음 문항만 가볍게 불러오고 있습니다."}</p>
    {questionLoadError && <button className="outline-button" type="button" onClick={onRetryQuestion}>다시 시도</button>}
  </section>;
  const selected = answers[String(id)] ?? [];
  const answerSnapshot = descriptiveSnapshots[String(id)] ?? "";
  const answerQuestion = (index: number) => {
    const next = question.kind === "single"
      ? [index]
      : selected.includes(index) ? selected.filter((item) => item !== index) : [...selected, index];
    onAnswers({ ...answers, [String(id)]: next });
  };
  return (
    <div className="exam-runner">
      <header className="card exam-runner-head"><div><span className="section-kicker">{examName} {session.examForm ? `${session.examForm.title} 기출` : "모의고사"}</span><strong>현재 {currentIndex + 1}번 · 전체 {session.questionIds.length}문항</strong></div><div className="exam-live-status"><ExamTimer endsAt={session.endsAt} onExpired={() => onSubmit(true)} /><span aria-live="polite">푼 문제 {answeredCount}문항 · 남은 문제 {unanswered}문항</span></div><button className="outline-button" onClick={onExit}>나가기·자동 저장</button></header>
      <div className="exam-layout">
        <article className="card exam-question-card">
          <div className="quiz-head"><div className="exam-question-meta"><span className="question-number">문제 {currentIndex + 1}</span><span className="category-label">{question.category}</span>{question.historicalExam ? <span className="past-original-number">원문 {question.historicalExam.number}번</span> : <span className="difficulty-badge">난이도 {question.difficulty}</span>}</div><button className={flagged.includes(id) ? "flag-button active" : "flag-button"} aria-pressed={flagged.includes(id)} aria-label={flagged.includes(id) ? "다시 볼 문제 표시 해제" : "다시 볼 문제로 표시"} onClick={() => onFlagged(flagged.includes(id) ? flagged.filter((item) => item !== id) : [...flagged, id])}>⚑ 다시 볼 문제</button></div>
          <div className="question-prompt"><QuestionPromptContent value={question.prompt} /></div>
          {isPractical ? (
            <section className="exam-practical-answer-panel">
              <strong>내 답안</strong>
              <p id={`exam-answer-hint-${id}`}>{question.shortAnswerInput?.hint ?? "문제에서 요구한 답만 입력하세요. 여러 항목은 문제 순서대로 작성하세요."}</p>
              <PracticalAnswerFields id={`exam-answer-${id}`} describedBy={`exam-answer-hint-${id}`} input={question.shortAnswerInput} value={descriptiveAnswers[String(id)] ?? ""} onChange={value => onDescriptiveAnswers({ ...descriptiveAnswers, [String(id)]: value })} disabled={busy} />
              <p>답안은 자동 저장됩니다. 채점 결과와 해설은 시험 제출 후에 확인할 수 있습니다.</p>
            </section>
          ) : question.kind === "descriptive" ? (
            <section className="exam-self-assessment">
              <textarea className="exam-descriptive-answer" value={descriptiveAnswers[String(id)] ?? ""} onChange={(event) => onDescriptiveAnswers({ ...descriptiveAnswers, [String(id)]: event.target.value })} rows={15} placeholder="실기형 답안을 작성하세요. 입력 내용은 자동 저장됩니다." spellCheck={false} disabled={Boolean(answerSnapshot)} />
              {answerSnapshot && <p className="exam-answer-locked" role="status">평가 자료를 공개한 시점의 답안을 저장하고 잠갔습니다. 이 답안을 기준으로 직접 채점해 주세요.</p>}
              <button
                type="button"
                className="outline-button"
                disabled={!descriptiveAnswers[String(id)]?.trim() || Boolean(answerSnapshot)}
                onClick={() => {
                  const snapshot = descriptiveAnswers[String(id)]?.trim() ?? "";
                  if (!snapshot) return;
                  onDescriptiveAnswers({ ...descriptiveAnswers, [String(id)]: snapshot });
                  onDescriptiveSnapshots({ ...descriptiveSnapshots, [String(id)]: snapshot });
                }}
                aria-expanded={Boolean(answerSnapshot)}
              >
                {answerSnapshot ? "평가 자료 공개됨" : "평가 기준·모범답안 공개"}
              </button>
              {answerSnapshot && <DescriptiveGuidance question={question} />}
              <div className="exam-self-score">
              <div><strong>실기형 직접 채점</strong><span>자동 채점은 사용하지 않습니다. 평가 자료와 비교한 예상 점수를 0~100점으로 입력하면 문항당 {config.descriptivePoint}점 기준으로 환산됩니다.</span></div>
                <label><span>점수</span><input type="number" min="0" max="100" inputMode="numeric" disabled={!answerSnapshot} value={answerSnapshot && Number.isFinite(descriptiveScores[String(id)]) ? descriptiveScores[String(id)] : ""} onChange={(event) => {
                  const next = { ...descriptiveScores };
                  if (event.target.value === "") delete next[String(id)];
                  else next[String(id)] = Number(event.target.value);
                  onDescriptiveScores(next);
                }} /><b>점</b></label>
              </div>
            </section>
          ) : <div className="choices">{question.choices.map((choice, index) => <button key={index} className={selected.includes(index) ? "choice selected" : "choice"} onClick={() => answerQuestion(index)} aria-pressed={selected.includes(index)}><span>{choiceLabel(index)}</span><RichContent value={choice} compact choiceValue /></button>)}</div>}
          <div className="exam-navigation"><button className="outline-button" onClick={() => onIndex(Math.max(0, currentIndex - 1))} disabled={currentIndex === 0}>← 이전 문제</button><button className="outline-button" onClick={() => onIndex(Math.min(session.questionIds.length - 1, currentIndex + 1))} disabled={currentIndex === session.questionIds.length - 1}>다음 문제 →</button><button className="primary-button" onClick={() => onSubmit(false)} disabled={busy}>{busy ? "성적 반영 중…" : `시험 제출 · 미응답 ${unanswered}`}</button></div>
        </article>
        <ExamAnswerMap items={answerStatuses} currentIndex={currentIndex} onIndex={onIndex} />
      </div>
    </div>
  );
}


function resolvedExamQuestionResults(
  result: ExamResult,
  questions: Question[],
  session: ExamSession,
): ExamQuestionResult[] {
  if (Array.isArray(result.questionResults) && result.questionResults.length) {
    return result.questionResults;
  }
  const config = resolvedExamConfig(session.examType, session.policySnapshot);
  return session.questionIds.map((questionId, index) => {
    const question = questions.find((item) => item.id === questionId);
    const storedScore = Number(session.descriptiveScores[String(questionId)]);
    const evaluation = result.practicalEvaluations?.[String(questionId)]
      ?? (Number.isFinite(storedScore) && question?.kind === "descriptive"
        ? createSelfEvaluation(question, storedScore)
        : undefined);
    const answerText = session.descriptiveAnswers[String(questionId)] ?? "";
    const isDescriptive = question?.kind === "descriptive" || Boolean(evaluation) || Object.hasOwn(session.descriptiveAnswers, String(questionId));
    if (isDescriptive) {
      return {
        questionId,
        position: index + 1,
        category: question?.category ?? "기록된 문제",
        kind: "descriptive",
        result: !answerText.trim() ? "unanswered" : evaluation?.result ?? "incorrect",
        score: !answerText.trim() ? null : evaluation?.score ?? 0,
        convertedScore: !answerText.trim() || !Number.isFinite(storedScore)
          ? 0
          : Math.round(storedScore * (config.descriptivePoint / 100) * 10) / 10,
        selectedAnswers: [],
        correctAnswers: [],
        choices: [],
        answerText,
      };
    }
    const selectedAnswers = session.answers[String(questionId)] ?? [];
    const correctAnswers = question?.correctAnswers ?? [];
    const correct = selectedAnswers.length > 0 && sameAnswers(selectedAnswers, correctAnswers);
    return {
      questionId,
      position: index + 1,
      category: question?.category ?? "기록된 문제",
      kind: question?.kind ?? "single",
      result: !selectedAnswers.length ? "unanswered" : correct ? "correct" : "incorrect",
      score: !selectedAnswers.length ? null : correct ? 100 : 0,
      convertedScore: 0,
      selectedAnswers,
      correctAnswers,
      choices: question?.choices ?? [],
      answerText: "",
    };
  });
}

function examResultLabel(result: ExamQuestionResult["result"]) {
  if (result === "correct") return "정답";
  if (result === "partial") return "부분 정답";
  if (result === "unanswered") return "미응답";
  return "오답";
}

export function ExamResultView({ result, questions, session, onExit }: { result: ExamResult; questions: Question[]; session: ExamSession; onExit: () => void }) {
  const isPractical = session.examType === "IPEP";
  const config = resolvedExamConfig(session.examType, session.policySnapshot);
  const [reviewFilter, setReviewFilter] = useState<"all" | "correct" | "incorrect" | "unanswered">("all");
  const questionResults = resolvedExamQuestionResults(result, questions, session);
  const filteredResults = questionResults.filter((item) => {
    if (reviewFilter === "all") return true;
    if (reviewFilter === "incorrect") return item.result === "incorrect" || item.result === "partial";
    return item.result === reviewFilter;
  });
  const resultCounts = {
    all: questionResults.length,
    correct: questionResults.filter((item) => item.result === "correct").length,
    incorrect: questionResults.filter((item) => item.result === "incorrect" || item.result === "partial").length,
    unanswered: questionResults.filter((item) => item.result === "unanswered").length,
  };
  const allQuestionDetailsLoaded = session.questionIds.every((id) => (
    questions.some((question) => question.id === id)
  ));
  const resultBreakdownsPending = !result.breakdowns && !allQuestionDetailsLoaded;
  const resultBreakdowns = result.breakdowns
    ? ([
        ["주제별", Object.entries(result.breakdowns.topics)],
        ["난이도별", Object.entries(result.breakdowns.difficulties)],
      ] as const).map(([title, rows]) => ({ title, rows }))
    : allQuestionDetailsLoaded
      ? ([
          ["주제별", (question: Question | undefined) => question?.topic || "미분류"],
          ["난이도별", (question: Question | undefined) => question?.difficulty || "기록 없음"],
        ] as const).map(([title, keyFor]) => ({
          title,
          rows: [...questionResults.reduce((rows, item) => {
            const key = keyFor(questions.find((question) => question.id === item.questionId));
            const current = rows.get(key) ?? { total: 0, correct: 0 };
            current.total += 1;
            if (item.result === "correct") current.correct += 1;
            rows.set(key, current);
            return rows;
          }, new Map<string, { total: number; correct: number }>())],
        }))
      : [];
  return (
    <div className="page-stack">
      <section className={`card exam-result-hero ${result.passed ? "passed" : "failed"}`}><span>{result.passed ? "PASS" : "REVIEW"}</span>{session.examForm && <p className="past-result-title">정보처리기사 실기 · {session.examForm.title} 기출</p>}<h2>{result.passed ? "시험 점수 기준 합격입니다." : "이번 시험은 불합격입니다."}</h2><strong>{result.totalScore}점</strong>{result.autoSubmitted && <p>시험 시간이 만료되어 자동 제출되었습니다.</p>}<p>{isPractical ? "입력한 답을 허용 정답과 비교한 실기 모의고사 결과입니다." : result.failedMinimum ? "총점과 별개로 과목별 40% 미만 과락이 있습니다." : "과락 없이 전체 기준을 적용한 결과입니다."}</p></section>
      <section className={isPractical ? "exam-result-grid practical" : "exam-result-grid"}>{!isPractical && <article className="card"><span>객관식 점수</span><strong>{result.objectiveScore}점</strong></article>}{config.descriptiveCount > 0 && <article className="card"><span>{isPractical ? "실기 점수" : "실기형 점수"}</span><strong>{result.descriptiveScore}점</strong></article>}<article className="card"><span>{isPractical ? "정답 / 부분 정답 / 오답 / 미응답" : "정답 / 오답 / 미응답"}</span><strong>{result.correctCount} / {isPractical && <>{result.partialCount ?? 0} / </>}{result.incorrectCount} / {result.unansweredCount}</strong></article></section>
      <article className="card subject-result-card"><h3>과목별 점수</h3>{Object.entries(result.subjectScores).map(([subject, score]) => <div key={subject}><span>{subject}</span><strong>{Number(score.earned.toFixed(2))} / {score.possible}점 · {score.rate}% {score.failedMinimum ? "· 과락" : ""}</strong></div>)}</article>
      <section className="exam-result-breakdowns" aria-label="모의고사 주제와 난이도별 결과">
        {resultBreakdownsPending ? (
          <article className="card" role="status"><h3>세부 결과를 준비하고 있습니다.</h3><p>전체 문항 정보를 확인한 뒤 정확한 주제별·난이도별 결과를 한 번에 표시합니다.</p></article>
        ) : resultBreakdowns.map((breakdown) => (
          <article className="card" key={breakdown.title}>
            <h3>{breakdown.title} 결과</h3>
            <ul>{breakdown.rows.map(([label, values]) => <li key={label}><span>{label}</span><strong>{values.correct}/{values.total}문항</strong></li>)}</ul>
          </article>
        ))}
      </section>
      <article className="card exam-review-card">
        <div className="exam-review-head"><div><span className="section-kicker">문항별 복습</span><h3>문항별 채점 결과</h3><p>문항을 열면 제출 답안·정답·해설을 함께 확인할 수 있습니다.</p></div><div className="exam-review-filters" aria-label="채점 결과 필터">
          {([
            ["all", "전체"],
            ["correct", "정답"],
            ["incorrect", "오답·부분 정답"],
            ["unanswered", "미응답"],
          ] as const).map(([value, label]) => <button key={value} className={reviewFilter === value ? "active" : ""} onClick={() => setReviewFilter(value)}>{label} {resultCounts[value]}</button>)}
        </div></div>
        <div className="exam-review-list">
          {filteredResults.map((item) => {
            const question = questions.find((entry) => entry.id === item.questionId);
            const evaluation = result.practicalEvaluations?.[String(item.questionId)];
            const choices = item.choices?.length ? item.choices : question?.choices ?? [];
            return <details className={`exam-review-item ${item.result}`} key={`${session.id}-${item.questionId}`}>
              <summary><span className="exam-review-number">문제 {item.position}{practicalPastQuestion(item.questionId) && <small>원문 {practicalPastQuestion(item.questionId)!.number}번</small>}</span><span className={`exam-review-status ${item.result}`}>{examResultLabel(item.result)}</span><span className="exam-review-subject">{item.category}</span><strong>{question ? contentSummary(question.prompt, 72) : "현재 문제은행에서 확인할 수 없는 이전 문제"}</strong><span className="exam-review-chevron" aria-hidden="true">⌄</span></summary>
              <div className="exam-review-detail">
                {question && <div className="exam-review-prompt"><QuestionPromptContent value={question.prompt} /></div>}
                {item.kind === "descriptive" ? (
                  <>
                    <section className="submitted-answer"><strong>내가 제출한 답</strong><pre>{(isPractical ? displayPracticalAnswer(item.answerText) : item.answerText) || "미응답"}</pre></section>
                    {evaluation && <SelfAssessmentSummary evaluation={evaluation} />}
                    {question && <DescriptiveGuidance question={question} />}
                  </>
                ) : (
                  <>
                    {choices.length > 0 && <section className="exam-review-choices" aria-label={`문제 ${item.position} 선택지`}>
                      <strong>선택지</strong>
                      <div>{choices.map((choice, index) => {
                        const selected = item.selectedAnswers.includes(index);
                        const correct = item.correctAnswers.includes(index);
                        const className = [
                          "exam-review-choice",
                          selected ? "selected" : "",
                          correct ? "correct" : "",
                        ].filter(Boolean).join(" ");
                        return <div className={className} key={`${item.questionId}-${index}`}>
                          <span>{choiceLabel(index)}</span>
                          <RichContent value={choice} compact choiceValue />
                          <div className="exam-review-choice-flags">
                            {selected && <em>내 선택</em>}
                            {correct && <em>정답</em>}
                          </div>
                        </div>;
                      })}</div>
                    </section>}
                    <div className="exam-answer-comparison"><div><span>내 답</span><strong>{answerLetters(item.selectedAnswers)}</strong></div><div><span>정답</span><strong>{answerLetters(item.correctAnswers)}</strong></div></div>
                    {question && <section className="question-detail-explanation"><strong>정답 및 해설</strong><RichContent value={question.explanation} explanation /></section>}
                  </>
                )}
              </div>
            </details>;
          })}
        </div>
      </article>
      <div className="result-actions"><button className="outline-button" onClick={onExit}>모의고사 선택으로</button><button className="primary-button" onClick={() => window.print()}>결과 인쇄</button></div>
      <p className="exam-result-note">표시된 합격 여부는 모의고사 점수 기준이며 실제 자격의 최종 취득 조건을 의미하지 않습니다.</p>
    </div>
  );
}


export default ExamRunner;
