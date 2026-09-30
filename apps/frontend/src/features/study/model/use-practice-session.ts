"use client";
import { loginNoticePath } from "@shared/auth/login-navigation";
import { learningPath } from "@shared/study/learning-catalog";
import {
  isExpectedRequestCancellation
} from "@shared/runtime/latest-request-coordinator.mjs";
import {
  isDescriptiveAllowed,
  isObjectiveKind,
  type DescriptiveEvaluation,
  type PracticeKind
} from "@shared/study/study-domain";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Practice } from "../components/study-lazy-screens";
import {
  shuffle
} from "../components/study-navigation";
import {
  type Attempt,
  type Question,
  type TheoryArticle
} from "../components/study-screen-shared";
import { scopeQuestions } from "./study-data-utils";
import {
  clientEventId,
  readGuestLearningState,
  readRecentSqlPracticeQuestionIds,
  writeGuestLearningState,
  writeRecentSqlPracticeQuestionIds
} from "../persistence/guest-learning-store";
import { trackEvent } from "../telemetry/study-telemetry";
import {
  mergeById,
  mergeQuestionFeedback,
  requestQuestionFeedback,
  type AttemptSavePayload,
  type QuestionFeedback,
} from "./answer-feedback";
import type { StudyControllerContext } from "./study-controller-context";
import { requestStudyMutation } from "./study-mutation-api-client";

import useSessionEpoch from "./use-session-epoch";

export default function usePracticeSession({ data, setData, selectedExam, isAuthenticated, userKeyHash, setNotice, setPendingRequestCount, setActiveView, writeLearningUrl, fetchStudyData, refreshData, runTrackedAccountSave, runTrackedLocalSave, retrySaveQueue, bookmarkSaveQueue, bookmarkDesired, bookmarkConfirmed, bookmarkRequested, availableQuestions }: Pick<StudyControllerContext, "data" | "setData" | "selectedExam" | "isAuthenticated" | "userKeyHash" | "setNotice" | "setPendingRequestCount" | "setActiveView" | "writeLearningUrl" | "fetchStudyData" | "refreshData" | "runTrackedAccountSave" | "runTrackedLocalSave" | "retrySaveQueue" | "bookmarkSaveQueue" | "bookmarkDesired" | "bookmarkConfirmed" | "bookmarkRequested" | "availableQuestions">) {
  const epoch = useSessionEpoch();
  const nextQuestionPending = useRef(false);
  const prefetchedBatch = useRef<Promise<Question[]> | null>(null);
  const [practiceStarting, setPracticeStarting] = useState(false);

  const [practiceGrading, setPracticeGrading] = useState(false);
  const [practiceAdvancing, setPracticeAdvancing] = useState(false);

  const [category, setCategory] = useState("전체 과목");

  const [difficulty, setDifficulty] = useState("전체");

  const [selectedPracticeKind, setPracticeKind] = useState<PracticeKind>("objective");
  const practiceKind = selectedExam === "IPEP" ? "descriptive"
    : isDescriptiveAllowed(selectedExam, category) ? selectedPracticeKind : "objective";

  const [queue, setQueue] = useState<number[]>([]);

  const [cursor, setCursor] = useState(0);

  const [selected, setSelected] = useState<number[]>([]);

  const [revealed, setRevealed] = useState(false);

  const [quizDone, setQuizDone] = useState(false);

  const [quizCorrect, setQuizCorrect] = useState(0);

  const [continuousPractice, setContinuousPractice] = useState(false);

  const [bookmarkPractice, setBookmarkPractice] = useState(false);

  const [bookmarkAnswers, setBookmarkAnswers] = useState<Record<string, number[]>>({});

  const [bookmarkDescriptiveAnswers, setBookmarkDescriptiveAnswers] = useState<Record<string, string>>({});

  const [bookmarkDescriptiveScores, setBookmarkDescriptiveScores] = useState<Record<string, string>>({});

  const [bookmarkEvaluations, setBookmarkEvaluations] = useState<Record<string, DescriptiveEvaluation>>({});

  const [bookmarkCompletedIds, setBookmarkCompletedIds] = useState<number[]>([]);

  const [descriptiveAnswer, setDescriptiveAnswer] = useState("");

  const [descriptiveAnswerSnapshot, setDescriptiveAnswerSnapshot] = useState("");

  const [descriptiveSelfScore, setDescriptiveSelfScore] = useState("");

  const [evaluation, setEvaluation] = useState<DescriptiveEvaluation | null>(null);

  const [originTheoryId, setOriginTheoryId] = useState<number | null>(null);

  const questionStartedAt = useRef(0);

  const practiceStartingRef = useRef(false);

  const practiceGradingRef = useRef(false);

  function applyQuestionFeedback(questionId: number, feedback: QuestionFeedback) {
    setData((previous) => ({
      ...previous,
      questions: mergeQuestionFeedback(previous.questions, questionId, feedback),
    }));
  }

  useEffect(() => {
    questionStartedAt.current = Date.now();
  }, [queue, cursor]);

  const currentQuestion = data.questions.find((item) => item.id === queue[cursor]);
  const displayedPracticeQuestionId = continuousPractice ? currentQuestion?.id : undefined;

  useEffect(() => {
    if (!displayedPracticeQuestionId) return;
    try {
      writeRecentSqlPracticeQuestionIds(userKeyHash, selectedExam, [
        ...readRecentSqlPracticeQuestionIds(userKeyHash, selectedExam),
        displayedPracticeQuestionId,
      ]);
    } catch { /* Browser storage may be unavailable; practice still works. */ }
  }, [displayedPracticeQuestionId, selectedExam, userKeyHash]);

  const practiceAvailableCount = useMemo(() => {
    const counts = data.practiceMeta?.counts;
    if (!counts?.length) return availableQuestions.length;
    const chosenKind = practiceKind;
    return counts.filter((item) => (
      (category === "전체 과목" || item.category === category)
      && (difficulty === "전체" || chosenKind === "descriptive" || item.kind === "descriptive" || item.difficulty === difficulty)
      && (chosenKind === "objective"
        ? item.kind === "single" || item.kind === "multiple"
        : chosenKind === "descriptive"
          ? item.kind === "descriptive"
          : true)
    )).reduce((sum, item) => sum + item.count, 0);
  }, [availableQuestions.length, category, data.practiceMeta, difficulty, practiceKind]);

  const resetBookmarkPractice = useCallback(() => {
    setBookmarkPractice(false);
    setBookmarkAnswers({});
    setBookmarkDescriptiveAnswers({});
    setBookmarkDescriptiveScores({});
    setBookmarkEvaluations({});
    setBookmarkCompletedIds([]);
  }, []);

  async function practiceCandidates(options?: { bookmarkOnly?: boolean; questionId?: number; theory?: TheoryArticle; formId?: string }): Promise<Question[]> {
    const { selectSqlPracticeCandidates } = await import("./practice-candidates.mjs");
    return selectSqlPracticeCandidates({
      questions: scopeQuestions(data.questions, selectedExam),
      category,
      difficulty,
      practiceKind: practiceKind,
      bookmarkOnly: options?.bookmarkOnly,
      questionId: options?.questionId,
      theoryId: options?.theory?.id,
    });
  }

  async function loadPracticeBatch(options?: { bookmarkOnly?: boolean; theory?: TheoryArticle; exclude?: number[] }, isCurrent?: () => boolean) {
    if (!isAuthenticated && options?.bookmarkOnly) {
      return practiceCandidates({ bookmarkOnly: true });
    }
    const params: Record<string, string | number> = {
      category,
      difficulty,
      kind: practiceKind,
      limit: options?.theory ? 10 : options?.bookmarkOnly ? 12 : 10,
    };
    if (options?.theory) params.theoryId = options.theory.id;
    if (options?.bookmarkOnly) params.bookmarks = 1;
    const isGeneralPractice = !options?.theory && !options?.bookmarkOnly;
    const recentQuestionIds = options?.exclude?.length
      ? options.exclude
      : isGeneralPractice
        ? readRecentSqlPracticeQuestionIds(userKeyHash, selectedExam)
        : [];
    if (recentQuestionIds.length) params.exclude = recentQuestionIds.slice(-100).join(",");
    const serverPayload = await fetchStudyData("practice", params);
    if (isCurrent && !isCurrent()) return [];
    const payload = isAuthenticated
      ? serverPayload
      : (await import("./merge-guest-study-data")).mergeGuestData(serverPayload, readGuestLearningState());
    if (isCurrent && !isCurrent()) return [];
    setData((previous) => ({
      ...previous,
      questions: mergeById(previous.questions, payload.questions),
      settings: payload.settings ?? previous.settings,
      site: payload.site ?? previous.site,
    }));
    return payload.questions;
  }

  async function startPractice(options?: { bookmarkOnly?: boolean; questionId?: number; theory?: TheoryArticle; formId?: string }) {
    if (!isAuthenticated) {
      window.location.assign(loginNoticePath(learningPath({ examType: selectedExam, page: "practice" })));
      return;
    }
    const isCurrent = epoch.capture();
    if (practiceStartingRef.current) return;
    practiceStartingRef.current = true;
    prefetchedBatch.current = null;
    setPracticeStarting(true);
    setPendingRequestCount((count) => count + 1);
    try {
      let candidates: Question[];
      try {
        if (options?.formId) {
          const { loadIpePracticeSet } = await import("./ipe-practice-set");
          candidates = await loadIpePracticeSet(options.formId, selectedExam, async (ids) => (await refreshData("questions", { ids })).questions);
        } else if (options?.questionId) {
          candidates = await practiceCandidates(options);
          if (!candidates.length) {
            const payload = await refreshData("questions", { ids: options.questionId });
            candidates = payload.questions;
          }
        } else {
          candidates = await loadPracticeBatch(options, isCurrent);
        }
      } catch (error) {
        if (isCurrent() && !isExpectedRequestCancellation(error)) {
          setNotice("문제를 불러오지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.");
        }
        return;
      }
      if (!isCurrent()) return;
      if (!candidates.length) {
        setNotice("선택한 조건에 맞는 문제가 없습니다.");
        return;
      }
      const ordered = options?.theory || options?.bookmarkOnly || options?.formId ? candidates : shuffle(candidates);
      const isContinuous = !options?.theory && !options?.questionId && !options?.bookmarkOnly && !options?.formId;
      setQueue(ordered.slice(0, options?.theory ? 10 : undefined).map((item) => item.id));
      setContinuousPractice(isContinuous);
      resetBookmarkPractice();
      setBookmarkPractice(Boolean(options?.bookmarkOnly));
      setCursor(0);
      setSelected([]);
      setRevealed(false);
      setQuizDone(false);
      setQuizCorrect(0);
      setDescriptiveAnswer("");
      setDescriptiveAnswerSnapshot("");
      setDescriptiveSelfScore("");
      setEvaluation(null);
      setOriginTheoryId(options?.theory?.id ?? null);
      setActiveView("practice");
      writeLearningUrl({
        examType: selectedExam,
        page: "question",
        id: ordered[0].id,
      });
      trackEvent({
        eventType: options?.theory ? "related_questions_started" : "question_session_started",
        examScope: selectedExam,
        subject: options?.theory?.category ?? (category === "전체 과목" ? undefined : category),
        pagePath: options?.theory ? `/theory/${options.theory.id}` : "/practice",
      });
    } finally {
      practiceStartingRef.current = false;
      setPracticeStarting(false);
      setPendingRequestCount((count) => Math.max(0, count - 1));
    }
  }

  function toggleAnswer(index: number) {
    if (!currentQuestion || revealed || practiceGradingRef.current) return;
    const toggle = (answers: number[]) => currentQuestion.kind === "single"
      ? [index] : answers.includes(index) ? answers.filter(item => item !== index) : [...answers, index];
    // Functional updates preserve every input when React batches rapid toggles.
    setSelected(toggle);
    if (bookmarkPractice) {
      setBookmarkAnswers(previous => ({ ...previous,
        [String(currentQuestion.id)]: toggle(previous[String(currentQuestion.id)] ?? []) }));
    }
  }

  async function saveAttempt(question: Question, values: {
    answers?: number[];
    result: "correct" | "partial" | "incorrect";
    score: number;
    mode: string;
    answerText?: string;
    evaluationId?: number;
  }): Promise<AttemptSavePayload<Attempt>> {
    const isCurrent = epoch.capture();
    const clientOperationId = clientEventId();
    try {
      return await runTrackedAccountSave(async (signal) => {
        const payload = await requestStudyMutation<AttemptSavePayload<Attempt>>(
          question.examScope === "IPEP" ? "short-answer" : isObjectiveKind(question.kind) ? "attempt" : "self-assessment",
          {
            questionId: question.id,
            clientOperationId,
            selectedAnswers: values.answers ?? [],
            result: values.result,
            score: values.score,
            mode: values.mode,
            answerText: values.answerText ?? "",
            evaluationId: values.evaluationId,
            examType: selectedExam,
            feedbackAuthorization: question.feedbackAuthorization!,
          },
          signal,
        );
        applyQuestionFeedback(question.id, payload.feedback);
        if (!isAuthenticated) {
          // A bounded, non-authoritative draft, regraded by the server on sign-in.
          try {
            const guest = readGuestLearningState();
            writeGuestLearningState({ ...guest, selectedExam,
              attempts: [...guest.attempts, payload.attempt].slice(-200) });
          } catch { /* Grading must still work when browser storage is blocked. */ }
        }
        setData((previous) => ({
          ...previous,
          attempts: previous.attempts.some((item) => item.id === payload.attempt.id)
            ? previous.attempts.map((item) => item.id === payload.attempt.id ? payload.attempt : item)
            : [...previous.attempts, payload.attempt],
        }));
        if (isCurrent() && (isObjectiveKind(question.kind) || question.examScope === "IPEP")
          && payload.attempt.correct
          && !values.mode.startsWith("bookmark-modal")) {
          setQuizCorrect((count) => count + 1);
        }
        trackEvent({
          eventType: "question_answer_submitted",
          eventId: clientOperationId,
          answerResult: payload.attempt.correct ? "correct" : "incorrect",
          examScope: selectedExam,
          subject: question.category,
          questionId: question.id,
          durationMs: Date.now() - questionStartedAt.current,
          pagePath: "/practice",
        });
        return payload;
      }, { operationId: clientOperationId });
    } catch {
      if (isCurrent()) setNotice(isAuthenticated ? "풀이 기록을 저장하지 못했습니다. 상단의 다시 시도를 눌러 주세요." : "채점을 완료하지 못했습니다. 답안은 유지되니 다시 시도해 주세요.");
      throw new Error("attempt save failed");
    }
  }

  async function gradeObjective() {
    const isCurrent = epoch.capture();
    if (!currentQuestion || !selected.length || revealed || practiceGradingRef.current) return;
    practiceGradingRef.current = true;
    setPracticeGrading(true);
    try {
      const payload = await saveAttempt(currentQuestion, {
        answers: selected,
        result: "incorrect",
        score: 0,
        mode: bookmarkPractice ? "bookmark-practice" : "practice",
      });
      if (!isCurrent()) return;
      setRevealed(true);
      if (bookmarkPractice) {
        setBookmarkCompletedIds((previous) => previous.includes(currentQuestion.id)
          ? previous
          : [...previous, currentQuestion.id]);
      }
      if (!payload.attempt.correct) setNotice("");
    } catch {
      if (isCurrent()) setNotice("서버 채점을 완료하지 못했습니다. 답안은 유지되어 있으니 다시 시도해 주세요.");
    } finally {
      if (isCurrent()) {
        practiceGradingRef.current = false;
        setPracticeGrading(false);
      }
    }
  }

  async function savePracticalAnswer(question: Question, answer: string, mode: string): Promise<DescriptiveEvaluation> {
    const { createSelfEvaluation } = await import("../components/study-screen-shared");
    const payload = await saveAttempt(question, { result: "incorrect", score: 0, mode, answerText: answer });
    const guidance = createSelfEvaluation({ ...question, ...payload.feedback }, payload.attempt.score ?? 0);
    return { ...guidance, provider: "exact", result: payload.attempt.result,
      feedback: payload.attempt.correct ? "입력한 답이 허용 정답과 일치합니다." : "입력한 답이 등록된 허용 정답과 일치하지 않습니다. 정답과 입력 형식을 확인하세요.", ...payload.grading };
  }

  async function saveSelfAssessment(question: Question, answer: string, score: number, mode: string) {
    const { createSelfEvaluation } = await import("../components/study-screen-shared");
    const normalizedScore = Math.max(0, Math.min(100, Math.round(score)));
    const nextEvaluation = createSelfEvaluation(question, normalizedScore);
    await saveAttempt(question, {
      result: nextEvaluation.result,
      score: nextEvaluation.score,
      mode,
      answerText: answer,
    });
    return nextEvaluation;
  }

  async function submitDescriptive() {
    const isCurrent = epoch.capture();
    if (!currentQuestion || currentQuestion.kind !== "descriptive" || !descriptiveAnswer.trim()
      || practiceGradingRef.current) return;
    if (!revealed || descriptiveAnswer.trim() !== descriptiveAnswerSnapshot.trim()) {
      setNotice("모범답안을 보기 전에 저장한 내 답안으로만 점수를 기록할 수 있습니다.");
      return;
    }
    const score = Number(descriptiveSelfScore);
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      setNotice("평가 기준과 모범답안을 비교한 뒤 0점부터 100점 사이의 예상 점수를 직접 입력해 주세요.");
      return;
    }
    practiceGradingRef.current = true;
    setPracticeGrading(true);
    let nextEvaluation: DescriptiveEvaluation;
    try {
      nextEvaluation = await saveSelfAssessment(
        currentQuestion,
        descriptiveAnswer,
        score,
        bookmarkPractice ? "bookmark-self-assessment" : "self-assessment",
      );
    } catch {
      if (isCurrent()) setNotice("자기평가 결과를 계정에 저장하지 못했습니다. 답안은 화면에 유지됩니다.");
      return;
    } finally {
      if (isCurrent()) {
        practiceGradingRef.current = false;
        setPracticeGrading(false);
      }
    }
    if (!isCurrent()) return;
    setEvaluation(nextEvaluation);
    setRevealed(true);
    if (bookmarkPractice) {
      setBookmarkDescriptiveScores((previous) => ({
        ...previous,
        [String(currentQuestion.id)]: String(nextEvaluation.score),
      }));
      setBookmarkEvaluations((previous) => ({ ...previous, [String(currentQuestion.id)]: nextEvaluation }));
      setBookmarkCompletedIds((previous) => previous.includes(currentQuestion.id)
        ? previous
        : [...previous, currentQuestion.id]);
    }
  }

  async function revealDescriptiveAnswer() {
    const isCurrent = epoch.capture();
    if (!currentQuestion || currentQuestion.kind !== "descriptive" || !descriptiveAnswer.trim()
      || practiceGradingRef.current) return;
    practiceGradingRef.current = true;
    setPracticeGrading(true);
    try {
      if (selectedExam === "IPEP") {
        const nextEvaluation = await savePracticalAnswer(currentQuestion, descriptiveAnswer, bookmarkPractice ? "bookmark-practice" : "practice");
        if (!isCurrent()) return;
        setEvaluation(nextEvaluation);
        setDescriptiveAnswerSnapshot(descriptiveAnswer);
        setRevealed(true);
        if (bookmarkPractice) {
          setBookmarkEvaluations(previous => ({ ...previous, [String(currentQuestion.id)]: nextEvaluation }));
          setBookmarkCompletedIds(previous => previous.includes(currentQuestion.id) ? previous : [...previous, currentQuestion.id]);
        }
        return;
      }
      const feedback = await requestQuestionFeedback({
        questionId: currentQuestion.id,
        examType: selectedExam,
        answerText: descriptiveAnswer.trim(),
        feedbackAuthorization: currentQuestion.feedbackAuthorization ?? "",
      });
      if (!isCurrent()) return;
      applyQuestionFeedback(currentQuestion.id, feedback);
      setDescriptiveAnswerSnapshot(descriptiveAnswer.trim());
      setRevealed(true);
    } catch {
      if (isCurrent()) setNotice("평가 기준과 모범답안을 불러오지 못했습니다. 답안은 유지되어 있으니 다시 시도해 주세요.");
    } finally {
      if (isCurrent()) {
        practiceGradingRef.current = false;
        setPracticeGrading(false);
      }
    }
  }

  function openBookmarkQuestion(index: number, advancing = false) {
    if (!bookmarkPractice || practiceGradingRef.current || (!advancing && nextQuestionPending.current)
      || index < 0 || index >= queue.length) return;
    const questionId = queue[index];
    const nextEvaluation = bookmarkEvaluations[String(questionId)] ?? null;
    setCursor(index);
    setSelected(bookmarkAnswers[String(questionId)] ?? []);
    setDescriptiveAnswer(bookmarkDescriptiveAnswers[String(questionId)] ?? "");
    setDescriptiveAnswerSnapshot(
      bookmarkCompletedIds.includes(questionId)
        ? bookmarkDescriptiveAnswers[String(questionId)] ?? ""
        : "",
    );
    setDescriptiveSelfScore(bookmarkDescriptiveScores[String(questionId)] ?? "");
    setEvaluation(nextEvaluation);
    setRevealed(bookmarkCompletedIds.includes(questionId) || Boolean(nextEvaluation));
    writeLearningUrl({ examType: selectedExam, page: "question", id: questionId }, "replace");
  }

  async function nextQuestion() {
    if (nextQuestionPending.current || practiceGradingRef.current) return;
    nextQuestionPending.current = true;
    setPracticeAdvancing(true);
    const isCurrent = epoch.capture();
    try {
      if (bookmarkPractice && cursor + 1 < queue.length) {
        openBookmarkQuestion(cursor + 1, true);
        return;
      }
      if (cursor + 1 >= queue.length) {
        if (continuousPractice) {
          const currentId = queue[cursor];
          let replenished: number[] = [];
          try {
            const pending = prefetchedBatch.current;
            prefetchedBatch.current = null;
            const candidates = pending ? await pending : await loadPracticeBatch({ exclude: queue }, isCurrent);
            replenished = candidates.map((item) => item.id);
            if (!replenished.length && pending && isCurrent()) {
              replenished = (await loadPracticeBatch({ exclude: queue }, isCurrent)).map((item) => item.id);
            }
          } catch (error) {
            if (isCurrent() && !isExpectedRequestCancellation(error)) {
              setNotice("다음 문제를 불러오지 못했습니다. 다시 눌러 주세요.");
            }
            return;
          }
          if (!isCurrent()) return;
          const firstDifferent = replenished.findIndex((id) => id !== currentId);
          if (firstDifferent > 0) {
            [replenished[0], replenished[firstDifferent]] = [replenished[firstDifferent], replenished[0]];
          }
          if (replenished.length) {
            setQueue((previous) => [...previous, ...replenished]);
            setCursor((value) => value + 1);
            setSelected([]);
            setRevealed(false);
            setDescriptiveAnswer("");
            setDescriptiveAnswerSnapshot("");
            setDescriptiveSelfScore("");
            setEvaluation(null);
            writeLearningUrl({
              examType: selectedExam,
              page: "question",
              id: replenished[0],
            }, "replace");
            return;
          }
        }
        setQuizDone(true);
        trackEvent({
          eventType: "question_session_completed",
          examScope: selectedExam,
          subject: category === "전체 과목" ? undefined : category,
          pagePath: "/practice",
        });
        return;
      }
      const nextQuestionId = queue[cursor + 1];
      setCursor((value) => value + 1);
      setSelected([]);
      setRevealed(false);
      setDescriptiveAnswer("");
      setDescriptiveAnswerSnapshot("");
      setDescriptiveSelfScore("");
      setEvaluation(null);
      if (nextQuestionId) {
        writeLearningUrl({
          examType: selectedExam,
          page: "question",
          id: nextQuestionId,
        }, "replace");
      }
      // Fetch while two questions remain so the next batch is ready before
      // the learner reaches the end of the current queue.
      if (continuousPractice && queue.length - (cursor + 1) <= 3 && !prefetchedBatch.current) {
        prefetchedBatch.current = loadPracticeBatch({ exclude: queue }, isCurrent).catch(() => []);
      }
    } finally {
      if (isCurrent()) {
        setPracticeAdvancing(false);
        queueMicrotask(() => { if (isCurrent()) nextQuestionPending.current = false; });
      }
    }
  }

  function stopPractice() {
    epoch.invalidate();
    practiceGradingRef.current = false;
    nextQuestionPending.current = false;
    setPracticeGrading(false);
    setPracticeAdvancing(false);
    prefetchedBatch.current = null;
    trackEvent({
      eventType: "question_session_completed",
      examScope: selectedExam,
      subject: category === "전체 과목" ? undefined : category,
      pagePath: "/practice",
    });
    setQueue([]);
    setCursor(0);
    setSelected([]);
    setRevealed(false);
    setQuizDone(false);
    setQuizCorrect(0);
    setContinuousPractice(false);
    resetBookmarkPractice();
    setOriginTheoryId(null);
    writeLearningUrl({ examType: selectedExam, page: "practice" }, "replace");
  }

  async function toggleBookmark(question: Question) {
    const currentDesired = bookmarkDesired.get(question.id) ?? question.bookmarked;
    const desired = !currentDesired;
    bookmarkDesired.set(question.id, desired);
    bookmarkRequested.set(question.id, desired);
    if (!bookmarkConfirmed.has(question.id)) {
      bookmarkConfirmed.set(question.id, question.bookmarked);
    }
    setData((previous) => ({
      ...previous,
      questions: previous.questions.map((item) => item.id === question.id
        ? { ...item, bookmarked: desired }
        : item),
    }));
    if (!isAuthenticated) {
      const guest = readGuestLearningState();
      const bookmarks = desired
        ? [...new Set([...guest.bookmarks, question.id])]
        : guest.bookmarks.filter((id) => id !== question.id);
      const saved = runTrackedLocalSave(() => {
        writeGuestLearningState({ ...guest, bookmarks });
      });
      if (saved) {
        bookmarkConfirmed.set(question.id, desired);
      } else {
        const confirmed = bookmarkConfirmed.get(question.id) ?? question.bookmarked;
        bookmarkDesired.set(question.id, confirmed);
        setData((previous) => ({
          ...previous,
          questions: previous.questions.map((item) => item.id === question.id
            ? { ...item, bookmarked: confirmed }
            : item),
        }));
      }
      return;
    }
    try {
      await bookmarkSaveQueue.enqueue(question.id, {
        questionId: question.id,
        bookmarked: desired,
      });
    } catch {
      const confirmed = bookmarkConfirmed.get(question.id) ?? question.bookmarked;
      const failedDesired = bookmarkRequested.get(question.id)
        ?? desired;
      bookmarkSaveQueue.clear(question.id);
      bookmarkDesired.set(question.id, confirmed);
      setData((previous) => ({
        ...previous,
        questions: previous.questions.map((item) => item.id === question.id
          ? { ...item, bookmarked: confirmed }
          : item),
      }));
      retrySaveQueue.set(`bookmark:${question.id}`, async () => {
        bookmarkDesired.set(question.id, failedDesired);
        setData((previous) => ({
          ...previous,
          questions: previous.questions.map((item) => item.id === question.id
            ? { ...item, bookmarked: failedDesired }
            : item),
        }));
        await bookmarkSaveQueue.enqueue(question.id, {
          questionId: question.id,
          bookmarked: failedDesired,
        });
      });
      setNotice("북마크를 저장하지 못했습니다. 상단의 다시 시도를 눌러 주세요.");
    }
  }

  async function gradeBookmarkQuestion(question: Question, answers: number[]) {
    const payload = await saveAttempt(question, {
      answers,
      result: "incorrect",
      score: 0,
      mode: "bookmark-modal",
    });
    return payload.attempt.correct;
  }

  async function selfAssessBookmarkAnswer(question: Question, answer: string, score: number) {
    return question.examScope === "IPEP"
      ? savePracticalAnswer(question, answer, "bookmark-modal")
      : saveSelfAssessment(question, answer, score, "bookmark-modal-self-assessment");
  }

  const practiceBindings = {
    examType: selectedExam,
    questions: availableQuestions,
    availableCount: practiceAvailableCount,
    queue: queue,
    cursor: cursor,
    currentQuestion: currentQuestion,
    selected: selected,
    revealed: revealed,
    quizDone: quizDone,
    quizCorrect: quizCorrect,
    category: category,
    difficulty: difficulty,
    practiceKind: practiceKind,
    descriptiveAnswer: descriptiveAnswer,
    descriptiveSelfScore: descriptiveSelfScore,
    evaluation: evaluation,
    starting: practiceStarting,
    grading: practiceGrading,
    advancing: practiceAdvancing,
    originTheory: data.theories.find((item) => item.id === originTheoryId),
    onCategory: setCategory,
    onDifficulty: setDifficulty,
    onPracticeKind: setPracticeKind,
    onStart: () => startPractice(),
    onStartForm: (formId: string) => startPractice({ formId }),
    onAnswer: toggleAnswer,
    onGrade: gradeObjective,
    onDescriptiveAnswer: (value) => {
      setDescriptiveAnswer(value);
      if (bookmarkPractice && currentQuestion) {
        setBookmarkDescriptiveAnswers((previous) => ({
          ...previous,
          [String(currentQuestion.id)]: value,
        }));
      }
    },
    onDescriptiveSelfScore: (value) => {
      setDescriptiveSelfScore(value);
      if (bookmarkPractice && currentQuestion) {
        setBookmarkDescriptiveScores((previous) => ({
          ...previous,
          [String(currentQuestion.id)]: value,
        }));
      }
    },
    onSubmitDescriptive: submitDescriptive,
    onResetDescriptive: () => {
      setDescriptiveAnswer("");
      setDescriptiveAnswerSnapshot("");
      setDescriptiveSelfScore("");
      setEvaluation(null);
      setRevealed(false);
      if (bookmarkPractice && currentQuestion) {
        setBookmarkDescriptiveAnswers((previous) => {
          const next = { ...previous };
          delete next[String(currentQuestion.id)];
          return next;
        });
        setBookmarkEvaluations((previous) => {
          const next = { ...previous };
          delete next[String(currentQuestion.id)];
          return next;
        });
        setBookmarkDescriptiveScores((previous) => {
          const next = { ...previous };
          delete next[String(currentQuestion.id)];
          return next;
        });
        setBookmarkCompletedIds((previous) => previous.filter((id) => id !== currentQuestion.id));
      }
    },
    onRevealDescriptive: revealDescriptiveAnswer,
    onNext: nextQuestion,
    onStop: stopPractice,
    continuous: continuousPractice,
    bookmarkMode: bookmarkPractice,
    completedQuestionIds: bookmarkCompletedIds,
    onIndex: openBookmarkQuestion,
    onBookmark: toggleBookmark
  } satisfies Pick<import("react").ComponentProps<typeof Practice>, "examType" | "questions" | "availableCount" | "queue" | "cursor" | "currentQuestion" | "selected" | "revealed" | "quizDone" | "quizCorrect" | "category" | "difficulty" | "practiceKind" | "descriptiveAnswer" | "descriptiveSelfScore" | "evaluation" | "starting" | "grading" | "advancing" | "originTheory" | "onCategory" | "onDifficulty" | "onPracticeKind" | "onStart" | "onStartForm" | "onAnswer" | "onGrade" | "onDescriptiveAnswer" | "onDescriptiveSelfScore" | "onSubmitDescriptive" | "onResetDescriptive" | "onRevealDescriptive" | "onNext" | "onStop" | "continuous" | "bookmarkMode" | "completedQuestionIds" | "onIndex" | "onBookmark">;

  const resetPracticeSession = useCallback((resetFilters = false) => {
    epoch.invalidate();
    prefetchedBatch.current = null;
    practiceGradingRef.current = false;
    nextQuestionPending.current = false;
    setPracticeGrading(false);
    setPracticeAdvancing(false);
    setQueue([]); setCursor(0); setSelected([]); setRevealed(false);
    setQuizDone(false); setQuizCorrect(0); setContinuousPractice(false);
    resetBookmarkPractice(); setOriginTheoryId(null);
    setDescriptiveAnswer(""); setDescriptiveAnswerSnapshot("");
    setDescriptiveSelfScore(""); setEvaluation(null);
    if (resetFilters) { setCategory("전체 과목"); setPracticeKind("objective"); }
  }, [epoch, resetBookmarkPractice]);
  function restorePracticeQuestion(questionId: number) {
    resetPracticeSession();
    setQueue([questionId]);
  }
  return {
    practiceBindings, queue, cursor, currentQuestion, originTheoryId,
    startPractice, toggleBookmark, gradeBookmarkQuestion, selfAssessBookmarkAnswer,
    resetPracticeSession, restorePracticeQuestion
  };
}
