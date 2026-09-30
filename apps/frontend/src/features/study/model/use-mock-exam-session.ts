"use client";
import { loginNoticePath } from "@shared/auth/login-navigation";
import { learningPath } from "@shared/study/learning-catalog";
import { ApiRequestError } from "@frontend/shared/api/request-json";
import {
  isExpectedRequestCancellation
} from "@shared/runtime/latest-request-coordinator.mjs";
import {
  type ExamType
} from "@shared/study/study-domain";
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { ExamSaveRequestError, QUESTION_CHUNK_SIZE, QUESTION_PREFETCH_CHUNKS, type ExamSaveErrorPayload, type ExamSaveSnapshot } from "../components/study-app-config";
import { ExamRunner } from "../components/study-lazy-screens";
import {
  type ExamSession,
  type Question,
  type StudyData
} from "../components/study-screen-shared";
import {
  draftIsNewer,
  preserveConflictingSqlExamDraft,
  readSqlExamDraft,
  sqlExamDraftKey,
  writeSqlExamDraft,
} from "../persistence/exam-draft";
import { trackEvent } from "../telemetry/study-telemetry";
import {
  mergeById
} from "./answer-feedback";
import {
  requestStudyData
} from "./study-api-client";
import type { StudyControllerContext } from "./study-controller-context";
import { requestStudyMutation } from "./study-mutation-api-client";

import useSessionEpoch from "./use-session-epoch";
import { examQuestionAnswered } from "./exam-answer-state";

export default function useMockExamSession({ data, setData, isAuthenticated, userKeyHash, setNotice, setActiveView, writeLearningUrl, refreshData, runTrackedAccountSave, changeExam, selectedExam }: Pick<StudyControllerContext, "data" | "setData" | "isAuthenticated" | "userKeyHash" | "setNotice" | "setActiveView" | "writeLearningUrl" | "refreshData" | "runTrackedAccountSave" | "changeExam" | "selectedExam">) {
  const epoch = useSessionEpoch();

  const [examSession, setExamSession] = useState<ExamSession | null>(null);

  const examRevisionRef = useRef(0);
  const savedSnapshotRef = useRef("");

  const examSaveQueueRef = useRef<Promise<void>>(Promise.resolve());

  const examFinalizingRef = useRef(false);

  const examStartingRef = useRef(false);
  const startSelectionEpochRef = useRef(0);
  useEffect(() => { startSelectionEpochRef.current += 1; }, [selectedExam]);

  const [examAnswers, setExamAnswers] = useState<Record<string, number[]>>({});

  const [examDescriptive, setExamDescriptive] = useState<Record<string, string>>({});

  const [examDescriptiveScores, setExamDescriptiveScores] = useState<Record<string, number>>({});

  const [examDescriptiveSnapshots, setExamDescriptiveSnapshots] = useState<Record<string, string>>({});

  const [examFlagged, setExamFlagged] = useState<number[]>([]);

  const [examIndex, setExamIndex] = useState(0);

  const [examBusy, setExamBusy] = useState(false);

  const [examQuestionLoadError, setExamQuestionLoadError] = useState("");

  const [examQuestionRequestTick, setExamQuestionRequestTick] = useState(0);

  const [examError, setExamError] = useState<{ message: string; shortages?: Array<{ label: string; required: number; available: number }> } | null>(null);

  const loadSession = useCallback((session: ExamSession, updateUrl = true, forceServer = false) => {
    epoch.invalidate();
    const draft = forceServer ? null : readSqlExamDraft(userKeyHash, session);
    const saved = draft && draftIsNewer(draft, session) ? draft : null;
    savedSnapshotRef.current = JSON.stringify({
      answers: session.answers ?? {},
      descriptiveAnswers: session.descriptiveAnswers ?? {},
      descriptiveScores: session.descriptiveScores ?? {},
      descriptiveSnapshots: session.descriptiveSnapshots ?? {},
      flagged: session.flagged ?? [],
      currentIndex: Math.min(Math.max(0, Number(session.currentIndex) || 0), Math.max(0, session.questionIds.length - 1)),
    });
    setExamSession(session);
    examRevisionRef.current = Number(session.revision) || 0;
    setExamAnswers(saved?.answers ?? session.answers ?? {});
    setExamDescriptive(saved?.descriptiveAnswers ?? session.descriptiveAnswers ?? {});
    setExamDescriptiveScores(saved?.descriptiveScores ?? session.descriptiveScores ?? {});
    setExamDescriptiveSnapshots(saved?.descriptiveSnapshots ?? session.descriptiveSnapshots ?? {});
    setExamFlagged(saved?.flagged ?? session.flagged ?? []);
    setExamIndex(Math.min(
      Math.max(0, Number(saved?.currentIndex ?? session.currentIndex) || 0),
      Math.max(0, session.questionIds.length - 1),
    ));
    setExamError(null);
    setActiveView("mock");
    if (updateUrl) {
      writeLearningUrl({
        examType: session.examType,
        page: "mock-exam",
        id: session.id,
      });
    }
  }, [epoch, userKeyHash, setActiveView, writeLearningUrl]);

  const queueExamSave = useCallback((
    sessionId: string,
    snapshot: ExamSaveSnapshot,
    showProgress = false,
  ) => {
    const isCurrent = epoch.capture();
    // Retries enter the same queue and update its revision just like the first attempt.
    return runTrackedAccountSave(async (signal) => {
      if (!isCurrent() || examFinalizingRef.current) return null;
      const execute = async () => {
        if (!isCurrent()) return null;
        let payload: ExamSaveErrorPayload;
        try {
          payload = await requestStudyMutation<ExamSaveErrorPayload>("exam-save", {
            sessionId,
            revision: examRevisionRef.current,
            ...snapshot,
          }, signal);
        } catch (error) {
          if (error instanceof ApiRequestError && error.payload) {
            const failure = error.payload as ExamSaveErrorPayload;
            if (isCurrent() && failure.code === "REVISION_CONFLICT" && failure.session) {
              preserveConflictingSqlExamDraft(userKeyHash, sessionId, {
                revision: examRevisionRef.current,
                updatedAt: new Date().toISOString(),
                ...snapshot,
              });
              loadSession(failure.session, false, true);
              setData((previous) => ({
                ...previous,
                examSessions: previous.examSessions.map((item) => item.id === sessionId ? failure.session! : item),
              }));
              setNotice("다른 탭의 최신 답안을 불러왔습니다. 이 탭의 초안은 충돌 복구본으로 보관했습니다.");
              return failure.session;
            }
            throw new ExamSaveRequestError(failure);
          }
          throw error;
        }
        if (!payload.session) throw new ExamSaveRequestError(payload);
        if (isCurrent()) {
          examRevisionRef.current = Number(payload.session.revision) || 0;
          savedSnapshotRef.current = JSON.stringify(snapshot);
          setData((previous) => ({
            ...previous,
            examSessions: previous.examSessions.map((item) => (
              item.id === payload.session?.id ? payload.session : item
            )),
          }));
        }
        return payload.session;
      };
      const queued = examSaveQueueRef.current.catch(() => undefined).then(execute);
      examSaveQueueRef.current = queued.then(() => undefined, () => undefined);
      return queued;
    }, { showProgress, operationId: `exam-save:${sessionId}` });
  }, [epoch, runTrackedAccountSave, setData, userKeyHash, loadSession, setNotice]);

  useEffect(() => {
    if (!examSession || examSession.status !== "active" || examBusy) return;
    const isCurrent = epoch.capture();
    const snapshot: ExamSaveSnapshot = {
      answers: examAnswers,
      descriptiveAnswers: examDescriptive,
      descriptiveScores: examDescriptiveScores,
      descriptiveSnapshots: examDescriptiveSnapshots,
      flagged: examFlagged,
      currentIndex: examIndex,
    };
    if (JSON.stringify(snapshot) === savedSnapshotRef.current) return;
    try {
      writeSqlExamDraft(userKeyHash, examSession.id, {
        revision: examRevisionRef.current,
        updatedAt: new Date().toISOString(),
        ...snapshot,
      });
    } catch {
      queueMicrotask(() => setNotice("브라우저 임시 저장 공간을 사용할 수 없습니다."));
    }
    const timer = window.setTimeout(() => {
      if (examFinalizingRef.current) return;
      void queueExamSave(examSession.id, snapshot).catch(() => {
        if (!isCurrent()) return;
        setNotice("답안은 이 기기에 보관 중이며 연결되면 다시 저장됩니다.");
      });
    }, 1_800);
    return () => window.clearTimeout(timer);
  }, [examSession, examAnswers, examDescriptive, examDescriptiveScores, examDescriptiveSnapshots, examFlagged, examIndex, examBusy, userKeyHash, queueExamSave, epoch, setNotice]);

  const loadExamQuestionWindow = useEffectEvent(async (
    requestIds: number[],
    cancelled: () => boolean,
  ) => {
    try {
      await refreshData("questions", { ids: requestIds.join(",") });
      if (!cancelled()) setExamQuestionLoadError("");
    } catch (error) {
      if (!cancelled() && !isExpectedRequestCancellation(error)) {
        setExamQuestionLoadError("문항을 불러오지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.");
      }
    }
  });

  useEffect(() => {
    if (!examSession) return;
    const loadedIds = new Set(data.questions.map((question) => question.id));
    const chunkStart = Math.floor(examIndex / QUESTION_CHUNK_SIZE) * QUESTION_CHUNK_SIZE;
    const requestIds = examSession.status === "submitted"
      ? examSession.questionIds.filter((id) => !loadedIds.has(id)).slice(0, QUESTION_CHUNK_SIZE)
      : examSession.questionIds
        .slice(
          chunkStart,
          chunkStart + QUESTION_CHUNK_SIZE * QUESTION_PREFETCH_CHUNKS,
        )
        .filter((id) => !loadedIds.has(id));
    if (!requestIds.length) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void loadExamQuestionWindow(requestIds, () => cancelled);
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [examSession, examIndex, data.questions, examQuestionRequestTick]);


  async function startExam(type: ExamType, formId?: string) {
    if (!isAuthenticated) {
      window.location.assign(loginNoticePath(learningPath({ examType: type, page: "mock-exams" })));
      return;
    }
    const isCurrent = epoch.capture();
    if (examBusy || examStartingRef.current || examFinalizingRef.current) return;
    const startSelectionEpoch = startSelectionEpochRef.current;
    const isStartCurrent = () => isCurrent() && startSelectionEpochRef.current === startSelectionEpoch;
    function openStartedSession(session: ExamSession, questions: Question[]) {
      const settingSave = changeExam(type);
      setData((previous) => ({
        ...previous,
        questions: mergeById(previous.questions, questions),
        examSessions: [session, ...previous.examSessions.filter((item) => item.id !== session.id)],
      }));
      loadSession(session);
      void settingSave;
    }
    examStartingRef.current = true;
    setExamBusy(true);
    setExamError(null);
    try {
      const payload = await requestStudyMutation<{
        session: ExamSession;
        questions: Question[];
        resumed: boolean;
      }>("exam-start", { examType: type, ...(formId ? { formId } : {}) });
      if (!isStartCurrent()) return;
      openStartedSession(payload.session, payload.questions ?? []);
      trackEvent({
        eventType: "mock_exam_started",
        examScope: type,
        pagePath: "/mock",
      });
    } catch (error) {
      if (!isStartCurrent()) return;
      // A transport timeout can happen after the server has created (or resumed)
      // the session. Read the authenticated server state once; never replay POST.
      const ambiguous = error instanceof ApiRequestError && (
        error.code === "NETWORK_ERROR"
        || error.code === "REQUEST_TIMEOUT"
        || error.code === "INVALID_SUCCESS_CONTRACT"
        || (error.code === "INVALID_API_RESPONSE" && error.status !== undefined
          && error.status >= 200 && error.status < 300)
        || error.status === 502
        || error.status === 504
      );
      if (ambiguous) {
        try {
          const readback = await requestStudyData<StudyData>({
            scope: "mock", exam: type, cache: "no-store",
          });
          if (!isStartCurrent()) return;
          const active = readback.examSessions.find((session) =>
            session.examType === type && session.examForm?.id === formId
            && session.status === "active" && session.questionIds.length > 0);
          if (active) {
            openStartedSession(active, readback.questions ?? []);
            setNotice("서버에서 진행 중인 시험을 확인해 이어 풉니다.");
            return;
          }
        } catch {
          if (!isStartCurrent()) return;
        }
        setExamError({ message: "시험 시작 상태를 확인하지 못했습니다. 잠시 후 다시 확인해 주세요." });
        return;
      }
      const failure = error instanceof ApiRequestError ? error.payload : undefined;
      setExamError({
        message: typeof failure?.error === "string"
          ? failure.error
          : "시험을 시작하지 못했습니다. 연결 상태를 확인해 주세요.",
        shortages: Array.isArray(failure?.shortages) ? failure.shortages : undefined,
      });
    } finally {
      examStartingRef.current = false;
      setExamBusy(false);
    }
  }

  async function flushExamBeforeExit() {
    if (!examSession || examSession.status !== "active") return true;
    const isCurrent = epoch.capture();
    try {
      await queueExamSave(examSession.id, {
        answers: examAnswers,
        descriptiveAnswers: examDescriptive,
        descriptiveScores: examDescriptiveScores,
        descriptiveSnapshots: examDescriptiveSnapshots,
        flagged: examFlagged,
        currentIndex: examIndex,
      }, true);
      return true;
    } catch (error) {
      if (!isCurrent()) return false;
      setNotice(error instanceof ExamSaveRequestError
        ? error.message
        : "답안을 아직 저장하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.");
      return false;
    }
  }

  async function submitExam(autoSubmit = false) {
    const isCurrent = epoch.capture();
    if (!examSession || examBusy || examFinalizingRef.current) return;
    const unanswered = examSession.questionIds.filter((id) => {
      const question = data.questions.find((item) => item.id === id);
      return !examQuestionAnswered({ examType: examSession.examType, answers: examAnswers, descriptiveAnswers: examDescriptive, descriptiveScores: examDescriptiveScores, descriptiveSnapshots: examDescriptiveSnapshots }, id, question?.kind);
    }).length;
    if (!autoSubmit && !window.confirm(unanswered
      ? `미응답 ${unanswered}문항이 있습니다. 그대로 제출할까요?`
      : "답안을 제출하면 다시 변경할 수 없습니다. 제출할까요?")) return;
    examFinalizingRef.current = true;
    setExamBusy(true);
    try {
      await examSaveQueueRef.current.catch(() => undefined);
      await runTrackedAccountSave(async (signal) => {
        if (!isCurrent()) return;
        const payload = await requestStudyMutation<{
          session: ExamSession;
          questions: Question[];
        }>(
          "exam-submit",
          {
            sessionId: examSession.id,
            revision: examRevisionRef.current,
            answers: examAnswers,
            descriptiveAnswers: examDescriptive,
            descriptiveScores: examDescriptiveScores,
            descriptiveSnapshots: examDescriptiveSnapshots,
            flagged: examFlagged,
            currentIndex: examIndex,
          },
          signal,
        );
        if (!isCurrent()) return;
        setExamSession(payload.session);
        examRevisionRef.current = Number(payload.session.revision) || 0;
        setData((previous) => ({
          ...previous,
          questions: mergeById(previous.questions, payload.questions ?? []),
          examSessions: previous.examSessions.map((item) => item.id === payload.session.id ? payload.session : item),
        }));
        window.localStorage.removeItem(sqlExamDraftKey(userKeyHash, examSession.id));
        await refreshData("mock");
        trackEvent({
          eventType: "mock_exam_completed",
          examScope: examSession.examType,
          pagePath: "/mock",
        });
      });
    } catch {
      if (!isCurrent()) return;
      setNotice("제출 결과를 확인하고 있습니다…");
      let confirmed: ExamSession | null = null;
      let confirmedQuestions: Question[] = [];
      for (let attempt = 0; attempt < 3 && !confirmed; attempt += 1) {
        if (attempt) await new Promise((resolve) => window.setTimeout(resolve, 700));
        try {
          const payload = await requestStudyData<StudyData>({
            scope: "mock-session",
            exam: examSession.examType,
            params: { id: examSession.id },
            cache: "no-store",
          });
          confirmed = payload.examSessions.find((item) => item.id === examSession.id && item.status === "submitted") ?? null;
          if (confirmed) confirmedQuestions = payload.questions ?? [];
        } catch {
        }
      }
      if (!isCurrent()) return;
      if (confirmed) {
        setExamSession(confirmed);
        examRevisionRef.current = Number(confirmed.revision) || examRevisionRef.current;
        setData((previous) => ({
          ...previous,
          questions: mergeById(previous.questions, confirmedQuestions),
          examSessions: previous.examSessions.map((item) => item.id === confirmed?.id ? confirmed : item),
        }));
        window.localStorage.removeItem(sqlExamDraftKey(userKeyHash, examSession.id));
        setNotice("시험 제출이 완료되었습니다.");
      } else {
        setNotice("시험 제출 상태를 확인하지 못했습니다. 답안은 유지되어 있으니 다시 시도해 주세요.");
      }
    } finally {
      examFinalizingRef.current = false;
      setExamBusy(false);
    }
  }

  const examBindings = {
    answers: examAnswers,
    descriptiveAnswers: examDescriptive,
    descriptiveScores: examDescriptiveScores,
    descriptiveSnapshots: examDescriptiveSnapshots,
    flagged: examFlagged,
    currentIndex: examIndex,
    busy: examBusy,
    onAnswers: (value) => { if (!examFinalizingRef.current) setExamAnswers(value); },
    onDescriptiveAnswers: (value) => { if (!examFinalizingRef.current) setExamDescriptive(value); },
    onDescriptiveScores: (value) => { if (!examFinalizingRef.current) setExamDescriptiveScores(value); },
    onDescriptiveSnapshots: (value) => { if (!examFinalizingRef.current) setExamDescriptiveSnapshots(value); },
    onFlagged: (value) => { if (!examFinalizingRef.current) setExamFlagged(value); },
    onIndex: (value) => { if (!examFinalizingRef.current) setExamIndex(value); },
    onSubmit: submitExam,
    questionLoadError: examQuestionLoadError,
    onRetryQuestion: () => setExamQuestionRequestTick((value) => value + 1),
    onExit: async () => {
      if (!examSession) return;
      const isCurrent = epoch.capture();
      if (!await flushExamBeforeExit()) return;
      if (!isCurrent()) return;
      if (examSession.status === "active") {
        trackEvent({
          eventType: "mock_exam_paused",
          examScope: examSession.examType,
          pagePath: "/mock",
        });
      }
      clearExamSession();
      writeLearningUrl({
        examType: selectedExam,
        page: "mock-exams",
      });
    }
  } satisfies Pick<import("react").ComponentProps<typeof ExamRunner>, "answers" | "descriptiveAnswers" | "descriptiveScores" | "descriptiveSnapshots" | "flagged" | "currentIndex" | "busy" | "onAnswers" | "onDescriptiveAnswers" | "onDescriptiveScores" | "onDescriptiveSnapshots" | "onFlagged" | "onIndex" | "onSubmit" | "questionLoadError" | "onRetryQuestion" | "onExit">;

  const clearExamSession = useCallback(() => { epoch.invalidate(); setExamSession(null); }, [epoch]);
  return {
    examBindings, examSession, examIndex, examBusy, examError, loadSession,
    startExam, clearExamSession
  };
}
