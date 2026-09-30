"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { apiAction, apiGet } from "@frontend/features/admin/model/admin-api-client";

type JsonRecord = Record<string, unknown>;
type LogsData = {
  audits: Array<JsonRecord & { success: boolean; before: JsonRecord; after: JsonRecord }>;
  groupedErrors: JsonRecord[];
  recentErrors: JsonRecord[];
};

function formatDate(value: unknown) {
  if (!value) return "기록 없음";
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) return "기록 없음";
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function statusLabel(value: unknown) {
  const labels: Record<string, string> = {
    open: "확인 필요",
    resolved: "해결",
    ignored: "무시",
  };
  return labels[String(value)] ?? String(value ?? "-");
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return <div className="admin-empty-state"><strong>{title}</strong><p>{description}</p></div>;
}

export default function AdminLogsSection({
  onNotice,
}: {
  onNotice: (message: string, error?: boolean) => void;
}) {
  const searchParams = useSearchParams();
  const [state, setState] = useState<{ loading: boolean; error: string; data: LogsData | null }>({
    loading: true,
    error: "",
    data: null,
  });
  const [tab, setTab] = useState<"audit" | "errors">(
    searchParams.get("view") === "errors" ? "errors" : "audit",
  );
  const [search, setSearch] = useState("");

  async function refresh() {
    setState((previous) => ({ ...previous, loading: true, error: "" }));
    try {
      const params = new URLSearchParams({ search, limit: "100" });
      setState({ loading: false, error: "", data: await apiGet("logs", params) });
    } catch (error) {
      setState({ loading: false, error: error instanceof Error ? error.message : "조회 실패", data: null });
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function updateError(id: unknown, status: string) {
    try {
      await apiAction("error-status", { id, status });
      onNotice("오류 처리 상태를 변경했습니다.");
      await refresh();
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "상태 변경 실패", true);
    }
  }

  const data = state.data;
  if (state.loading && !data) return <div className="admin-loading" role="status">데이터를 불러오는 중입니다.</div>;
  if (state.error) {
    return (
      <div className="admin-error-state" role="alert">
        <strong>데이터를 불러오지 못했습니다.</strong><p>{state.error}</p>
        <button className="admin-button secondary" type="button" onClick={() => void refresh()}>다시 시도</button>
      </div>
    );
  }

  return (
    <div className="admin-section-stack">
      <section className="admin-section-head">
        <div><span>AUDIT & ERRORS</span><h2>관리자 작업·시스템 로그</h2><p>민감한 답안·토큰 없이 변경 요약과 반복 오류를 확인합니다.</p></div>
        <form className="admin-log-search" onSubmit={(event) => { event.preventDefault(); void refresh(); }}>
          <label htmlFor="admin-log-query">로그 검색</label>
          <div><input id="admin-log-query" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="작업·대상·실패 원인 검색" /><button className="admin-button secondary" type="submit">검색</button></div>
        </form>
      </section>
      <div className="admin-tabs"><button type="button" className={tab === "audit" ? "active" : ""} onClick={() => setTab("audit")}>관리자 감사 로그</button><button type="button" className={tab === "errors" ? "active" : ""} onClick={() => setTab("errors")}>오류 및 시스템 상태</button></div>
      {tab === "audit" ? (
        <section className="admin-card admin-table-card">
          <div className="admin-table-head"><strong>중요 작업 기록</strong><span>{data?.audits.length ?? 0}건 표시</span></div>
          {data?.audits.length ? <div className="admin-log-list">{data.audits.map((item) => <details key={String(item.id)} className={item.success ? "success" : "failure"}><summary><span>{item.success ? "성공" : "실패"}</span><strong>{String(item.action)}</strong><small>{String(item.target_type)} {item.target_id ? `· ${String(item.target_id)}` : ""}</small><time>{formatDate(item.created_at)}</time></summary><div><p>{item.failure_reason ? `실패 원인: ${String(item.failure_reason)}` : "작업이 정상 완료되었습니다."}</p><div><section><strong>변경 전 요약</strong><pre>{JSON.stringify(item.before, null, 2)}</pre></section><section><strong>변경 후 요약</strong><pre>{JSON.stringify(item.after, null, 2)}</pre></section></div></div></details>)}</div> : <EmptyState title="관리자 작업 기록이 없습니다." description="콘텐츠 변경, 백업, 복원과 설정 변경이 기록됩니다." />}
        </section>
      ) : (
        <>
          <section className="admin-card admin-padded-card admin-system-status-card"><div className="admin-card-head"><div><h3>반복 오류 묶음</h3><p>같은 원인의 오류를 발생 횟수와 마지막 시각으로 묶었습니다.</p></div></div>{data?.groupedErrors.length ? <div className="admin-error-groups">{data.groupedErrors.map((item) => <article key={`${String(item.fingerprint)}-${String(item.status)}`}><span className={`admin-status ${item.status === "open" ? "danger" : "muted"}`}>{statusLabel(item.status)}</span><div><strong>{String(item.error_type)}</strong><p>{String(item.page_path || "발생 화면 미확인")} · 영향: {String(item.impact)}</p><small>발생 {String(item.occurrences)}회 · 마지막 {formatDate(item.last_seen)}</small></div></article>)}</div> : <EmptyState title="최근 발생한 오류가 없습니다." description="애플리케이션 오류와 데이터 저장 실패가 여기에 집계됩니다." />}</section>
          <section className="admin-card admin-table-card admin-system-errors-card"><div className="admin-table-head"><strong>최근 개별 오류</strong></div>{data?.recentErrors.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>발생 시각</th><th>유형</th><th>화면·문제</th><th>영향</th><th>메시지</th><th>상태</th></tr></thead><tbody>{data.recentErrors.map((item) => <tr key={String(item.id)}><td>{formatDate(item.created_at)}</td><td>{String(item.error_type)}</td><td>{String(item.page_path || "-")}<small>{item.question_id ? `문제 ID ${String(item.question_id)}` : ""}</small></td><td>{String(item.impact)}</td><td>{String(item.message)}</td><td><select value={String(item.status)} onChange={(event) => void updateError(item.id, event.target.value)}><option value="open">확인 필요</option><option value="resolved">해결</option><option value="ignored">무시</option></select></td></tr>)}</tbody></table></div> : <EmptyState title="개별 오류가 없습니다." description="오류가 발생하면 영향 범위와 함께 표시됩니다." />}</section>
        </>
      )}
    </div>
  );
}
