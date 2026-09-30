"use client";

import {
  lazy,
  Suspense,
  type ChangeEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import type { AdminSection } from "@frontend/features/admin/model/admin-sections";
import {
  apiAction,
  apiGet,
  invalidateAdminGetCache,
} from "@frontend/features/admin/model/admin-api-client";
import { SW_CURRICULUM_SUBJECT_GROUPS } from "@shared/study/sw-curriculum-contract.mjs";
import { ADMIN_IMPORT_FILE_MAX_BYTES } from "@shared/admin/admin-transfer-limits.mjs";
import { canDeleteBackup } from "@shared/admin/backup-deletion";
import { runDurableAdminBackup, type DurableBackupKind } from "@frontend/features/admin/model/admin-durable-backup";
import { deleteBackupsSequentially, type BackupDeletionResult } from "@frontend/features/admin/model/admin-backup-deletion";
import {
  EmptyState,
  ErrorState,
  ExportButton,
  ExportLink,
  LoadingBlock,
  emptyLoad,
  formatBytes,
  formatDate,
  statusLabel,
  type JsonRecord,
  type LoadState,
} from "./admin-ui";
import { MetricCard } from "./admin-section-primitives";
import AdminRestoreModal, { type BackupItem } from "./admin-restore-modal";
import AdminSkctBankActivation from "./admin-skct-bank-activation";
import AdminTheoryContentRepair from "./admin-theory-content-repair";
import { contentDomainOptions } from "./admin-content-shared";
import { CONTENT_ADMIN_DOMAINS, type ContentAdminDomain } from "@shared/admin/content-domains";
import { releasedLocalPracticeCourses, localPracticeWorkbooks } from "@shared/study/local-practice";

const LazyDashboardSection = lazy(() => import("./admin-dashboard-section"));
const LazyQuestionsSection = lazy(() => import("./admin-question-sections"));
const LazyTheoriesSection = lazy(() => import("./admin-theory-sections"));

type QualityData = {
  generatedAt: string;
  cached: boolean;
  ruleVersion: string;
  coverage: Array<{ domain: ContentAdminDomain; questions: number; theories: number }>;
  summary: { total: number; error: number; warning: number; info: number; autoFixable: number };
  issues: Array<{
    id: string;
    severity: "error" | "warning" | "info";
    targetType: "question" | "theory" | "sw-question" | "sw-theory" | "collection";
    targetId: string | number | null;
    targetIds?: Array<string | number>;
    domain?: ContentAdminDomain;
    title: string;
    detail: string;
    fixable: boolean;
    fixAction?: string;
  }>;
};

function QualitySection({
  onNotice,
}: {
  onNotice: (message: string, error?: boolean) => void;
}) {
  const [state, setState] = useState<LoadState<QualityData>>(emptyLoad);
  const [severity, setSeverity] = useState("all");
  const [domain, setDomain] = useState("all");
  const [page, setPage] = useState(1);
  async function refresh(force = false) {
    setState((previous) => ({ ...previous, loading: true, error: "" }));
    try {
      if (force) invalidateAdminGetCache({ resource: "quality" });
      const params = force ? new URLSearchParams({ refresh: "1" }) : undefined;
      setState({
        loading: false,
        error: "",
        data: await apiGet("quality", params, { bypassCache: force }),
      });
    } catch (error) {
      setState({ loading: false, error: error instanceof Error ? error.message : "점검 실패", data: null });
    }
  }
  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, []);
  async function fix(issue: QualityData["issues"][number]) {
    if (!issue.fixAction || !window.confirm(`"${issue.title}" 항목을 자동 수정할까요? 변경 내용은 감사 로그에 남습니다.`)) return;
    try {
      await apiAction("quality-fix", { fixAction: issue.fixAction });
      onNotice("안전하게 자동 수정하고 다시 점검했습니다.");
      await refresh(true);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "자동 수정 실패", true);
    }
  }
  if (state.loading && !state.data) return <LoadingBlock label="문제와 이론의 품질을 점검하는 중입니다." />;
  if (state.error && !state.data) return <ErrorState message={state.error} onRetry={refresh} />;
  const data = state.data!;
  const matching = data.issues.filter(issue => (severity === "all" || issue.severity === severity) && (domain === "all" || issue.domain === domain || (domain === "sw" && issue.targetType.startsWith("sw-"))));
  const pages = Math.max(1, Math.ceil(matching.length / 30));
  const currentPage = Math.min(page, pages);
  const issues = matching.slice((currentPage - 1) * 30, currentPage * 30);
  return (
    <div className="admin-section-stack">
      <section className="admin-section-head"><div><span>QUALITY ASSURANCE</span><h2>전체 분야 문제·이론 품질 점검</h2><p>최근 점검 스냅샷 {formatDate(data.generatedAt)} · {data.cached ? "캐시 결과" : "새 검사 결과"}</p></div><button className="admin-button secondary" type="button" disabled={state.loading} onClick={() => void refresh(true)}>{state.loading ? "점검 중…" : "새로 점검"}</button></section>
      <section className="admin-metric-grid compact"><MetricCard label="확인할 항목" value={data.summary.total} unit="건" /><MetricCard label="오류" value={data.summary.error} unit="건" tone={data.summary.error ? "warning" : "normal"} /><MetricCard label="검토 권장" value={data.summary.warning} unit="건" /><MetricCard label="확인 정보" value={data.summary.info} unit="건" /><MetricCard label="자동 수정 가능" value={data.summary.autoFixable} unit="건" tone="accent" /></section>
      <section className="admin-card admin-padded-card">
        <h3>검사 범위와 기준</h3>
        <p>오류는 누락된 본문·해설, 잘못된 선택지·정답 번호, 깨진 코드 블록과 실기 정답표 불일치입니다. 중복 가능성은 검토 권장, 긴 지문은 참고 정보로 구분합니다. 자동 검사로 내용의 사실관계까지 보장하지는 않습니다.</p>
        <div className="admin-domain-coverage">{data.coverage?.map(item => <span key={item.domain}><strong>{CONTENT_ADMIN_DOMAINS.find(d => d.id === item.domain)?.label}</strong> 문제 {item.questions.toLocaleString()} · 이론 {item.theories.toLocaleString()}</span>)}</div>
        <p>정보처리기사 실기는 문항·해설과 검증 정답표의 일치를 검사합니다. 회차별 기출문제의 개별 이론 연결은 필수 항목이 아닙니다.</p>
        <p>빅분기 파일 실습은 별도 배포 자료입니다. {releasedLocalPracticeCourses().flatMap(course => localPracticeWorkbooks(course)).map(item => <Link className="admin-practice-link" key={item.id} href={item.href}>{item.title} · {item.release.questionCount}개</Link>)} CSV·노트북·참고 코드 검증은 자료 배포 시 수행합니다.</p>
      </section>
      <section className="admin-card admin-padded-card quality-results-card">
        <div className="admin-card-head"><div><h3>점검 결과</h3><p>자동 수정은 상용구 정리와 표시 번호 정렬처럼 되돌리기 쉬운 항목에만 제공됩니다.</p></div><label>분야<select value={domain} onChange={event => { setDomain(event.target.value); setPage(1); }}><option value="all">전체 분야</option>{CONTENT_ADMIN_DOMAINS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label>구분<select value={severity} onChange={(event) => { setSeverity(event.target.value); setPage(1); }}><option value="all">전체</option><option value="error">오류</option><option value="warning">검토 권장</option><option value="info">참고 정보</option></select></label></div>
        {issues.length ? <div className="quality-list">{issues.map((issue) => {
          const firstTargetId = issue.targetId ?? issue.targetIds?.[0] ?? null;
          const isCollection = issue.targetType === "collection" || (issue.targetIds?.length ?? 0) > 1;
          const targetDomain = issue.domain ?? (issue.targetType.startsWith("sw-") ? "sw" : "sql");
          const targetHref = firstTargetId
            ? issue.targetType === "theory" || issue.targetType === "sw-theory"
              ? `/admin/theories?focus=${firstTargetId}&domain=${targetDomain}`
              : `/admin/questions?focus=${firstTargetId}&domain=${targetDomain}`
            : "";
          const contentKind = issue.targetType.includes("question") ? "문제" : "이론";
          return <article key={issue.id} className={issue.severity}>
            <span className="quality-severity">{issue.severity === "error" ? "오류" : issue.severity === "warning" ? "검토" : "참고"}</span>
            <div className="quality-copy"><strong>{issue.title}</strong><p>{issue.detail}</p><small>{isCollection ? `${issue.targetIds?.length ?? 0}개 데이터 관련` : `${CONTENT_ADMIN_DOMAINS.find(item => item.id === targetDomain)?.shortLabel ?? targetDomain} ${contentKind} ID ${issue.targetId}`}</small></div>
            <div className="quality-actions">
              {targetHref && <Link className="admin-button small secondary" href={targetHref}>해당 콘텐츠 확인</Link>}
              {issue.fixable ? <button className="admin-button small" type="button" onClick={() => void fix(issue)}>변경 확인 후 수정</button> : !targetHref && <span className="manual-check">수동 확인</span>}
            </div>
          </article>;
        })}</div> : <EmptyState title="해당 조건의 점검 항목이 없습니다." description="다른 분야나 구분을 선택해 확인할 수 있습니다." />}
        <div className="admin-pagination"><span>{matching.length.toLocaleString()}건 · {currentPage} / {pages}</span><button disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>이전</button><button disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>다음</button></div>
      </section>
    </div>
  );
}

type BackupListData = {
  items: BackupItem[];
  storage?: {
    configuredMode: "database" | "external";
    externalAvailable: boolean;
    defaultMode: "database" | "external";
    location: string;
    warning: string;
  };
};

function BackupsSection({
  onNotice,
}: {
  onNotice: (message: string, error?: boolean) => void;
}) {
  const [state, setState] = useState<LoadState<BackupListData>>(emptyLoad);
  const [type, setType] = useState("full");
  const [includeAnalytics, setIncludeAnalytics] = useState(false);
  const [storageMode, setStorageMode] = useState<"database" | "external">("database");
  const [busy, setBusy] = useState(false);
  const [durableBusy, setDurableBusy] = useState(false);
  const [backupProgress, setBackupProgress] = useState("");
  const backupCancelRequested = useRef(false);
  const [restoring, setRestoring] = useState<BackupItem | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const deletionLock = useRef(false);
  const [progress, setProgress] = useState({ finished: 0, total: 0 });
  const [deletionResult, setDeletionResult] = useState<BackupDeletionResult | null>(null);
  async function refresh() {
    setState((previous) => ({ ...previous, loading: true, error: "" }));
    try {
      const data = await apiGet<BackupListData>("backups", undefined, { bypassCache: true });
      setState({ loading: false, error: "", data });
      setSelectedIds(previous => previous.filter(id => data.items.some(item => item.id === id && canDeleteBackup(item))));
      setStorageMode(data.storage?.defaultMode ?? "database");
    } catch (error) {
      setState(previous => ({ ...previous, loading: false, error: error instanceof Error ? error.message : "조회 실패" }));
    }
  }
  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, []);
  async function create(resume?: BackupItem) {
    if (busy) return;
    backupCancelRequested.current = false;
    setBackupProgress("");
    const selectedType = resume?.backup_type ?? type;
    const selectedMode = resume ? "external" : storageMode;
    const durable = selectedMode === "external" && selectedType !== "settings";
    setDurableBusy(durable);
    setBusy(true);
    try {
      if (durable) {
        if (!["content", "learning", "full"].includes(selectedType)) {
          throw new Error("재개할 백업 유형이 유효하지 않습니다.");
        }
        const result = await runDurableAdminBackup({
          backupId: resume?.id ?? crypto.randomUUID(),
          type: selectedType as DurableBackupKind,
          includeAnalytics: resume ? resume.includedData.includes("analytics_events") : includeAnalytics,
          shouldCancel: () => backupCancelRequested.current,
          onProgress: setBackupProgress,
        });
        const completedList = result.backupList as BackupListData | null | undefined;
        if (completedList) {
          setState({ loading: false, error: "", data: completedList });
          setSelectedIds(previous => previous.filter(id => completedList.items.some(item => item.id === id && canDeleteBackup(item))));
          setStorageMode(completedList.storage?.defaultMode ?? "database");
        } else {
          // A completed snapshot remains a success even if optional GET fails.
          await refresh();
        }
        onNotice(result.canceled ? "백업 작업을 취소하고 부분 저장물을 정리했습니다."
          : "백업을 생성하고 원본 재검증 및 무결성 검증값을 저장했습니다.");
        return;
      }
      const created = await apiAction<{ backupList: BackupListData | null }>("backup-create", {
        type: selectedType, includeAnalytics, storageMode: selectedMode,
      });
      if (created.backupList) {
        const data = created.backupList;
        setState({ loading: false, error: "", data });
        setSelectedIds(previous => previous.filter(id => data.items.some(item => item.id === id && canDeleteBackup(item))));
        setStorageMode(data.storage?.defaultMode ?? "database");
        onNotice("백업을 생성하고 무결성 검증값을 저장했습니다.");
      } else {
        onNotice("백업 생성은 완료됐습니다. 목록을 새로고침해 확인해 주세요.", true);
      }
    } catch (error) {
      onNotice(error instanceof Error
        ? durable ? `${error.message} · 생성 중 항목이 목록에 표시되면 이어할 수 있습니다.` : error.message
        : "백업 실패", true);
      await refresh();
    } finally {
      setBusy(false);
      setDurableBusy(false);
      setBackupProgress("");
      backupCancelRequested.current = false;
    }
  }
  async function cancelPausedBackup(item: BackupItem) {
    try {
      await apiAction("backup-cancel", { backupId: item.id });
      await refresh();
      onNotice("백업 작업을 취소하고 부분 저장물을 정리했습니다.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "백업 취소 실패", true);
    }
  }
  async function remove(targets: BackupItem[]) {
    if (deletionLock.current || busy || restoring || state.loading || state.error || !targets.length) return;
    if (targets.some(item => !canDeleteBackup(item))) return;
    const targetSummary = targets.length === 1
      ? `${formatDate(targets[0].created_at)} 백업`
      : `선택한 백업 ${targets.length}개`;
    if (!window.confirm(`${targetSummary}을 영구 삭제할까요?\n백업 파일과 목록 기록이 삭제되며 복구할 수 없습니다.\n현재 문제·이론·회원·학습 데이터는 삭제하지 않습니다.`)) return;
    deletionLock.current = true;
    setDeleting(true);
    setDeletionResult(null);
    setProgress({ finished: 0, total: targets.length });
    try {
      const result = await deleteBackupsSequentially(targets.map(item => item.id), (finished, total) => setProgress({ finished, total }));
      setDeletionResult(result);
      setSelectedIds(previous => previous.filter(id => !result.deleted.includes(id)));
      const incomplete = result.failed.length + result.skipped.length;
      onNotice(`백업 ${result.deleted.length}개 삭제 완료${incomplete ? ` · 실패 ${result.failed.length}개 · 미실행 ${result.skipped.length}개. 목록을 확인해 주세요.` : "."}`, incomplete > 0);
      await refresh();
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "삭제 실패", true);
    } finally {
      deletionLock.current = false;
      setDeleting(false);
    }
  }
  const items = state.data?.items ?? [];
  const selectable = items.filter(canDeleteBackup);
  const selected = selectable.filter(item => selectedIds.includes(item.id));
  const locked = busy || deleting || Boolean(restoring) || state.loading || Boolean(state.error);
  const allSelected = selectable.length > 0 && selected.length === selectable.length;
  return (
    <div className="admin-section-stack">
      <section className="admin-section-head"><div><span>DATA SAFETY</span><h2>백업 및 복원</h2><p>서버에서 백업을 만들고 검증한 뒤, 복원 직전에도 자동 백업합니다.</p><p>이론 진도 기능은 종료되어 새 백업에 포함하지 않으며, 이전 백업에서도 이론 진도는 복원하지 않습니다.</p></div></section>
      <section className="admin-card backup-create-card" aria-labelledby="backup-create-title">
        <div className="backup-create-heading"><span>CREATE BACKUP</span><h3 id="backup-create-title">새 백업 생성</h3><p>환경변수·비밀키·비밀번호는 어떤 유형에도 포함하지 않습니다.</p></div>
        <div className="backup-create-fields">
          <label className="backup-create-field">백업 범위<select value={type} onChange={(event) => setType(event.target.value)}><option value="full">전체 데이터</option><option value="content">문제·이론만</option><option value="learning">사용자 학습 기록 포함</option><option value="settings">사이트 설정만</option></select></label>
          <label className="backup-create-field">보관 위치<select value={storageMode} aria-describedby={state.data?.storage?.warning ? "backup-storage-warning" : undefined} onChange={(event) => setStorageMode(event.target.value as "database" | "external")}><option value="database">D1 기존 호환 저장</option><option value="external" disabled={!state.data?.storage?.externalAvailable}>비공개 외부 저장소</option></select></label>
        </div>
        {state.data?.storage?.warning && <p className="admin-form-hint backup-storage-warning" id="backup-storage-warning">{state.data.storage.warning}</p>}
        <div className="backup-create-actions">
          {type === "full" && <label className="admin-check"><input type="checkbox" checked={includeAnalytics} onChange={(event) => setIncludeAnalytics(event.target.checked)} /><span>익명 방문 통계 포함</span></label>}
          <button className="admin-button" type="button" disabled={busy || deleting || Boolean(restoring)} onClick={() => void create()}>{busy ? "백업 생성 중…" : "백업 생성"}</button>
          {busy && durableBusy && <button className="admin-button secondary" type="button" disabled={backupCancelRequested.current} onClick={() => { backupCancelRequested.current = true; setBackupProgress("현재 단계가 끝나면 취소합니다."); }}>취소 요청</button>}
        </div>
      </section>
      {busy && <p role="status" className="admin-form-hint">{durableBusy
        ? <>백업 생성과 무결성 검증 중입니다. {backupProgress || "진행 상태를 확인하고 있습니다."} 페이지를 닫아도 생성 중 항목을 다시 이어할 수 있습니다.</>
        : "백업 생성과 무결성 검증 중입니다. 완료될 때까지 페이지를 닫거나 새로고침하지 마세요."}</p>}
      <section className="admin-card admin-table-card">
        <div className="admin-table-head"><strong>백업 목록</strong><span>최근 {items.length}개 표시 · 최대 100개</span></div>
        <div className="admin-bulk-bar backup-selection-bar">
          <label className="admin-check"><input type="checkbox" aria-label="표시된 삭제 가능 백업 전체 선택" disabled={locked || !selectable.length} checked={allSelected} ref={node => { if (node) node.indeterminate = selected.length > 0 && !allSelected; }} onChange={event => setSelectedIds(event.target.checked ? selectable.map(item => item.id) : [])} /> 전체 선택</label>
          <span aria-live="polite">{deleting ? `삭제 중 ${progress.finished} / ${progress.total}개 · 이 화면을 유지해 주세요.` : `${selected.length}개 선택`}</span>
          <button className="admin-button small danger" type="button" disabled={locked || !selected.length} onClick={() => void remove(selected)}>선택 삭제</button>
          <button className="admin-button small secondary" type="button" disabled={busy || deleting || Boolean(restoring) || state.loading} onClick={() => void refresh()}>새로고침</button>
        </div>
        {deletionResult && (deletionResult.failed.length > 0 || deletionResult.skipped.length > 0) && <div className="admin-padded-card" role="status"><p>삭제하지 못한 항목은 목록 확인 후 다시 선택해 주세요.</p><ul>{deletionResult.failed.map(failure => <li key={failure.id}>{failure.id.slice(0, 8)}: {failure.message}</li>)}</ul>{deletionResult.skipped.length > 0 && <p>권한 확인이 필요해 남은 {deletionResult.skipped.length}개는 실행하지 않았습니다.</p>}</div>}
        {state.loading && !state.data ? <LoadingBlock /> : state.error ? <ErrorState message={state.error} onRetry={refresh} /> : items.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th scope="col">선택</th><th scope="col">생성 시각</th><th scope="col">유형</th><th scope="col">보관</th><th scope="col">포함 데이터</th><th scope="col">크기</th><th scope="col">상태</th><th scope="col">무결성</th><th scope="col">작업</th></tr></thead><tbody>{items.map((item) => {
          const completed = item.status === "completed";
          return <tr key={item.id}><td><input type="checkbox" aria-label={`${formatDate(item.created_at)} ${item.id.slice(0, 8)} 백업 선택`} disabled={locked || !canDeleteBackup(item)} checked={selectedIds.includes(item.id)} onChange={event => setSelectedIds(previous => event.target.checked ? [...previous, item.id] : previous.filter(id => id !== item.id))} /></td><td><strong>{formatDate(item.created_at)}</strong><small>{item.id.slice(0, 8)}</small></td><td>{item.backup_type}</td><td>{item.storageMode === "external" ? "외부 비공개" : "D1 호환"}</td><td><span>{item.includedData.length}종</span><small>{Object.values(item.counts).reduce((sum, count) => sum + Number(count), 0)}건</small></td><td>{formatBytes(item.byteSize)}</td><td><span className={completed ? "admin-status success" : "admin-status danger"}>{statusLabel(item.status)}</span>{item.status === "failed" && <details className="backup-failure-detail"><summary>실패 원인</summary><p>{item.error_message || "상세 오류가 기록되지 않았습니다."}</p></details>}</td><td>{completed ? <code>{item.checksum.slice(0, 12)}…</code> : <span>저장 안 됨</span>}</td><td><div className="admin-row-actions">{completed ? <a href={`/api/admin?resource=backup-download&id=${item.id}`}>다운로드</a> : <span className="admin-disabled-action" aria-disabled="true">다운로드</span>}{item.status === "creating" && item.resumable && <><button type="button" disabled={locked} onClick={() => void create(item)}>이어하기</button><button type="button" className="danger" disabled={locked} onClick={() => void cancelPausedBackup(item)}>작업 취소</button></>}<button type="button" disabled={locked || !completed} onClick={() => setRestoring(item)}>복원</button><button type="button" className="danger" disabled={locked || !canDeleteBackup(item)} onClick={() => void remove([item])}>삭제</button></div></td></tr>;
        })}</tbody></table></div> : <EmptyState title="생성된 백업이 없습니다." description="전체 백업 또는 문제·이론 백업을 먼저 생성해 주세요." />}
      </section>
      <AdminTheoryContentRepair onNotice={onNotice} />
      {restoring && <AdminRestoreModal backup={restoring} onClose={() => setRestoring(null)} onRestored={async () => { onNotice("백업을 복원하고 데이터 건수를 검증했습니다."); await refresh(); }} />}
    </div>
  );
}

const SW_TRANSFER_SUBJECTS = SW_CURRICULUM_SUBJECT_GROUPS.flatMap((group) => (
  group.subjects.map((subject) => ({ id: subject.id, name: subject.name }))
));

function importSubjectOptions(value: unknown) {
  if (!value || typeof value !== "object") return [];
  const envelope = value as JsonRecord;
  if (!Array.isArray(value) && envelope.metadata && envelope.data) return [];
  const source = Array.isArray(value)
    ? { questions: value }
    : ((envelope.data && typeof envelope.data === "object" ? envelope.data : envelope) as JsonRecord);
  const rows = (key: string, alternate?: string) => {
    const candidate = source[key] ?? (alternate ? source[alternate] : undefined);
    return Array.isArray(candidate) ? candidate.filter((row): row is JsonRecord => Boolean(row) && typeof row === "object") : [];
  };
  const registered = new Set(
    [...rows("questions"), ...rows("theories")]
      .map((row) => String(row.category ?? "").trim())
      .filter(Boolean),
  );
  const sw = new Map<string, string>();
  for (const row of [...rows("swQuestions", "sw_questions"), ...rows("swTheories", "sw_theories")]) {
    const id = String(row.subject_id ?? row.subjectId ?? "").trim();
    if (id) sw.set(id, String(row.category ?? row.subject ?? id));
  }
  const registeredDomains = CONTENT_ADMIN_DOMAINS.filter(item => item.id !== "sw");
  return [
    ...[...registered].map((category) => ({
      value: `registered:${category}`,
      label: `${registeredDomains.find(item => contentDomainOptions(item.id).subjects.some(subject => subject === category))?.shortLabel ?? "자격"} · ${category}`,
    })),
    ...[...sw].map(([id, label]) => ({ value: `sw:${id}`, label: `SW · ${label}` })),
  ];
}

function TransferSection({
  onNotice,
}: {
  onNotice: (message: string, error?: boolean) => void;
}) {
  const [fileName, setFileName] = useState("");
  const [fileSize, setFileSize] = useState(0);
  const [importData, setImportData] = useState<unknown>(null);
  const [preview, setPreview] = useState<JsonRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [exportDomain, setExportDomain] = useState<ContentAdminDomain>("sql");
  const [exportSubject, setExportSubject] = useState("");
  const [importSelection, setImportSelection] = useState("all");
  const [confirmImport, setConfirmImport] = useState(false);
  const detectedImportSubjects = useMemo(() => importSubjectOptions(importData), [importData]);
  const registeredExport = exportDomain === "sw" ? null : contentDomainOptions(exportDomain);
  const exportSubjects = exportDomain === "sw"
    ? SW_TRANSFER_SUBJECTS
    : registeredExport!.subjects.map((name) => ({ id: name, name }));
  const exportParameters: Record<string, string> = exportDomain === "sw"
    ? { subjectId: exportSubject }
    : { contentDomain: exportDomain, category: exportSubject };
  const questionScope = exportDomain === "sw" ? "sw-questions" : "questions";
  const theoryScope = exportDomain === "sw" ? "sw-theories" : "theories";
  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    setConfirmImport(false);
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > ADMIN_IMPORT_FILE_MAX_BYTES) {
      onNotice("가져오기 파일은 24MiB 이하여야 합니다.", true);
      return;
    }
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      if (!parsed || (typeof parsed !== "object" && !Array.isArray(parsed))) {
        throw new Error("JSON 최상위 값은 문제 배열 또는 데이터 객체여야 합니다.");
      }
      setFileName(file.name);
      setFileSize(file.size);
      setImportData(parsed);
      setImportSelection("all");
      setPreview(null);
      onNotice("전체 파일을 읽었습니다. 저장 전에 검증을 실행해 주세요.");
    } catch (error) {
      setFileName("");
      setFileSize(0);
      setImportData(null);
      setImportSelection("all");
      setPreview(null);
      event.target.value = "";
      onNotice(
        error instanceof Error ? `JSON 파일을 읽지 못했습니다. ${error.message}` : "JSON 파일을 읽지 못했습니다.",
        true,
      );
    }
  }
  async function validate() {
    if (!importData) return;
    setConfirmImport(false);
    setBusy(true);
    try {
      const data = await apiAction<JsonRecord>("import-preview", { data: importData, selection: importSelection });
      setPreview(data);
      onNotice(
        data.canCommit === false
          ? "가져오기 전에 수정해야 할 데이터 오류가 있습니다."
          : "선택한 범위를 저장하지 않고 먼저 검증했습니다.",
        data.canCommit === false,
      );
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "검증 실패", true);
    } finally {
      setBusy(false);
    }
  }
  async function commit() {
    if (!preview || preview.canCommit === false || !importData || !confirmImport) return;
    const previewMetadata = preview.metadata && typeof preview.metadata === "object"
      ? preview.metadata as JsonRecord
      : null;
    const discardWithoutBackup = previewMetadata?.discardWithoutBackup === true;
    setConfirmImport(false);
    setBusy(true);
    try {
      await apiAction("import-commit", { data: importData, selection: importSelection });
      onNotice(discardWithoutBackup
        ? "기존 정보처리기사 콘텐츠를 백업 없이 폐기하고 새 1단원 정본으로 교체했습니다."
        : "데이터를 병합하고 결과를 검증했습니다.");
      setFileName("");
      setFileSize(0);
      setImportData(null);
      setImportSelection("all");
      setPreview(null);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "가져오기 실패", true);
    } finally {
      setBusy(false);
    }
  }
  const previewMetadata = preview?.metadata && typeof preview.metadata === "object"
    ? preview.metadata as JsonRecord
    : null;
  const discardWithoutBackup = previewMetadata?.discardWithoutBackup === true;
  return (
    <div className="admin-section-stack">
      <section className="admin-section-head"><div><span>DATA TRANSFER</span><h2>전체 분야 가져오기·내보내기</h2><p>분야와 과목을 선택해 내보내고, 가져오기는 선택 범위 검증 후에만 병합합니다.</p></div></section>
      <AdminSkctBankActivation onNotice={onNotice} />
      <section className="admin-transfer-grid">
        <article className="admin-card">
          <span>EXPORT</span>
          <h3>데이터 내보내기</h3>
          <p>분야 전체 또는 한 과목을 선택해 문제·이론을 JSON이나 CSV로 내려받습니다.</p>
          <div className="admin-form-grid">
            <label>학습 분야<select value={exportDomain} onChange={(event) => { setExportDomain(event.target.value as ContentAdminDomain); setExportSubject(""); }}>{CONTENT_ADMIN_DOMAINS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
            <label>과목<select value={exportSubject} onChange={(event) => setExportSubject(event.target.value)}><option value="">분야 전체</option>{exportSubjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label>
          </div>
          <div className="admin-export-list">
            <ExportLink parameters={{ scope: questionScope, ...exportParameters }} onNotice={onNotice}>문제 JSON · 문항 원문 전체</ExportLink>
            <ExportLink parameters={{ scope: questionScope, format: "csv", ...exportParameters }} onNotice={onNotice}>문제 CSV · 목록 형식</ExportLink>
            <ExportLink parameters={{ scope: theoryScope, ...exportParameters }} onNotice={onNotice}>이론 JSON · 본문 전체</ExportLink>
            <ExportLink parameters={{ scope: theoryScope, format: "csv", ...exportParameters }} onNotice={onNotice}>이론 CSV · 목록 형식</ExportLink>
            <ExportButton parameters={{ scope: "links" }} onNotice={onNotice}>연결 관계만 JSON · 문제 본문 제외</ExportButton>
            <ExportButton parameters={{ scope: "statistics" }} onNotice={onNotice}>통계만 JSON · 문제 본문 제외</ExportButton>
          </div>
        </article>
        <article className="admin-card"><span>IMPORT</span><h3>문제·이론 가져오기</h3><p>모두의 문제집 JSON에서 전체 또는 감지된 한 과목만 선택하고, 기존 ID·이론 연결·중복·마크다운 오류를 먼저 검사합니다.</p><label className="admin-file-input"><input type="file" accept=".json,application/json" onChange={(event) => void readFile(event)} /><span>{fileName ? `${fileName} · ${formatBytes(fileSize)}` : "JSON 파일 선택"}</span></label>{importData !== null && <label>가져올 범위<select value={importSelection} onChange={(event) => { setImportSelection(event.target.value); setPreview(null); }}><option value="all">파일 전체</option>{detectedImportSubjects.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>}<button className="admin-button secondary" type="button" disabled={!importData || busy} onClick={() => void validate()}>{busy ? "선택 범위 검증 중…" : "가져오기 전 검증"}</button></article>
      </section>
      {preview && <section className="admin-card import-preview"><div className="admin-card-head"><div><span>VALIDATION RESULT</span><h3>가져오기 미리보기</h3></div><span className={preview.canCommit === false ? "admin-status danger" : "admin-status success"}>{preview.canCommit === false ? "데이터 오류 확인 필요" : "전체 파일 검증 완료"}</span></div><pre>{JSON.stringify(preview, null, 2)}</pre><div className="admin-warning-box"><strong>아직 데이터는 변경되지 않았습니다.</strong><p>{preview.canCommit === false ? "표시된 오류를 수정한 파일로 다시 검증해 주세요." : discardWithoutBackup ? "기존 정보처리기사 콘텐츠와 연결 학습 기록을 백업 없이 폐기한 뒤 새 정본으로 교체합니다." : "건수와 중복 가능성을 확인한 뒤 병합을 실행하세요."}</p></div><button className="admin-button" type="button" disabled={busy || preview.canCommit === false} onClick={() => setConfirmImport(true)}>{discardWithoutBackup ? "백업 없이 폐기 교체" : "검증 결과로 병합"}</button></section>}
      {preview && confirmImport && <section className="admin-card admin-warning-box" role="alertdialog" aria-label="가져오기 최종 확인">
        <h3>가져오기 최종 확인</h3>
        <p>{discardWithoutBackup ? "기존 정보처리기사 문제·이론과 연결 학습 기록을 백업 없이 삭제합니다. 이 작업은 되돌릴 수 없습니다." : "검증한 콘텐츠를 병합합니다. 기존 ID를 변경하는 경우 전체 백업이 자동 생성됩니다. 백업 형식 파일도 적용 전에 전체 백업을 생성합니다."}</p>
        <button className="admin-button secondary" type="button" disabled={busy} onClick={() => setConfirmImport(false)}>취소</button>
        <button className="admin-button" type="button" disabled={busy} onClick={() => void commit()}>확인하고 적용</button>
      </section>}
    </div>
  );
}

export default function AdminCoreSections({
  section,
  onNotice,
}: {
  section: AdminSection;
  onNotice: (message: string, error?: boolean) => void;
}) {
  const sectionView = section === "dashboard"
    ? <LazyDashboardSection onNotice={onNotice} />
    : section === "questions"
      ? <LazyQuestionsSection onNotice={onNotice} />
      : section === "theories"
        ? <LazyTheoriesSection onNotice={onNotice} />
        : section === "quality"
          ? <QualitySection onNotice={onNotice} />
          : section === "backups"
            ? <BackupsSection onNotice={onNotice} />
            : section === "transfer"
              ? <TransferSection onNotice={onNotice} />
              : null;

  return (
    <Suspense fallback={<LoadingBlock label="관리자 화면을 불러오는 중입니다." />}>
      {sectionView}
    </Suspense>
  );
}
