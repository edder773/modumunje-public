"use client";

import {
  type FormEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "next/navigation";
import { SW_CURRICULUM_SUBJECT_GROUPS } from "@shared/study/sw-curriculum-contract.mjs";
import {
  apiAction,
  apiGet,
} from "@frontend/features/admin/model/admin-api-client";
import { splitQuestionPromptForDisplay } from "@shared/content/content-format.mjs";
import {
  contentScopeAllowsSubject,
  examScopeLabel,
  type ExamScope,
} from "@shared/study/study-domain";
import {
  EmptyState,
  ErrorState,
  ExportLink,
  LoadingBlock,
  MarkdownPreview,
  Modal,
  emptyLoad,
  type JsonRecord,
  type LoadState,
} from "./admin-ui";
import {
  ContentDomainTabs,
  contentDomainOptions,
  updateContentQuery,
  type ContentAdminDomain,
  type CertificationAdminDomain,
  parseContentAdminDomain,
  type SwAdminTheory,
} from "./admin-content-shared";

import { useAdminTheoryLoader } from "@frontend/features/admin/model/admin-theory-loader";

type AdminTheory = {
  id: number;
  title: string;
  category: string;
  topic: string;
  sortOrder: number;
  examScope: ExamScope;
  difficulty: string;
  summary: string;
  content: string;
  reviewAnswers: string;
  keywords: string[];
  active: boolean;
  linkedQuestions: number;
  viewCount: number;
  relatedStarts: number;
  created_at: string;
  updated_at: string;
};

type AdminTheorySummary = Pick<AdminTheory, "id" | "title" | "category" | "topic" | "sortOrder" | "examScope" | "active" | "summary" | "linkedQuestions" | "viewCount">;
type SwTheorySummary = Pick<SwAdminTheory, "id" | "subjectGroupId" | "subjectId" | "category" | "topic" | "title" | "summary" | "sortOrder" | "active" | "linkedQuestions">;

type TheoryListData = {
  items: AdminTheorySummary[];
  pagination: { page: number; pageSize: number; total: number; pages: number };
};

function TheoryFormModal({
  theory,
  domain,
  onClose,
  onSaved,
}: {
  theory: AdminTheory | null;
  domain: CertificationAdminDomain;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const domainConfig = contentDomainOptions(domain);
  const [form, setForm] = useState({
    title: theory?.title ?? "",
    category: theory?.category ?? domainConfig.subjects[0],
    topic: theory?.topic ?? "",
    sortOrder: theory?.sortOrder ?? 999,
    examScope: theory?.examScope ?? domainConfig.scopeOptions[0]!.value,
    summary: theory?.summary ?? "",
    content: theory?.content ?? "",
    reviewAnswers: theory?.reviewAnswers ?? "",
    keywords: theory?.keywords.join(", ") ?? "",
    active: theory?.active ?? true,
  });
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function update(name: string, value: string | number | boolean) {
    setForm((previous) => {
      const next = { ...previous, [name]: value };
      if (name === "examScope" && !contentScopeAllowsSubject(String(value), next.category)) {
        next.category = domainConfig.subjects.find((subject) => contentScopeAllowsSubject(String(value), subject)) ?? domainConfig.subjects[0];
      }
      return next;
    });
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await apiAction(theory ? "theory-update" : "theory-create", {
        ...form,
        id: theory?.id,
        keywords: form.keywords.split(",").map((item) => item.trim()).filter(Boolean),
      });
      await onSaved();
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={theory ? "이론 수정" : "새 이론 등록"} onClose={onClose} wide>
      <div className="admin-modal-tabs"><button type="button" className={tab === "edit" ? "active" : ""} onClick={() => setTab("edit")}>편집</button><button type="button" className={tab === "preview" ? "active" : ""} onClick={() => setTab("preview")}>마크다운 미리보기</button></div>
      {tab === "preview" ? <div className="admin-theory-preview"><h2>{form.title || "제목 없음"}</h2><p>{form.summary}</p><MarkdownPreview value={form.content} />{form.reviewAnswers.trim() && <section className="admin-detail-section"><MarkdownPreview value={form.reviewAnswers} /></section>}</div> : (
        <form className="admin-form" onSubmit={submit}>
          <label>이론 제목<input value={form.title} onChange={(event) => update("title", event.target.value)} /></label>
          <div className="admin-form-grid three">
            <label>시험 범위<select value={form.examScope} onChange={(event) => update("examScope", event.target.value)}>{domainConfig.scopeOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
            <label>과목<select value={form.category} onChange={(event) => update("category", event.target.value)}>{domainConfig.subjects.filter((subject) => contentScopeAllowsSubject(form.examScope, subject)).map((subject) => <option key={subject}>{subject}</option>)}</select></label>
            <label>소분류<input value={form.topic} onChange={(event) => update("topic", event.target.value)} /></label>
            <label>정렬 순서<input type="number" min={1} max={99999} value={form.sortOrder} onChange={(event) => update("sortOrder", Number(event.target.value))} /></label>
            <label>키워드 · 쉼표 구분<input value={form.keywords} onChange={(event) => update("keywords", event.target.value)} /></label>
          </div>
          <label>한 줄 요약<textarea rows={3} value={form.summary} onChange={(event) => update("summary", event.target.value)} /></label>
          <label>마크다운 본문<textarea rows={24} value={form.content} onChange={(event) => update("content", event.target.value)} placeholder="제목, 문단, 목록, SQL 코드 블록과 표를 사용할 수 있습니다." /></label>
          <label>복습 문제 정답 및 해설<textarea rows={16} value={form.reviewAnswers} onChange={(event) => update("reviewAnswers", event.target.value)} placeholder="본문 하단 복습 문제와 같은 번호의 정답 및 해설을 입력합니다." /></label>
          <label className="admin-check"><input type="checkbox" checked={form.active} onChange={(event) => update("active", event.target.checked)} /> 학습 화면에 활성화</label>
          {error && <p className="admin-form-error">{error}</p>}
          <footer className="admin-form-actions"><button type="button" className="admin-button secondary" onClick={onClose}>취소</button><button className="admin-button" disabled={busy}>{busy ? "저장 중…" : "저장"}</button></footer>
        </form>
      )}
    </Modal>
  );
}

function TheoryDetailModal({
  theory,
  onClose,
  onEdit,
  onNotice,
}: {
  theory: AdminTheory;
  onClose: () => void;
  onEdit: () => void;
  onNotice: (message: string, error?: boolean) => void;
}) {
  const [links, setLinks] = useState<LoadState<{ questions: JsonRecord[] }>>(emptyLoad);
  const [questionId, setQuestionId] = useState("");
  async function refreshLinks() {
    try {
      const params = new URLSearchParams({ id: String(theory.id) });
      setLinks({ loading: false, error: "", data: await apiGet("theory-links", params) });
    } catch (error) {
      setLinks({ loading: false, error: error instanceof Error ? error.message : "연결 조회 실패", data: null });
    }
  }
  useEffect(() => {
    const timer = window.setTimeout(() => void refreshLinks(), 0);
    return () => window.clearTimeout(timer);
  }, [theory.id]); // eslint-disable-line react-hooks/exhaustive-deps
  async function link(targetTheory: number | null, targetQuestionId: number) {
    try {
      await apiAction("theory-link", { questionId: targetQuestionId, theoryId: targetTheory });
      onNotice(targetTheory ? "문제를 이론에 연결했습니다." : "이론 연결을 해제했습니다.");
      await refreshLinks();
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "연결 실패", true);
    }
  }
  return (
    <Modal title={theory.title} onClose={onClose} wide>
      <div className="admin-detail-meta"><span>{examScopeLabel(theory.examScope)}</span><span>{theory.category}</span><span>{theory.topic}</span><span>{theory.active ? "활성" : "비활성"}</span></div>
      <p className="admin-detail-summary">{theory.summary}</p>
      <section className="admin-detail-section"><MarkdownPreview value={theory.content} /></section>
      {theory.reviewAnswers.trim() && <section className="admin-detail-section"><MarkdownPreview value={theory.reviewAnswers} /></section>}
      <section className="admin-stat-strip">
        <div><span>조회 수</span><strong>{theory.viewCount}회</strong></div>
        <div><span>연결 문제 시작</span><strong>{theory.relatedStarts}회</strong></div>
        <div><span>연결 문제</span><strong>{theory.linkedQuestions}문항</strong></div>
      </section>
      <section className="admin-detail-section">
        <div className="admin-card-head"><div><h3>연결 문제</h3><p>문제 ID를 직접 연결하거나 기존 연결을 해제할 수 있습니다.</p></div><form onSubmit={(event) => { event.preventDefault(); const id = Number(questionId); if (id) void link(theory.id, id); }}><input type="number" value={questionId} onChange={(event) => setQuestionId(event.target.value)} placeholder="문제 ID" /><button className="admin-button small">연결</button></form></div>
        {links.loading ? <LoadingBlock /> : links.data?.questions.length ? <div className="admin-link-list">{links.data.questions.map((question) => <div key={String(question.id)}><span>문제 {String(question.display_order)} · ID {String(question.id)}</span><strong>{splitQuestionPromptForDisplay(String(question.prompt)).stem}</strong><button type="button" onClick={() => void link(null, Number(question.id))}>연결 해제</button></div>)}</div> : <EmptyState title="직접 연결된 문제가 없습니다." description="문제 ID를 입력해 연결하거나 문제 편집 화면에서 이론을 선택하세요." />}
      </section>
      <footer className="admin-form-actions"><button className="admin-button secondary" type="button" onClick={onClose}>닫기</button><button className="admin-button" type="button" onClick={onEdit}>수정</button></footer>
    </Modal>
  );
}

function SwTheoryFormModal({
  theory,
  onClose,
  onSaved,
}: {
  theory: SwAdminTheory | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    subjectGroupId: theory?.subjectGroupId ?? "",
    subjectId: theory?.subjectId ?? "",
    category: theory?.category ?? "",
    topic: theory?.topic ?? "",
    title: theory?.title ?? "",
    summary: theory?.summary ?? "",
    content: theory?.content ?? "",
    reviewAnswers: theory?.reviewAnswers ?? "",
    keywords: theory?.keywords.join(", ") ?? "",
    sortOrder: String(theory?.sortOrder ?? ""),
    active: theory?.active ?? true,
  });
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const update = (key: string, value: string | boolean) => setForm((previous) => ({ ...previous, [key]: value }));
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await apiAction(theory ? "sw-theory-update" : "sw-theory-create", {
        ...(theory ? { id: theory.id } : {}),
        ...form,
        sortOrder: Number(form.sortOrder) || 999,
        keywords: form.keywords.split(",").map((value) => value.trim()).filter(Boolean),
      });
      await onSaved();
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={theory ? `SW 이론 ${theory.id} 수정` : "새 SW 이론 등록"} onClose={onClose} wide>
      <div className="admin-modal-tabs" role="tablist" aria-label="이론 편집 방식"><button type="button" role="tab" aria-selected={!preview} className={!preview ? "active" : ""} onClick={() => setPreview(false)}>편집</button><button type="button" role="tab" aria-selected={preview} className={preview ? "active" : ""} onClick={() => setPreview(true)}>미리보기</button></div>
      {preview ? <div className="admin-preview-stack"><h2>{form.title}</h2><p>{form.summary}</p><MarkdownPreview value={form.content} /></div> : <form className="admin-form" onSubmit={submit}>
        <div className="admin-form-grid three"><label>대분류 ID<input required value={form.subjectGroupId} onChange={(event) => update("subjectGroupId", event.target.value)} /></label><label>소분류 ID<input required value={form.subjectId} onChange={(event) => update("subjectId", event.target.value)} /></label><label>표시 순서<input required type="number" min="1" value={form.sortOrder} onChange={(event) => update("sortOrder", event.target.value)} /></label><label>대분류명<input required value={form.category} onChange={(event) => update("category", event.target.value)} /></label><label>소분류명<input required value={form.topic} onChange={(event) => update("topic", event.target.value)} /></label><label>제목<input required value={form.title} onChange={(event) => update("title", event.target.value)} /></label></div>
        <label>요약<textarea required rows={3} value={form.summary} onChange={(event) => update("summary", event.target.value)} /></label><label>이론 본문<textarea required rows={18} value={form.content} onChange={(event) => update("content", event.target.value)} /></label><label>복습 답안<textarea rows={7} value={form.reviewAnswers} onChange={(event) => update("reviewAnswers", event.target.value)} /></label><label>키워드 · 쉼표 구분<input value={form.keywords} onChange={(event) => update("keywords", event.target.value)} /></label><label className="admin-check"><input type="checkbox" checked={form.active} onChange={(event) => update("active", event.target.checked)} /> 활성 이론으로 제공</label>{error && <p className="admin-form-error" role="alert">{error}</p>}<footer className="admin-form-actions"><button type="button" className="admin-button secondary" onClick={onClose}>취소</button><button className="admin-button" disabled={busy}>{busy ? "저장 중…" : "저장"}</button></footer>
      </form>}
    </Modal>
  );
}

function SwTheoriesSection({ onNotice }: { onNotice: (message: string, error?: boolean) => void }) {
  const searchParams = useSearchParams();
  const [focus, setFocus] = useState(Number(searchParams.get("focus")) || 0);
  const [state, setState] = useState<LoadState<{ items: SwTheorySummary[]; pagination: { page: number; pageSize: number; total: number; pages: number } }>>(emptyLoad);
  const [filters, setFilters] = useState({ search: searchParams.get("search") ?? "", subjectGroupId: searchParams.get("subjectGroupId") ?? "", subjectId: searchParams.get("subjectId") ?? "", active: focus ? "" : searchParams.get("active") ?? "active" });
  const [page, setPage] = useState(focus ? 1 : Number(searchParams.get("page")) || 1);
  const [pageSize, setPageSize] = useState(20);
  const [detail, setDetail] = useState<SwAdminTheory | null>(null);
  const [editing, setEditing] = useState<SwAdminTheory | "new" | null>(null);
  const handledFocus = useRef(0);
  const listRequest = useRef(0);
  const reader = useAdminTheoryLoader<SwAdminTheory>({ resource: "sw-theories", onLoaded: (theory, mode) => mode === "edit" ? setEditing(theory) : setDetail(theory), onError: onNotice });
  async function refresh() {
    const request = ++listRequest.current;
    setState((previous) => ({ ...previous, loading: true, error: "" }));
    const params = new URLSearchParams({ ...filters, page: String(page), pageSize: String(pageSize), view: "summary" });
    if (focus) params.set("id", String(focus));
    try { const data = await apiGet<{ items: SwTheorySummary[]; pagination: { page: number; pageSize: number; total: number; pages: number } }>("sw-theories", params); if (request === listRequest.current) setState({ loading: false, error: "", data }); } catch (failure) { if (request === listRequest.current) setState({ loading: false, error: failure instanceof Error ? failure.message : "조회 실패", data: null }); }
  }
  useEffect(() => { const timer = window.setTimeout(() => void refresh(), 0); return () => { window.clearTimeout(timer); listRequest.current += 1; }; }, [page, pageSize, filters.subjectGroupId, filters.subjectId, filters.active, focus]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { updateContentQuery({ domain: "sw", ...filters, page, pageSize, ...(focus ? { focus } : {}) }); }, [filters, page, pageSize, focus]);
  useEffect(() => {
    if (!focus || !state.data || handledFocus.current === focus) return;
    const target = state.data.items.find((item) => item.id === focus);
    if (!target) return;
    handledFocus.current = focus;
    const timer = window.setTimeout(() => void reader.open(target), 0);
    return () => window.clearTimeout(timer);
  }, [focus, state.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = state.data?.items ?? [];
  const groups = SW_CURRICULUM_SUBJECT_GROUPS.map(group => [group.id, group.name] as const);
  const subjects = SW_CURRICULUM_SUBJECT_GROUPS.filter(group => !filters.subjectGroupId || group.id === filters.subjectGroupId).flatMap(group => group.subjects.map(subject => [subject.id, subject.name] as const));
  const setFilter = (key: string, value: string) => { setFocus(0); setPage(1); setFilters((previous) => ({ ...previous, [key]: value, ...(key === "subjectGroupId" ? { subjectId: "" } : {}) })); };
  async function deactivate(theory: SwTheorySummary) {
    if (!window.confirm("이 SW 이론을 비활성화할까요? 연결 문제와 기존 학습 데이터는 유지됩니다.")) return;
    try { await apiAction("sw-theory-deactivate", { id: theory.id }); onNotice("SW 이론을 비활성화했습니다."); setDetail(null); await refresh(); } catch (failure) { onNotice(failure instanceof Error ? failure.message : "작업 실패", true); }
  }
  return <div className="admin-section-stack"><section className="admin-section-head"><div><span>SW THEORY LIBRARY</span><h2>SW 전공 이론 관리</h2><p>75개 이론의 본문·분류·공개 상태와 연결 문제를 관리합니다.</p></div><div className="admin-head-actions"><ExportLink className="admin-button secondary" parameters={{ scope: "sw-theories", ...filters }} onNotice={onNotice}>현재 조건 내보내기</ExportLink><button type="button" className="admin-button" onClick={() => setEditing("new")}>＋ 새 SW 이론</button></div></section><section className="admin-card admin-filter-card"><form onSubmit={(event) => { event.preventDefault(); if (focus || page !== 1) { setFocus(0); setPage(1); } else void refresh(); }}><label className="admin-search"><span>검색</span><input value={filters.search} onChange={(event) => setFilters((previous) => ({ ...previous, search: event.target.value }))} placeholder="ID·제목·요약·분류" /><button>검색</button></label><label>대분류<select value={filters.subjectGroupId} onChange={(event) => setFilter("subjectGroupId", event.target.value)}><option value="">전체</option>{groups.map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label><label>소분류<select value={filters.subjectId} onChange={(event) => setFilter("subjectId", event.target.value)}><option value="">전체</option>{subjects.map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label><label>상태<select value={filters.active} onChange={(event) => setFilter("active", event.target.value)}><option value="">전체</option><option value="active">활성</option><option value="inactive">비활성</option></select></label></form></section><section className="admin-card admin-table-card"><div className="admin-table-head"><strong>SW 이론 목록</strong><span>{state.data?.pagination.total ?? 0}개</span></div>{state.loading && !state.data ? <LoadingBlock /> : state.error ? <ErrorState message={state.error} onRetry={refresh} /> : rows.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>순서</th><th>이론</th><th>분류</th><th>연결</th><th>상태</th><th>작업</th></tr></thead><tbody>{rows.map((theory) => <tr key={theory.id} className={!theory.active ? "inactive" : ""}><td><strong>{theory.sortOrder}</strong><small>ID {theory.id}</small></td><td><button type="button" className="admin-title-button" onClick={() => void reader.open(theory)}>{theory.title}</button><small>{theory.summary}</small></td><td><span>{theory.category}</span><small>{theory.topic}</small></td><td>{theory.linkedQuestions}문항</td><td><span className={theory.active ? "admin-status success" : "admin-status muted"}>{theory.active ? "활성" : "비활성"}</span></td><td><div className="admin-row-actions"><button type="button" onClick={() => void reader.open(theory, "edit")}>수정</button><button type="button" className="danger" disabled={!theory.active} onClick={() => void deactivate(theory)}>비활성화</button></div></td></tr>)}</tbody></table></div> : <EmptyState title="조건에 맞는 SW 이론이 없습니다." description="검색어나 필터를 변경해 보세요." />}{state.data && <div className="admin-pagination"><label>페이지당<select value={pageSize} onChange={(event) => { setPage(1); setPageSize(Number(event.target.value)); }}><option value={10}>10개</option><option value={20}>20개</option></select></label><button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>← 이전</button><span>{page} / {state.data.pagination.pages}</span><button type="button" disabled={page >= state.data.pagination.pages} onClick={() => setPage((value) => value + 1)}>다음 →</button></div>}</section>{reader.pending && <Modal title={reader.pending} onClose={reader.cancel} wide><LoadingBlock label="이론 본문을 불러오는 중입니다." /></Modal>}{detail && <Modal title={detail.title} onClose={() => setDetail(null)} wide><div className="admin-detail-meta"><span>{detail.category}</span><span>{detail.topic}</span><span>연결 {detail.linkedQuestions}문항</span><span>{detail.active ? "활성" : "비활성"}</span></div><p className="admin-detail-summary">{detail.summary}</p><section className="admin-detail-section"><MarkdownPreview value={detail.content} /></section><footer className="admin-form-actions"><button type="button" className="admin-button secondary" onClick={() => setDetail(null)}>닫기</button><button type="button" className="admin-button" onClick={() => { setEditing(detail); setDetail(null); }}>수정</button></footer></Modal>}{editing && <SwTheoryFormModal theory={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={async () => { await refresh(); onNotice(editing === "new" ? "새 SW 이론을 등록했습니다." : "SW 이론을 수정했습니다."); }} />}</div>;
}

export default function TheoriesSection({ onNotice }: { onNotice: (message: string, error?: boolean) => void }) {
  const requestedDomain = useSearchParams().get("domain");
  const domain: ContentAdminDomain = parseContentAdminDomain(requestedDomain);
  return <><ContentDomainTabs section="theories" domain={domain} />{domain === "sw" ? <SwTheoriesSection onNotice={onNotice} /> : <SqlTheoriesSection key={domain} domain={domain} onNotice={onNotice} />}</>;
}

function SqlTheoriesSection({
  domain,
  onNotice,
}: {
  domain: CertificationAdminDomain;
  onNotice: (message: string, error?: boolean) => void;
}) {
  const domainConfig = contentDomainOptions(domain);
  const searchParams = useSearchParams();
  const [focusTheoryId, setFocusTheoryId] = useState(Number(searchParams.get("focus")) || 0);
  const handledFocus = useRef(0);
  const [state, setState] = useState<LoadState<TheoryListData>>(emptyLoad);
  const [filters, setFilters] = useState({
    search: searchParams.get("search") ?? "",
    examScope: searchParams.get("examScope") ?? "",
    category: searchParams.get("category") ?? "",
    active: focusTheoryId ? "" : searchParams.get("active") ?? "active",
    linked: searchParams.get("linked") ?? "",
  });
  const [page, setPage] = useState(focusTheoryId ? 1 : Number(searchParams.get("page")) || 1);
  const [pageSize, setPageSize] = useState(Number(searchParams.get("pageSize")) === 10 ? 10 : 20);
  const [detail, setDetail] = useState<AdminTheory | null>(null);
  const [editing, setEditing] = useState<AdminTheory | "new" | null>(null);
  const listRequest = useRef(0);
  const reader = useAdminTheoryLoader<AdminTheory>({ resource: "theories", domain, onLoaded: (theory, mode) => mode === "edit" ? setEditing(theory) : setDetail(theory), onError: onNotice });
  async function refresh() {
    const request = ++listRequest.current;
    setState((previous) => ({ ...previous, loading: true, error: "" }));
    try {
      const params = new URLSearchParams({ ...filters, contentDomain: domain, page: String(page), pageSize: String(pageSize), view: "summary" });
      if (focusTheoryId) params.set("id", String(focusTheoryId));
      const data = await apiGet<TheoryListData>("theories", params);
      if (request === listRequest.current) setState({ loading: false, error: "", data });
    } catch (error) {
      if (request === listRequest.current) setState({ loading: false, error: error instanceof Error ? error.message : "조회 실패", data: null });
    }
  }
  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => { window.clearTimeout(timer); listRequest.current += 1; };
  }, [page, pageSize, filters.examScope, filters.category, filters.active, filters.linked, focusTheoryId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    updateContentQuery({ domain, ...filters, page, pageSize, ...(focusTheoryId ? { focus: focusTheoryId } : {}) });
  }, [domain, filters, page, pageSize, focusTheoryId]);
  useEffect(() => {
    if (!focusTheoryId || !state.data || handledFocus.current === focusTheoryId) return;
    const target = state.data.items.find((item) => item.id === focusTheoryId);
    if (!target) return;
    handledFocus.current = focusTheoryId;
    const timer = window.setTimeout(() => void reader.open(target), 0);
    return () => window.clearTimeout(timer);
  }, [focusTheoryId, state.data]); // eslint-disable-line react-hooks/exhaustive-deps
  async function deactivate(theory: AdminTheorySummary) {
    if (!window.confirm("이 이론을 비활성화할까요? 연결 문제와 기존 학습 기록은 유지됩니다.")) return;
    try {
      await apiAction("theory-deactivate", { id: theory.id });
      onNotice("이론을 비활성화했습니다.");
      await refresh();
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "작업 실패", true);
    }
  }
  const rows = state.data?.items ?? [];
  return (
    <div className="admin-section-stack">
      <section className="admin-section-head">
        <div><span>{domainConfig.label} THEORY LIBRARY</span><h2>{domainConfig.label} 이론 콘텐츠 관리</h2><p>학습 본문을 미리 보고 문제 연결과 공개 상태를 관리합니다.</p></div>
        <div className="admin-head-actions"><ExportLink className="admin-button secondary" parameters={{ scope: "theories", contentDomain: domain, ...filters }} onNotice={onNotice}>현재 조건 내보내기</ExportLink><button className="admin-button" type="button" onClick={() => setEditing("new")}>＋ 새 이론</button></div>
      </section>
      <section className="admin-card admin-filter-card">
        <form onSubmit={(event) => { event.preventDefault(); if (focusTheoryId || page !== 1) { setFocusTheoryId(0); setPage(1); } else void refresh(); }}>
          <label className="admin-search"><span>검색</span><input value={filters.search} onChange={(event) => setFilters((previous) => ({ ...previous, search: event.target.value }))} placeholder="제목·요약·키워드" /><button>검색</button></label>
          <label>시험 범위<select value={filters.examScope} onChange={(event) => { setFocusTheoryId(0); setPage(1); setFilters((previous) => ({ ...previous, examScope: event.target.value })); }}><option value="">전체</option>{domainConfig.scopeOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
          <label>과목<select value={filters.category} onChange={(event) => { setFocusTheoryId(0); setPage(1); setFilters((previous) => ({ ...previous, category: event.target.value })); }}><option value="">전체</option>{domainConfig.subjects.map((subject) => <option key={subject}>{subject}</option>)}</select></label>
          <label>연결 문제<select value={filters.linked} onChange={(event) => { setFocusTheoryId(0); setPage(1); setFilters((previous) => ({ ...previous, linked: event.target.value })); }}><option value="">전체</option><option value="available">1건 이상</option><option value="none">0건</option></select></label>
          <label>상태<select value={filters.active} onChange={(event) => { setFocusTheoryId(0); setPage(1); setFilters((previous) => ({ ...previous, active: event.target.value })); }}><option value="">전체</option><option value="active">활성</option><option value="inactive">비활성</option></select></label>
        </form>
      </section>
      <section className="admin-card admin-table-card">
        <div className="admin-table-head"><strong>이론 목록</strong><span>{state.data?.pagination.total ?? 0}개</span></div>
        {state.loading && !state.data ? <LoadingBlock /> : state.error ? <ErrorState message={state.error} onRetry={refresh} /> : rows.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>순서</th><th>이론</th><th>범위·과목</th><th>조회·연결</th><th>상태</th><th>작업</th></tr></thead><tbody>{rows.map((theory) => <tr key={theory.id} className={!theory.active ? "inactive" : ""}>
          <td><strong>{theory.sortOrder}</strong><small>ID {theory.id}</small></td>
          <td><button className="admin-title-button" type="button" onClick={() => void reader.open(theory)}>{theory.title}</button><small>{theory.topic} · {theory.summary}</small></td>
          <td><span>{examScopeLabel(theory.examScope)}</span><small>{theory.category}</small></td>
          <td><strong>{theory.viewCount}회</strong><small>연결 {theory.linkedQuestions}문항</small></td>
          <td><span className={theory.active ? "admin-status success" : "admin-status muted"}>{theory.active ? "활성" : "비활성"}</span></td>
          <td><div className="admin-row-actions"><button type="button" onClick={() => void reader.open(theory, "edit")}>수정</button><button className="danger" type="button" disabled={!theory.active} onClick={() => void deactivate(theory)}>비활성화</button></div></td>
        </tr>)}</tbody></table></div> : <EmptyState title="조건에 맞는 이론이 없습니다." description="필터를 조정하거나 새 이론을 등록해 주세요." />}
        {state.data && <div className="admin-pagination"><label>페이지당<select value={pageSize} onChange={(event) => { setPage(1); setPageSize(Number(event.target.value)); }}><option value={10}>10개</option><option value={20}>20개</option></select></label><button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>← 이전</button><span>{page} / {state.data.pagination.pages} · 현재 {rows.length}개</span><button type="button" disabled={page >= state.data.pagination.pages} onClick={() => setPage((value) => value + 1)}>다음 →</button></div>}
      </section>
      {reader.pending && <Modal title={reader.pending} onClose={reader.cancel} wide><LoadingBlock label="이론 본문을 불러오는 중입니다." /></Modal>}
      {detail && <TheoryDetailModal theory={detail} onClose={() => setDetail(null)} onEdit={() => { setEditing(detail); setDetail(null); }} onNotice={onNotice} />}
      {editing && <TheoryFormModal theory={editing === "new" ? null : editing} domain={domain} onClose={() => setEditing(null)} onSaved={async () => { await refresh(); onNotice(editing === "new" ? "새 이론을 등록했습니다." : "이론을 수정했습니다."); }} />}
    </div>
  );
}
