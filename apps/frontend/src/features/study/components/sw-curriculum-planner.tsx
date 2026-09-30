"use client";

import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useMemo,
  useState,
} from "react";
import { learningPath, type LearningField } from "@shared/study/learning-catalog";
import { SW_CURRICULUM_SUBJECT_GROUPS, SW_CURRICULUM_RECOMMENDATIONS } from "@shared/study/sw-curriculum-contract.mjs";
import { loginNoticePath } from "@shared/auth/login-navigation";
import {
  prefetchSwStudyData,
  requestSwStudyData,
} from "../model/sw-study-api-client";
import { requestSwStudyMutation } from "../model/study-mutation-api-client";
import { ApiRequestError } from "@frontend/shared/api/request-json";
import {
  createLatestRequestCoordinator,
  isExpectedRequestCancellation,
} from "@shared/runtime/latest-request-coordinator.mjs";
import { createLatestValueQueue } from "@shared/runtime/latest-value-queue.mjs";
import {
  mergeById,
  mergeSwQuestionFeedback,
  type SwAttemptPayload,
  type SwQuestionFeedback,
} from "../model/answer-feedback";
import { clientEventId } from "../persistence/guest-learning-store";
import {
  createSwSessionDraft,
  parseSwLearningState,
  subjectSelectionsMatch,
  type SwLearningLocation,
  type SwPersistedSession,
} from "../persistence/sw-learning-store";
import {
  preloadMarkdownRenderer,
  sameAnswers,
} from "./study-screen-shared";
import { trackEvent } from "../telemetry/study-telemetry";
import type { SwTheoryItem } from "./sw-theory-views";
import { learnerSafeErrorMessage } from "./learning-feedback";
import type { SwPlannerView } from "./study-navigation";
import type { SwQuestionItem } from "./sw-question-runners";
import useSwReadingProgress from "../model/use-sw-reading-progress";
import {
  persistSwPracticeQuestionBatch,
  swSessionSnapshot,
} from "../model/sw-session-snapshot";
import {
  requestedSwSessionQuestionIds,
  restoreSwSessionSnapshot,
} from "../model/sw-session-restore.mjs";
import SwCurriculumContent from "./sw-curriculum-content";
import useSwCurriculumState from "../model/use-sw-curriculum-state";
import useSwAccountSync from "../model/use-sw-account-sync";

export type SwNavigationRequest = { target: SwPlannerView; token: number };

export default function SwCurriculumPlanner({
  field,
  isAuthenticated,
  userKeyHash,
  onBack,
  navigationRequest,
  onViewChange,
  initialTheoryId,
  onTheoryChange,
}: {
  field: LearningField;
  isAuthenticated: boolean;
  userKeyHash: string;
  onBack: () => void;
  navigationRequest: SwNavigationRequest;
  onViewChange: (view: SwPlannerView) => void;
  initialTheoryId: number | null;
  onTheoryChange: (theoryId: number | null) => void;
}) {
  const detailedField = useMemo(() => ({
    ...field,
    subjectGroups: SW_CURRICULUM_SUBJECT_GROUPS,
    recommendedCombinations: SW_CURRICULUM_RECOMMENDATIONS,
  }), [field]);
  const {
    learningStore,
    persistedLearningState,
    selectedQuestionProfile,
    selectedSubjectIds,
    selectedSubjectIdsKey,
    selectedSubjects,
  } = useSwCurriculumState(detailedField, userKeyHash);
  const { readSwCurriculumSelection, writeSwCurriculumSelection, writeSwLearningState } = learningStore;
  const [contentView, setContentView] = useState<SwPlannerView>("curriculum");
  const [selectionHydrated, setSelectionHydrated] = useState(false);
  const [swTheorySearch, setSwTheorySearch] = useState("");
  const [swTheoryCategory, setSwTheoryCategory] = useState("전체 분류");
  const [contentLoading, setContentLoading] = useState(false);
  const [contentError, setContentError] = useState("");
  const [theoryItems, setTheoryItems] = useState<SwTheoryItem[]>([]);
  const [selectedTheory, setSelectedTheory] = useState<SwTheoryItem | null>(null);
  const [practiceQuestions, setPracticeQuestions] = useState<SwQuestionItem[]>([]);
  const [questionSessionScopeKey, setQuestionSessionScopeKey] = useState("");
  const [practiceIndex, setPracticeIndex] = useState(0);
  const [practiceAnswers, setPracticeAnswers] = useState<Record<string, number[]>>({});
  const [revealedQuestions, setRevealedQuestions] = useState<Set<string>>(new Set());
  const [practiceLoadingNext, setPracticeLoadingNext] = useState(false);
  const [mockQuestionCountInput, setMockQuestionCountInput] = useState("50");
  const mockQuestionCount = Math.min(100, Math.max(5, Number(mockQuestionCountInput) || 5));
  const [mockSubmitted, setMockSubmitted] = useState(false);
  const [mockSubmitWarning, setMockSubmitWarning] = useState(false);
  const [contentRetry, setContentRetry] = useState<(() => void) | null>(null);
  const swReadRequests = useRef(createLatestRequestCoordinator()).current;
  const swSessionIdRef = useRef("");
  const swSessionRevisionRef = useRef(0);
  const swPracticeWindowUpdatingRef = useRef(false);
  const accountSync = useSwAccountSync(selectionHydrated && isAuthenticated, userKeyHash, learningStore);
  const swFinalizingRef = useRef(false);
  const swSessionConflictRef = useRef(false);
  const swGradingRequestsRef = useRef(new Map<string, Promise<boolean | null>>());
  const previousSelectedSubjectIdsKeyRef = useRef(selectedSubjectIdsKey);
  const {
    readingProgress: swReadingProgress,
    readerRef: swReaderRef,
  } = useSwReadingProgress(selectedTheory?.id ?? null);
  const [swSubmitBusy, setSwSubmitBusy] = useState(false);
  const [swGradingQuestionIds, setSwGradingQuestionIds] = useState<Set<string>>(new Set());

  const persistQueuedSwSessionRef = useRef<(
    sessionId: string,
    session: SwPersistedSession,
  ) => Promise<void>>(async () => undefined);
  persistQueuedSwSessionRef.current = async (sessionId, session) => {
    const result = await saveSwSessionToAccount({
      ...session,
      id: sessionId,
      revision: swSessionRevisionRef.current,
    }, "sw-session-save");
    if (result.status !== "saved") {
      swSessionConflictRef.current = result.status === "conflict";
      throw new Error(result.status === "conflict" ? "SW_SESSION_CONFLICT" : "SW_SESSION_SAVE_FAILED");
    }
    swSessionConflictRef.current = false;
  };
  const swSessionSaveQueue = useRef(createLatestValueQueue(
    (sessionId: string, session: SwPersistedSession) => persistQueuedSwSessionRef.current(sessionId, session),
  )).current;
  const retryQueuedSwSession = useCallback(async (sessionId: string) => {
    if (swSessionConflictRef.current || !swSessionSaveQueue.hasPending(sessionId)) return;
    try {
      await swSessionSaveQueue.retry(sessionId);
      setContentError("");
      setContentRetry(null);
    } catch {
      setContentError("SW 학습 상태를 아직 계정에 저장하지 못했습니다. 이 브라우저의 초안은 유지됩니다.");
    }
  }, [swSessionSaveQueue]);
  function applySwQuestionFeedback(questionId: string, feedback: SwQuestionFeedback) {
    setPracticeQuestions((questions) => mergeSwQuestionFeedback(questions, questionId, feedback));
  }

  const resetChangedSwSelection = useEffectEvent(() => {
    resetSwQuestionSessionState();
    clearPersistedSwSession();
    if (contentView === "practice" || contentView === "mock") showView("curriculum");
  });

  const applySwNavigationRequest = useEffectEvent((target: SwPlannerView) => {
    if (target === "curriculum") {
      setContentError("");
      showView("curriculum");
      return;
    }
    if (target === "theories" && initialTheoryId) {
      if (selectedTheory?.id !== initialTheoryId) void openTheory(initialTheoryId);
      return;
    }
    if (!selectedSubjectIds.size) {
      setContentError("");
      showView("curriculum");
      return;
    }
    if (target === "theories") {
      if (contentView !== "theories" && contentView !== "theory") void loadTheories();
      return;
    }
    if (target === "practice") {
      if (contentView === "practice" && practiceQuestions.length > 0) return;
      if (persistedLearningState.activeSession?.mode === "practice") {
        void restoreSwSession(persistedLearningState.activeSession);
      } else {
        void startPractice();
      }
      return;
    }
    if (target === "mock") {
      if (persistedLearningState.activeSession?.mode === "mock") {
        void restoreSwSession(persistedLearningState.activeSession);
      } else {
        setContentError("복원할 진행 중 모의고사가 없습니다.");
        showView("mock-setup");
      }
      return;
    }
    if (contentView === "mock-setup") return;
    setSelectedTheory(null);
    setContentError("");
    showView("mock-setup");
  });

  const recoverEmptySwSelection = useEffectEvent(() => {
    setSelectedTheory(null);
    resetSwQuestionSessionState();
    clearPersistedSwSession();
    setContentError("학습 범위가 비어 있어 범위 선택 화면으로 돌아왔습니다.");
    showView("curriculum");
  });

  useEffect(() => {
    const timer = window.setTimeout(() => setSelectionHydrated(true), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => () => {
    swReadRequests.cancelAll("unmount");
  }, [swReadRequests]);

  useEffect(() => {
    if (!selectionHydrated) {
      previousSelectedSubjectIdsKeyRef.current = selectedSubjectIdsKey;
      return;
    }
    if (previousSelectedSubjectIdsKeyRef.current === selectedSubjectIdsKey) return;
    previousSelectedSubjectIdsKeyRef.current = selectedSubjectIdsKey;
    const timer = window.setTimeout(resetChangedSwSelection, 0);
    return () => window.clearTimeout(timer);
  }, [selectedSubjectIdsKey, selectionHydrated]);

  useEffect(() => {
    if (!selectionHydrated || !selectedSubjectIdsKey || contentView !== "curriculum") return;
    const timer = window.setTimeout(() => {
      void preloadMarkdownRenderer();
      prefetchSwStudyData({
        expectedUserKey: userKeyHash,
        view: "theories",
        params: { subjects: selectedSubjectIdsKey },
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [
    contentView,
    selectedSubjectIdsKey,
    selectionHydrated,
    userKeyHash,
  ]);

  function showView(next: SwPlannerView) {
    if (!isAuthenticated && ["practice", "mock", "mock-setup"].includes(next)) {
      window.location.assign(loginNoticePath(learningPath({ fieldId: field.id, page: "field", section: next === "practice" ? "practice" : "mock-exams" })));
      return;
    }
    setContentView(next);
    onViewChange(next);
  }

  function rememberSwLocation(location: Omit<SwLearningLocation, "updatedAt">) {
    writeSwLearningState((current) => ({
      ...current,
      version: 4,
      lastLocation: { ...location, updatedAt: new Date().toISOString() },
    }));
  }

  function clearPersistedSwSession() {
    writeSwLearningState((current) => {
      const next = { ...current };
      delete next.activeSession;
      return { ...next, version: 4 };
    });
  }

  function resetSwQuestionSessionState() {
    swReadRequests.cancelAll("session-reset");
    setContentLoading(false);
    setPracticeQuestions([]);
    setQuestionSessionScopeKey("");
    setPracticeIndex(0);
    setPracticeAnswers({});
    setRevealedQuestions(new Set());
    setPracticeLoadingNext(false);
    setMockSubmitted(false);
    setMockSubmitWarning(false);
    setSwSubmitBusy(false);
    setSwGradingQuestionIds(new Set());
    setContentRetry(null);
  }

  async function changeSwCurriculumSelection(subjectIds: Set<string>) {
    if (swFinalizingRef.current) return;
    const activeSession = persistedLearningState.activeSession;
    const hasProgress = Boolean(activeSession
      && (Object.keys(activeSession.answers).length || activeSession.revealedQuestionIds.length));
    if (hasProgress && !window.confirm("진행 중인 문제 풀이가 있습니다. 현재 세션을 종료하고 학습 범위를 변경할까요?")) {
      return;
    }
    if (activeSession && !await finalizeSwSession(activeSession)) return;
    resetSwQuestionSessionState();
    writeSwCurriculumSelection(subjectIds);
    clearPersistedSwSession();
  }

  async function restoreSwSession(session: SwPersistedSession) {
    if (!session.questionIds.length) return false;
    if (!subjectSelectionsMatch(session.subjectIds, [...selectedSubjectIds])) {
      setContentError("저장된 문제 풀이는 다른 학습 범위의 초안입니다. 해당 범위로 돌아간 뒤 다시 열어 주세요.");
      return false;
    }
    const request = swReadRequests.begin("questions");
    setContentLoading(true);
    setContentError("");
    setContentRetry(null);
    try {
      const requestedSessionIds = requestedSwSessionQuestionIds(session.questionIds);
      const payload = await requestSwStudyData<{ questions?: SwQuestionItem[] }>({
        expectedUserKey: userKeyHash,
        view: "session",
        params: {
          ids: requestedSessionIds.join(","),
          subjects: session.subjectIds.join(","),
          theoryId: session.theoryId,
          mode: session.mode, sessionId: session.id,
          profile: selectedQuestionProfile?.id,
        },
        signal: request.signal,
      });
      if (!request.isCurrent()) return false;
      if (!payload.questions) throw new Error("저장된 학습 문제를 복원하지 못했습니다.");
      const restored = restoreSwSessionSnapshot({
        session,
        questions: payload.questions,
        requestedQuestionIds: requestedSessionIds,
        requiredTag: selectedQuestionProfile?.requiredTag,
      });
      if (!restored.questions.length) {
        setContentError("저장된 문제를 현재 콘텐츠에서 찾지 못했습니다. 기존 답안은 삭제하지 않았습니다.");
        return false;
      }
      if (!restored.scopeIsComplete) {
        setContentError(`콘텐츠 변경으로 ${restored.omittedQuestionCount}문항을 제외하고 남은 답안을 복원했습니다.`);
      }
      setPracticeQuestions(restored.questions);
      setQuestionSessionScopeKey([...session.subjectIds].sort().join(","));
      setPracticeAnswers(restored.answers);
      setRevealedQuestions(new Set(restored.revealedQuestionIds));
      setPracticeIndex(restored.currentIndex);
      setMockSubmitted(session.mockSubmitted);
      swSessionIdRef.current = session.id;
      swSessionRevisionRef.current = session.revision;
      setMockSubmitWarning(false);
      setSelectedTheory(null);
      showView(session.mode === "mock" ? "mock" : "practice");
      window.scrollTo({ top: 0, behavior: "auto" });
      return true;
    } catch (error) {
      if (!request.isCurrent() || isExpectedRequestCancellation(error)) return false;
      setContentError(learnerSafeErrorMessage(error, "저장된 학습 문제를 복원하지 못했습니다."));
      setContentRetry(() => () => {
        void restoreSwSession(session);
      });
      return false;
    } finally {
      if (request.isCurrent()) setContentLoading(false);
      request.finish();
    }
  }

  function selectedSubjectQuery() { return selectedSubjectIdsKey; }

  async function loadTheories() {
    window.location.assign(learningPath({ fieldId: field.id, page: "field", section: "theories" }));
  }

  async function openTheory(theoryId: number) {
    const request = swReadRequests.begin("content");
    setContentLoading(true);
    setContentError("");
    setContentRetry(null);
    try {
      void preloadMarkdownRenderer();
      const payload = await requestSwStudyData<{ theory?: SwTheoryItem }>({
        expectedUserKey: userKeyHash,
        view: "theory",
        params: { id: theoryId },
        cacheMode: "reuse",
        signal: request.signal,
      });
      if (!request.isCurrent()) return;
      if (!payload.theory) throw new Error("이론을 불러오지 못했습니다.");
      setSelectedTheory(payload.theory);
      if (!theoryItems.length && selectedSubjectIds.size) {
        const listRequest = swReadRequests.begin("theory-list");
        void requestSwStudyData<{ theories?: SwTheoryItem[] }>({
          expectedUserKey: userKeyHash,
          view: "theories",
          params: { subjects: selectedSubjectQuery() },
          cacheMode: "reuse",
          signal: listRequest.signal,
        }).then((listPayload) => {
            if (listRequest.isCurrent() && listPayload.theories) setTheoryItems(listPayload.theories);
          })
          .catch(() => undefined)
          .finally(() => listRequest.finish());
      }
      showView("theory");
      onTheoryChange(payload.theory.id);
      trackEvent({
        eventType: "theory_viewed",
        examScope: "SW",
        subject: payload.theory.category,
        pagePath: `/sw/theory/${payload.theory.id}`,
      });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      if (!request.isCurrent() || isExpectedRequestCancellation(error)) return;
      setContentError(learnerSafeErrorMessage(error, "이론을 불러오지 못했습니다."));
      setContentRetry(() => () => {
        void openTheory(theoryId);
      });
    } finally {
      if (request.isCurrent()) setContentLoading(false);
      request.finish();
    }
  }

  async function startPractice(
    theoryId?: number,
    limit = 20,
    destination: "practice" | "mock" = "practice",
  ) {
    if (!isAuthenticated) {
      window.location.assign(loginNoticePath(learningPath({ fieldId: field.id, page: "field", section: destination === "mock" ? "mock-exams" : "practice" })));
      return;
    }
    if (!theoryId && !selectedSubjectIds.size) {
      showView("curriculum");
      setContentError("");
      return;
    }
    const request = swReadRequests.begin("questions");
    const sid = `sw_${clientEventId()}`;
    setContentLoading(true);
    setContentError("");
    setContentRetry(null);
    try {
      const payload = await requestSwStudyData<{ questions?: SwQuestionItem[] }>({
        expectedUserKey: userKeyHash,
        view: "practice",
        params: {
          exclude: !theoryId && destination === "practice"
            ? (persistedLearningState.recentPracticeQuestionIds ?? []).join(",")
            : undefined,
          limit,
          mode: destination === "mock" ? "mock" : "practice", sessionId: sid,
          subjects: selectedSubjectQuery(),
          theoryId,
          profile: selectedQuestionProfile?.id,
        },
        cacheMode: "none",
        signal: request.signal,
      });
      if (!request.isCurrent()) return;
      if (!payload.questions) throw new Error("문제를 구성하지 못했습니다.");
      const mode = destination === "mock" ? "mock" : "practice";
      swSessionIdRef.current = sid;
      swSessionRevisionRef.current = 0;
      {
        const initial = createSwSessionDraft(sid, mode, [...selectedSubjectIds],
          payload.questions.map((question) => question.id), theoryId);
        const saved = await saveSwSessionToAccount(initial, "sw-session-save");
        if (saved.status !== "saved") return;
        payload.questions = saved.questions;
      }
      setPracticeQuestions(payload.questions);
      setQuestionSessionScopeKey(selectedSubjectIdsKey);
      setPracticeIndex(0);
      setPracticeAnswers({});
      setRevealedQuestions(new Set());
      setPracticeLoadingNext(false);
      setMockSubmitted(false);
      setMockSubmitWarning(false);
      if (!theoryId) setSelectedTheory(null);
      showView(destination);
      rememberSwLocation({
        view: destination === "mock" ? "mock" : "practice",
        title: destination === "mock" ? "선택 범위 모의고사" : selectedTheory?.title ?? "선택 범위 문제 풀이",
        detail: destination === "mock"
          ? `${payload.questions.length}문항 모의고사 진행 중`
          : theoryId
            ? "연결 문제를 이어서 풉니다."
            : `${selectedSubjects.length}개 소주제 연속 학습`,
        theoryId,
      });
      trackEvent({
        eventType: destination === "mock"
          ? "mock_exam_started"
          : theoryId
            ? "related_questions_started"
            : "question_session_started",
        examScope: "SW",
        subject: theoryId ? selectedTheory?.category : undefined,
        pagePath: theoryId
          ? learningPath({ fieldId: field.id, page: "field", section: "theories", theoryId })
          : learningPath({
            fieldId: field.id,
            page: "field",
            section: destination === "mock" ? "mock-exams" : "practice",
          }),
      });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      if (!request.isCurrent() || isExpectedRequestCancellation(error)) return;
      setContentError(learnerSafeErrorMessage(error, "문제를 구성하지 못했습니다."));
      setContentRetry(() => () => {
        void startPractice(theoryId, limit, destination);
      });
    } finally {
      if (request.isCurrent()) setContentLoading(false);
      request.finish();
    }
  }

  function swAnswerIsCorrect(question: SwQuestionItem) {
    return sameAnswers(practiceAnswers[question.id] ?? [], question.correctAnswers);
  }

  function toggleSwAnswer(question: SwQuestionItem, index: number) {
    setPracticeAnswers((previous) => {
      const selected = previous[question.id] ?? [];
      const next = question.kind === "multiple"
        ? selected.includes(index)
          ? selected.filter((answer) => answer !== index)
          : [...selected, index].sort((first, second) => first - second)
        : [index];
      return { ...previous, [question.id]: next };
    });
  }

  async function trackSwAnswer(question: SwQuestionItem) {
    const requestKey = `${contentView}:${question.id}:${JSON.stringify(practiceAnswers[question.id] ?? [])}`;
    const existing = swGradingRequestsRef.current.get(requestKey);
    if (existing) return existing;
    const clientOperationId = clientEventId();
    const request = (async () => {
      try {
        const payload = await requestSwStudyMutation<SwAttemptPayload>(
          "sw-attempt",
          {
            questionId: question.id,
            selectedAnswers: practiceAnswers[question.id] ?? [],
            mode: "practice", sessionId: swSessionIdRef.current, clientOperationId,
            feedbackAuthorization: question.feedbackAuthorization ?? "",
          },
          undefined,
          userKeyHash,
        );
        applySwQuestionFeedback(question.id, payload.feedback);
        trackEvent({
          eventType: "question_answer_submitted",
          eventId: clientOperationId,
          examScope: "SW",
          subject: question.category,
          contentId: question.id,
          answerResult: payload.attempt.correct ? "correct" : "incorrect",
          pagePath: `/sw/question/${question.id}`,
        });
        return payload.attempt.correct;
      } catch {
        setContentError("서버 채점을 완료하지 못했습니다. 답안은 유지되어 있으니 다시 시도해 주세요.");
        return null;
      }
    })();
    swGradingRequestsRef.current.set(requestKey, request);
    setSwGradingQuestionIds((current) => new Set(current).add(question.id));
    try {
      return await request;
    } finally {
      if (swGradingRequestsRef.current.get(requestKey) === request) {
        swGradingRequestsRef.current.delete(requestKey);
      }
      setSwGradingQuestionIds((current) => {
        const next = new Set(current);
        next.delete(question.id);
        return next;
      });
    }
  }

  async function revealPracticeAnswer(question: SwQuestionItem) {
    const graded = await trackSwAnswer(question);
    if (graded === null) return;
    setRevealedQuestions((previous) => new Set(previous).add(question.id));
  }

  async function nextSwPracticeQuestion() {
    const current = practiceQuestions[practiceIndex];
    if (!current || !revealedQuestions.has(current.id) || practiceLoadingNext || swPracticeWindowUpdatingRef.current) return;
    setContentError("");
    setContentRetry(null);
    if (practiceIndex < practiceQuestions.length - 1) {
      setPracticeIndex((value) => value + 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    swPracticeWindowUpdatingRef.current = true;
    setPracticeLoadingNext(true);
    const request = swReadRequests.begin("questions");
    try {
      const excludedIds = practiceQuestions.slice(-100).map((question) => question.id).join(",");
      const payload = await requestSwStudyData<{ questions?: SwQuestionItem[] }>({
        expectedUserKey: userKeyHash,
        view: "practice",
        params: {
          exclude: excludedIds,
          limit: 20,
          mode: "practice", sessionId: swSessionIdRef.current,
          subjects: selectedSubjectQuery(),
          theoryId: selectedTheory?.id,
          profile: selectedQuestionProfile?.id,
        },
        signal: request.signal,
      });
      if (!request.isCurrent()) return;
      if (!payload.questions) throw new Error("다음 문제를 불러오지 못했습니다.");
      const existingIds = new Set(practiceQuestions.map((question) => question.id));
      const nextQuestions = payload.questions.filter((question) => !existingIds.has(question.id));
      if (!nextQuestions.length) {
        setContentError("선택한 학습 범위의 모든 문제를 확인했습니다.");
        setContentRetry(null);
        return;
      }
      {
        if (swSessionConflictRef.current) throw new Error("최신 학습 상태를 확인하려면 새로고침해 주세요.");
        await swSessionSaveQueue.retry(swSessionIdRef.current);
        if (!request.isCurrent()) return;
      }
      const combinedQuestions = await persistSwPracticeQuestionBatch({
          current: practiceQuestions,
          next: nextQuestions,
          id: swSessionIdRef.current,
          revision: swSessionRevisionRef.current,
          subjectIds: questionSessionScopeKey.split(",").filter(Boolean),
          theoryId: selectedTheory?.id,
          answers: practiceAnswers,
          revealedQuestionIds: [...revealedQuestions],
          currentIndex: practiceQuestions.length,
          save: (session, action) => saveSwSessionToAccount(session, action, {
            updateQuestions: false, isCurrent: request.isCurrent,
          }),
        });
      if (!combinedQuestions || !request.isCurrent()) return;
      const retainedIds = new Set(combinedQuestions.map((question) => question.id));
      setPracticeQuestions(combinedQuestions);
      setPracticeAnswers((answers) => Object.fromEntries(Object.entries(answers).filter(([id]) => retainedIds.has(id))));
      setRevealedQuestions((ids) => new Set([...ids].filter((id) => retainedIds.has(id))));
      setPracticeIndex(combinedQuestions.findIndex((question) => question.id === nextQuestions[0].id));
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      if (!request.isCurrent() || isExpectedRequestCancellation(error)) return;
      setContentError(learnerSafeErrorMessage(error, "다음 문제를 불러오지 못했습니다."));
      setContentRetry(() => () => {
        void nextSwPracticeQuestion();
      });
    } finally {
      swPracticeWindowUpdatingRef.current = false;
      if (request.isCurrent()) setPracticeLoadingNext(false);
      request.finish();
    }
  }

  async function saveSwSessionToAccount(
    session: SwPersistedSession,
    action: "sw-session-save" | "sw-session-submit",
    options?: { updateQuestions: boolean; isCurrent: () => boolean },
  ) {
    try {
      const payload = await requestSwStudyMutation<{
        session: SwPersistedSession;
        questions?: SwQuestionItem[];
      }>(
        action,
        {
          sessionId: session.id,
          revision: Math.max(
            session.revision,
            session.id === swSessionIdRef.current ? swSessionRevisionRef.current : 0,
          ),
          mode: session.mode,
          subjectIds: session.subjectIds,
          theoryId: session.theoryId,
          questionIds: session.questionIds,
          answers: session.answers,
          revealedQuestionIds: session.revealedQuestionIds,
          currentIndex: session.currentIndex,
        },
        undefined,
        userKeyHash,
      );
      if (options && !options.isCurrent()) return { status: "failed" as const, session: null };
      if (options && (!payload.session || payload.session.id !== session.id
        || payload.session.currentIndex !== session.currentIndex
        || JSON.stringify(payload.session.questionIds) !== JSON.stringify(session.questionIds))) {
        throw new Error("저장된 학습 범위가 일치하지 않습니다. 새로고침 후 다시 시도해 주세요.");
      }
      if (payload.session) {
        swSessionIdRef.current = payload.session.id;
        swSessionRevisionRef.current = Number(payload.session.revision) || 0;
        writeSwLearningState((current) => {
          const activeSession = current.activeSession;
          if (!activeSession || activeSession.id !== payload.session.id) return current;
          return {
            ...current,
            version: 4,
            activeSession: {
              ...activeSession,
              revision: swSessionRevisionRef.current,
              updatedAt: payload.session.updatedAt ?? activeSession.updatedAt,
            },
          };
        });
      }
      if (options?.updateQuestions !== false && Array.isArray(payload.questions)) {
        setPracticeQuestions((current) => mergeById(current, payload.questions as SwQuestionItem[]));
      }
      return payload.session
        ? { status: "saved" as const, session: payload.session, questions: payload.questions ?? [] }
        : { status: "failed" as const, session: null };
    } catch (error) {
      if (options && !options.isCurrent()) return { status: "failed" as const, session: null };
      const failure = error instanceof ApiRequestError ? error.payload : undefined;
      if (failure?.code === "SW_SESSION_CONFLICT" && failure.session) {
        setContentError("다른 탭이나 기기의 최신 SW 학습 상태가 있습니다. 새로고침 후 이어서 진행해 주세요.");
        return { status: "conflict" as const, session: null };
      }
      setContentError(learnerSafeErrorMessage(error, "SW 학습 상태를 계정에 저장하지 못했습니다. 이 브라우저의 초안은 유지됩니다."));
      return { status: "failed" as const, session: null };
    }
  }

  const queueSwSessionSnapshot = useCallback(async (session: SwPersistedSession) => {
    try {
      await swSessionSaveQueue.enqueue(session.id, session);
      return true;
    } catch {
      if (!swSessionConflictRef.current) {
        setContentRetry(() => () => {
          void retryQueuedSwSession(session.id);
        });
      }
      return false;
    }
  }, [retryQueuedSwSession, swSessionSaveQueue]);

  async function finalizeSwSession(session: SwPersistedSession) {
    if (swFinalizingRef.current) return false;
    swFinalizingRef.current = true;
    setSwSubmitBusy(true);
    try {
      if (!await queueSwSessionSnapshot(session)) return false;
      const result = await saveSwSessionToAccount({
        ...session,
        revision: swSessionRevisionRef.current,
      }, "sw-session-submit");
      return result.status === "saved";
    } finally {
      swFinalizingRef.current = false;
      setSwSubmitBusy(false);
    }
  }

  async function stopSwPractice() {
    if (swFinalizingRef.current) return;
    if (Object.keys(practiceAnswers).length > 0
      && !window.confirm("현재 문제 풀이를 마치고 저장된 진행 상태를 종료할까요?")) return;
    const activeSession = persistedLearningState.activeSession;
    if (activeSession && !await finalizeSwSession(activeSession)) return;
    setContentError("");
    resetSwQuestionSessionState();
    clearPersistedSwSession();
    showView(selectedTheory ? "theory" : "curriculum");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submitMockExam() {
    if (swFinalizingRef.current) return;
    swFinalizingRef.current = true;
    setSwSubmitBusy(true);
    const activeSession: SwPersistedSession = {
      id: swSessionIdRef.current || `sw_${clientEventId()}`,
      revision: swSessionRevisionRef.current,
      mode: "mock",
      subjectIds: questionSessionScopeKey.split(","),
      theoryId: selectedTheory?.id,
      questionIds: practiceQuestions.map((question) => question.id),
      answers: practiceAnswers,
      revealedQuestionIds: [...revealedQuestions],
      currentIndex: practiceIndex,
      mockSubmitted: false,
      updatedAt: new Date().toISOString(),
    };
    try {
      setMockSubmitWarning(false);
      if (!await queueSwSessionSnapshot(activeSession)) return;
      const saved = await saveSwSessionToAccount({
        ...activeSession,
        revision: swSessionRevisionRef.current,
      }, "sw-session-submit");
      if (saved.status !== "saved") return;
      setMockSubmitted(true);
      trackEvent({
        eventType: "mock_exam_completed",
        examScope: "SW",
        pagePath: learningPath({ fieldId: field.id, page: "field", section: "mock-exams" }),
      });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      swFinalizingRef.current = false;
      setSwSubmitBusy(false);
    }
  }

  function requestMockSubmit() {
    if (swFinalizingRef.current) return;
    const unanswered = practiceQuestions.filter((question) => (
      !practiceAnswers[question.id]?.length
    )).length;
    if (unanswered > 0) {
      setMockSubmitWarning(true);
      return;
    }
    void submitMockExam();
  }

  useEffect(() => {
    if (
      (contentView !== "practice" && contentView !== "mock")
      || practiceLoadingNext
      || !practiceQuestions.length
      || !questionSessionScopeKey
      || questionSessionScopeKey !== selectedSubjectIdsKey
    ) return;
    const updatedAt = new Date().toISOString();
    const revealedCount = practiceQuestions.filter((question) => revealedQuestions.has(question.id)).length;
    const answeredCount = practiceQuestions.filter((question) => Boolean(practiceAnswers[question.id]?.length)).length;
    const session = mockSubmitted ? null : swSessionSnapshot({
      id: swSessionIdRef.current || `sw_${clientEventId()}`,
      revision: swSessionRevisionRef.current,
      mode: contentView,
      subjectIds: questionSessionScopeKey.split(","),
      theoryId: selectedTheory?.id,
      questionIds: practiceQuestions.map((question) => question.id),
      answers: practiceAnswers,
      revealedQuestionIds: [...revealedQuestions],
      currentIndex: practiceIndex,
      updatedAt,
    });
    writeSwLearningState((current) => {
      const next: ReturnType<typeof parseSwLearningState> = {
        ...current,
        version: 4,
        recentPracticeQuestionIds: [...new Set([
          ...(current.recentPracticeQuestionIds ?? []),
          ...practiceQuestions.map((question) => question.id),
        ])].slice(-100),
        lastLocation: {
          view: contentView,
          title: contentView === "mock" ? "선택 범위 모의고사" : selectedTheory?.title ?? "선택 범위 문제 풀이",
          detail: contentView === "mock"
            ? `${practiceQuestions.length}문항 중 ${answeredCount}문항 응답`
            : `${revealedCount}문항 풀이 완료`,
          theoryId: selectedTheory?.id,
          updatedAt,
        },
      };
      if (session) next.activeSession = session;
      else delete next.activeSession;
      return next;
    });
    if (session) {
      swSessionIdRef.current = session.id;
      const timer = window.setTimeout(() => {
        if (!swPracticeWindowUpdatingRef.current) void queueSwSessionSnapshot(session);
      }, 800);
      return () => window.clearTimeout(timer);
    }
  }, [
    contentView,
    mockSubmitted,
    practiceAnswers,
    practiceIndex,
    practiceQuestions,
    practiceLoadingNext,
    questionSessionScopeKey,
    revealedQuestions,
    selectedSubjectIdsKey,
    selectedTheory,
    isAuthenticated,
    queueSwSessionSnapshot,
    writeSwLearningState,
  ]);

  useEffect(() => {
    const retryWhenOnline = () => {
      const sessionId = parseSwLearningState(readSwCurriculumSelection()).activeSession?.id;
      if (sessionId) void retryQueuedSwSession(sessionId);
    };
    window.addEventListener("online", retryWhenOnline);
    return () => window.removeEventListener("online", retryWhenOnline);
  }, [isAuthenticated, retryQueuedSwSession, readSwCurriculumSelection]);

  useEffect(() => {
    if (contentView !== "mock" || mockSubmitted) return;
    const hasAnswers = practiceQuestions.some((question) => Boolean(practiceAnswers[question.id]?.length));
    if (!hasAnswers) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [contentView, mockSubmitted, practiceAnswers, practiceQuestions]);

  useEffect(() => {
    if (!selectionHydrated) return;
    swReadRequests.cancelAll("navigation");
    const target = navigationRequest.target;
    const timer = window.setTimeout(() => {
      setContentLoading(false);
      applySwNavigationRequest(target);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [navigationRequest.target, navigationRequest.token, selectionHydrated, swReadRequests]);

  useEffect(() => {
    if (selectedSubjectIds.size || contentView === "curriculum") return;
    const timer = window.setTimeout(recoverEmptySwSelection, 0);
    return () => window.clearTimeout(timer);
  }, [selectedSubjectIds.size, contentView]);

  return (
    <>
      {accountSync.error && (
        <div className="inline-learning-error" role="alert">
          <p>{accountSync.error}</p>
          <button className="outline-button" type="button" disabled={accountSync.busy} onClick={accountSync.retry}>
            {accountSync.busy ? "동기화 중…" : "다시 동기화"}
          </button>
        </div>
      )}
      <SwCurriculumContent
        field={detailedField}
        contentView={contentView}
        contentLoading={contentLoading}
        contentError={contentError}
        contentRetry={contentRetry}
        theoryItems={theoryItems}
        selectedTheory={selectedTheory}
        theoryCategory={swTheoryCategory}
        onTheoryCategoryChange={setSwTheoryCategory}
        theorySearch={swTheorySearch}
        onTheorySearchChange={setSwTheorySearch}
        selectedSubjects={selectedSubjects}
        readingProgress={swReadingProgress}
        readerRef={swReaderRef}
        practiceQuestions={practiceQuestions}
        practiceIndex={practiceIndex}
        practiceAnswers={practiceAnswers}
        revealedQuestions={revealedQuestions}
        practiceLoadingNext={practiceLoadingNext}
        questionCount={mockQuestionCount}
        questionCountInput={mockQuestionCountInput}
        activeSession={persistedLearningState.activeSession}
        mockSubmitted={mockSubmitted}
        mockSubmitWarning={mockSubmitWarning}
        selectionHydrated={selectionHydrated}
        selectedSubjectIds={selectedSubjectIds}
        questionProfileSelectionMessage={selectedQuestionProfile?.selectionMessage ?? ""}
        busy={swSubmitBusy}
        grading={Boolean(practiceQuestions[practiceIndex]
          && swGradingQuestionIds.has(practiceQuestions[practiceIndex].id))}
        answerIsCorrect={swAnswerIsCorrect}
        onBackToFields={onBack}
        onShowCurriculum={() => showView("curriculum")}
        onShowMockSetup={() => showView("mock-setup")}
        onBackToTheories={() => {
          showView("theories");
          onTheoryChange(null);
        }}
        onOpenTheory={(theoryId) => void openTheory(theoryId)}
        onStartPractice={(theoryId) => void startPractice(theoryId)}
        onRestoreSession={(session) => void restoreSwSession(session)}
        onQuestionCountInput={setMockQuestionCountInput}
        onStartMock={() => void startPractice(undefined, mockQuestionCount, "mock")}
        onPracticeIndex={setPracticeIndex}
        onToggleAnswer={toggleSwAnswer}
        onMockSubmitWarning={setMockSubmitWarning}
        onRequestMockSubmit={requestMockSubmit}
        onSubmitMock={submitMockExam}
        onStopPractice={stopSwPractice}
        onRevealPractice={revealPracticeAnswer}
        onNextPractice={() => void nextSwPracticeQuestion()}
        onSelectionChange={changeSwCurriculumSelection}
      />
    </>
  );
}
