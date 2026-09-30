"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { connectGroupSocket, type GroupSocketStatus } from "./group-exam-socket";
import styles from "./group-exam.module.css";
import { groupExamApi as api, GroupApiError } from "./group-exam-api";
import { GroupExamModal } from "./group-exam-modal";
import { seedGroupExam } from "./group-exam-start-state";
import { finishLobbyPoll, nextLobbyPoll, type LobbyPollDeadlines } from "./group-exam-lobby-poll";
import {
  confirmsGroupSettingsReadback,
  GROUP_EXAM_AREAS,
  groupSettingsDraft,
  groupSettingsSubmission,
  storedAreaSeconds,
  type GroupSettingsDraft,
  type GroupSettingsSubmission,
} from "./group-exam-settings";

type AnyRecord = Record<string, unknown>;
type MutationOptions = {
  successNotice?: string;
  verifyDetail?: (detail: AnyRecord) => boolean;
  verificationError?: string;
  onFailure?: (outcome: "rejected" | "unconfirmed") => void;
};
type UserMutation = (action: string, values?: AnyRecord, options?: MutationOptions) => Promise<AnyRecord | null>;
type SettingsPendingAttempt = {
  idempotencyKey: string;
  submission: GroupSettingsSubmission;
};
type PresenceHealth = { status: "unknown" | "fresh" | "degraded"; lastSuccessAt: number | null };

function operationId(prefix: string) {
  return `${prefix}:${crypto.randomUUID()}`;
}

function subscribeNetworkStatus(onStoreChange: () => void) {
  window.addEventListener("online", onStoreChange);
  window.addEventListener("offline", onStoreChange);
  return () => {
    window.removeEventListener("online", onStoreChange);
    window.removeEventListener("offline", onStoreChange);
  };
}

export function GroupExamClient() {
  const router=useRouter();
  const [groups, setGroups] = useState<AnyRecord[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<AnyRecord | null>(null);
  const [members, setMembers] = useState<AnyRecord[]>([]);
  const [sync, setSync] = useState<AnyRecord | null>(null);
  const [presenceHealth, setPresenceHealth] = useState<PresenceHealth>({ status: "unknown", lastSuccessAt: null });
  const [syncRefreshNonce, setSyncRefreshNonce] = useState(0);
  const [notice, setNotice] = useState("");
  const deviceOnline = useSyncExternalStore(subscribeNetworkStatus, () => navigator.onLine, () => true);
  const [pendingActions, setPendingActions] = useState(new Set<string>());
  const pendingActionRef = useRef(new Set<string>());
  const [pageState, setPageState] = useState<"loading" | "ready" | "error">("loading");
  const [ownedActiveCount, setOwnedActiveCount] = useState(0);
  const [capabilities, setCapabilities] = useState({ personalProgress: false, strictRepeat: false, webSocket: false });
  const [socketStatus,setSocketStatus] = useState<GroupSocketStatus>("connecting");
  const retryKeys = useRef(new Map<string, string>());
  const settingsPendingAttemptsRef = useRef(new Map<string, SettingsPendingAttempt>());
  const [settingsPendingAttempts, setSettingsPendingAttempts] = useState(new Map<string, SettingsPendingAttempt>());
  const selectedIdRef = useRef("");
  const groupsRef = useRef(groups);
  useEffect(() => { groupsRef.current = groups; }, [groups]);
  const createForm = useRef<HTMLDetailsElement>(null);
  const createName = useRef<HTMLInputElement>(null);
  const hydratedDetailId = useRef("");
  const syncRequestSequence = useRef(0);
  const syncPhase = useRef("idle");
  const syncRef = useRef<AnyRecord | null>(null);
  const presenceSessionId = useRef(`presence:${crypto.randomUUID()}`);

  const updateSettingsPendingAttempt = useCallback((groupId: string, attempt: SettingsPendingAttempt | null) => {
    const next = new Map(settingsPendingAttemptsRef.current);
    if (attempt) next.set(groupId, attempt);
    else next.delete(groupId);
    settingsPendingAttemptsRef.current = next;
    setSettingsPendingAttempts(next);
  }, []);

  const resetSelection = useCallback((groupId: string) => {
    selectedIdRef.current = groupId;
    syncRequestSequence.current += 1;
    hydratedDetailId.current = "";
    setDetail(null); setMembers([]); setSync(null);
    syncRef.current = null; syncPhase.current = "idle";
    setPresenceHealth({ status: "unknown", lastSuccessAt: null });
    setSelectedId(groupId);
  }, []);
  const forgetGroup = useCallback((groupId: string) => {
    const next = groupsRef.current.filter(group => group.id !== groupId);
    groupsRef.current = next; setGroups(next);
    updateSettingsPendingAttempt(groupId, null);
    if (selectedIdRef.current === groupId) resetSelection(String(next[0]?.id ?? ""));
  }, [resetSelection, updateSettingsPendingAttempt]);

  const refresh = useCallback(async () => {
    const body = await api("/api/group-exams?scope=groups");
    const next = (body.groups as AnyRecord[]) ?? [];
    setGroups(next);
    setOwnedActiveCount(Number(body.ownedActiveCount ?? next.filter(g => g.is_owner).length));
    if (body.capabilities) setCapabilities(body.capabilities as typeof capabilities);
    groupsRef.current = next;
    if (!next.some(group => group.id === selectedIdRef.current)) resetSelection(String(next[0]?.id ?? ""));
    return next;
  }, [resetSelection]);

  const refreshDetail = useCallback(async (groupId: string) => {
    if (!groupId) return null;
    let body: AnyRecord;
    try { body = await api(`/api/group-exams?scope=group&groupId=${encodeURIComponent(groupId)}`); }
    catch (error) {
      if (error instanceof GroupApiError && error.code === "GROUP_NOT_FOUND") {
        forgetGroup(groupId); return null;
      }
      throw error;
    }
    const nextDetail = body.group as AnyRecord;
    const pending = settingsPendingAttemptsRef.current.get(groupId);
    if (pending && confirmsGroupSettingsReadback(nextDetail, pending.submission)) {
      updateSettingsPendingAttempt(groupId, null);
    }
    if (selectedIdRef.current === groupId) {
      setDetail(nextDetail);
      setMembers((body.members as AnyRecord[]) ?? []);
    }
    return nextDetail;
  }, [forgetGroup, updateSettingsPendingAttempt]);

  const selectGroup = useCallback((groupId: string) => {
    if (groupId === selectedIdRef.current) {
      if (!detail) void refreshDetail(groupId).catch(error => setNotice(error instanceof Error ? error.message : "그룹 상세를 불러오지 못했습니다."));
      return;
    }
    resetSelection(groupId);
  }, [detail, refreshDetail, resetSelection]);

  useEffect(() => {
    let active = true;
    api("/api/group-exams?scope=lobby").then((body) => {
      if (!active) return;
      const next = (body.groups as AnyRecord[]) ?? [];
      setGroups(next);
      setPageState("ready");
      setOwnedActiveCount(Number(body.ownedActiveCount ?? next.filter(g => g.is_owner).length));
      if (body.capabilities) setCapabilities(body.capabilities as typeof capabilities);
      const firstId = String(body.selectedGroupId ?? next[0]?.id ?? "");
      if (firstId && body.detail) {
        const initialDetail = body.detail as AnyRecord;
        hydratedDetailId.current = firstId;
        selectedIdRef.current = firstId;
        setDetail(initialDetail.group as AnyRecord);
        setMembers((initialDetail.members as AnyRecord[]) ?? []);
      }
      if (firstId && body.sync) {
        const initialSync = body.sync as AnyRecord;
        syncRef.current = initialSync;
        setSync(initialSync);
        syncPhase.current = String(initialSync.phase ?? "idle");
      }
      setSelectedId((value) => value || firstId);
    }).catch((error) => { if (active) { setPageState("error"); setNotice(error instanceof Error ? error.message : "그룹을 불러오지 못했습니다."); } });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!selectedId) return;
    selectedIdRef.current = selectedId;
    if (hydratedDetailId.current === selectedId) {
      hydratedDetailId.current = "";
      return;
    }
    let active = true;
    refreshDetail(selectedId)
      .catch((error) => { if (active) setNotice(error instanceof Error ? error.message : "그룹 상세를 불러오지 못했습니다."); });
    return () => { active = false; };
  }, [refreshDetail, selectedId]);

  async function mutate(action: string, values: AnyRecord = {}, options: MutationOptions = {}) {
    if (pendingActionRef.current.has(action)) return null;
    pendingActionRef.current.add(action);
    setPendingActions(new Set(pendingActionRef.current));
    setNotice("");
    let mutationAccepted = false;
    try {
      const signature = `user:${action}:${JSON.stringify(values)}`;
      const explicitMutationKey = typeof values.idempotencyKey === "string" && values.idempotencyKey.length > 0;
      const mutationKey = String(values.idempotencyKey ?? retryKeys.current.get(signature) ?? operationId(action));
      if (!explicitMutationKey) retryKeys.current.set(signature, mutationKey);
      const requestBody = { action, ...values, idempotencyKey: mutationKey };
      const body = await api("/api/group-exams", { method: "POST", body: JSON.stringify(requestBody) });
      mutationAccepted = true;
      const detailGroupId = String(values.groupId ?? selectedIdRef.current);
      let latestDetail: AnyRecord | null = null;
      if (action === "settings-update" && body.settings) {
        latestDetail = { ...detail, ...(body.settings as AnyRecord) };
        if (selectedIdRef.current === detailGroupId) setDetail(latestDetail);
      } else if (action === "group-delete" || action === "group-leave") {
        if (detail?.is_owner) setOwnedActiveCount(count => Math.max(0, count - 1));
        forgetGroup(detailGroupId);
        setNotice(action === "group-delete" ? "그룹을 삭제했습니다." : "그룹에서 나왔습니다.");
        void refresh().catch(() => undefined);
      } else if (action === "run-start") {
        const run = body.run as AnyRecord | undefined;
        const runId = String(run?.id ?? "");
        if (runId) {
          if (body.current) seedGroupExam(runId, body.current as AnyRecord);
          router.push(`/groups/exams/${encodeURIComponent(runId)}`);
        }
      } else if (!["invite-create", "invite-revoke", "invite-resend"].includes(action)) {
        const [, latest] = await Promise.all([refresh(), detailGroupId ? refreshDetail(detailGroupId) : Promise.resolve(null)]);
        latestDetail = latest;
      }
      if (options.verifyDetail && (!latestDetail || !options.verifyDetail(latestDetail))) {
        throw new Error(options.verificationError ?? "저장 여부를 확인하지 못했습니다. 다시 시도해 주세요.");
      }
      if (!explicitMutationKey) retryKeys.current.delete(signature);
      if (options.successNotice) setNotice(options.successNotice);
      if (action === "run-start") setSyncRefreshNonce((value) => value + 1);
      return body;
    } catch (error) {
      options.onFailure?.(mutationAccepted || !(error instanceof GroupApiError) ? "unconfirmed" : "rejected");
      setNotice(error instanceof Error ? error.message : "요청을 처리하지 못했습니다.");
      return null;
    } finally { pendingActionRef.current.delete(action); setPendingActions(new Set(pendingActionRef.current)); }
  }

  const selected = useMemo(() => groups.find((item) => item.id === selectedId), [groups, selectedId]);
  const isOwner = Boolean(detail?.is_owner);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  async function createGroup(formData: FormData) {
    const body = await mutate("group-create", { name: formData.get("name"), publicName: formData.get("publicName"), memberLimit: 50 });
    const id = String((body?.group as AnyRecord | undefined)?.id ?? "");
    if (id) selectGroup(id);
  }

  const refreshSync = useCallback(async (heartbeat: boolean, includeSync = true) => {
    const requestGroupId = selectedIdRef.current;
    if (!requestGroupId) return true;
    const sequence = includeSync ? ++syncRequestSequence.current : syncRequestSequence.current;
    try {
      const previous = syncRef.current;
      const stateVersion = String(previous?.stateVersion ?? "");
      const presenceVersion = String(previous?.presenceVersion ?? "");
      const body = heartbeat
        ? await api("/api/group-exams", { method: "POST", body: JSON.stringify({
          action: "presence-heartbeat", groupId: requestGroupId, sessionId: presenceSessionId.current,
          pageContext: "lobby", visible: document.visibilityState === "visible", includeSync,
          stateVersion, presenceVersion,
        }) })
        : await api(`/api/group-exams?scope=sync&groupId=${encodeURIComponent(requestGroupId)}&stateVersion=${encodeURIComponent(stateVersion)}&presenceVersion=${encodeURIComponent(presenceVersion)}`);
      if (selectedIdRef.current !== requestGroupId || sequence !== syncRequestSequence.current) return true;
      if (!includeSync) return true;
      const current = body.unchanged && previous
        ? { ...previous, ...body, presence: body.presence ?? previous.presence }
        : body;
      syncRef.current = current;
      setSync(current);
      setPresenceHealth({ status: "fresh", lastSuccessAt: Date.now() });
      const phase = String(current.phase ?? "idle");
      if (current.group) setDetail(previous => previous ? {...previous, ...(current.group as AnyRecord)} : previous);
      syncPhase.current = phase;
      if (current.run) {
            const runId = String((current.run as AnyRecord | undefined)?.id ?? "");
        setGroups((previous) => previous.map(g => g.id === requestGroupId ? {...g, recent_run_id: runId, recent_run_status: phase} : g));
      }
      return true;
    } catch (error) {
      if (selectedIdRef.current === requestGroupId) {
        if (error instanceof GroupApiError && error.code === "GROUP_NOT_FOUND") {
          forgetGroup(requestGroupId); void refresh().catch(() => undefined); return true;
        }
        setPresenceHealth((state) => ({ status: "degraded", lastSuccessAt: state.lastSuccessAt }));
        setNotice(error instanceof Error ? error.message : "그룹 상태를 동기화하지 못했습니다.");
      }
      return false;
    }
  }, [forgetGroup, refresh]);

  useEffect(() => {
    if(!selectedId||!capabilities.webSocket)return;
    let timer=0;
    const stop=connectGroupSocket({groupId:selectedId,onStatus:setSocketStatus,onInvalidate:()=>{
      window.clearTimeout(timer);timer=window.setTimeout(()=>void refreshSync(false),100);
    }});
    return()=>{window.clearTimeout(timer);stop();};
  },[capabilities.webSocket,refreshSync,selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    if(capabilities.webSocket&&socketStatus==="connected"){
      const heartbeat=()=>void refreshSync(true,true);
      heartbeat();const timer=window.setInterval(heartbeat,20_000);
      return()=>window.clearInterval(timer);
    }
    let stopped = false;
    let timer = 0;
    let inFlight = false;
    let lastStartedAt = 0;
    let due: LobbyPollDeadlines = { syncAt: Date.now(), heartbeatAt: Date.now() };
    const schedule = () => {
      if (stopped) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(run, nextLobbyPoll(due, Date.now()).delay);
    };
    const run = () => {
      if (stopped || inFlight) return;
      const next = nextLobbyPoll(due, Date.now());
      if (!next.sync && !next.heartbeat) { schedule(); return; }
      const visible = document.visibilityState === "visible";
      const includeSync = next.sync || visible;
      if (!navigator.onLine) {
        due = finishLobbyPoll(due, Date.now(), next.heartbeat, includeSync, syncPhase.current, visible, false);
        schedule();
        return;
      }
      inFlight = true;
      lastStartedAt = Date.now();
      let success = false;
      void refreshSync(next.heartbeat, includeSync).then((value) => { success = value; }).finally(() => {
        inFlight = false;
        due = finishLobbyPoll(due, Date.now(), next.heartbeat, includeSync, syncPhase.current, document.visibilityState === "visible", success, Math.floor(Math.random() * 500));
        schedule();
      });
    };
    const expedite = () => {
      if (stopped || inFlight || Date.now() - lastStartedAt < 2_000) return;
      due.syncAt = Date.now();
      if (document.visibilityState !== "visible") due.heartbeatAt = Date.now();
      schedule();
    };
    run();
    window.addEventListener("focus", expedite);
    window.addEventListener("online", expedite);
    document.addEventListener("visibilitychange", expedite);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      window.removeEventListener("focus", expedite);
      window.removeEventListener("online", expedite);
      document.removeEventListener("visibilitychange", expedite);
    };
  }, [capabilities.webSocket, socketStatus, refreshSync, selectedId, syncRefreshNonce]);

  const presence = presenceHealth.status === "fresh" ? (sync?.presence as AnyRecord[] | undefined) ?? [] : [];
  const presenceByMembership = new Map(presence.map((item) => [
    String(item.membership_id),
    String(item.presence_state ?? (item.online ? "online" : "offline")),
  ]));
  const phase = String(sync?.phase ?? "idle");

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <div><p className={styles.eyebrow}>함께 푸는 SKCT</p><h1>그룹 모의시험</h1>
        <p>같은 문제, 같은 시작 시각. 개인학습 문제은행의 다섯 영역을 함께 풀어 보세요.</p></div>
        {selectedId && <span role="status" className={deviceOnline ? styles.siteOnline : styles.siteOffline}>
          {deviceOnline ? capabilities.webSocket && socketStatus === "connected" ? "● 실시간 연결" : "연결 확인 중" : "오프라인 · 재연결 대기"}
        </span>}
      </header>
      {notice && <p className={styles.notice} role="status" aria-live="polite">{notice}</p>}
      <section className={styles.workspace}>
        <aside className={`${styles.card} ${styles.sidebar}`}>
          <h2>그룹 선택</h2><p>내가 만든 활성 그룹 {ownedActiveCount}/3</p>
          {pageState === "loading" && <p role="status">그룹을 불러오는 중입니다.</p>}
          {pageState === "ready" && groups.length === 0 && <p>아직 참여 중인 그룹이 없습니다.</p>}
          <label>그룹 선택<select value={selectedId} onChange={(event) => selectGroup(event.target.value)}>
            <option value="">그룹을 선택하세요</option>{groups.map((group) => <option key={String(group.id)} value={String(group.id)}>{String(group.name)}</option>)}
          </select></label>
          <details ref={createForm} className={styles.createGroup} open={groups.length === 0}><summary>새 그룹 만들기</summary><form action={createGroup} className={styles.stack}>
            <label>그룹 이름<input ref={createName} name="name" minLength={2} maxLength={80} required /></label>
            <label>표시 이름<input name="publicName" minLength={2} maxLength={40} required /></label>
            <button disabled={pendingActions.has("group-create") || ownedActiveCount >= 3}>그룹 만들기</button>
          </form></details>
          <div className={styles.bankNote}><strong>개인학습 문제은행</strong><p>언어이해 · 자료해석 · 창의수리 · 언어추리 · 수열추리</p><p>시험이 시작되면 참가자와 문항 구성이 고정됩니다.</p></div>
        </aside>

        <section className={styles.mainStage}>
        {pageState === "ready" && !selectedId && <article className={`${styles.card} ${styles.emptyStage}`}>
          <div className={styles.emptyIllustration} aria-hidden="true"><span>01</span><span>02</span><span>03</span></div>
          <p className={styles.eyebrow}>함께 시작하는 모의시험</p><h2>{groups.length ? "함께 풀 그룹을 선택하세요" : "첫 그룹을 만들어 함께 풀어 보세요"}</h2>
          <p>그룹을 만들고 초대 링크를 공유하면 같은 문제를 같은 시각에 풀 수 있습니다.</p>
          <div className={styles.emptyAreas}>{GROUP_EXAM_AREAS.map(area => <span key={area}>{area}</span>)}</div>
          <button onClick={() => { if (createForm.current) createForm.current.open = true; createName.current?.focus(); }}>새 그룹 만들기</button>
          <p className={styles.emptyHint}>초대 링크를 받았다면 해당 링크에서 그룹에 참여할 수 있습니다.</p>
        </article>}

        {detail && <article className={`${styles.card} ${styles.contextCard}`}>
          <div className={styles.contextHeader}><div><p className={styles.eyebrow}>현재 그룹</p><h2>{String(detail.name)}</h2>
          <p>현재 {String(detail.active_members)}명{Number(detail.reserved_invites)>0 ? ` · 초대 예약 ${String(detail.reserved_invites)}명` : ""} · 정원 {String(detail.member_limit)}명</p></div>
          <span className={`${styles.phase} ${phase === "running" ? styles.phaseLive : ""}`}>{phase === "running" ? "시험 진행 중" : phase === "scheduled" ? "예약 대기" : phase === "finalizing" ? "채점 중" : phase === "completed" ? "최근 시험 완료" : "대기실"}</span></div>
          <LobbySummary detail={detail} />
          <h3 className={styles.memberHeading}>참가자 <span>{members.length}명</span></h3>
          <ul className={styles.members}>{members.map((member) => {
            const memberPresence = presenceByMembership.get(String(member.membership_id)) ?? "offline";
            const presenceClass = presenceHealth.status !== "fresh" ? styles.unknown
              : memberPresence === "online" ? styles.online : memberPresence === "recent" ? styles.recent : styles.offline;
            const presenceLabel = presenceHealth.status !== "fresh" ? "확인 불가"
              : memberPresence === "online" ? "접속 중" : memberPresence === "recent" ? "최근 접속" : "오프라인";
            return <li key={String(member.membership_id)}>
            <span><i className={presenceClass} aria-hidden="true" />{String(member.public_name)}{member.is_owner ? " (대표)" : ""}<small>{presenceLabel}</small></span>
            {isOwner && !member.is_owner && <span className={styles.actions}>
              <button className={styles.secondary} disabled={pendingActions.has("owner-transfer")} onClick={() => mutate("owner-transfer", { groupId: selectedId, targetMembershipId: member.membership_id })}>대표 위임</button>
              <button className={styles.secondary} disabled={pendingActions.has("member-kick")} onClick={() => mutate("member-kick", { groupId: selectedId, targetMembershipId: member.membership_id })}>내보내기</button>
            </span>}
          </li>;})}</ul>
          {isOwner && <OwnerControls key={selectedId} pendingActions={pendingActions} capabilities={capabilities} groupId={selectedId} detail={detail}
            members={members} phase={phase} mutate={mutate} pending={settingsPendingAttempts.get(selectedId) ?? null}
            onPendingChange={(attempt) => updateSettingsPendingAttempt(selectedId, attempt)} reloadDetail={refreshDetail} />}
          {!isOwner && <button className={styles.leaveButton} disabled={pendingActions.has("group-leave")} onClick={() => mutate("group-leave", { groupId: selectedId })}>그룹 나가기</button>}
        </article>}

        {selectedId && <article className={`${styles.card} ${styles.examStage}`}>
          <p className={styles.eyebrow}>내 응시</p><h2>{phase === "running" ? "시험이 시작되었습니다" : "준비되면 함께 시작하세요"}</h2>
          <p>{phase === "running" ? "시험 화면에서 답안을 선택하고 다음 문항으로 이동하세요." : "대표가 시험을 시작하면 모든 참가자가 같은 시각에 응시합니다."}</p>

          {["running","finalizing"].includes(String(selected?.recent_run_status ?? phase)) && Boolean(selected?.recent_run_id) && <button onClick={()=>router.push(`/groups/exams/${encodeURIComponent(String(selected?.recent_run_id))}`)}>시험 전용 화면 열기</button>}
          {selected?.recent_run_status === "completed" && <button className={styles.secondary} onClick={()=>router.push(`/groups/results/${encodeURIComponent(String(selected?.recent_run_id))}`)}>최근 결과 보기</button>}
        </article>}
        </section>
      </section>
      {selectedId && !detail && <p role="status">그룹 정보를 확인하는 중입니다.</p>}
    </main>
  );
}

function LobbySummary({ detail }: {detail: AnyRecord}) {
  const lobby = (detail.lobby ?? {}) as AnyRecord;
  const seconds = storedAreaSeconds(detail);
  return <div className={styles.lobby}>
    <p><strong>문항 수:</strong> {String(lobby.effectiveQuestionCount ?? 15)}문항{lobby.questionCountAdminSet ? " (관리자 설정)" : " (기본)"}</p>
    <p><strong>오늘 남은 횟수:</strong> {String(lobby.quotaRemaining ?? 1)}/{String(lobby.quotaTotal ?? 1)} · 다음 초기화 {lobby.nextQuotaResetAt ? new Date(String(lobby.nextQuotaResetAt)).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : "-"}</p>
    <p><strong>진행 방식:</strong> 한 문항씩 · 시간 종료 시 자동 이동</p>
    <details><summary>영역별 문항 제한시간</summary><ul>{GROUP_EXAM_AREAS.map((area) => <li key={area}>{area} {String(seconds[area] ?? 45)}초</li>)}</ul></details>
  </div>;
}

function OwnerControls({ pendingActions, capabilities, groupId, detail, members, phase, mutate, pending, onPendingChange, reloadDetail }: {
  pendingActions: Set<string>;
  capabilities: { personalProgress: boolean; strictRepeat: boolean };
  groupId: string;
  detail: AnyRecord;
  members: AnyRecord[];
  phase: string;
  mutate: UserMutation;
  pending: SettingsPendingAttempt | null;
  onPendingChange: (attempt: SettingsPendingAttempt | null) => void;
  reloadDetail: (groupId: string) => Promise<AnyRecord | null>;
}) {
  const [modal, setModal] = useState<"settings" | "invite" | "start" | null>(null);
  const [inviteUrl, setInviteUrl] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const [deleteName,setDeleteName]=useState("");
  const [deleteOpen,setDeleteOpen]=useState(false);
  const [settingsStatus, setSettingsStatus] = useState<"idle" | "saving" | "saved" | "rejected" | "unconfirmed">(
    pending ? "unconfirmed" : "idle",
  );
  const [draft, setDraft] = useState<GroupSettingsDraft>(() => groupSettingsDraft(detail, pending?.submission));
  const settingsRequestPending = useRef(false);
  const quotaRemaining = Number((detail.lobby as AnyRecord | undefined)?.quotaRemaining ?? 0);
  const startBlocked = members.length === 0 || quotaRemaining <= 0 || ["running", "finalizing"].includes(phase) || pendingActions.has("run-start");
  async function makeInvite() {
    const body = await mutate("invite-create", { groupId, reusable:true });
    const token = String((body?.invite as AnyRecord | undefined)?.token ?? "");
    if (token) { setInviteUrl(`${location.origin}/groups/invite/${token}`); setCopyStatus(""); }
  }
  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopyStatus("초대 링크를 복사했습니다.");
    } catch { setCopyStatus("초대 링크를 복사하지 못했습니다. 링크 입력란에서 직접 복사해 주세요."); }
  }
  return <div className={styles.stack}>
    <h3>대표 관리</h3>
    <div className={styles.ownerControls}><div className={styles.ownerPrimary}><p>참가자가 준비되면 시험을 시작하세요.</p><button disabled={startBlocked} onClick={() => setModal("start")}>{quotaRemaining <= 0 ? "오늘 응시 완료" : "시험 시작"}</button></div><div className={styles.ownerSettings}><button className={styles.secondary} onClick={() => { setDraft(groupSettingsDraft(detail,pending?.submission)); setSettingsStatus(pending ? "unconfirmed" : "idle"); setModal("settings"); }}>그룹 설정</button><button className={styles.secondary} onClick={() => setModal("invite")}>초대 링크</button></div><div className={styles.ownerUtility}><button className={styles.leaveButton} disabled={pendingActions.has("group-leave")} onClick={() => mutate("group-leave", { groupId })}>그룹 나가기</button><button className={styles.deleteButton} onClick={()=>setDeleteOpen(true)}>그룹 삭제</button></div></div>
    {modal === "settings" && <GroupExamModal title="그룹 설정" onClose={() => setModal(null)}>
    <form onSubmit={async (event) => {
      event.preventDefault();
      if (settingsRequestPending.current) return;
      settingsRequestPending.current = true;
      const attempt = pending ?? {
        idempotencyKey: operationId("settings-update"),
        submission: groupSettingsSubmission(detail, draft),
      };
      onPendingChange(attempt);
      setSettingsStatus("saving");
      const saved = await mutate("settings-update", {
        groupId,
        ...attempt.submission,
        idempotencyKey: attempt.idempotencyKey,
      }, {
        successNotice: "그룹 설정을 저장했습니다.",
        verifyDetail: (latest) => confirmsGroupSettingsReadback(latest, attempt.submission),
        verificationError: "설정 저장 여부를 확인하지 못했습니다. 다시 시도해 주세요.",
        onFailure: setSettingsStatus,
      });
      settingsRequestPending.current = false;
      if (saved) {
        const confirmedDetail = { ...detail, ...(saved.settings as AnyRecord) };
        onPendingChange(null);
        setDraft(groupSettingsDraft(confirmedDetail));
        setSettingsStatus("saved");
      }
    }} className={styles.stack}>
      <label>정원<input name="memberLimit" type="number" min={2} max={50} value={draft.memberLimit} required
        disabled={Boolean(pending)} onChange={(event) => {
          setDraft((current) => ({ ...current, memberLimit: event.target.value }));
          setSettingsStatus("idle");
        }} /></label>
      <label>이전 문항 재등장<select value={draft.repeatPolicy} disabled={Boolean(pending)} aria-describedby="repeat-policy-help" onChange={event => setDraft(value => ({...value,repeatPolicy:event.target.value as "allow" | "forbid"}))}><option value="allow">허용</option><option value="forbid" disabled={!capabilities.strictRepeat}>이 그룹에서 나온 문항 제외</option></select></label>
      <p id="repeat-policy-help">{capabilities.strictRepeat ? "이전에 풀었던 문항을 제외합니다. 남은 문제가 부족하면 시작할 수 없습니다." : "이전 문항 제외를 아직 사용할 수 없습니다."}</p>
      <label>다음 문항 시간<select value={draft.advanceTimePolicy} disabled={Boolean(pending) || !capabilities.personalProgress} onChange={event => setDraft(value => ({...value,advanceTimePolicy:event.target.value as "carry_remaining" | "reset_to_base"}))}><option value="carry_remaining">남은 시간 더하기</option><option value="reset_to_base">다음 문항 기본 시간만 적용</option></select></label>
      <fieldset><legend>영역별 문항 제한시간(초)</legend>{GROUP_EXAM_AREAS.map((area) => <label key={area}>{area}<input name={area} type="number" min={1} max={3600} value={draft.areaSeconds[area]} required
        disabled={Boolean(pending)} onChange={(event) => {
          setDraft((current) => ({ ...current, areaSeconds: { ...current.areaSeconds, [area]: event.target.value } }));
          setSettingsStatus("idle");
        }} /></label>)}</fieldset>
      <p className={settingsStatus === "saved" ? styles.successMessage : styles.formStatus} role="status" aria-live="polite">{settingsStatus === "saving" ? "설정을 저장하고 있습니다…" : settingsStatus === "saved" ? "✓ 설정을 저장했습니다." : settingsStatus === "rejected" ? "설정을 저장하지 못했습니다. 입력값을 확인해 주세요." : settingsStatus === "unconfirmed" ? "연결이 끊겨 저장 여부를 확인하지 못했습니다. 다시 시도해 주세요." : ""}</p>
      <footer className={styles.modalActions}>
        <button type="button" className={styles.secondary} disabled={settingsStatus === "saving"} onClick={() => setModal(null)}>닫기</button>
        <button disabled={pendingActions.has("settings-update")}>{settingsStatus === "saving" ? "저장 중…" : settingsStatus === "unconfirmed" ? "다시 저장" : "설정 저장"}</button>
      </footer>
      {pending && settingsStatus !== "saving" && <button type="button" className={styles.textButton} onClick={async () => {
        onPendingChange(null);
        const latest = await reloadDetail(groupId).catch(() => null);
        setDraft(groupSettingsDraft(latest ?? detail));
        setSettingsStatus("idle");
      }}>입력 다시 하기</button>}
    </form></GroupExamModal>}
    {modal === "invite" && <GroupExamModal title="그룹원 초대" onClose={() => setModal(null)}>
      <div className={styles.modalBody}><p>같은 링크를 여러 사람에게 공유할 수 있습니다. 링크는 7일 동안 유효하며, 정원에 도달하면 참여가 마감됩니다.</p>
      {inviteUrl ? <><label className={styles.inviteLabel}>초대 링크<div className={styles.inviteRow}><input readOnly value={inviteUrl} onFocus={event => event.currentTarget.select()} /><button type="button" onClick={() => void copyInvite()}>{copyStatus === "초대 링크를 복사했습니다." ? "복사됨 ✓" : "링크 복사"}</button></div></label><p className={styles.formStatus} role="status" aria-live="polite">{copyStatus}</p></> : <p className={styles.invitePlaceholder}>링크를 만들어 함께 풀 사람을 초대하세요.</p>}
      </div><footer className={styles.modalActions}><button className={styles.secondary} onClick={() => setModal(null)}>닫기</button><button disabled={pendingActions.has("invite-create")} onClick={makeInvite}>{pendingActions.has("invite-create") ? "링크 만드는 중…" : inviteUrl ? "새 링크 만들기" : "초대 링크 만들기"}</button></footer>
    </GroupExamModal>}
    {modal === "start" && <GroupExamModal title="시험 시작" closeDisabled={pendingActions.has("run-start")} onClose={() => setModal(null)}>
      <div className={styles.modalBody}><p>현재 그룹원 <strong>{members.length}명</strong>이 함께 응시합니다. 시험 준비가 끝나면 5초 카운트다운 후 시작합니다.</p><div className={styles.startSummary}><span>전체 문항 <strong>{String((detail.lobby as AnyRecord | undefined)?.effectiveQuestionCount ?? 15)}문항</strong></span><span>오늘 남은 횟수 <strong>{quotaRemaining}회</strong></span></div>{quotaRemaining <= 0 && <p className={styles.formStatus}>오늘 응시 횟수를 모두 사용했습니다.</p>}</div>
      <footer className={styles.modalActions}><button className={styles.secondary} disabled={pendingActions.has("run-start")} onClick={() => setModal(null)}>취소</button><button disabled={startBlocked} onClick={async () => { const started = await mutate("run-start", { groupId, mode: "immediate", waitForView:true }); if (started) setModal(null); }}>{pendingActions.has("run-start") ? "시험 준비 중…" : "지금 시작"}</button></footer>
    </GroupExamModal>}
    {deleteOpen && <GroupExamModal title="그룹 삭제" closeDisabled={pendingActions.has("group-delete")} onClose={() => {setDeleteOpen(false);setDeleteName("");}}>
      <div className={styles.modalBody}><p><strong>{String(detail.name)}</strong> 그룹을 삭제하시겠습니까? 삭제 후에는 되돌릴 수 없습니다.</p><label>확인을 위해 그룹 이름을 입력하세요<input value={deleteName} onChange={event => setDeleteName(event.target.value)} autoComplete="off" placeholder={String(detail.name)} /></label></div>
      <footer className={styles.modalActions}><button className={styles.secondary} disabled={pendingActions.has("group-delete")} onClick={() => {setDeleteOpen(false);setDeleteName("");}}>취소</button><button className={styles.danger} disabled={pendingActions.has("group-delete") || deleteName !== String(detail.name)} onClick={async () => {const deleted = await mutate("group-delete", {groupId, expectedRevision:Number(detail.revision), confirmedName:deleteName});if(deleted){setDeleteOpen(false);setDeleteName("");}}}>{pendingActions.has("group-delete") ? "삭제 중…" : "그룹 삭제"}</button></footer>
    </GroupExamModal>}
  </div>;
}

export function groupAnswerLabel(answer: unknown, choices: unknown): string {
  if (!Array.isArray(answer) || !answer.length) return "미응답";
  const labels = Array.isArray(choices) ? choices : [];
  return answer.filter((value): value is number => Number.isInteger(value) && value >= 0 && value < labels.length)
    .map(index => `${index < 20 ? String.fromCodePoint(0x2460 + index) : `${index + 1}번`} ${String(labels[index])}`).join(", ") || "응답 확인 불가";
}
