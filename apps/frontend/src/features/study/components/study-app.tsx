"use client";
import { learningPath } from "@shared/study/learning-catalog";
import { isPublicLearningRoute } from "@shared/study/learning-route-access";
import { loginNoticePath } from "@shared/auth/login-navigation";

import RetryBoundary from "@frontend/features/errors/retry-boundary";
import { ApiRequestError } from "@frontend/shared/api/request-json";
import {
  createLatestRequestCoordinator,
  isExpectedRequestCancellation,
} from "@shared/runtime/latest-request-coordinator.mjs";
import {
  LEARNING_CATALOG,
  learningFieldForCourse,
  parseLearningPath,
  type LearningRoute,
} from "@shared/study/learning-catalog";
import {
  courseContentRelease,
  examScopeAllows,
  isReleasedExamType,
  questionAllowedForExam,
  type ExamType
} from "@shared/study/study-domain";
import { Suspense, useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import {
mergeById
} from "../model/answer-feedback";
import {
  requestStudyData,
  type StudyScope,
} from "../model/study-api-client";
import { requestStudyMutation } from "../model/study-mutation-api-client";
import useSqlLearningMutationQueues from "../model/use-sql-learning-mutation-queues";
import useStudyNavigationState from "../model/use-study-navigation-state";
import useStudyRuntimeEvents from "../model/use-study-runtime-events";
import useStudySaveOperations from "../model/use-study-save-operations";
import {
  readGuestLearningState,
writeGuestLearningState
} from "../persistence/guest-learning-store";
import {
  EMPTY_SW_LEARNING_STATE,
  createSwLearningStore,
} from "../persistence/sw-learning-store";
import {
  currentHiddenQuestionRoute,
  useLearningRouter,
} from "../routing/use-learning-router";
import { trackEvent } from "../telemetry/study-telemetry";
import {
  LearningLoadError,
  LearningLoadingState,
  type SaveStatusValue,
} from "./learning-feedback";
import {
  StudyMobileNavigation,
  StudyTransientFeedback,
  type StudyReportRequest,
} from "./study-app-chrome";
import { EMPTY_DATA, courseViewAvailable } from "./study-app-config";
import { studyAppViewState } from "./study-app-view-state";
import StudyHeader from "./study-header";
import { Dashboard, LearningFieldHome, ExamRunner, LearningRecordsHub, MockExamHome, Practice, TheoryView } from "./study-lazy-screens";
import {
  examForLearningRoute,
  fieldSectionForSwView,
  routeForView,
  swViewForFieldSection,
  viewForLearningRoute,
  type SwNavView,
  type SwPlannerView
} from "./study-navigation";
import type { StudyData, View } from "./study-screen-shared";
import { calcStreak, compareTheories, gradedPracticeAttempts, scopeQuestions } from "../model/study-data-utils";
import StudySidebar from "./study-sidebar";

import useGuestLearningSync from "../model/use-guest-learning-sync";
import useMockExamSession from "../model/use-mock-exam-session";
import usePracticeSession from "../model/use-practice-session";
import useTheoryLearning from "../model/use-theory-learning";

export default function StudyApp({
  displayName,
  userKeyHash,
  signInPath,
  signOutPath,
  isAuthenticated,
  adminAccess,
  groupExamAccess,
  initialPath,
  initialData,
  initialScope,
  rootCatalog,
}: {
  displayName: string;
  userKeyHash: string;
  signInPath: string;
  signOutPath: string;
  isAuthenticated: boolean;
  adminAccess: boolean;
  groupExamAccess: boolean;
  initialPath: string;
  initialData: StudyData | null;
  initialScope: StudyScope | null;
  rootCatalog?: ReactNode;
}) {
  const {
    pathname,
    poppedRoute,
    pushLearningRoot,
    writeLearningUrl,
  } = useLearningRouter();
  const {
    initialLearningRoute,
    initialLearningLevel,
    activeView,
    setActiveView,
    learningLevel,
    setLearningLevel,
    selectedFieldId,
    setSelectedFieldId,
    swActiveView,
    setSwActiveView,
    swSelectedTheoryId,
    setSwSelectedTheoryId,
    swNavigationRequest,
    setSwNavigationRequest,
    selectedExam,
    setSelectedExam,
  } = useStudyNavigationState(initialPath);
  const swLearningStore = useMemo(() => createSwLearningStore(userKeyHash), [userKeyHash]);
  const serializedSwCurriculumSelection = useSyncExternalStore(
    swLearningStore.subscribeSwCurriculumSelection,
    swLearningStore.readSwCurriculumSelection,
    () => EMPTY_SW_LEARNING_STATE,
  );
  const [data, setData] = useState<StudyData>(initialData ?? EMPTY_DATA);
  const [loading, setLoading] = useState(
    initialLearningLevel === "course"
      && initialLearningRoute?.page !== "home"
      && !initialData,
  );
  const [pendingRequestCount, setPendingRequestCount] = useState(0);
  const contentPending = pendingRequestCount > 0;
  const [recordsLoadingMore, setRecordsLoadingMore] = useState<"attempts" | "bookmarks" | null>(null);
  const [studyDataLoaded, setStudyDataLoaded] = useState(
    initialScope === "overview" || initialScope === "bootstrap",
  );
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const noticeIsError = /실패|못했습니다|사용할 수 없습니다|오류|제한|초과/u.test(notice);
  const [saveStatus, setSaveStatus] = useState<SaveStatusValue>(
    isAuthenticated ? "account-saved" : "local-saved",
  );

  useStudyRuntimeEvents(setNotice, setSaveStatus);
  const [reportRequest, setReportRequest] = useState<StudyReportRequest | null>(null);
  const initialRouteRestored = useRef(false);
  const restoreLearningRouteRef = useRef<(route: LearningRoute) => void>(() => undefined);
  const studyRequestCoordinator = useRef(createLatestRequestCoordinator()).current;
  const {
    retrySaveQueue,
    selectedExamSaveQueue,
    bookmarkSaveQueue,
    bookmarkDesired,
    bookmarkConfirmed,
    bookmarkRequested,
  } = useSqlLearningMutationQueues({ setSaveStatus });
  const {
    retrySave,
    runTrackedAccountSave,
    runTrackedLocalSave,
  } = useStudySaveOperations({ retrySaveQueue, setSaveStatus });

  const availableQuestions = useMemo(
    () => scopeQuestions(data.questions, selectedExam),
    [data.questions, selectedExam],
  );
  const { practiceBindings, cursor, currentQuestion, originTheoryId, startPractice, toggleBookmark, gradeBookmarkQuestion, selfAssessBookmarkAnswer, resetPracticeSession, restorePracticeQuestion } = usePracticeSession({ data, setData, selectedExam, isAuthenticated, userKeyHash, setNotice, setPendingRequestCount, setActiveView, writeLearningUrl, fetchStudyData, refreshData, runTrackedAccountSave, runTrackedLocalSave, retrySaveQueue, bookmarkSaveQueue, bookmarkDesired, bookmarkConfirmed, bookmarkRequested, availableQuestions });
  const { theoryBindings, selectedTheoryId, openSqlTheory, clearTheorySelection, restoreTheorySelection } = useTheoryLearning({ data, selectedExam, setNotice, setPendingRequestCount, setActiveView, writeLearningUrl, refreshData });
  const { examBindings, examSession, examIndex, examBusy, examError, loadSession, startExam, clearExamSession } = useMockExamSession({ data, setData, isAuthenticated, userKeyHash, setNotice, setActiveView, writeLearningUrl, refreshData, runTrackedAccountSave, changeExam, selectedExam });
  const { importGuestLearning } = useGuestLearningSync({ isAuthenticated, runTrackedAccountSave, onGuestImported, userKeyHash, setNotice });


  const abortStudyRequests = useCallback((reason: string) => {
    studyRequestCoordinator.cancelAll(reason);
  }, [studyRequestCoordinator]);

  useEffect(() => () => {
    abortStudyRequests("unmount");
  }, [abortStudyRequests]);

  async function fetchStudyData(scope: StudyScope, params: Record<string, string | number> = {}) {
    const request = studyRequestCoordinator.begin(scope);
    try {
      const payload = await requestStudyData<StudyData>({
        scope,
        exam: selectedExam,
        params,
        cache: isAuthenticated ? "no-store" : "default",
        signal: request.signal,
      });
      if (!request.isCurrent()) {
        throw new ApiRequestError("요청이 취소되었습니다.", "REQUEST_ABORTED");
      }
      return payload;
    } finally {
      request.finish();
    }
  }

  async function refreshData(
    scope: StudyScope = "overview",
    params: Record<string, string | number> = {},
  ) {
    const payload = await fetchStudyData(scope, params);
    if (scope === "shell") {
      setData((previous) => ({
        ...previous,
        settings: payload.settings,
        site: payload.site,
        adminAccess: payload.adminAccess,
      }));
    } else if (scope === "theory" || scope === "theories") {
      // Public reading must not replace the current exercise's answers/feedback
      // or private records with the empty fields in a theory response.
      setData((previous) => ({
        ...previous,
        theories: mergeById(previous.theories, payload.theories ?? []),
        theoryNavigation: payload.theoryNavigation ?? previous.theoryNavigation,
        site: payload.site ?? previous.site,
      }));
    } else if (scope === "overview" || scope === "bootstrap") {
      setData((previous) => ({
        ...previous,
        ...payload,
        overview: payload.overview,
      }));
      setStudyDataLoaded(true);
      setLoadError("");
    } else {
      setData((previous) => ({
        ...previous,
        ...payload,
        questions: mergeById(previous.questions, payload.questions ?? []),
        theories: mergeById(previous.theories, payload.theories ?? []),
        attempts: payload.attempts !== undefined ? payload.attempts : previous.attempts,
        examSessions: payload.examSessions !== undefined ? payload.examSessions : previous.examSessions,
        theoryProgress: payload.theoryProgress !== undefined ? payload.theoryProgress : previous.theoryProgress,
        evaluations: payload.evaluations !== undefined ? payload.evaluations : previous.evaluations,
        overview: payload.overview ?? previous.overview,
        practiceMeta: payload.practiceMeta ?? previous.practiceMeta,
        theoryNavigation: payload.theoryNavigation ?? previous.theoryNavigation,
      }));
      setLoadError("");
    }
    return payload;
  }

  const bootstrapInitialData = useEffectEvent(async (
    requestedScope: StudyScope,
    initialParams: Record<string, string | number>,
  ) => {
    await Promise.resolve();
    let payload = initialData;
    if (!payload) payload = await refreshData(requestedScope, initialParams);
    const imported = await importGuestLearning();
    if (imported) payload = await refreshData(requestedScope, initialParams);
    return { imported, payload };
  });

  useEffect(() => {
    if (!isAuthenticated) return;
    const storageKey = `baeumzip-account-touch:${userKeyHash}`;
    try {
      if (window.sessionStorage.getItem(storageKey) === "1") return;
      window.sessionStorage.setItem(storageKey, "1");
    } catch {
    }
    void requestStudyMutation("account-touch", { displayName }).catch(() => {
      try {
        window.sessionStorage.removeItem(storageKey);
      } catch {
      }
    });
  }, [displayName, isAuthenticated, userKeyHash]);

  useEffect(() => {
    let cancelled = false;
    if (!isAuthenticated && initialLearningLevel === "root") {
      queueMicrotask(() => {
        if (cancelled) return;
        setLoadError("");
        setLoading(false);
      });
      return () => {
        cancelled = true;
      };
    }
    let localExam: string | null = null;
    try {
      localExam = window.localStorage.getItem(`sql-study-selected-exam:${userKeyHash}`);
    } catch {
      queueMicrotask(() => setSaveStatus("error"));
    }
    if (!isAuthenticated) {
      runTrackedLocalSave(() => {
        const probeKey = "baeumzip-storage-check";
        window.localStorage.setItem(probeKey, "1");
        window.localStorage.removeItem(probeKey);
      });
    }
    const routeExam = examForLearningRoute(initialLearningRoute);
    if (!routeExam && isReleasedExamType(localExam)) {
      queueMicrotask(() => setSelectedExam(localExam));
    }
    const requestedScope: StudyScope = initialScope ?? (initialLearningLevel !== "course"
      || initialLearningRoute?.page === "home"
        ? "shell"
        : initialLearningRoute?.page === "theory"
          ? "theory"
          : initialLearningRoute?.page === "theories"
            ? "theories"
            : initialLearningRoute?.page === "question"
              ? "questions"
              : initialLearningRoute?.page === "practice"
                ? "practice-meta"
              : initialLearningRoute?.page === "mock-exam" && initialLearningRoute.id !== "active"
                ? "mock-session"
                : initialLearningRoute?.page === "mock-exams" || initialLearningRoute?.page === "mock-exam"
                  ? "mock"
                  : ["records", "bookmarks", "incorrect"].includes(initialLearningRoute?.page ?? "")
                    ? "records"
                    : "overview");
    const initialParams: Record<string, string | number> = initialLearningRoute?.page === "theory"
      ? { id: initialLearningRoute.id }
      : initialLearningRoute?.page === "question"
        ? { ids: initialLearningRoute.id }
      : requestedScope === "mock-session"
        && initialLearningRoute?.page === "mock-exam"
        && initialLearningRoute.id !== "active"
        ? { id: initialLearningRoute.id }
        : {};

    queueMicrotask(() => {
      void bootstrapInitialData(requestedScope, initialParams)
        .then(({ imported, payload }) => {
          if (cancelled) return;
          if (imported) setNotice("이 브라우저의 북마크와 풀이 기록을 계정에 연결했습니다.");
          const stored = payload.settings?.selectedExam;
          if (!routeExam && isReleasedExamType(stored) && !localExam) {
            setSelectedExam(stored);
          }
        })
        .catch(() => {
          if (!cancelled && initialLearningLevel !== "field") {
            setLoadError("학습 데이터를 불러오지 못했습니다.");
          }
        })
        .finally(() => {
          if (!cancelled && initialLearningLevel !== "field") setLoading(false);
        });
    });
    return () => {
      cancelled = true;
    };
  }, [
    initialLearningLevel,
    initialLearningRoute,
    initialScope,
    isAuthenticated,
    runTrackedLocalSave,
    setSelectedExam,
    userKeyHash,
  ]);

  useEffect(() => {
    if (loading) return;
    const path = window.location.pathname;
    if (learningLevel === "course" && activeView === "mock") {
      trackEvent({
        eventType: "mock_exam_page_viewed",
        examScope: selectedExam,
        pagePath: path,
      });
    }
  }, [activeView, learningLevel, selectedExam, selectedFieldId, swActiveView, loading]);

  const routeFocusKey = `${learningLevel}:${activeView}:${selectedTheoryId ?? ""}:${swActiveView}`;
  const previousRouteFocusKey = useRef(routeFocusKey);
  useEffect(() => {
    if (previousRouteFocusKey.current === routeFocusKey) return;
    previousRouteFocusKey.current = routeFocusKey;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById("main-content")?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [routeFocusKey]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [activeView, selectedTheoryId, cursor, examIndex]);

  useEffect(() => {
    if (!notice || noticeIsError) return;
    const timer = window.setTimeout(() => setNotice(""), 3000);
    return () => window.clearTimeout(timer);
  }, [notice, noticeIsError]);

  const availableTheories = useMemo(
    () => data.theories
      .filter((article) => examScopeAllows(article.examScope, selectedExam))
      .sort(compareTheories),
    [data.theories, selectedExam],
  );
  const examAttempts = useMemo(
    () => data.attempts.filter((attempt) => attempt.examType === selectedExam),
    [data.attempts, selectedExam],
  );
  const objectiveExamAttempts = useMemo(
    () => gradedPracticeAttempts(availableQuestions, examAttempts, selectedExam),
    [availableQuestions, examAttempts, selectedExam],
  );
  const courseOverview = data.overview?.byExam[selectedExam];
  const releasedCourse = courseContentRelease(selectedExam);
  const streak = studyDataLoaded
    ? calcStreak(objectiveExamAttempts)
    : courseOverview?.streak ?? calcStreak(objectiveExamAttempts);
  const loadedExplainedQuestionCount = useMemo(
    () => data.questions.filter((question) => question.explanation.trim()).length,
    [data.questions],
  );
  const dashboardQuestionCount = courseOverview?.contentQuestionCount
    ?? releasedCourse?.questionCount
    ?? (studyDataLoaded ? availableQuestions.length : data.overview?.questionCount ?? availableQuestions.length);
  const dashboardTheoryCount = courseOverview?.contentTheoryCount
    ?? releasedCourse?.theoryCount
    ?? (studyDataLoaded ? availableTheories.length : data.overview?.theoryCount ?? availableTheories.length);
  const dashboardExplainedQuestionCount = courseOverview?.contentExplainedQuestionCount
    ?? (studyDataLoaded ? loadedExplainedQuestionCount : data.overview?.explainedQuestionCount ?? loadedExplainedQuestionCount);

  function restoreLearningRoute(route: LearningRoute) {
    if (!isAuthenticated && !isPublicLearningRoute(route)) {
      window.location.assign(loginNoticePath(learningPath(route)));
      return;
    }
    if (route.page === "field") {
      const nextSwView: SwPlannerView = route.activeMock ? "mock" : swViewForFieldSection(route.section);
      setSelectedFieldId(route.fieldId);
      setLearningLevel("field");
      setActiveView("dashboard");
      setSwActiveView(nextSwView);
      setSwSelectedTheoryId(route.theoryId ?? null);
      setSwNavigationRequest((previous) => ({ target: nextSwView, token: previous.token + 1 }));
      resetPracticeSession();
      clearTheorySelection();
      clearExamSession();
      return;
    }
    setSelectedFieldId(learningFieldForCourse(route.examType)?.id ?? LEARNING_CATALOG[0].id);
    setLearningLevel("course");
    setSelectedExam(route.examType);
    try {
      window.localStorage.setItem(`sql-study-selected-exam:${userKeyHash}`, route.examType);
    } catch {
    }
    clearTheorySelection();

    const requestedView = viewForLearningRoute(route);
    if (!courseViewAvailable(route.examType, requestedView)) {
      setActiveView("theory");
      resetPracticeSession();
      clearExamSession();
      setNotice("현재 공개된 이론 학습 화면으로 이동했습니다.");
      writeLearningUrl({ examType: route.examType, page: "theories" }, "replace");
      return;
    }

    if (route.page === "home") {
      setActiveView("dashboard");
      resetPracticeSession();
      clearExamSession();
      return;
    }
    if (route.page === "practice") {
      setActiveView("practice");
      resetPracticeSession();
      clearExamSession();
      return;
    }
    if (route.page === "question") {
      const question = data.questions.find((item) => (
        item.id === route.id && questionAllowedForExam(item, route.examType)
      ));
      setActiveView("practice");
      clearExamSession();
      if (!question) {
        resetPracticeSession();
        setNotice("이 과정에서 확인할 수 없는 문제입니다.");
        writeLearningUrl({ examType: route.examType, page: "practice" }, "replace");
        return;
      }
      restorePracticeQuestion(question.id);
      writeLearningUrl(route, "replace");
      return;
    }
    if (route.page === "theories") {
      setActiveView("theory");
      resetPracticeSession();
      clearExamSession();
      return;
    }
    if (route.page === "theory") {
      const article = data.theories.find((item) => (
        item.id === route.id && examScopeAllows(item.examScope, route.examType)
      ));
      setActiveView("theory");
      resetPracticeSession();
      clearExamSession();
      if (!article) {
        setNotice("이 과정에서 확인할 수 없는 이론입니다.");
        writeLearningUrl({ examType: route.examType, page: "theories" }, "replace");
        return;
      }
      restoreTheorySelection(article.id);
      writeLearningUrl(route, "replace");
      return;
    }
    if (route.page === "mock-exams") {
      setActiveView("mock");
      resetPracticeSession();
      clearExamSession();
      return;
    }
    if (route.page === "mock-exam") {
      const session = route.id === "active"
        ? data.examSessions.find((item) => item.status === "active" && item.examType === route.examType)
        : data.examSessions.find((item) => item.id === route.id && item.examType === route.examType);
      if (!session) {
        setActiveView("mock");
        clearExamSession();
        setNotice("저장된 모의고사를 찾을 수 없습니다.");
        writeLearningUrl({ examType: route.examType, page: "mock-exams" }, "replace");
        return;
      }
      loadSession(session, false);
      writeLearningUrl({
        examType: route.examType,
        page: "mock-exam",
        id: session.status === "active" ? "active" : session.id,
      }, "replace");
      return;
    }
    setActiveView(
      route.page === "bookmarks"
        ? "wrong"
        : route.page === "incorrect"
          ? "incorrect"
          : "stats",
    );
    resetPracticeSession();
    clearExamSession();
  }

  useEffect(() => {
    restoreLearningRouteRef.current = restoreLearningRoute;
  });

  useEffect(() => {
    if (loading || loadError) return;
    const isInitialRestore = !initialRouteRestored.current;
    initialRouteRestored.current = true;
    const hiddenQuestionRoute = currentHiddenQuestionRoute();
    if (!isInitialRestore && poppedRoute?.revision === undefined && hiddenQuestionRoute) {
      return;
    }
    const route = isInitialRestore
      ? initialLearningRoute
      : poppedRoute?.route ?? hiddenQuestionRoute ?? parseLearningPath(pathname);
    const timer = window.setTimeout(() => {
      if (!isInitialRestore && poppedRoute?.revision !== undefined) abortStudyRequests("route-restore");
      if (route) restoreLearningRouteRef.current(route);
      else if (pathname === "/") {
        setLearningLevel("root");
        setActiveView("dashboard");
        resetPracticeSession();
        clearTheorySelection();
        clearExamSession();
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [
    initialLearningRoute,
    loadError,
    loading,
    pathname,
    poppedRoute?.route,
    poppedRoute?.revision,
    abortStudyRequests,
    resetPracticeSession,
    clearExamSession,
    clearTheorySelection,
    setActiveView,
    setLearningLevel,
  ]);

  async function navigate(view: View) {
    const destination = learningPath(routeForView(view, selectedExam));
    if (view === "theory") { window.location.assign(destination); return; }
    if (!isAuthenticated && !isPublicLearningRoute(routeForView(view, selectedExam))) {
      window.location.assign(loginNoticePath(destination));
      return;
    }
    if (learningLevel !== "course") return;
    if (view === activeView) return;
    abortStudyRequests("navigation");
    setActiveView(view);
    writeLearningUrl(routeForView(view, selectedExam), "push", "client");
    if (view !== "practice") {
      resetPracticeSession();
    }
    if (view !== "mock") clearExamSession();
    clearTheorySelection();
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (view === "dashboard") return;
    const scope: StudyScope = view === "practice"
      ? "practice-meta"
      : view === "mock"
          ? "mock"
          : "records";
    setLoadError("");
    let pendingShown = false;
    const loadingTimer = window.setTimeout(() => {
      pendingShown = true;
      setPendingRequestCount((count) => count + 1);
    }, 150);
    try {
      await refreshData(scope, scope === "records" ? {
        view: view === "wrong" ? "bookmarks" : view,
      } : {});
    } catch (error) {
      if (!isExpectedRequestCancellation(error)) {
        setLoadError("학습 데이터를 불러오지 못했습니다.");
      }
    } finally {
      window.clearTimeout(loadingTimer);
      if (pendingShown) setPendingRequestCount((count) => Math.max(0, count - 1));
    }
  }

  async function changeExam(
    next: ExamType,
    routeMode: "push" | "replace" = "replace",
    destination: View = activeView,
  ) {
    abortStudyRequests("exam-change");
    setLearningLevel("course");
    setSelectedExam(next);
    resetPracticeSession(true);
    clearTheorySelection();
    if (examSession?.examType !== next) clearExamSession();
    writeLearningUrl(routeForView(destination, next), routeMode);
    try {
      window.localStorage.setItem(`sql-study-selected-exam:${userKeyHash}`, next);
    } catch {
      setNotice("브라우저에 시험 선택을 저장하지 못했습니다.");
    }
    if (!isAuthenticated) {
      const guest = readGuestLearningState();
      runTrackedLocalSave(() => {
        writeGuestLearningState({ ...guest, selectedExam: next });
      });
      return;
    }
    try {
      await selectedExamSaveQueue.enqueue("selected-exam", next);
    } catch {
      setNotice("시험 선택은 이 기기에 저장했습니다.");
    }
  }

  function openLearningRoot() {
    abortStudyRequests("learning-root");
    setLearningLevel("root");
    setActiveView("dashboard");
    resetPracticeSession();
    clearTheorySelection();
    setSwSelectedTheoryId(null);
    clearExamSession();
    pushLearningRoot();
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }

  function openLearningField(fieldId: string) {
    const field = LEARNING_CATALOG.find((item) => item.id === fieldId);
    if (!field) return;
    abortStudyRequests("learning-field");
    setSelectedFieldId(field.id);
    setLearningLevel("field");
    setActiveView("dashboard");
    setSwActiveView("curriculum");
    setSwSelectedTheoryId(null);
    setSwNavigationRequest((previous) => ({ target: "curriculum", token: previous.token + 1 }));
    resetPracticeSession();
    clearTheorySelection();
    clearExamSession();
    writeLearningUrl({ fieldId: field.id, page: "field" });
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }

  function navigateSw(target: SwNavView) {
    const destination = learningPath({ fieldId: selectedFieldId, page: "field", section: fieldSectionForSwView(target) });
    if (target === "theories") { window.location.assign(destination); return; }
    if (!isAuthenticated && !isPublicLearningRoute({ fieldId: selectedFieldId, page: "field", section: fieldSectionForSwView(target) })) {
      window.location.assign(loginNoticePath(destination));
      return;
    }
    if (learningLevel !== "field") return;
    setSwActiveView(target);
    setSwSelectedTheoryId(null);
    setSwNavigationRequest((previous) => ({ target, token: previous.token + 1 }));
    writeLearningUrl({
      fieldId: selectedFieldId,
      page: "field",
      section: fieldSectionForSwView(target),
    });
    window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
  }

  function handleSwViewChange(next: SwPlannerView) {
    const route: LearningRoute = { fieldId: selectedFieldId, page: "field", section: fieldSectionForSwView(next) };
    if (!isAuthenticated && !isPublicLearningRoute(route)) {
      window.location.assign(loginNoticePath(learningPath(route)));
      return;
    }
    setSwActiveView(next);
    if (next === "theory") return;
    setSwSelectedTheoryId(null);
    writeLearningUrl({
      fieldId: selectedFieldId,
      page: "field",
      section: fieldSectionForSwView(next),
      activeMock: next === "mock",
    });
  }

  function handleSwTheoryChange(theoryId: number | null) {
    setSwSelectedTheoryId(theoryId);
    writeLearningUrl({
      fieldId: selectedFieldId,
      page: "field",
      section: "theories",
      theoryId: theoryId ?? undefined,
    }, theoryId ? "push" : "replace");
  }

  function selectLearningCourse(examType: ExamType) {
    setLearningLevel("course");
    setActiveView("dashboard");
    setLoading(false);
    setLoadError("");
    void changeExam(examType, "push", "dashboard");
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }

  async function onGuestImported() {
    await retryCourseData();
    setNotice("이 브라우저의 북마크와 풀이 기록을 계정에 연결했습니다.");
  }

  async function retryCourseData() {
    setLoading(true);
    setLoadError("");
    try {
      const scope: StudyScope = activeView === "dashboard"
        ? "overview"
        : activeView === "practice"
          ? "practice-meta"
          : activeView === "theory"
            ? selectedTheoryId ? "theory" : "theories"
            : activeView === "mock"
              ? "mock"
              : "records";
      await refreshData(scope, scope === "theory" && selectedTheoryId
        ? { id: selectedTheoryId }
        : scope === "records"
          ? { view: activeView === "wrong" ? "bookmarks" : activeView }
          : {});
    } catch (error) {
      if (!isExpectedRequestCancellation(error)) {
        setLoadError("학습 데이터를 불러오지 못했습니다.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function loadMoreRecords(kind: "attempts" | "bookmarks") {
    const cursor = kind === "attempts"
      ? data.recordsPagination?.attemptsNextCursor
      : data.recordsPagination?.bookmarksNextCursor;
    if (!cursor || recordsLoadingMore) return;
    setRecordsLoadingMore(kind);
    try {
      const payload = await fetchStudyData("records", {
        [kind === "attempts" ? "attemptCursor" : "bookmarkCursor"]: cursor,
        limit: data.recordsPagination?.limit ?? 30,
        view: activeView === "wrong" ? "bookmarks" : activeView,
      });
      setData((previous) => ({
        ...previous,
        questions: mergeById(previous.questions, payload.questions ?? []),
        attempts: kind === "attempts"
          ? mergeById(previous.attempts, payload.attempts ?? [])
          : previous.attempts,
        evaluations: kind === "attempts"
          ? mergeById(previous.evaluations, payload.evaluations ?? [])
          : previous.evaluations,
        recordsPagination: {
          attemptsNextCursor: kind === "attempts"
            ? payload.recordsPagination?.attemptsNextCursor ?? null
            : previous.recordsPagination?.attemptsNextCursor ?? null,
          bookmarksNextCursor: kind === "bookmarks"
            ? payload.recordsPagination?.bookmarksNextCursor ?? null
            : previous.recordsPagination?.bookmarksNextCursor ?? null,
          limit: payload.recordsPagination?.limit ?? previous.recordsPagination?.limit ?? 30,
        },
      }));
    } catch (error) {
      if (!isExpectedRequestCancellation(error)) {
        setLoadError("이전 학습 기록을 더 불러오지 못했습니다.");
      }
    } finally {
      setRecordsLoadingMore(null);
    }
  }

  const {
    contentUsesPrimaryHeading,
    courseContext,
    courseReady,
    fieldContext,
    fieldUsesSectionRoutes,
    hasSwCurriculumSelection,
    selectedCourseNavItems,
    selectedExamName,
    selectedField,
    topbarTitle,
    visibleSwNavItems,
  } = studyAppViewState({
    learningLevel,
    selectedFieldId,
    selectedExam,
    serializedSwCurriculumSelection,
    loadError,
    activeView,
    swActiveView,
    selectedTheoryId,
    swSelectedTheoryId,
  });

  return (
    <div className={courseContext ? "app-shell course-context" : "app-shell catalog-context"}>
      <a className="skip-link" href="#main-content">본문으로 건너뛰기</a>
      <StudySidebar
        learningLevel={learningLevel}
        selectedField={selectedField}
        selectedExam={selectedExam}
        selectedExamName={selectedExamName}
        activeView={activeView}
        swActiveView={swActiveView}
        fieldUsesSectionRoutes={fieldUsesSectionRoutes}
        hasSwCurriculumSelection={hasSwCurriculumSelection}
        adminAccess={adminAccess}
        courseNavItems={selectedCourseNavItems}
        onLearningRoot={openLearningRoot}
        onLearningField={openLearningField}
        onCourseView={(view) => void navigate(view)}
        onSwView={navigateSw}
      />

      <main className="main-area" id="main-content" tabIndex={-1}>
        <StudyHeader
          learningLevel={learningLevel}
          selectedField={selectedField}
          selectedExamName={selectedExamName}
          topbarTitle={topbarTitle}
          contentUsesPrimaryHeading={contentUsesPrimaryHeading}
          isAuthenticated={isAuthenticated}
          saveStatus={saveStatus}
          onRetrySave={retrySave}
          onReport={() => setReportRequest({ mode: "general" })}
          adminAccess={adminAccess}
          groupExamAccess={groupExamAccess}
          displayName={displayName}
          signInPath={signInPath}
          signOutPath={signOutPath}
          onLearningRoot={openLearningRoot}
          onLearningField={openLearningField}
          notice={data.site.notice}
          maintenanceMode={data.site.maintenanceMode}
        />

        {loading && learningLevel !== "root" && <LearningLoadingState view={activeView} />}
        {!loading && contentPending && (
          <div className="partial-loading" role="status" aria-live="polite">
            <span className="loading-indicator" aria-hidden="true" />
            <span>필요한 학습 내용만 불러오고 있습니다.</span>
          </div>
        )}
        {!loading && loadError && (courseContext || learningLevel === "root") && (
          <LearningLoadError message={loadError} onRetry={() => void retryCourseData()} />
        )}
        {!loading && !isAuthenticated && learningLevel !== "root" && !currentQuestion
          && (!examSession || examSession.status === "submitted") && swActiveView !== "mock" && swActiveView !== "practice" && (
          <p className="catalog-record-note">이론은 로그인 없이 읽을 수 있습니다. 문제 풀이·모의고사·학습 기록을 이용하려면 <a href={signInPath}>로그인</a>해 주세요.</p>
        )}
        {activeView === "dashboard" && learningLevel === "root" && (
          rootCatalog
        )}
        {!loading && activeView === "dashboard" && fieldContext && (
          <RetryBoundary fallbackTitle="학습 분야 화면을 표시하지 못했습니다." resetKey={selectedFieldId}>
            <LearningFieldHome
              key={`${userKeyHash}:${selectedField.id}`}
              userKeyHash={userKeyHash}
              field={selectedField}
              isAuthenticated={isAuthenticated}
              onBack={openLearningRoot}
              onCourseSelect={selectLearningCourse}
              swNavigationRequest={swNavigationRequest}
              onSwViewChange={handleSwViewChange}
              initialSwTheoryId={swSelectedTheoryId}
              onSwTheoryChange={handleSwTheoryChange}
            />
          </RetryBoundary>
        )}
        <RetryBoundary fallbackTitle={`${selectedField.name} 학습 화면을 표시하지 못했습니다.`} resetKey={`${selectedExam}:${activeView}`}>
          <Suspense fallback={<LearningLoadingState view={activeView} />}>
        {!loading && activeView === "dashboard" && courseReady && (
          <Dashboard
            examType={selectedExam}
            questionCount={dashboardQuestionCount}
            theoryCount={dashboardTheoryCount}
            explainedQuestionCount={dashboardExplainedQuestionCount}
            onStart={() => navigate("practice")}
            onNavigate={navigate}
          />
        )}
        {!loading && courseReady && activeView === "practice" && (
          <Practice
            {...practiceBindings}
            adSuppressed={Boolean(reportRequest)}
            onReportQuestion={() => {
              if (!isAuthenticated) {
                setNotice("문제 오류 신고는 로그인 후 이용할 수 있습니다.");
                return;
              }
              if (currentQuestion) {
                setReportRequest({ mode: "question", questionId: currentQuestion.id });
              }
            }}
            theory={data.theories.find((item) => item.id === currentQuestion?.theoryId)}
            onOpenTheory={(id) => {
              void openSqlTheory(id, currentQuestion?.id ?? null);
            }}
            onReturnTheory={() => {
              clearTheorySelection();
              if (originTheoryId) restoreTheorySelection(originTheoryId);
              setActiveView("theory");
              resetPracticeSession();
              if (originTheoryId) {
                writeLearningUrl({
                  examType: selectedExam,
                  page: "theory",
                  id: originTheoryId,
                });
              }
            }}
          />
        )}
        {!loading && courseReady && activeView === "mock" && (
          examSession
            ? <ExamRunner
            {...examBindings}
                session={examSession}
                questions={data.questions}
              />
            : <MockExamHome
                examType={selectedExam}
                sessions={data.examSessions}
                busy={examBusy}
                error={examError}
                onStart={() => startExam(selectedExam)}
                onStartPast={(formId) => startExam("IPEP", formId)}
                onResume={loadSession}
              />
        )}
        {!loading && courseReady && activeView === "theory" && (
          <TheoryView
            {...theoryBindings}
            examType={selectedExam}
            articles={availableTheories}
            questions={availableQuestions}
            onPractice={(article) => startPractice({ theory: article })}
          />
        )}
        {!loading && courseReady && (
          activeView === "stats" || activeView === "wrong" || activeView === "incorrect"
        ) && (
          <LearningRecordsHub
            activeView={activeView}
            examType={selectedExam}
            questions={availableQuestions}
            attempts={examAttempts}
            objectiveAttempts={objectiveExamAttempts}
            sessions={data.examSessions.filter((item) => item.examType === selectedExam)}
            theories={data.theories}
            streak={streak}
            onNavigate={navigate}
            onRetryBookmarks={() => startPractice({ bookmarkOnly: true })}
            onBookmark={toggleBookmark}
            onGrade={gradeBookmarkQuestion}
            onSelfAssessment={selfAssessBookmarkAnswer}
            summary={data.recordsSummary}
            stats={data.recordStats}
            attemptsHasMore={Boolean(data.recordsPagination?.attemptsNextCursor)}
            bookmarksHasMore={Boolean(data.recordsPagination?.bookmarksNextCursor)}
            loadingMore={recordsLoadingMore}
            onLoadMore={loadMoreRecords}
          />
        )}
          </Suspense>
        </RetryBoundary>
      </main>

      <StudyMobileNavigation
        courseContext={courseContext}
        fieldContext={fieldContext}
        fieldUsesSectionRoutes={fieldUsesSectionRoutes}
        courseItems={selectedCourseNavItems}
        activeView={activeView}
        selectedExam={selectedExam}
        onCourseNavigate={(view) => void navigate(view)}
        swItems={visibleSwNavItems}
        swActiveView={swActiveView}
        selectedField={selectedField}
        onSwNavigate={navigateSw}
      />
      <StudyTransientFeedback
        reportRequest={reportRequest}
        notice={notice}
        noticeIsError={noticeIsError}
        onCloseReport={() => setReportRequest(null)}
        onReportSubmitted={() => {
          setReportRequest(null);
          setNotice("제보가 접수되었습니다. 관리자 화면에서 확인하겠습니다.");
        }}
        onCloseNotice={() => setNotice("")}
      />
    </div>
  );
}
