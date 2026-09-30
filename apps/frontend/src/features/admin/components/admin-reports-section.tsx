"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiAction, apiGet } from "@frontend/features/admin/model/admin-api-client";

import {
  EmptyState,
  ErrorState,
  LoadingBlock,
  emptyLoad,
  formatDate,
  statusLabel,
  type LoadState,
  type UserReportItem,
} from "./admin-ui";

export default function ReportsSection({
  onNotice,
  onReportsChanged,
}: {
  onNotice: (message: string, error?: boolean) => void;
  onReportsChanged?: () => void;
}) {
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [state, setState] = useState<LoadState<{ items: UserReportItem[] }>>(emptyLoad);

  const refresh = async () => {
    setState((previous) => ({ ...previous, loading: true, error: "" }));
    try {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (search.trim()) params.set("search", search.trim());
      const data = await apiGet<{ items: UserReportItem[] }>("reports", params);
      setState({ loading: false, error: "", data });
      setNotes(Object.fromEntries(data.items.map((item) => [item.id, item.admin_note])));
    } catch (error) {
      setState({
        loading: false,
        error: error instanceof Error ? error.message : "제보 조회 실패",
        data: null,
      });
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  async function update(item: UserReportItem, nextStatus: UserReportItem["status"]) {
    try {
      await apiAction("report-status", {
        id: item.id,
        status: nextStatus,
        adminNote: notes[item.id] ?? "",
      });
      onReportsChanged?.();
      onNotice("제보 처리 상태를 저장했습니다.");
      await refresh();
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "제보 상태 저장 실패", true);
    }
  }

  async function remove(item: UserReportItem) {
    if (!window.confirm(`“${item.title}” 제보를 삭제할까요? 삭제한 제보는 복구할 수 없습니다.`)) {
      return;
    }
    try {
      await apiAction("report-delete", { id: item.id });
      onReportsChanged?.();
      onNotice("사용자 제보를 삭제했습니다.");
      await refresh();
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "제보 삭제 실패", true);
    }
  }

  const items = state.data?.items ?? [];
  return (
    <div className="admin-section-stack">
      <section className="admin-section-head">
        <div>
          <span>USER REPORTS</span>
          <h2>사용자 제보</h2>
          <p>익명 사용자 식별값만 보며 버그·콘텐츠 오류·개선 요청을 처리합니다.</p>
        </div>
      </section>
      <section className="admin-card admin-filter-card report-filter-bar">
        <form onSubmit={(event) => { event.preventDefault(); void refresh(); }}>
          <label className="report-status-field">
            <span>상태</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">전체</option>
              <option value="new">신규</option>
              <option value="reviewing">검토 중</option>
              <option value="resolved">해결</option>
            </select>
          </label>
          <label className="report-search-field">
            <span>검색</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="제목·내용 검색"
              aria-label="사용자 제보 제목 또는 내용 검색"
            />
          </label>
          <button className="admin-button" type="submit">조회</button>
        </form>
      </section>
      {state.loading && !state.data ? <LoadingBlock label="사용자 제보를 불러오는 중입니다." />
        : state.error ? <ErrorState message={state.error} onRetry={refresh} />
          : items.length ? (
            <section className="admin-report-list">
              {items.map((item) => (
                <article className="admin-card admin-report-card" key={item.id}>
                  <header>
                    <div>
                      <span className={`admin-status ${item.status === "resolved" ? "success" : item.status === "new" ? "danger" : ""}`}>
                        {statusLabel(item.status)}
                      </span>
                      <span>{item.category === "bug" ? "버그" : item.category === "content" ? "콘텐츠 오류" : "개선 제안"}</span>
                    </div>
                    <time>{formatDate(item.created_at)}</time>
                  </header>
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                  <div className="admin-report-meta">
                    {item.question_id && <Link href={`/admin/questions?focus=${item.question_id}`}>관련 문제 확인 →</Link>}
                    <span>사용자 {item.anonymous_user}…</span>
                  </div>
                  <label>
                    관리자 메모
                    <textarea
                      value={notes[item.id] ?? ""}
                      onChange={(event) => setNotes((previous) => ({ ...previous, [item.id]: event.target.value }))}
                      rows={3}
                      maxLength={1200}
                    />
                  </label>
                  <div className="admin-row-actions">
                    <button type="button" onClick={() => void update(item, "new")}>신규로</button>
                    <button type="button" onClick={() => void update(item, "reviewing")}>검토 중</button>
                    <button type="button" onClick={() => void update(item, "resolved")}>해결</button>
                    <button
                      className="danger"
                      type="button"
                      onClick={() => void remove(item)}
                    >
                      제보 삭제
                    </button>
                  </div>
                </article>
              ))}
            </section>
          ) : <EmptyState title="조건에 맞는 제보가 없습니다." description="사용자 제보가 접수되면 이곳에서 확인할 수 있습니다." />}
    </div>
  );
}
