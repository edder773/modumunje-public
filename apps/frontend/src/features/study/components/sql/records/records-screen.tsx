"use client";

import { choiceLabel } from "@shared/study/choice-label";

import {
  useId,
  useMemo,
  useState,
  type KeyboardEvent,
} from "react";
import {
  examDisplayName,
  hasDescriptiveQuestions,
  isObjectiveKind,
  questionKindLabel,
  type DescriptiveEvaluation,
  type ExamResult,
  type ExamType,
} from "@shared/study/study-domain";
import { parseUtcDate } from "@shared/date/korea-date.mjs";
import {
  CATEGORIES,
  SUBCATEGORIES,
  EmptyState,
  QuestionPromptContent,
  RichContent,
  answerLetters,
  contentSummary,
  dateTimeLabel,
  koreaDateKey,
  DescriptiveGuidance,
  resolvedTopic,
  sameAnswers,
  SelfAssessmentSummary,
  type Attempt,
  type Difficulty,
  type ExamSession,
  type Question,
  type TheoryArticle,
  type View,
} from "../../study-screen-shared";
import Modal from "../../modal";
import { PracticalAnswerFields } from "../practical-answer-input";

export function LearningRecordsHub({
  activeView,
  examType,
  questions,
  attempts,
  objectiveAttempts,
  sessions,
  theories,
  streak,
  onNavigate,
  onRetryBookmarks,
  onBookmark,
  onGrade,
  onSelfAssessment,
  summary,
  stats,
  attemptsHasMore,
  bookmarksHasMore,
  loadingMore,
  onLoadMore,
}: {
  activeView: "stats" | "wrong" | "incorrect";
  examType: ExamType;
  questions: Question[];
  attempts: Attempt[];
  objectiveAttempts: Attempt[];
  sessions: ExamSession[];
  theories: TheoryArticle[];
  streak: number;
  onNavigate: (view: View) => void;
  onRetryBookmarks: () => void;
  onBookmark: (question: Question) => void;
  onGrade: (question: Question, answers: number[]) => Promise<boolean>;
  onSelfAssessment: (question: Question, answer: string, score: number) => Promise<DescriptiveEvaluation>;
  summary?: { incorrectQuestionCount: number; bookmarkCount: number };
  stats?: {
    totalAttempts: number;
    correctAttempts: number;
    incorrectAttempts: number;
    learningDays: number;
    difficulties: Array<{ level: string; attempts: number; correct: number; incorrect: number }>;
    categories: Array<{
      category: string;
      attempts: number;
      correct: number;
      incorrect: number;
      topics: Array<{ topic: string; attempts: number; correct: number; incorrect: number }>;
    }>;
  };
  attemptsHasMore: boolean;
  bookmarksHasMore: boolean;
  loadingMore: "attempts" | "bookmarks" | null;
  onLoadMore: (kind: "attempts" | "bookmarks") => void;
}) {
  const loadedBookmarkedCount = questions.filter((question) => question.bookmarked).length;
  const loadedIncorrectCount = new Set(
    objectiveAttempts
      .filter((attempt) => attempt.result !== "correct")
      .map((attempt) => attempt.questionId),
  ).size;
  const bookmarkedCount = summary?.bookmarkCount ?? loadedBookmarkedCount;
  const incorrectCount = summary?.incorrectQuestionCount ?? loadedIncorrectCount;
  const tabs: Array<{ id: "stats" | "incorrect" | "wrong"; label: string; count?: number }> = [
    { id: "stats", label: "풀이·모의고사 기록" },
    { id: "incorrect", label: "오답 문제", count: incorrectCount },
    { id: "wrong", label: "북마크", count: bookmarkedCount },
  ];
  const tabsId = useId();
  function moveTabFocus(event: KeyboardEvent<HTMLButtonElement>, currentIndex: number) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    onNavigate(tabs[nextIndex].id);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus();
  }
  return (
    <div className="page-stack learning-records-hub">
      <section className="card learning-records-header" aria-labelledby="learning-records-title">
        <div>
          <span className="section-kicker">{examDisplayName(examType)} 학습 기록</span>
          <h2 id="learning-records-title">학습 결과와 복습 항목을 한곳에서 확인하세요.</h2>
          <p>현재 선택한 과정의 {examType === "IPEP" ? "단답형" : "객관식"} 풀이, 오답 문제, 북마크와 모의고사 결과만 표시합니다.</p>
        </div>
        <div className="learning-record-tabs" role="tablist" aria-label="학습 기록 보기">
          {tabs.map((tab, index) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`${tabsId}-tab-${tab.id}`}
              aria-controls={`${tabsId}-panel-${tab.id}`}
              aria-selected={activeView === tab.id}
              tabIndex={activeView === tab.id ? 0 : -1}
              className={activeView === tab.id ? "active" : ""}
              onClick={() => onNavigate(tab.id)}
              onKeyDown={(event) => moveTabFocus(event, index)}
            >
              <span>{tab.label}</span>
              {typeof tab.count === "number" && <strong>{tab.count}</strong>}
            </button>
          ))}
        </div>
      </section>
      <div
        role="tabpanel"
        id={`${tabsId}-panel-${activeView}`}
        aria-labelledby={`${tabsId}-tab-${activeView}`}
        tabIndex={0}
      >
      {activeView === "stats" && (
        <StatsView
          examType={examType}
          questions={questions}
          attempts={objectiveAttempts}
          sessions={sessions}
          streak={streak}
          serverStats={stats}
        />
      )}
      {activeView === "incorrect" && (
        <WrongNote
          mode="incorrect"
          examType={examType}
          questions={questions}
          attempts={objectiveAttempts}
          theories={theories}
          onRetryBookmarks={onRetryBookmarks}
          onBookmark={onBookmark}
          onGrade={onGrade}
          onSelfAssessment={onSelfAssessment}
        />
      )}
      {activeView === "wrong" && (
        <WrongNote
          mode="bookmarks"
          examType={examType}
          questions={questions}
          attempts={attempts}
          theories={theories}
          onRetryBookmarks={onRetryBookmarks}
          onBookmark={onBookmark}
          onGrade={onGrade}
          onSelfAssessment={onSelfAssessment}
        />
      )}
      </div>
      {(activeView === "stats" || activeView === "incorrect") && attemptsHasMore && (
        <button className="outline-button records-load-more" type="button" disabled={Boolean(loadingMore)} onClick={() => onLoadMore("attempts")}>
          {loadingMore === "attempts" ? "이전 풀이를 불러오는 중…" : "이전 풀이 기록 더 보기"}
        </button>
      )}
      {activeView === "wrong" && bookmarksHasMore && (
        <button className="outline-button records-load-more" type="button" disabled={Boolean(loadingMore)} onClick={() => onLoadMore("bookmarks")}>
          {loadingMore === "bookmarks" ? "북마크를 불러오는 중…" : "이전 북마크 더 보기"}
        </button>
      )}
    </div>
  );
}

export function WrongNote({ mode, examType, questions, attempts, theories, onRetryBookmarks, onBookmark, onGrade, onSelfAssessment }: {
  mode: "bookmarks" | "incorrect";
  examType: ExamType;
  questions: Question[];
  attempts: Attempt[];
  theories: TheoryArticle[];
  onRetryBookmarks: () => void;
  onBookmark: (question: Question) => void;
  onGrade: (question: Question, answers: number[]) => Promise<boolean>;
  onSelfAssessment: (question: Question, answer: string, score: number) => Promise<DescriptiveEvaluation>;
}) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [kindFilter, setKindFilter] = useState<"all" | "objective" | "descriptive">("all");
  const [difficultyFilter, setDifficultyFilter] = useState<"전체" | Difficulty>("전체");
  const [sortOrder, setSortOrder] = useState<"recent" | "category">("recent");
  const reviewIndex = useMemo(() => {
    const latestAttemptByQuestionId = new Map<number, Attempt>();
    const incorrectQuestionIds = new Set<number>();
    for (const attempt of attempts) {
      if (!latestAttemptByQuestionId.has(attempt.questionId)) {
        latestAttemptByQuestionId.set(attempt.questionId, attempt);
        if (attempt.result !== "correct") incorrectQuestionIds.add(attempt.questionId);
      }
    }
    return { latestAttemptByQuestionId, incorrectQuestionIds };
  }, [attempts]);
  const sourceQuestions = useMemo(() => (
    mode === "bookmarks"
      ? questions.filter((question) => question.bookmarked)
      : questions.filter((question) => reviewIndex.incorrectQuestionIds.has(question.id))
  ), [mode, questions, reviewIndex]);
  const filteredQuestions = useMemo(() => [...sourceQuestions]
    .filter((question) => kindFilter === "all"
      || (kindFilter === "objective" ? isObjectiveKind(question.kind) : question.kind === "descriptive"))
    .filter((question) => difficultyFilter === "전체" || question.difficulty === difficultyFilter)
    .sort((first, second) => sortOrder === "category"
      ? first.category.localeCompare(second.category, "ko")
        || resolvedTopic(first).localeCompare(resolvedTopic(second), "ko")
      : +parseUtcDate(reviewIndex.latestAttemptByQuestionId.get(second.id)?.createdAt ?? second.updatedAt)
        - +parseUtcDate(reviewIndex.latestAttemptByQuestionId.get(first.id)?.createdAt ?? first.updatedAt)), [
    difficultyFilter,
    kindFilter,
    reviewIndex,
    sortOrder,
    sourceQuestions,
  ]);
  const selected = useMemo(
    () => questions.find((question) => question.id === selectedId) ?? null,
    [questions, selectedId],
  );
  return <div className="page-stack review-library">
    <section className="wrong-hero"><div><span className="section-kicker">{examDisplayName(examType)} {mode === "bookmarks" ? "북마크" : "오답 문제"}</span><h2>{mode === "bookmarks" ? "다시 볼 문제를 확인하세요." : "틀렸던 문제를 다시 확인하세요."}</h2><p>문제 카드를 누르면 정답을 가린 풀이 모달이 바로 열립니다.</p></div><div className="wrong-count"><strong>{sourceQuestions.length}</strong><span>{mode === "bookmarks" ? "저장한 문항" : "오답 문항"}</span>{mode === "bookmarks" && <button className="primary-button" title="북마크 문제 풀기" onClick={onRetryBookmarks} disabled={!sourceQuestions.length}>북마크 문제 풀기</button>}</div></section>
    <section className="card wrong-filter-bar" aria-label={`${mode === "bookmarks" ? "북마크" : "오답 문제"} 필터`}><label>문제 유형<select value={kindFilter} onChange={(event) => setKindFilter(event.target.value as typeof kindFilter)}><option value="all">전체</option>{examType !== "IPEP" && <option value="objective">객관식</option>}{(mode === "bookmarks" || examType === "IPEP") && hasDescriptiveQuestions(examType) && <option value="descriptive">{examType === "IPEP" ? "단답형" : "서술형"}</option>}</select></label><label>난이도<select value={difficultyFilter} onChange={(event) => setDifficultyFilter(event.target.value as typeof difficultyFilter)}><option>전체</option><option>하</option><option>중</option><option>상</option></select></label><label>정렬<select value={sortOrder} onChange={(event) => setSortOrder(event.target.value as typeof sortOrder)}><option value="recent">최근 활동순</option><option value="category">과목·소분류순</option></select></label><span className="filter-result-count">{filteredQuestions.length}문항</span></section>
    {filteredQuestions.length ? <div className="wrong-list compact-wrong-list bookmark-list">{filteredQuestions.map((question) => {
      const latest = reviewIndex.latestAttemptByQuestionId.get(question.id);
      return <button className="card wrong-summary-card" type="button" key={question.id} onClick={() => setSelectedId(question.id)} aria-label={`${contentSummary(question.prompt, 45)} 바로 풀기`}><span className="manage-number">{mode === "bookmarks" ? "★" : "!"}</span><div className="wrong-summary-copy"><div className="wrong-item-head"><span className="scope-badge">{examDisplayName(examType)}</span><span className="category-label">{question.category}</span><span className="difficulty-badge">난이도 {question.difficulty}</span><span>{examType === "IPEP" ? "단답형" : questionKindLabel(question.kind)}</span></div><h3>{contentSummary(question.prompt, 92)}</h3><p>{resolvedTopic(question)}</p><div className="wrong-card-foot"><span>{latest ? `최근 풀이 ${dateTimeLabel(latest.createdAt)}` : "아직 풀이 기록 없음"}</span><strong>{mode === "bookmarks" ? "북마크됨" : "오답 기록"}</strong></div></div><span className="card-arrow" aria-hidden="true">→</span></button>;
    })}</div> : <EmptyState title={sourceQuestions.length ? "조건에 맞는 결과가 없습니다." : mode === "bookmarks" ? "아직 저장한 문제가 없습니다." : "아직 틀린 문제가 없습니다."} description={sourceQuestions.length ? "문제 유형이나 난이도 필터를 변경해 보세요." : mode === "bookmarks" ? "문제를 풀다가 다시 보고 싶은 문항을 북마크해보세요." : "문제 풀이를 시작해보세요."} />}
    {selected && <WrongDetailModal key={selected.id} title={mode === "bookmarks" ? "북마크 문제 풀기" : "오답 문제 다시 풀기"} question={selected} theory={theories.find((item) => item.id === selected.theoryId)} onClose={() => setSelectedId(null)} onBookmark={() => onBookmark(selected)} onGrade={onGrade} onSelfAssessment={onSelfAssessment} />}
  </div>;
}

function WrongDetailModal({ title, question, theory, onClose, onBookmark, onGrade, onSelfAssessment }: {
  title: string;
  question: Question;
  theory?: TheoryArticle;
  onClose: () => void;
  onBookmark: () => void;
  onGrade: (question: Question, answers: number[]) => Promise<boolean>;
  onSelfAssessment: (question: Question, answer: string, score: number) => Promise<DescriptiveEvaluation>;
}) {
  const [answers, setAnswers] = useState<number[]>([]);
  const [answerText, setAnswerText] = useState("");
  const [answerSnapshot, setAnswerSnapshot] = useState("");
  const [selfScore, setSelfScore] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [evaluation, setEvaluation] = useState<DescriptiveEvaluation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isDescriptive = question.kind === "descriptive";
  const isPractical = question.examScope === "IPEP";
  const correct = !isDescriptive && revealed && sameAnswers(answers, question.correctAnswers);

  function toggleModalAnswer(index: number) {
    if (revealed || busy) return;
    if (question.kind === "single") {
      setAnswers([index]);
      return;
    }
    setAnswers((previous) => previous.includes(index)
      ? previous.filter((item) => item !== index)
      : [...previous, index]);
  }

  async function gradeModalAnswer() {
    if (!answers.length || busy || revealed) return;
    setBusy(true);
    setError("");
    try {
      await onGrade(question, answers);
      setRevealed(true);
    } catch {
      setError("채점 결과를 저장하지 못했습니다. 답안은 유지되며 다시 시도할 수 있습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function gradePracticalModal() {
    if (!answerText.trim() || busy || revealed) return;
    setBusy(true);
    setError("");
    try {
      const result = await onSelfAssessment(question, answerText, 0);
      setEvaluation(result);
      setRevealed(true);
    } catch {
      setError("정답 확인과 저장을 완료하지 못했습니다. 입력 답안은 유지되니 다시 시도해 주세요.");
    } finally { setBusy(false); }
  }

  async function saveModalSelfAssessment() {
    const score = Number(selfScore);
    if (!revealed || !answerSnapshot || answerText.trim() !== answerSnapshot || busy || evaluation || !Number.isFinite(score) || score < 0 || score > 100) return;
    setBusy(true);
    setError("");
    try {
      const nextEvaluation = await onSelfAssessment(question, answerSnapshot, score);
      setEvaluation(nextEvaluation);
      setRevealed(true);
    } catch {
      setError("직접 채점 기록을 저장하지 못했습니다. 입력 내용은 유지됩니다.");
    } finally {
      setBusy(false);
    }
  }

  return <Modal title={title} onClose={onClose} wide><div className="bookmark-modal-quiz"><div className="quiz-head"><div className="question-detail-meta"><span className="category-label">{question.category}</span><span className="difficulty-badge">난이도 {question.difficulty}</span><span>{resolvedTopic(question)}</span><span>{isPractical ? "단답형" : questionKindLabel(question.kind)}</span></div><button className={question.bookmarked ? "bookmark-button active" : "bookmark-button"} onClick={onBookmark} aria-label={question.bookmarked ? "북마크 해제" : "북마크 추가"}>{question.bookmarked ? "★" : "☆"}</button></div><div className="question-detail-prompt"><QuestionPromptContent value={question.prompt} /></div>{question.kind === "multiple" && <p className="multi-hint">복수정답 문제입니다. 해당하는 답을 모두 선택하세요.</p>}{!isDescriptive && <div className="choices bookmark-modal-choices">{question.choices.map((choice, index) => {
    const chosen = answers.includes(index);
    const right = question.correctAnswers.includes(index);
    let className = chosen ? "choice selected" : "choice";
    if (revealed && right) className += " correct";
    if (revealed && chosen && !right) className += " incorrect";
    return <button key={index} className={className} type="button" onClick={() => toggleModalAnswer(index)} aria-pressed={chosen}><span>{choiceLabel(index)}</span><RichContent value={choice} compact choiceValue />{revealed && chosen && <i>{right ? "내 선택 · 정답" : "내 선택 · 오답"}</i>}{revealed && right && !chosen && <i>정답</i>}</button>;
  })}</div>}{isPractical && <section className="descriptive-answer-panel bookmark-modal-answer"><div><strong>내 답안</strong><span>{question.shortAnswerInput?.hint ?? "요구한 답만 입력하세요. 여러 답은 문제 순서대로 쉼표 또는 줄바꿈으로 구분하세요."}</span></div><PracticalAnswerFields input={question.shortAnswerInput} value={answerText} onChange={setAnswerText} disabled={revealed || busy} /><button className="primary-button" onClick={gradePracticalModal} disabled={!answerText.trim() || revealed || busy}>{busy ? "확인 중…" : "정답 확인"}</button>{revealed && <DescriptiveGuidance question={question} />}</section>}{isDescriptive && !isPractical && <section className="descriptive-answer-panel bookmark-modal-answer"><div><strong>내 답안</strong><span>SQL·실행계획·튜닝 근거를 여러 줄로 작성할 수 있습니다.</span></div><textarea value={answerText} onChange={(event) => setAnswerText(event.target.value)} rows={10} placeholder="문제의 요구사항, 판단 근거와 개선안을 작성하세요." spellCheck={false} disabled={revealed || Boolean(evaluation)} /><button className="outline-button" type="button" disabled={!answerText.trim() || revealed} onClick={() => { const snapshot = answerText.trim(); if (!snapshot) return; setAnswerSnapshot(snapshot); setAnswerText(snapshot); setRevealed(true); }}>평가 기준·모범답안 확인</button>{revealed && <><DescriptiveGuidance question={question} />{!evaluation && <section className="self-score-control"><div><strong>내 답안 직접 채점하기</strong><span>자동 채점 없이 평가 자료와 비교한 예상 점수를 0~100점으로 기록하세요.</span></div><label><span>점수</span><input type="number" min="0" max="100" inputMode="numeric" value={selfScore} onChange={(event) => setSelfScore(event.target.value)} /><b>점</b></label><button className="primary-button" onClick={saveModalSelfAssessment} disabled={!answerSnapshot || answerText.trim() !== answerSnapshot || selfScore === "" || busy}>{busy ? "저장 중…" : "내 점수 저장"}</button></section>}</>}</section>}{error && <div className="evaluation-error" role="alert"><strong>처리하지 못했습니다.</strong><span>{error}</span></div>}{!isDescriptive && !revealed && <button className="primary-button bookmark-modal-submit" onClick={gradeModalAnswer} disabled={!answers.length || busy}>{busy ? "채점 중…" : "정답 확인"}</button>}{!isDescriptive && revealed && <><section className="bookmark-correct-answer"><strong>정답 {answerLetters(question.correctAnswers)}</strong><div>{question.correctAnswers.map((answer) => <p key={answer}><b>{choiceLabel(answer)}</b><RichContent value={question.choices[answer] ?? ""} compact choiceValue /></p>)}</div></section><div className={correct ? "explanation correct" : "explanation incorrect"}><div className="explanation-title"><span>{correct ? "✓" : "!"}</span><strong>{correct ? "정답입니다." : "다시 확인해 보세요."}</strong></div><RichContent value={question.explanation} explanation /></div></>}{evaluation && <SelfAssessmentSummary evaluation={evaluation} />}{theory && <p className="linked-theory">연결 이론 · {theory.title}</p>}<div className="modal-actions"><button className="outline-button" onClick={onClose}>닫기</button></div></div></Modal>;
}


export function StatsView({ examType, questions, attempts, sessions, streak, serverStats }: {
  examType: ExamType;
  questions: Question[];
  attempts: Attempt[];
  sessions: ExamSession[];
  streak: number;
  serverStats?: {
    totalAttempts: number;
    correctAttempts: number;
    incorrectAttempts: number;
    learningDays: number;
    difficulties: Array<{ level: string; attempts: number; correct: number; incorrect: number }>;
    categories: Array<{
      category: string;
      attempts: number;
      correct: number;
      incorrect: number;
      topics: Array<{ topic: string; attempts: number; correct: number; incorrect: number }>;
    }>;
  };
}) {
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const practiceKind = examType === "IPEP" ? "단답형" : "객관식";
  const loadedStats = useMemo(() => {
    type Count = { attempts: number; correct: number; incorrect: number };
    type QuestionMeta = { category: string; topic: string; difficulty: Difficulty };
    const questionById = new Map<number, QuestionMeta>();
    const topicsByCategory = new Map<string, string[]>();
    const topicSets = new Map<string, Set<string>>();
    const categoryCounts = new Map<string, Count>();
    const difficultyCounts = new Map<Difficulty, Count>(
      (["하", "중", "상"] as Difficulty[]).map((level) => [
        level,
        { attempts: 0, correct: 0, incorrect: 0 },
      ]),
    );
    const topicCounts = new Map<string, Map<string, Count>>();

    for (const question of questions) {
      if (!isObjectiveKind(question.kind) && question.examScope !== "IPEP") continue;
      const topic = resolvedTopic(question);
      questionById.set(question.id, {
        category: question.category,
        topic,
        difficulty: question.difficulty,
      });
      if (!topicSets.has(question.category)) {
        topicSets.set(question.category, new Set());
        topicsByCategory.set(question.category, []);
      }
      const seen = topicSets.get(question.category)!;
      if (!seen.has(topic)) {
        seen.add(topic);
        topicsByCategory.get(question.category)!.push(topic);
      }
      if (!categoryCounts.has(question.category)) {
        categoryCounts.set(question.category, { attempts: 0, correct: 0, incorrect: 0 });
      }
    }

    const learningDates = new Set<string>();
    let correctAttempts = 0;
    let gradedAttempts = 0;
    for (const attempt of attempts) {
      if (examType === "IPEP" && !["practice", "bookmark-practice", "bookmark-modal", "incorrect-review", "mock-exam"].includes(attempt.mode)) continue;
      const question = questionById.get(attempt.questionId);
      if (!question) continue;
      gradedAttempts += 1;
      const isCorrect = attempt.result === "correct";
      if (isCorrect) correctAttempts += 1;
      learningDates.add(koreaDateKey(attempt.createdAt));

      const category = categoryCounts.get(question.category)!;
      category.attempts += 1;
      category[isCorrect ? "correct" : "incorrect"] += 1;

      const difficulty = difficultyCounts.get(question.difficulty)!;
      difficulty.attempts += 1;
      difficulty[isCorrect ? "correct" : "incorrect"] += 1;

      let categoryTopics = topicCounts.get(question.category);
      if (!categoryTopics) {
        categoryTopics = new Map();
        topicCounts.set(question.category, categoryTopics);
      }
      let topic = categoryTopics.get(question.topic);
      if (!topic) {
        topic = { attempts: 0, correct: 0, incorrect: 0 };
        categoryTopics.set(question.topic, topic);
      }
      topic.attempts += 1;
      topic[isCorrect ? "correct" : "incorrect"] += 1;
    }

    const categoryStats = [
      ...CATEGORIES.filter((category) => categoryCounts.has(category)),
      ...Array.from(categoryCounts.keys()).filter((category) => !CATEGORIES.includes(category)),
    ]
      .map((category) => {
        const counts = categoryCounts.get(category)!;
        const configuredTopics = SUBCATEGORIES[category] ?? [];
        const availableTopics = topicsByCategory.get(category) ?? [];
        const availableTopicSet = new Set(availableTopics);
        const orderedTopics = [
          ...configuredTopics.filter((topic) => availableTopicSet.has(topic)),
          ...availableTopics.filter((topic) => !configuredTopics.includes(topic)),
        ];
        return {
          category,
          ...counts,
          accuracy: counts.attempts
            ? Math.round((counts.correct / counts.attempts) * 100)
            : null,
          topics: orderedTopics.map((topic) => ({
            topic,
            ...(topicCounts.get(category)?.get(topic)
              ?? { attempts: 0, correct: 0, incorrect: 0 }),
          })),
        };
      });

    return {
      categoryStats,
      difficultyStats: (["하", "중", "상"] as Difficulty[]).map((level) => ({
        level,
        ...difficultyCounts.get(level)!,
      })),
      correctAttempts,
      totalAttempts: examType === "IPEP" ? gradedAttempts : attempts.length,
      incorrectAttempts: (examType === "IPEP" ? gradedAttempts : attempts.length) - correctAttempts,
      learningDays: learningDates.size,
    };
  }, [attempts, questions, examType]);
  const stats = useMemo(() => {
    if (!serverStats) return loadedStats;
    const difficultyByLevel = new Map(serverStats.difficulties.map((item) => [item.level, item]));
    const categoryByName = new Map(serverStats.categories.map((item) => [item.category, item]));
    const orderedCategories = [
      ...CATEGORIES.filter((category) => categoryByName.has(category)),
      ...serverStats.categories.map((item) => item.category).filter((category) => !CATEGORIES.includes(category)),
    ];
    return {
      totalAttempts: serverStats.totalAttempts,
      correctAttempts: serverStats.correctAttempts,
      incorrectAttempts: serverStats.incorrectAttempts,
      learningDays: serverStats.learningDays,
      difficultyStats: (["하", "중", "상"] as Difficulty[]).map((level) => ({
        ...(difficultyByLevel.get(level) ?? { attempts: 0, correct: 0, incorrect: 0 }),
        level,
      })),
      categoryStats: orderedCategories.map((category) => {
        const item = categoryByName.get(category)!;
        return {
          ...item,
          accuracy: item.attempts ? Math.round(item.correct / item.attempts * 100) : null,
        };
      }),
    };
  }, [loadedStats, serverStats]);
  const submitted = useMemo(
    () => sessions.filter((session) => session.status === "submitted"),
    [sessions],
  );
  const latestScore = submitted.length ? Number((submitted[0].result as ExamResult).totalScore ?? 0) : 0;
  return (
    <div className="page-stack">
      <section className="stats-context" aria-label="현재 학습 기록 범위">
        <div><h2>{examDisplayName(examType)} {practiceKind} 풀이 요약</h2></div>
        <p>현재 선택한 {examDisplayName(examType)}의 {practiceKind} 풀이 기록입니다. 과목별 정답률은 정답 수를 {practiceKind} 풀이 수로 나누어 계산합니다.</p>
      </section>
      <section className="stats-summary">
        <article className="card stat-block"><span>총 풀이 수</span><strong>{stats.totalAttempts}<small>회</small></strong><p>{examDisplayName(examType)} 전체 {practiceKind} 기록 기준</p></article>
        <article className="card stat-block success"><span>정답 수</span><strong>{stats.correctAttempts}<small>회</small></strong><p>완전 정답으로 채점된 풀이</p></article>
        <article className="card stat-block danger"><span>오답 수</span><strong>{stats.incorrectAttempts}<small>회</small></strong><p>{practiceKind} 오답으로 채점된 풀이</p></article>
        <article className="card stat-block"><span>학습일 수</span><strong>{stats.learningDays}<small>일</small></strong><p>연속 학습 {streak}일</p></article>
      </section>
      {!stats.totalAttempts && <section className="card stats-empty-inline"><strong>첫 문제를 풀고 학습 기록을 만들어보세요.</strong><p>{practiceKind} 문제를 풀면 난이도·과목·소분류별 풀이·정답·오답 횟수가 이곳에 표시됩니다.</p></section>}
      {stats.totalAttempts > 0 && <section className="stats-grid">
        <article className="card difficulty-distribution">
          <div className="card-title-row"><div><span className="section-kicker">난이도별 기록</span><h3>난이도별 풀이 기록</h3></div><small>실제 학습 기록 기준</small></div>
          {stats.difficultyStats.map((item) => <div key={item.level}><span>난이도 {item.level}</span><strong>{item.attempts ? `${item.attempts}회` : "미학습"}</strong><small>정답 {item.correct}회 · 오답 {item.incorrect}회</small></div>)}
          <div className="mock-stat-summary"><span>최근 모의고사{submitted[0]?.examForm ? ` · ${submitted[0].examForm.title}` : ""}</span><strong>{submitted.length ? `${latestScore}점` : "응시 기록 없음"}</strong><small>{submitted.length}회 응시</small></div>
        </article>
        <article className="card category-stats">
          <div className="card-title-row stats-title-row"><div><span className="section-kicker">과목별 기록</span><h3>과목별 풀이 기록</h3></div><small>과목을 눌러 소분류 보기</small></div>
          {stats.categoryStats.map((item, categoryIndex) => {
            const expanded = expandedCategory === item.category;
            return <section className={expanded ? "category-stat expanded" : "category-stat"} key={item.category}><button className="category-toggle" onClick={() => setExpandedCategory(expanded ? null : item.category)} aria-expanded={expanded}><span className="subject-order">{examType === "IPEP" ? "실기" : `${categoryIndex + 1}과목`}</span><span className="category-toggle-copy"><strong>{item.category}</strong><small>{item.attempts}회 풀이 · 정답 {item.correct}회 · 오답 {item.incorrect}회</small><small className="category-accuracy">{practiceKind} 정답률 {item.accuracy === null ? "—" : `${item.accuracy}%`}</small></span><span className="category-toggle-score"><strong>{item.attempts ? `${item.attempts}회` : "미학습"}</strong><i aria-hidden="true">{expanded ? "−" : "+"}</i></span></button>{expanded && <div className="topic-breakdown"><div className="topic-stat-list">{item.topics.map((topic) => {
              const status = !topic.attempts ? "미학습" : topic.incorrect ? `오답 ${topic.incorrect}회` : "오답 없음";
              return <div className="topic-stat" key={topic.topic}><div className="topic-stat-head"><div><strong>{topic.topic}</strong><span>풀이 {topic.attempts}회 · 정답 {topic.correct}회 · 오답 {topic.incorrect}회</span></div><span className={`topic-status ${topic.incorrect ? "incorrect" : topic.attempts ? "good" : "idle"}`}>{status}</span></div></div>;
            })}</div></div>}</section>;
          })}
        </article>
      </section>}
    </div>
  );
}


export default LearningRecordsHub;
