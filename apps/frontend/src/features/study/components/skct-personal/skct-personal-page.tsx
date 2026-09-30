"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { LearnerPageSession } from "@shared/auth/page-session";
import CatalogPageShell from "@frontend/features/study/components/catalog/catalog-page-shell";
import Modal from "@frontend/features/study/components/modal";
import MarkdownRenderer from "@frontend/features/content/components/markdown-renderer";
import { dateTimeLabel } from "@shared/date/korea-date.mjs";
import { SKCT_LEARNING_UNITS, SKCT_SECTION_LINKS, SkctLearningHome, SkctLearningSetup } from "./skct-learning-entry";
import { SKCT_MOCK_SECTION_QUESTIONS, type SkctFullMock } from "@shared/study/skct-personal-exam";
import { SkctLearningStatistics, type SkctUnitStatistics } from "./skct-learning-statistics";
import SkctExamTools from "./skct-exam-tools";
import "./skct-personal.css";

type Question = { sourceItemId: string; unitId: string; passage: string | null; question: string;
  stimulus: string | null; conditions: string[]; insertionSentence: string | null;
  judgmentItems: unknown; choiceHasSourceLabel: boolean[]; displayChoices: string[]; assetUrls: string[]; assetDescriptions?: string[] };
type Feedback = { answerIndex: number; correct: boolean; explanation: string; distractorExplanations: Record<string, string> };
type Item = { position: number; sourceItemId: string; question: Question; selectedIndex: number | null;
  finalized: boolean; elapsedSeconds: number; feedback?: Feedback };
type Attempt = { id: string; releaseId: string; unitId: string; mode: "practice" | "mock";
  status: "in_progress" | "submitted"; revision: number; activePosition: number | null;
  activeSince: string | null; lastOperationId?: string | null;
  startedAt: string; submittedAt: string | null; items: Item[]; correctCount: number | null; fullMock?: SkctFullMock | null };
type View = "home" | "practice" | "mock" | "records";
type Home = { available: boolean; units: { id: string; name: string }[] };
type RecordRow = { id: string; unit_id: string; mode: string; status: string; started_at: string;
  question_count: number; answered_count: number; finalized_count?: number; full_mock?: number; elapsed_seconds: number; correct_count: number };
type Pending = { action: string; attemptId: string; operationId: string; revision: number;
  position?: number; choiceIndex?: number; practiceFlowVersion?: 2 | 3; activePosition?: number | null;
  answers?: { position: number; choiceIndex: number }[]; times?: { position: number; seconds: number }[] };
type MockLocal = { revision: number; position: number; choices: Record<number, number>;
  deltas: Record<number, number> };
type MockLocalAction = { type: "replace"; value: MockLocal | null }
  | { type: "choose"; position: number; choiceIndex: number }
  | { type: "navigate"; position: number }
  | { type: "tick"; seconds: number };
function mockLocalReducer(state: MockLocal | null, action: MockLocalAction): MockLocal | null {
  if (action.type === "replace") return action.value;
  if (!state) return null;
  if (action.type === "choose") return { ...state, choices: { ...state.choices, [action.position]: action.choiceIndex } };
  if (action.type === "navigate") return { ...state, position: action.position };
  const pendingSeconds = Object.values(state.deltas).reduce((sum,value) => sum+value,0);
  const added = Math.min(action.seconds,30-pendingSeconds);
  if (added <= 0) return state;
  return { ...state,
    deltas: { ...state.deltas, [state.position]: (state.deltas[state.position] ?? 0)+added } };
}
const attemptKey = (mode: "practice" | "mock") => `skct-personal-current-attempt-v3:${mode}`;
const mockLocalKey = (id: string) => `skct-personal-mock-local-v1:${id}`;
const legacyAttemptKey = "skct-personal-current-attempt-v2";
const unitNames: Record<string, string> = Object.fromEntries(SKCT_LEARNING_UNITS.map(unit => [unit.id, unit.name]));
const pendingKey = (id: string) => `skct-personal-pending-operation-v2:${id}`;
const leaseKey = (id: string) => `skct-personal-active-tab-v1:${id}`;
const tabNamePrefix = "skct-personal-tab-v1:";
const labels = ["①", "②", "③", "④", "⑤"];
function choiceTextWithoutNumber(choice: string, index: number) {
  const trimmed = choice.trim();
  const sourceNumber = labels[index];
  if (trimmed.startsWith(sourceNumber)) return trimmed.slice(sourceNumber.length).replace(/^[.)\s]+/u, "").trim() || choice;
  const digit = String(index + 1);
  if (trimmed.startsWith(`${digit}.`) || trimmed.startsWith(`${digit})`) || trimmed.startsWith(`${digit} `)) {
    return trimmed.slice(2).trim() || choice;
  }
  return choice;
}
class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function judgmentEntries(value: unknown): [string, string][] {
  if (Array.isArray(value)) return value.flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    return typeof row.label === "string" && typeof row.text === "string" ? [[row.label, row.text]] : [];
  });
  if (value && typeof value === "object") return Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string");
  return [];
}
function displaySourceMarkdown(value: string) {
  return value.replace(/!\[[^\]]*\]\(assets\/[^)]*\.svg\)/gu, "").trim();
}

async function getJson(path: string) {
  const response = await fetch(path, { cache: "no-store", credentials: "same-origin" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "학습 데이터를 불러오지 못했습니다.");
  return data;
}
async function postJson(body: Record<string, unknown>) {
  const response = await fetch("/api/skct-personal", {
    method: "POST", cache: "no-store", credentials: "same-origin",
    keepalive: body.action === "pause" || body.action === "checkpoint",
    headers: { "Content-Type": "application/json", "x-sql-study-user-request": "1" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new ApiError(response.status, data.error ?? "학습 상태를 저장하지 못했습니다.");
  return data;
}

function QuestionContent({ item }: { item: Item }) {
  const q = item.question;
  const displayedQuestion = displaySourceMarkdown(q.question);
  return <div className="skct-question-content">
    <h3 id="skct-current-question" tabIndex={-1}>{item.position}번 문항</h3>
    <div className="skct-question-body"><MarkdownRenderer value={displayedQuestion} /></div>
    {q.passage && <section className="skct-passage" aria-label="제시문"><p>{q.passage}</p></section>}
    {q.stimulus && <section className="skct-stimulus" aria-label="문제 자료"><MarkdownRenderer value={displaySourceMarkdown(q.stimulus)} /></section>}
    {q.insertionSentence && <p className="skct-condition"><strong>삽입 문장</strong> {q.insertionSentence}</p>}
    {judgmentEntries(q.judgmentItems).length > 0 &&
      <div className="skct-judgments" aria-label="판단 항목">{judgmentEntries(q.judgmentItems).map(([label,value]) =>
        <p key={label}><strong>{label}</strong> {value}</p>)}</div>}
    {q.conditions?.length > 0 && <div className="skct-conditions" aria-label="조건">{q.conditions.map((value,index) => <p key={index}>{value}</p>)}</div>}
    {q.assetUrls.map((url,index) => <figure className="skct-figure" key={url}>
      {/* Source SVG is validated during import and served only by the same origin. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} loading="lazy" alt={q.assetDescriptions?.[index] ?? `${q.unitId} ${q.sourceItemId} 문제 자료 ${index+1}`} />
      {q.assetDescriptions?.[index] && <figcaption><details><summary>그림의 텍스트 설명</summary><p>{q.assetDescriptions[index]}</p></details></figcaption>}
    </figure>)}
  </div>;
}

export default function SkctPersonalPage({ session, view, initialAttemptId }: {
  session: LearnerPageSession; view: View; initialAttemptId: string | null;
}) {
  const [home, setHome] = useState<Home | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState("U01");
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [records, setRecords] = useState<RecordRow[] | null>(null);
  const [statistics,setStatistics] = useState<SkctUnitStatistics[] | null>(null);
  const [clockNow,setClockNow] = useState(() => Date.now());
  const clockOffset = useRef(0);
  const startRequest = useRef<string | null>(null);
  const [showSkipConfirm,setShowSkipConfirm] = useState(false);
  const [recordsCursor, setRecordsCursor] = useState<string | null>(null);
  const [position, setPosition] = useState(1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [hasPending, setHasPending] = useState(false);
  const [readOnlyTab, setReadOnlyTab] = useState(false);
  const [draftChoices, setDraftChoices] = useState<Record<string, number>>({});
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [showFinishConfirm, setShowFinishConfirm] = useState(false);
  const [mockLocal, dispatchMockLocal] = useReducer(mockLocalReducer,null);
  const [mockConflict, setMockConflict] = useState(false);
  const mockLocalRef = useRef<MockLocal | null>(null);
  const mockCheckpointInFlight = useRef(false);
  const submissionLockRef = useRef(false);
  const attemptRef = useRef<Attempt | null>(null);
  const tabId = useRef("");
  const feedbackRef = useRef<HTMLElement>(null);
  const authenticated = session.status === "active";
  useEffect(() => { attemptRef.current = attempt;
    if (attempt?.fullMock) clockOffset.current = Date.parse(attempt.fullMock.serverNow)-Date.now();
  }, [attempt]);
  useEffect(() => { const timer = window.setInterval(() => setClockNow(Date.now()+clockOffset.current),1000);
    return () => window.clearInterval(timer); }, []);
  const commitMockLocal = useCallback((id: string, action: MockLocalAction) => {
    const next = mockLocalReducer(mockLocalRef.current,action);
    mockLocalRef.current = next;
    dispatchMockLocal(action);
    if (next) sessionStorage.setItem(mockLocalKey(id),JSON.stringify(next));
    else sessionStorage.removeItem(mockLocalKey(id));
  }, []);
  const saveMockLocal = useCallback((id: string, local: MockLocal) =>
    commitMockLocal(id,{ type: "replace", value: local }),[commitMockLocal]);
  const preserveMockVisibleAnswers = useCallback((id: string) => {
    const current = attemptRef.current;
    const local = mockLocalRef.current;
    if (!current || current.id !== id || !local) return;
    const choices = Object.fromEntries(current.items
      .filter(item => item.selectedIndex !== null)
      .map(item => [item.position,item.selectedIndex as number]));
    saveMockLocal(id,{ ...local, choices: { ...choices, ...local.choices } });
  }, [saveMockLocal]);

  const claimLease = useCallback((id: string, takeover = false) => {
    if (!tabId.current) {
      const existing = window.name.startsWith(tabNamePrefix) ? window.name.slice(tabNamePrefix.length) : "";
      tabId.current = /^[0-9a-f]{8}-[0-9a-f-]{27}$/u.test(existing) ? existing : crypto.randomUUID();
      window.name = `${tabNamePrefix}${tabId.current}`;
    }
    const key = leaseKey(id);
    try {
      const current = JSON.parse(localStorage.getItem(key) ?? "null") as { owner?: string; expiresAt?: number } | null;
      if (!takeover && current?.owner !== tabId.current && Number(current?.expiresAt) > Date.now()) {
        setReadOnlyTab(true);
        return false;
      }
      localStorage.setItem(key, JSON.stringify({ owner: tabId.current, expiresAt: Date.now() + 12_000 }));
      const winner = JSON.parse(localStorage.getItem(key) ?? "null") as { owner?: string } | null;
      const owns = winner?.owner === tabId.current;
      setReadOnlyTab(!owns);
      return owns;
    } catch {
      setReadOnlyTab(true);
      setMessage("탭 상태를 확인하지 못했습니다. 브라우저 저장소를 사용할 수 있어야 풀이를 계속할 수 있습니다.");
      return false;
    }
  }, []);
  const refreshRecords = useCallback(async (cursor?: string) => {
    if (!authenticated) return;
    const data = await getJson(`/api/skct-personal?view=records${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    setRecords(previous => cursor ? [...(previous ?? []), ...data.records] : data.records);
    setRecordsCursor(data.nextCursor ?? null);
    setStatistics(data.statistics ?? []);
  }, [authenticated]);
  const loadAttempt = useCallback(async (id: string, expectedMode?: "practice" | "mock") => {
    const data = await getJson(`/api/skct-personal?view=attempt&id=${encodeURIComponent(id)}`);
    if (expectedMode && data.attempt.mode !== expectedMode) {
      sessionStorage.setItem(attemptKey(data.attempt.mode), id);
      if (sessionStorage.getItem(legacyAttemptKey) === id) sessionStorage.removeItem(legacyAttemptKey);
      throw new Error("요청한 학습 방식과 기록이 다릅니다. 학습 기록에서 다시 열어 주세요.");
    }
    setAttempt(data.attempt);
    attemptRef.current = data.attempt;
    setDraftChoices({});
    const serverPosition = data.attempt.activePosition ?? data.attempt.items.find((item: Item) => !item.finalized)?.position ?? 1;
    setPosition(serverPosition);
    sessionStorage.setItem(attemptKey(data.attempt.mode), id);
    if (sessionStorage.getItem(legacyAttemptKey) === id) sessionStorage.removeItem(legacyAttemptKey);
    let pending = sessionStorage.getItem(pendingKey(id));
    if (data.attempt.mode === "mock" && data.attempt.status === "in_progress") {
      let local: MockLocal | null = null;
      try {
        const parsed = JSON.parse(sessionStorage.getItem(mockLocalKey(id)) ?? "null") as MockLocal | null;
        const validChoices = parsed && Object.entries(parsed.choices ?? {}).every(([position,value]) =>
          data.attempt.items.some((item: Item) => item.position === Number(position)) && Number.isInteger(value) && value >= 1 && value <= 5);
        const validTimes = parsed && [parsed.deltas].every(record =>
          record && Object.entries(record).every(([position,value]) =>
            data.attempt.items.some((item: Item) => item.position === Number(position)) && Number.isSafeInteger(value) && value >= 0));
        if (parsed && Number.isSafeInteger(parsed.revision) && Number.isSafeInteger(parsed.position)
          && validChoices && validTimes && Object.values(parsed.deltas).reduce((sum,value) => sum+value,0) <= 30
          && data.attempt.items.some((item: Item) => item.position === parsed.position)) {
          local = parsed;
        }
      } catch { /* malformed local draft is ignored */ }
      if (!local) local = { revision: data.attempt.revision, position: serverPosition,
        choices: {}, deltas: {} };
      try {
        const operation = pending ? JSON.parse(pending) as Pending : null;
        if (operation?.action === "checkpoint" && data.attempt.lastOperationId === operation.operationId) {
          const choices = { ...local.choices };
          const deltas = { ...local.deltas };
          for (const answer of operation.answers ?? []) if (choices[answer.position] === answer.choiceIndex) delete choices[answer.position];
          for (const time of operation.times ?? []) deltas[time.position] = Math.max(0,(deltas[time.position] ?? 0)-time.seconds);
          local = { ...local, revision: data.attempt.revision, choices, deltas };
          sessionStorage.removeItem(pendingKey(id));
          pending = null;
        } else if (operation?.action !== "checkpoint" && operation?.action !== "submit"
          && data.attempt.lastOperationId === operation?.operationId) {
          local = { ...local, revision: data.attempt.revision };
          sessionStorage.removeItem(pendingKey(id));
          pending = null;
        }
      } catch { /* pending replay below checks the original server revision */ }
      if (data.attempt.fullMock) {
        local = { ...local, position: data.attempt.activePosition ?? 1,
          choices: Object.fromEntries(Object.entries(local.choices).filter(([key]) => Number(key) === data.attempt.activePosition)),
          deltas: Object.fromEntries(Object.entries(local.deltas).filter(([key]) => Number(key) === data.attempt.activePosition)) };
      }
      saveMockLocal(id,local);
      setPosition(local.position);
      setMockConflict(local.revision !== data.attempt.revision);
    } else {
      mockLocalRef.current = null;
      dispatchMockLocal({ type: "replace", value: null });
      setMockConflict(false);
    }
    setHasPending(Boolean(pending));
    if (data.attempt.status === "in_progress") claimLease(id);
    else setReadOnlyTab(false);
    return data.attempt as Attempt;
  }, [claimLease, saveMockLocal]);
  useEffect(() => {
    if (!attempt || attempt.status !== "in_progress") return;
    const id = attempt.id;
    const check = () => {
      try {
        const current = JSON.parse(localStorage.getItem(leaseKey(id)) ?? "null") as { owner?: string; expiresAt?: number } | null;
        if (current?.owner === tabId.current) claimLease(id);
        else setReadOnlyTab(Boolean(current && Number(current.expiresAt) > Date.now()));
      } catch { setReadOnlyTab(true); }
    };
    const interval = window.setInterval(check, 5_000);
    window.addEventListener("storage", check);
    return () => { window.clearInterval(interval); window.removeEventListener("storage", check); };
  }, [attempt, claimLease]);
  const resolveRejectedPending = useCallback(async (id: string) => {
    sessionStorage.removeItem(pendingKey(id));
    setHasPending(false);
    try {
      await loadAttempt(id);
      setMessage("다른 화면에서 학습 상태가 바뀌어 이전 입력을 저장하지 않았습니다. 현재 서버 기록을 다시 불러왔습니다.");
    } catch {
      setAttempt(null);
      setMessage("이전 입력은 거절되었습니다. 서버 기록을 다시 불러오려면 페이지를 새로고침해 주세요.");
    }
  }, [loadAttempt]);
  useEffect(() => {
    if (!authenticated) return;
    let live = true;
    void (async () => {
      try {
        if (view === "records") {
          await refreshRecords();
          return;
        }
        const mode = view === "practice" || view === "mock" ? view : null;
        const id = mode ? initialAttemptId : null;
        const [loaded, current] = await Promise.all([
          getJson("/api/skct-personal?view=home"),
          id && mode ? loadAttempt(id, mode).catch(error => {
            if (!initialAttemptId) sessionStorage.removeItem(attemptKey(mode));
            if (live && (initialAttemptId || !(error instanceof Error) || !error.message.startsWith("요청한 학습 방식")))
              setMessage(error instanceof Error ? error.message : "학습 기록을 열지 못했습니다.");
            return null;
          }) : Promise.resolve(null),
        ]);
        if (!live) return;
        setHome(loaded);
        if (!id || !current) return;
        const rawPending = sessionStorage.getItem(pendingKey(id));
        if (live) setHasPending(Boolean(rawPending));
        if (!rawPending) return;
        const pending = JSON.parse(rawPending) as Pending;
        if (pending.action === "checkpoint") return;
        if (pending.attemptId !== id) {
          sessionStorage.removeItem(pendingKey(id));
          if (live) setHasPending(false);
          return;
        }
        if (current.revision === pending.revision && current.status === "in_progress") {
          if (!claimLease(id)) return;
          try {
            const result = await postJson(pending);
            if (live) {
              setAttempt(result.attempt); setPosition(result.attempt.activePosition ?? current.activePosition ?? 1);
              if (current.mode === "mock" && pending.action !== "submit" && mockLocalRef.current)
                saveMockLocal(id,{ ...mockLocalRef.current, revision: result.attempt.revision });
            }
            sessionStorage.removeItem(pendingKey(id));
            if (live) setHasPending(false);
          } catch (error) {
            if (error instanceof ApiError && error.status >= 400 && error.status < 500) await resolveRejectedPending(id);
            else throw error;
          }
        } else {
          const item = current.items.find(row => row.position === pending.position);
          const confirmed = current.lastOperationId === pending.operationId
            || pending.action === "focus" && current.activePosition === pending.position
            || pending.action === "submit" && current.status === "submitted"
            || Boolean(item && item.selectedIndex === pending.choiceIndex && (pending.action === "save" || item.finalized));
          sessionStorage.removeItem(pendingKey(id));
          if (live) setHasPending(false);
          if (!confirmed && live) setMessage("이전 입력의 반영 여부가 불확실합니다. 현재 서버 기록을 불러왔으니 답안을 확인해 주세요.");
        }
      } catch (error) { if (live) setMessage(error instanceof Error ? error.message : "학습 자료를 열지 못했습니다."); }
    })();
    return () => { live = false; };
  }, [authenticated, claimLease, initialAttemptId, loadAttempt, refreshRecords, resolveRejectedPending, saveMockLocal, view]);

  async function start(unitId: string, mode: "practice" | "mock") {
    if (hasPending) { setMessage("이전 저장을 먼저 확인해 주세요."); return; }
    setBusy(true); setMessage("");
    try {
      startRequest.current ??= crypto.randomUUID();
      const data = await postJson({ action: "start", unitId, mode, fresh: true,
        operationId: startRequest.current, practiceFlowVersion: 3 });
      startRequest.current = null;
      window.history.replaceState(window.history.state,"",`${window.location.pathname}?attempt=${encodeURIComponent(data.attempt.id)}`);
      setAttempt(data.attempt); setPosition(data.attempt.activePosition ?? 1);
      attemptRef.current = data.attempt;
      setDraftChoices({});
      if (mode === "mock") {
        if (data.resumed) await loadAttempt(data.attempt.id,"mock");
        else {
          saveMockLocal(data.attempt.id, { revision: data.attempt.revision,
            position: data.attempt.activePosition ?? 1, choices: {}, deltas: {} });
          setMockConflict(false);
        }
      }
      sessionStorage.setItem(attemptKey(mode), data.attempt.id);
      setHasPending(Boolean(sessionStorage.getItem(pendingKey(data.attempt.id))));
      claimLease(data.attempt.id);
    } catch (error) { setMessage(error instanceof Error ? error.message : "학습을 시작하지 못했습니다."); }
    finally { setBusy(false); }
  }
  const mutate = useCallback(async (action: Pending["action"], nextPosition?: number, choiceIndex?: number) => {
    if (!attempt || busy || hasPending || !claimLease(attempt.id)) return;
    const pending: Pending = { action, attemptId: attempt.id, operationId: crypto.randomUUID(), revision: attempt.revision,
      ...(attempt.mode === "practice" ? { practiceFlowVersion: 3 as const } : {}),
      ...(nextPosition ? { position: nextPosition } : {}), ...(choiceIndex ? { choiceIndex } : {}) };
    sessionStorage.setItem(pendingKey(attempt.id), JSON.stringify(pending));
    setHasPending(true);
    setBusy(true); setMessage("");
    try {
      const data = await postJson(pending);
      sessionStorage.removeItem(pendingKey(attempt.id));
      setHasPending(false);
      setAttempt(data.attempt);
      attemptRef.current = data.attempt;
      if (data.attempt.fullMock) {
        const next = data.attempt.activePosition ?? position;
        setPosition(next);
        saveMockLocal(data.attempt.id,{ revision: data.attempt.revision, position: next, choices: {}, deltas: {} });
      }
      if ((action === "focus" || action === "append") && data.attempt.activePosition) setPosition(data.attempt.activePosition);
    } catch (error) {
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) await resolveRejectedPending(attempt.id);
      else setMessage((error instanceof Error ? error.message : "저장하지 못했습니다.") + " 연결이 돌아오면 이 작업을 다시 시도합니다.");
    } finally { setBusy(false); }
  }, [attempt, busy, hasPending, claimLease, resolveRejectedPending, position, saveMockLocal]);
  const updateMockLocal = useCallback((action: MockLocalAction) => {
    const state = attemptRef.current;
    const current = mockLocalRef.current;
    if (!state || state.mode !== "mock" || !current || submissionLockRef.current) return;
    commitMockLocal(state.id,action);
  }, [commitMockLocal]);
  const flushMockCheckpoint = useCallback(async (pause = false, resolvingConflict = false): Promise<Attempt | null> => {
    const state = attemptRef.current;
    const local = mockLocalRef.current;
    if (!state || state.mode !== "mock" || state.status !== "in_progress" || !local || (mockConflict && !resolvingConflict)
      || mockCheckpointInFlight.current || !claimLease(state.id)) return null;
    let pending: Pending | null = null;
    try { pending = JSON.parse(sessionStorage.getItem(pendingKey(state.id)) ?? "null") as Pending | null; }
    catch { setMockConflict(true); setMessage("로컬 저장 상태를 확인하지 못했습니다. 서버 기록과 비교해 주세요."); return null; }
    if (pending && (pending.action !== "checkpoint" || pending.revision !== state.revision)) {
      setMockConflict(true);
      setMessage("다른 화면의 저장 상태와 충돌했습니다. 로컬 답안을 확인해 주세요.");
      return null;
    }
    if (!pending) {
      const answers = Object.entries(local.choices).map(([position,choiceIndex]) => ({ position: Number(position), choiceIndex }))
        .filter(row => state.items.find(item => item.position === row.position)?.selectedIndex !== row.choiceIndex);
      const times = Object.entries(local.deltas).map(([position,seconds]) => ({ position: Number(position), seconds }))
        .filter(row => row.seconds > 0);
      const activePosition = pause ? null : local.position;
      if (!answers.length && !times.length && state.activePosition === activePosition) return state;
      pending = { action: "checkpoint", attemptId: state.id, operationId: crypto.randomUUID(),
        revision: state.revision, activePosition, answers, times };
      sessionStorage.setItem(pendingKey(state.id),JSON.stringify(pending));
      setHasPending(true);
    }
    mockCheckpointInFlight.current = true;
    try {
      const response = await postJson(pending);
      const updated = response.attempt as Attempt;
      attemptRef.current = updated;
      setAttempt(updated);
      const latest = mockLocalRef.current ?? local;
      const choices = { ...latest.choices };
      const deltas = { ...latest.deltas };
      for (const answer of pending.answers ?? []) if (choices[answer.position] === answer.choiceIndex) delete choices[answer.position];
      for (const time of pending.times ?? []) deltas[time.position] = Math.max(0,(deltas[time.position] ?? 0)-time.seconds);
      const checkpointPosition = updated.fullMock ? updated.activePosition ?? latest.position : latest.position;
      if (updated.fullMock && checkpointPosition !== latest.position) { setPosition(checkpointPosition); }
      saveMockLocal(state.id,{ ...latest, position: checkpointPosition, revision: updated.revision,
        choices: updated.fullMock && checkpointPosition !== latest.position ? {} : choices,
        deltas: updated.fullMock && checkpointPosition !== latest.position ? {} : deltas });
      sessionStorage.removeItem(pendingKey(state.id));
      setHasPending(false);
      setMessage("");
      return updated;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        preserveMockVisibleAnswers(state.id);
        sessionStorage.removeItem(pendingKey(state.id));
        setHasPending(false);
        setMockConflict(true);
        try { await loadAttempt(state.id,"mock"); } catch { /* local draft remains in sessionStorage */ }
        setMockConflict(true);
        setMessage("다른 탭의 저장과 충돌했습니다. 로컬 답안을 확인한 뒤 다시 저장하거나 서버 답안을 사용해 주세요.");
      } else setMessage("모의고사 답안을 저장하지 못했습니다. 연결이 돌아오면 같은 작업을 다시 시도합니다.");
      return null;
    } finally { mockCheckpointInFlight.current = false; }
  }, [claimLease, loadAttempt, mockConflict, preserveMockVisibleAnswers, saveMockLocal]);
  useEffect(() => {
    if (!attempt || attempt.mode !== "mock" || attempt.status !== "in_progress" || mockConflict) return;
    const raw = sessionStorage.getItem(pendingKey(attempt.id));
    if (raw) void flushMockCheckpoint();
  }, [attempt, mockConflict, flushMockCheckpoint]);
  useEffect(() => {
    if (!attempt || attempt.mode !== "mock" || attempt.status !== "in_progress" || readOnlyTab || mockConflict
      || attempt.fullMock && attempt.fullMock.phase !== "answering") return;
    let lastTick = Date.now();
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") { lastTick = Date.now(); return; }
      const now = Date.now();
      const seconds = Math.min(30,Math.floor((now-lastTick)/1_000));
      if (seconds < 1) return;
      lastTick = now;
      updateMockLocal({ type: "tick", seconds });
    },1_000);
    return () => window.clearInterval(timer);
  }, [attempt, readOnlyTab, mockConflict, updateMockLocal]);
  useEffect(() => {
    if (!attempt || attempt.mode !== "mock" || attempt.status !== "in_progress" || readOnlyTab || mockConflict
      || attempt.fullMock && attempt.fullMock.phase !== "answering") return;
    const timer = window.setInterval(() => void flushMockCheckpoint(),20_000);
    const visibility = () => { if (document.visibilityState === "hidden") void flushMockCheckpoint(true); };
    const pagehide = () => { void flushMockCheckpoint(true); };
    document.addEventListener("visibilitychange",visibility);
    window.addEventListener("pagehide",pagehide);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange",visibility);
      window.removeEventListener("pagehide",pagehide); };
  }, [attempt, readOnlyTab, mockConflict, flushMockCheckpoint]);
  useEffect(() => {
    if (!attempt || attempt.mode !== "practice" || attempt.status !== "in_progress" || readOnlyTab || hasPending) return;
    const active = attempt.items.find(item => item.position === position);
    if (!active || active.finalized || attempt.activePosition !== position) return;
    const tick = () => { if (document.visibilityState === "visible") void mutate("focus", position); };
    const timer = window.setInterval(tick, 20_000);
    const visibility = () => {
      if (document.visibilityState === "hidden") void mutate("pause");
      else if (document.visibilityState === "visible") void mutate("focus", position);
    };
    document.addEventListener("visibilitychange", visibility);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", visibility); };
  }, [attempt, position, readOnlyTab, hasPending, mutate]);
  useEffect(() => {
    if (!attempt || attempt.mode !== "practice" || attempt.status !== "in_progress" || attempt.activePosition !== position ||
        attempt.activeSince !== null || busy || hasPending || readOnlyTab || document.visibilityState !== "visible") return;
    const item = attempt.items.find(row => row.position === position);
    if (item && !item.finalized) {
      const timer = window.setTimeout(() => void mutate("focus", position), 0);
      return () => window.clearTimeout(timer);
    }
  }, [attempt, position, busy, hasPending, readOnlyTab, mutate]);
  async function retryPending() {
    if (!attempt || busy || !claimLease(attempt.id)) return;
    const raw = sessionStorage.getItem(pendingKey(attempt.id));
    if (!raw) return;
    try { if ((JSON.parse(raw) as Pending).action === "checkpoint") { await flushMockCheckpoint(); return; } }
    catch { setMockConflict(true); return; }
    setBusy(true);
    try {
      const pending = JSON.parse(raw) as Pending;
      const data = await postJson(pending);
      sessionStorage.removeItem(pendingKey(attempt.id));
      setHasPending(false);
      setAttempt(data.attempt); setMessage("");
      if (attempt.mode === "mock" && pending.action !== "submit" && mockLocalRef.current)
        saveMockLocal(attempt.id,{ ...mockLocalRef.current, revision: data.attempt.revision });
      if ((pending.action === "focus" || pending.action === "append") && data.attempt.activePosition) setPosition(data.attempt.activePosition);
      if (pending.action === "submit") {
        sessionStorage.removeItem(mockLocalKey(pending.attemptId));
        mockLocalRef.current = null;
        dispatchMockLocal({ type: "replace", value: null });
      }
    } catch (error) {
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
        try { const pending = JSON.parse(raw) as Pending; await resolveRejectedPending(pending.attemptId); }
        catch { setMessage("현재 서버 기록을 불러오지 못했습니다. 페이지를 새로고침해 주세요."); }
      } else setMessage(error instanceof Error ? error.message : "다시 저장하지 못했습니다.");
    }
    finally { setBusy(false); }
  }
  async function submitMock() {
    const current = attemptRef.current;
    if (!current || current.mode !== "mock" || current.status !== "in_progress" || busy || mockConflict
      || submissionLockRef.current || !claimLease(current.id)) return;
    submissionLockRef.current = true;
    setBusy(true);
    try {
      const saved = await flushMockCheckpoint(true);
      if (!saved) return;
      const pending: Pending = { action: "submit", attemptId: saved.id, revision: saved.revision,
        operationId: crypto.randomUUID() };
      sessionStorage.setItem(pendingKey(saved.id),JSON.stringify(pending));
      setHasPending(true);
      const result = await postJson(pending);
      attemptRef.current = result.attempt;
      setAttempt(result.attempt);
      sessionStorage.removeItem(pendingKey(saved.id));
      sessionStorage.removeItem(mockLocalKey(saved.id));
      mockLocalRef.current = null;
      dispatchMockLocal({ type: "replace", value: null });
      setHasPending(false);
      setMessage("");
      setShowSubmitConfirm(false);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        preserveMockVisibleAnswers(current.id);
        sessionStorage.removeItem(pendingKey(current.id));
        setHasPending(false);
        setShowSubmitConfirm(false);
        try {
          const latest = await loadAttempt(current.id,"mock");
          if (latest.status === "in_progress") {
            setMockConflict(true);
            setMessage("다른 탭에서 답안이 저장되었습니다. 이 탭 답안과 서버 답안 중 계속 사용할 것을 선택해 주세요.");
          } else setMessage("다른 탭에서 모의고사가 이미 제출되었습니다. 서버 결과를 불러왔습니다.");
        } catch {
          setMockConflict(true);
          setMessage("서버 기록을 불러오지 못했습니다. 이 탭의 답안은 남아 있습니다. 새로고침 후 다시 확인해 주세요.");
        }
      } else setMessage((error instanceof Error ? error.message : "제출하지 못했습니다.") + " 연결이 돌아오면 다시 시도해 주세요.");
    } finally { submissionLockRef.current = false; setBusy(false); }
  }
  useEffect(() => {
    const exam = attempt?.fullMock;
    if (!exam || attempt?.status !== "in_progress" || busy || hasPending || readOnlyTab || mockConflict || mockCheckpointInFlight.current) return;
    const deadline = exam.phase === "break" ? exam.breakUntil : exam.sectionDeadlineAt;
    if (deadline && clockNow >= Date.parse(deadline)) {
      const timer = window.setTimeout(() => void mutate("sync-exam"),0);
      return () => window.clearTimeout(timer);
    }
  }, [attempt,clockNow,busy,hasPending,readOnlyTab,mockConflict,mutate]);
  async function advanceFullMock() {
    if (!attempt?.fullMock || busy || mockCheckpointInFlight.current) return;
    const choice = mockLocalRef.current?.choices[position] ?? attempt.items.find(item => item.position === position)?.selectedIndex;
    setShowSkipConfirm(false);
    await mutate("advance",position,choice ?? undefined);
  }
  const current = attempt?.items.find(item => item.position === position);
  useEffect(() => { if (current?.feedback) feedbackRef.current?.focus(); }, [current?.feedback]);
  const currentPosition = current?.position;
  useEffect(() => { if (currentPosition) document.getElementById("skct-current-question")?.focus({preventScroll:true}); }, [currentPosition]);
  const unitName = attempt?.fullMock ? "전체 영역" : unitNames[attempt?.unitId ?? ""] ?? attempt?.unitId;
  const exam = attempt?.fullMock;
  const sectionName = exam ? SKCT_LEARNING_UNITS[exam.sectionIndex]?.name : unitName;
  const deadline = exam?.phase === "break" ? exam.breakUntil : exam?.sectionDeadlineAt;
  const remaining = deadline ? Math.max(0,Math.ceil((Date.parse(deadline)-clockNow)/1000)) : 0;
  const timeLabel = `${Math.floor(remaining/60).toString().padStart(2,"0")}:${(remaining%60).toString().padStart(2,"0")}`;
  const draftKey = current && attempt ? `${attempt.id}:${current.position}` : "";
  const selectedIndex = attempt?.mode === "mock" && attempt.status === "in_progress"
    ? mockLocal?.choices[position] ?? current?.selectedIndex
    : current?.selectedIndex ?? draftChoices[draftKey];
  const unansweredCount = attempt?.items.filter(item => (mockLocal?.choices[item.position] ?? item.selectedIndex) === null).length ?? 0;
  const correctAnswerIndex = current?.feedback?.answerIndex;
  const correctAnswerText = correctAnswerIndex && current
    ? choiceTextWithoutNumber(current.question.displayChoices[correctAnswerIndex-1] ?? "", correctAnswerIndex-1) : "";
  return <CatalogPageShell displayName={session.status === "blocked" ? "" : session.displayName}
    signInPath={session.status === "blocked" ? "/" : session.signInPath}
    signOutPath={session.status === "active" || session.status === "blocked" ? session.signOutPath : ""}
    isAuthenticated={authenticated} adminAccess={session.status === "active" && session.adminAccess}
    groupExamAccess={session.status === "active" && session.groupExamAccess}
    context={{ title: view === "home" ? "SKCT 개인학습" : view === "practice" ? "SKCT 문제 풀이" : view === "mock" ? "SKCT 모의고사" : "SKCT 학습 기록",
      description: view === "home" ? "영역별 연습부터 모의고사와 기록 확인까지." : view === "records" ? "진행 중인 학습과 완료한 결과를 확인하세요." : "학습할 영역을 선택하고 시작하세요." }}
    navigation={SKCT_SECTION_LINKS.map(item => ({ ...item, active: view === item.view }))}>
    <div className="skct-personal page-stack">
      <nav className="skct-breadcrumb" aria-label="현재 위치"><a href="/">학습 분야</a><span aria-hidden="true">›</span>
        {view === "home" ? <span aria-current="page">SKCT 개인학습</span> : <><a href="/learn/skct-personal">SKCT 개인학습</a><span aria-hidden="true">›</span><span aria-current="page">{SKCT_SECTION_LINKS.find(item => item.view === view)?.label}</span></>}
      </nav>
      {view === "home" && <SkctLearningHome authenticated={authenticated} signInPath={session.status === "blocked" ? "/" : session.signInPath} />}
      {(message || hasPending) && <p className="skct-save-message" role="status">{message || "저장되지 않은 입력이 있습니다. 저장을 다시 시도해 주세요."} {hasPending && !mockConflict && <button type="button" onClick={() => void retryPending()} disabled={busy}>저장 다시 시도</button>}</p>}
      {view !== "records" && home && !home.available && <p role="status" className="skct-closed">문항을 검수하고 있습니다. 검수가 끝나면 새 학습을 시작할 수 있습니다. <a href="/learn/skct-personal/records">기존 학습 기록 보기</a> · <a href="/">다른 학습 과정 보기</a></p>}
      {(view === "practice" || view === "mock") && !attempt && <SkctLearningSetup mode={view}
        units={home?.units.length ? home.units : [...SKCT_LEARNING_UNITS]} selectedUnitId={selectedUnitId}
        onSelectUnit={setSelectedUnitId} onStart={unitId => void start(unitId, view)}
        busy={busy} pending={hasPending} available={Boolean(home?.available)} loading={!home && !message} />}
      {(view === "practice" || view === "mock") && attempt && <section className={`skct-attempt skct-exam-workspace${exam ? " skct-full-mock" : ""}`} aria-labelledby="skct-attempt-title">
        {attempt.status === "in_progress" && readOnlyTab && <p role="status">이 학습은 다른 탭에서 열려 있습니다. 이 탭에서는 읽기만 할 수 있습니다. <button type="button" onClick={() => claimLease(attempt.id, true)}>이 탭에서 이어 풀기</button></p>}
        {attempt.mode === "mock" && attempt.status === "in_progress" && mockConflict && <div className="skct-save-message" role="alert">
          <p>다른 탭에서 저장한 기록과 이 탭의 답안이 다릅니다. 어느 답안을 계속 사용할지 선택해 주세요.</p>
          <button type="button" disabled={busy || readOnlyTab} onClick={async () => {
            const local = mockLocalRef.current;
            if (!local) return;
            sessionStorage.removeItem(pendingKey(attempt.id));
            setHasPending(false);
            saveMockLocal(attempt.id,{ ...local, revision: attempt.revision });
            setMockConflict(false);
            setMessage("로컬 답안을 선택했습니다. 서버에 저장합니다.");
            await flushMockCheckpoint(false, true);
          }}>이 탭 답안 사용</button>
          <button type="button" disabled={busy || readOnlyTab} onClick={() => {
            sessionStorage.removeItem(pendingKey(attempt.id));
            sessionStorage.removeItem(mockLocalKey(attempt.id));
            setHasPending(false);
            const next = attempt.activePosition ?? 1;
            saveMockLocal(attempt.id,{ revision: attempt.revision, position: next, choices: {}, deltas: {} });
            setPosition(next);
            setMockConflict(false);
            setMessage("서버 답안을 선택했습니다.");
          }}>서버 답안 사용</button>
        </div>}
        <div className="skct-attempt-head"><div><p className="section-kicker">{attempt.mode === "practice" ? "문제 풀이" : "모의고사"}</p>
          <h2 id="skct-attempt-title">{unitName} · {attempt.items.length}문항</h2>
          {attempt.status === "submitted" && <p>완료 · {attempt.correctCount ?? 0}/{attempt.items.length} 정답</p>}</div>
          <button type="button" onClick={async () => {
            setBusy(true);
            try {
              if (attempt.mode === "mock" && attempt.status === "in_progress") {
                const saved = await flushMockCheckpoint(true);
                if (!saved) {
                  setMessage("현재 모의고사 저장을 확인하지 못했습니다. 답안을 보존했으니 저장을 다시 시도해 주세요.");
                  return;
                }
              }
              setAttempt(null); setHasPending(false); setReadOnlyTab(false); setDraftChoices({});
              setShowSubmitConfirm(false); setShowFinishConfirm(false);
              sessionStorage.removeItem(attemptKey(attempt.mode));
              window.history.replaceState(window.history.state, "", window.location.pathname);
            } finally { setBusy(false); }
          }} disabled={busy}className="secondary-button">{attempt.mode === "mock" ? "응시 설정" : "영역 선택"}</button></div>
        {exam && <div className="skct-exam-status" aria-label="시험 진행 상태">
          <ol>{SKCT_LEARNING_UNITS.map((unit,index) => <li key={unit.id} aria-current={exam.sectionIndex === index ? "step" : undefined}
            className={exam.sectionIndex > index || exam.phase === "completed" ? "completed" : ""}><span>{index+1}</span>{unit.name}</li>)}</ol>
          {attempt.status === "in_progress" && <div className="skct-exam-clock" role="timer" aria-label={exam.phase === "break" ? "휴식 남은 시간" : "영역 남은 시간"}>
            <span>{exam.phase === "break" ? "다음 영역까지" : `${sectionName} 남은 시간`}</span><strong>{timeLabel}</strong></div>}
        </div>}
        {(attempt.status === "submitted" || attempt.mode === "mock" && !exam) && <nav className="skct-question-nav" aria-label="문항 이동">{attempt.items.map(item => <button key={item.position} type="button"
          aria-current={position === item.position ? "step" : undefined} aria-label={`${item.position}번 문항${item.finalized ? " 완료" : ""}`}
          disabled={busy || (attempt.mode === "practice" && hasPending) || (readOnlyTab && attempt.status === "in_progress") || mockConflict}
          onClick={() => { if (submissionLockRef.current) return; if (attempt.mode === "mock" && attempt.status === "in_progress") {
            setPosition(item.position); updateMockLocal({ type: "navigate", position: item.position });
          } else if (attempt.status === "submitted" || item.finalized) setPosition(item.position);
          else void mutate("focus", item.position); }}>{item.position}{item.finalized ? " ✓" : ""}</button>)}</nav>}
        {exam?.phase === "break" && attempt.status === "in_progress" && <section className="skct-exam-break" aria-label="영역 사이 휴식">
          <span className="section-kicker">잠시 쉬어가세요</span><h3>다음은 {sectionName} 영역입니다.</h3>
          <p>20문항 · 15분. 휴식이 끝나면 첫 문항이 자동으로 열립니다.</p><strong>{timeLabel}</strong></section>}
        <div className="skct-exam-layout">
        {current && (exam?.phase !== "break" || attempt.status === "submitted") && <article className="skct-current" aria-labelledby="skct-current-question">
          <p className="skct-question-count">{exam ? `${current.question.unitId ? unitNames[current.question.unitId] : sectionName} · ${(current.position-1)%SKCT_MOCK_SECTION_QUESTIONS+1} / ${SKCT_MOCK_SECTION_QUESTIONS}` : `현재 ${current.position}번 · ${attempt.items.filter(item => item.finalized).length}문항 확인`} · 풀이 시간 {current.elapsedSeconds + (attempt.mode === "mock" ? mockLocal?.deltas[current.position] ?? 0 : 0)}초</p>
          <QuestionContent item={current} />
          <fieldset disabled={busy || (attempt.mode === "practice" && hasPending) || readOnlyTab || mockConflict || current.finalized || attempt.status === "submitted"}>
            <legend>답안 선택</legend>
            {current.question.displayChoices.map((choice,index) => <label className="skct-choice" key={index}>
              <input type="radio" name={`skct-${attempt.id}-${current.position}`} checked={selectedIndex === index+1}
                aria-label={`${labels[index]} ${choiceTextWithoutNumber(choice, index)}`}
                onChange={() => attempt.mode === "practice"
                  ? setDraftChoices(previous => ({ ...previous, [draftKey]: index+1 }))
                  : updateMockLocal({ type: "choose", position: current.position, choiceIndex: index+1 })} />
              <span className="skct-choice-label" aria-hidden="true">{labels[index]}</span><span className="skct-choice-text">{choiceTextWithoutNumber(choice,index)}</span>
            </label>)}
          </fieldset>
          {attempt.mode === "practice" && attempt.status === "in_progress" && !current.finalized &&
            <div className="skct-answer-action"><p>선택만으로는 채점되지 않습니다. 정답 확인을 누르면 답안이 확정됩니다.</p>
              <button className="primary-button" type="button" disabled={busy || hasPending || readOnlyTab || selectedIndex == null}
                onClick={() => void mutate("answer", current.position, selectedIndex ?? undefined)}>정답 확인</button></div>}
          {current.feedback && <section className="skct-feedback" aria-label="채점 결과" tabIndex={-1} ref={feedbackRef}>
            <h4>{current.feedback.correct ? "정답입니다" : `정답은 ${labels[current.feedback.answerIndex-1]} ${correctAnswerText}입니다`}</h4>
            <p>{current.feedback.explanation}</p>
            {Object.entries(current.feedback.distractorExplanations).length > 0 && <details><summary>다른 선택지 해설</summary>
              {Object.entries(current.feedback.distractorExplanations).map(([label,value]) => <p key={label}><strong>{label}</strong> {value}</p>)}</details>}
          </section>}
          <div className="skct-question-actions">
            {attempt.mode === "practice" && position > 1 && <button className="secondary-button" type="button" disabled={busy || hasPending}
              onClick={() => attempt.items.find(item=>item.position===position-1)?.finalized || attempt.status === "submitted" ? setPosition(position-1) : void mutate("focus",position-1)}>이전 문항</button>}
            {(current.finalized || attempt.mode === "practice" && current.position < attempt.items.length) && (current.position < attempt.items.length || attempt.mode === "practice" && attempt.status === "in_progress") &&
              <button className="primary-button" type="button" disabled={busy || hasPending || readOnlyTab}
                onClick={() => { const next = current.position+1; if (next > attempt.items.length) void mutate("append");
                  else if (attempt.status === "submitted" || attempt.items.find(item => item.position === next)?.finalized) setPosition(next);
                  else void mutate("focus",next); }}>다음 문항</button>}
            {exam && attempt.status === "in_progress" && <button className="primary-button" type="button" disabled={busy || hasPending || readOnlyTab || mockConflict || remaining === 0}
              onClick={() => selectedIndex == null ? setShowSkipConfirm(true) : void advanceFullMock()}>
              {position === 100 ? "시험 마치기" : position%20 === 0 ? "영역 마치기" : "다음 문항"}</button>}
          </div>
        </article>}
        {current && exam?.phase !== "break" && <SkctExamTools key={attempt.id} />}
        </div>
        {attempt.mode === "practice" && attempt.status === "in_progress" && <button type="button"
          className="secondary-button skct-finish" disabled={busy || hasPending || readOnlyTab}
          onClick={() => setShowFinishConfirm(true)}>연습 마치기</button>}
        {attempt.mode === "mock" && attempt.status === "in_progress" && <button className="secondary-button skct-submit" type="button" disabled={busy || readOnlyTab || mockConflict}
          onClick={() => setShowSubmitConfirm(true)}>모의고사 제출</button>}
      </section>}
      {showSkipConfirm && <Modal title="미응답 문항 넘기기" onClose={() => setShowSkipConfirm(false)}>
        <p>답안을 선택하지 않았습니다. 넘기면 이 문항으로 돌아갈 수 없습니다.</p><div className="modal-actions">
          <button className="secondary-button" type="button" onClick={() => setShowSkipConfirm(false)}>계속 풀기</button>
          <button className="primary-button" type="button" onClick={() => void advanceFullMock()}>미응답으로 넘기기</button></div></Modal>}
      {showSubmitConfirm && attempt?.mode === "mock" && attempt.status === "in_progress" && <Modal
        title="모의고사 제출 확인" onClose={() => { if (!busy) setShowSubmitConfirm(false); }}>
        <p>미응답 문항: {unansweredCount}개. 제출하면 답안을 바꿀 수 없고 정답과 해설이 공개됩니다.</p>
        <div className="modal-actions"><button type="button" disabled={busy} onClick={() => setShowSubmitConfirm(false)}>계속 풀기</button>
          <button type="button" disabled={busy || readOnlyTab || mockConflict} onClick={() => void submitMock()}>제출 확정</button></div>
      </Modal>}
      {showFinishConfirm && attempt?.mode === "practice" && attempt.status === "in_progress" && <Modal
        title="연습 마치기 확인" onClose={() => setShowFinishConfirm(false)}>
        <p>연습을 마치면 이 시도에 문항을 더할 수 없습니다. 이미 확인한 답안과 해설은 학습 기록에서 다시 볼 수 있습니다.</p>
        <div className="modal-actions"><button type="button" onClick={() => setShowFinishConfirm(false)}>계속 풀기</button>
          <button type="button" disabled={busy || hasPending || readOnlyTab} onClick={() => {
            setShowFinishConfirm(false);
            void mutate("finish");
          }}>연습 마치기 확정</button></div>
      </Modal>}
      {view === "records" && <><SkctLearningStatistics statistics={statistics} /><section className="skct-records" aria-labelledby="skct-records-title"><h2 id="skct-records-title">학습 기록</h2>
        <button type="button" onClick={() => void refreshRecords()} disabled={busy}>기록 새로고침</button>
        {records?.length === 0 && <p>아직 저장된 기록이 없습니다.</p>}
        <ul>{records?.map(record => <li key={record.id}>
          <span><strong>{record.full_mock ? "전체 영역" : unitNames[record.unit_id] ?? record.unit_id} · {record.mode === "practice" ? "문제 풀이" : "모의고사"}</strong>
            <span className="skct-record-detail">시작 {dateTimeLabel(record.started_at)} · {record.answered_count}/{record.question_count} 풀이 · {record.elapsed_seconds}초
              {record.status === "submitted" ? ` · ${record.correct_count}/${record.mode === "mock" ? record.question_count : record.finalized_count ?? record.answered_count} 정답` : " · 진행 중"}</span></span>
          <a href={`/learn/skct-personal/${record.mode === "practice" ? "practice" : "mock-exams"}?attempt=${encodeURIComponent(record.id)}`}>
            {record.status === "submitted" ? "결과 보기" : "이어 풀기"}</a>
        </li>)}</ul>
        {recordsCursor && <button type="button" disabled={busy} onClick={() => void refreshRecords(recordsCursor)}>이전 기록 더 보기</button>}
      </section></>}
    </div>
    <nav className="mobile-nav skct-mobile-nav" aria-label="SKCT 개인학습 메뉴">
      {SKCT_SECTION_LINKS.map(item => <a key={item.view} className={`mobile-nav-item${view === item.view ? " active" : ""}`}
        href={item.href} aria-current={view === item.view ? "page" : undefined}><span aria-hidden="true">{item.icon}</span>{item.label}</a>)}
    </nav>
  </CatalogPageShell>;
}
