"use client";

import { useEffect, useState } from "react";
import { apiAction, apiGet } from "@frontend/features/admin/model/admin-api-client";

import {
  EmptyState,
  ErrorState,
  LoadingBlock,
  Modal,
  emptyLoad,
  formatDate,
  type LoadState,
} from "./admin-ui";
import { MetricCard } from "./admin-section-primitives";
import AdminSelfLearningReset from "./admin-self-learning-reset";

type MemberItem = {
  user_key: string;
  user_key_short: string;
  email: string;
  display_name: string;
  status: "active" | "blocked";
  blocked_reason: string;
  blocked_at: string | null;
  created_at: string;
  last_login_at: string;
  attempts: number;
  correct: number;
  incorrect: number;
  bookmarks: number;
  mock_exams: number;
};

type MembersData = {
  items: MemberItem[];
  summary: { total: number; active: number; blocked: number };
  pagination: { page: number; pageSize: number; total: number; pages: number };
};

export default function MembersSection({
  onNotice,
}: {
  onNotice: (message: string, error?: boolean) => void;
}) {
  const [state, setState] = useState<LoadState<MembersData>>(emptyLoad);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<MemberItem | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh(nextPage = page) {
    setState((previous) => ({ ...previous, loading: true, error: "" }));
    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        pageSize: "30",
      });
      if (status) params.set("status", status);
      if (search.trim()) params.set("search", search.trim());
      const data = await apiGet<MembersData>("members", params);
      setState({ loading: false, error: "", data });
      setPage(data.pagination.page);
    } catch (error) {
      setState({
        loading: false,
        error: error instanceof Error ? error.message : "회원 목록 조회 실패",
        data: null,
      });
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(1), 0);
    return () => window.clearTimeout(timer);
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  async function updateAccess() {
    if (!selected || busy) return;
    const blocking = selected.status === "active";
    if (blocking && reason.trim().length < 2) {
      onNotice("차단 사유를 2자 이상 입력해 주세요.", true);
      return;
    }
    setBusy(true);
    try {
      await apiAction(blocking ? "user-block" : "user-unblock", {
        userKey: selected.user_key,
        reason: reason.trim(),
      });
      onNotice(blocking ? "회원 접근을 차단했습니다." : "회원 차단을 해제했습니다.");
      setSelected(null);
      setReason("");
      await refresh();
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "회원 상태 변경 실패", true);
    } finally {
      setBusy(false);
    }
  }

  const data = state.data;
  return (
    <div className="admin-section-stack">
      <section className="admin-section-head">
        <div>
          <span>MEMBER ACCESS</span>
          <h2>회원 관리</h2>
          <p>가입 계정과 학습 활동을 확인하고, 운영 정책을 위반한 계정의 접근을 서버에서 제한합니다.</p>
        </div>
      </section>
      <section className="admin-metric-grid compact member-summary-grid">
        <MetricCard label="전체 회원" value={data?.summary.total ?? 0} unit="명" />
        <MetricCard label="이용 가능" value={data?.summary.active ?? 0} unit="명" tone="accent" />
        <MetricCard label="차단 회원" value={data?.summary.blocked ?? 0} unit="명" tone="warning" />
      </section>
      <AdminSelfLearningReset onReset={async () => { await refresh(); }} />
      <section className="admin-filter-card member-filter-card">
        <form className="member-filter-form" onSubmit={(event) => { event.preventDefault(); void refresh(1); }}>
          <label>
            상태
            <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
              <option value="">전체</option>
              <option value="active">이용 가능</option>
              <option value="blocked">차단됨</option>
            </select>
          </label>
          <label className="member-search-field">
            <span>회원 검색</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="이름·이메일·회원 식별값"
              aria-label="이름, 이메일 또는 회원 식별값 검색"
            />
          </label>
          <button className="admin-button" type="submit">조회</button>
        </form>
      </section>
      {state.loading && !data ? <LoadingBlock label="회원 목록을 불러오는 중입니다." />
        : state.error ? <ErrorState message={state.error} onRetry={() => void refresh()} />
          : data?.items.length ? (
            <section className="admin-card admin-table-card">
              <div className="admin-table-head">
                <strong>가입 회원</strong>
                <span>총 {data.pagination.total}명</span>
              </div>
              <div className="admin-table-wrap">
                <table className="admin-table member-table">
                  <thead>
                    <tr>
                      <th>회원</th>
                      <th>상태</th>
                      <th>마지막 로그인</th>
                      <th>풀이 기록</th>
                      <th>북마크·모의고사</th>
                      <th>접근 제어</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((item) => (
                      <tr key={item.user_key} className={item.status === "blocked" ? "inactive" : ""}>
                        <td>
                          <strong>{item.display_name || "이전 로그인 계정"}</strong>
                          <span>{item.email || "이메일은 다음 로그인 시 확인됩니다."}</span>
                          <small>{item.user_key_short}</small>
                        </td>
                        <td>
                          <span className={`admin-status ${item.status === "blocked" ? "danger" : "success"}`}>
                            {item.status === "blocked" ? "차단됨" : "이용 가능"}
                          </span>
                          {item.blocked_reason && <small>{item.blocked_reason}</small>}
                        </td>
                        <td>{formatDate(item.last_login_at)}</td>
                        <td>
                          <strong>{item.attempts}회</strong>
                          <small>정답 {item.correct} · 오답 {item.incorrect}</small>
                        </td>
                        <td>
                          <span>북마크 {item.bookmarks}개</span>
                          <small>완료 모의고사 {item.mock_exams}회</small>
                        </td>
                        <td>
                          <button
                            className={item.status === "blocked" ? "admin-button secondary" : "admin-button danger"}
                            type="button"
                            onClick={() => { setSelected(item); setReason(""); }}
                          >
                            {item.status === "blocked" ? "차단 해제" : "접근 차단"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {data.pagination.pages > 1 && (
                <div className="admin-pagination">
                  <button type="button" disabled={page <= 1} onClick={() => void refresh(page - 1)}>이전</button>
                  <span>{page} / {data.pagination.pages}</span>
                  <button type="button" disabled={page >= data.pagination.pages} onClick={() => void refresh(page + 1)}>다음</button>
                </div>
              )}
            </section>
          ) : <EmptyState title="조건에 맞는 회원이 없습니다." description="로그인한 사용자는 계정별로 이 목록에 등록됩니다." />}
      {selected && (
        <Modal
          title={selected.status === "active" ? "회원 접근 차단" : "회원 차단 해제"}
          onClose={() => { if (!busy) setSelected(null); }}
        >
          <div className="member-access-modal">
            <p>
              <strong>{selected.display_name || selected.email || selected.user_key_short}</strong>
              {selected.status === "active"
                ? " 계정은 차단 즉시 학습 화면과 사용자 API를 이용할 수 없습니다."
                : " 계정의 학습 화면과 사용자 API 접근을 다시 허용합니다."}
            </p>
            {selected.status === "active" && (
              <label>
                차단 사유
                <textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  rows={4}
                  maxLength={500}
                  placeholder="운영자만 확인할 차단 사유를 입력하세요."
                />
                <small>{reason.trim().length}/500자 · 최소 2자</small>
              </label>
            )}
            <div className="admin-row-actions">
              <button type="button" onClick={() => setSelected(null)} disabled={busy}>취소</button>
              <button
                className={selected.status === "active" ? "danger" : ""}
                type="button"
                onClick={() => void updateAccess()}
                disabled={busy}
              >
                {busy ? "처리 중…" : selected.status === "active" ? "접근 차단" : "차단 해제"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
