"use client";

import {
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "next/navigation";
import { PRACTICAL_PAST_EXAMS_PUBLISHED, isHiddenPracticalPastQuestion } from "@shared/study/ipe-practical-past.mjs";
import { parseAdminAnswerNumbers } from "@shared/admin/question-answer-input";
import { AdminQuestionOptionsGate } from "./admin-question-options-gate";
import { SW_CURRICULUM_SUBJECT_GROUPS } from "@shared/study/sw-curriculum-contract.mjs";
import {
  apiAction,
  apiGet,
} from "@frontend/features/admin/model/admin-api-client";
import { releasedLocalPracticeCourses, localPracticeWorkbooks } from "@shared/study/local-practice";
import { splitQuestionPromptForDisplay } from "@shared/content/content-format.mjs";
import {
  COURSE_DEFINITIONS,
  contentScopeAllowsSubject,
  examDisplayName,
  examScopesCompatible,
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
  formatDate,
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
  type SwAdminQuestion,
  type SwOptions,
} from "./admin-content-shared";

type AdminQuestion = {
  id: number;
  displayOrder: number;
  category: string;
  topic: string;
  examScope: ExamScope;
  difficulty: "하" | "중" | "상";
  difficultyRationale: string;
  kind: "single" | "multiple" | "descriptive";
  prompt: string;
  displayPrompt?: string;
  choices: string[];
  correctAnswers: number[];
  explanation: string;
  tags: string[];
  scoringCriteria: string[];
  requiredConcepts: string[];
  acceptableAlternatives: string[];
  deductionConditions: string[];
  errorConditions: string[];
  theoryId: number | null;
  theory_title?: string;
  active: boolean;
  totalAttempts: number;
  correctAttempts: number;
  incorrectAttempts: number;
  correctnessRate: number | null;
  wrongNoteCount: number;
  averageDurationSeconds: number | null;
  aiEvaluationErrors: number;
  lastAttemptAt: string | null;
  created_at: string;
  updated_at: string;
};

const DESCRIPTIVE_PLACEMENTS = COURSE_DEFINITIONS.flatMap((course) => (
  course.descriptiveSubjects.map((category) => ({ examType: course.examType, category }))
));

type QuestionListData = {
  items: AdminQuestion[];
  pagination: { page: number; pageSize: number; total: number; pages: number };
};

type AdminOptions = {
  theories: Array<{ id: number; title: string; category: string; topic: string; exam_scope: string }>;
  categories: Array<{ category: string; topic: string; questions: number }>;
};

function splitLines(value: string) {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function QuestionFormModal({
  question,
  domain,
  options,
  onClose,
  onSaved,
}: {
  question: AdminQuestion | null;
  domain: CertificationAdminDomain;
  options: AdminOptions;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const domainConfig = contentDomainOptions(domain);
  const descriptivePlacements = DESCRIPTIVE_PLACEMENTS.filter((placement) => (
    domainConfig.subjects.includes(placement.category)
  ));
  const defaultDescriptivePlacement = descriptivePlacements[0]!;
  const [form, setForm] = useState({
    category: question?.category ?? domainConfig.subjects[0],
    topic: question?.topic ?? "",
    examScope: question?.examScope ?? domainConfig.scopeOptions[0]!.value,
    difficulty: question?.difficulty ?? "중",
    difficultyRationale: question?.difficultyRationale ?? "",
    kind: question?.kind ?? "single",
    prompt: question?.prompt ?? "",
    choices: question?.choices.join("\n") ?? "",
    correctAnswers: question?.correctAnswers.map((answer) => answer + 1).join(", ") ?? "1",
    explanation: question?.explanation ?? "",
    tags: question?.tags.join(", ") ?? "",
    scoringCriteria: question?.scoringCriteria.join("\n") ?? "",
    requiredConcepts: question?.requiredConcepts.join("\n") ?? "",
    acceptableAlternatives: question?.acceptableAlternatives.join("\n") ?? "",
    deductionConditions: question?.deductionConditions.join("\n") ?? "",
    errorConditions: question?.errorConditions.join("\n") ?? "",
    theoryId: question?.theoryId ? String(question.theoryId) : "",
    active: question?.active ?? true,
  });
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const topics = useMemo(
    () => [...new Set(options.categories.filter((item) => item.category === form.category).map((item) => item.topic))],
    [options.categories, form.category],
  );
  const descriptive = form.kind === "descriptive";
  const practical = form.examScope === "IPEP" && descriptive;

  function update(name: string, value: string | boolean) {
    setForm((previous) => {
      const next = { ...previous, [name]: value };
      if (name === "kind" && value === "descriptive") {
        if (!defaultDescriptivePlacement) return previous;
        next.examScope = defaultDescriptivePlacement.examType;
        next.category = defaultDescriptivePlacement.category;
        next.choices = "";
        next.correctAnswers = "";
        next.theoryId = "";
      }
      if (next.kind === "descriptive" && name === "examScope") {
        const placement = descriptivePlacements.find((item) => (
          item.examType === next.examScope && item.category === next.category
        )) ?? descriptivePlacements.find((item) => item.examType === next.examScope);
        if (placement) next.category = placement.category;
      }
      if (next.kind === "descriptive" && name === "category") {
        const placement = descriptivePlacements.find((item) => (
          item.category === next.category && item.examType === next.examScope
        )) ?? descriptivePlacements.find((item) => item.category === next.category);
        if (placement) next.examScope = placement.examType;
      }
      if (next.kind !== "descriptive" && name === "examScope" && !contentScopeAllowsSubject(next.examScope, next.category)) {
        next.category = domainConfig.subjects.find((subject) => contentScopeAllowsSubject(next.examScope, subject)) ?? domainConfig.subjects[0];
      }
      if (name === "category" || name === "examScope") {
        next.theoryId = "";
      }
      return next;
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload = {
        ...form,
        id: question?.id,
        choices: splitLines(form.choices),
        correctAnswers: parseAdminAnswerNumbers(form.correctAnswers, splitLines(form.choices).length, form.kind),
        tags: form.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
        scoringCriteria: splitLines(form.scoringCriteria),
        requiredConcepts: splitLines(form.requiredConcepts),
        acceptableAlternatives: splitLines(form.acceptableAlternatives),
        deductionConditions: splitLines(form.deductionConditions),
        errorConditions: splitLines(form.errorConditions),
        theoryId: form.theoryId ? Number(form.theoryId) : null,
      };
      await apiAction(question ? "question-update" : "question-create", payload);
      await onSaved();
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={question ? `문제 ${question.displayOrder} 수정` : "새 문제 등록"} onClose={onClose} wide>
      <div className="admin-modal-tabs">
        <button type="button" className={tab === "edit" ? "active" : ""} onClick={() => setTab("edit")}>편집</button>
        <button type="button" className={tab === "preview" ? "active" : ""} onClick={() => setTab("preview")}>미리보기</button>
      </div>
      {tab === "preview" ? (
        <div className="admin-preview-stack">
          <section><span>문제 본문</span><MarkdownPreview value={form.prompt} /></section>
          {!descriptive && <section><span>선택지</span><ol>{splitLines(form.choices).map((choice) => <li key={choice}><MarkdownPreview value={choice} /></li>)}</ol></section>}
          <section><span>정답 및 해설</span><MarkdownPreview value={form.explanation} /></section>
        </div>
      ) : (
        <form className="admin-form" onSubmit={submit}>
          <div className="admin-form-grid three">
            <label>시험 범위<select value={form.examScope} onChange={(event) => update("examScope", event.target.value)}>{(descriptive
              ? [...new Set(descriptivePlacements.map((item) => item.examType))].map((value) => ({ value, label: `${examDisplayName(value)} 전용` }))
              : domainConfig.scopeOptions
            ).map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
            <label>과목<select value={form.category} onChange={(event) => update("category", event.target.value)}>{(descriptive
              ? descriptivePlacements.filter((item) => item.examType === form.examScope).map((item) => item.category)
              : domainConfig.subjects.filter((subject) => contentScopeAllowsSubject(form.examScope, subject))
            ).map((subject) => <option key={subject}>{subject}</option>)}</select></label>
            <label>문제 유형<select value={form.kind} onChange={(event) => update("kind", event.target.value)}><option value="single">단일 정답</option><option value="multiple">복수 정답</option>{descriptivePlacements.length > 0 && <option value="descriptive">{domain === "ipe" ? "실기 단답형" : "실기형·서술형 · 지정 과목"}</option>}</select></label>
            <label>소분류<input list="question-topics" value={form.topic} onChange={(event) => update("topic", event.target.value)} /><datalist id="question-topics">{topics.map((topic) => <option key={topic}>{topic}</option>)}</datalist></label>
            <label>난이도<select value={form.difficulty} onChange={(event) => update("difficulty", event.target.value)}><option>하</option><option>중</option><option>상</option></select></label>
            <label>연결 이론<select value={form.theoryId} onChange={(event) => update("theoryId", event.target.value)}><option value="">연결 안 함</option>{options.theories.filter((theory) => (
              theory.category === form.category
              && examScopesCompatible(form.examScope, theory.exam_scope)
            )).map((theory) => <option key={theory.id} value={theory.id}>{theory.title}</option>)}</select></label>
          </div>
          {descriptive && <p className="admin-form-note">실기형·서술형은 서버에서도 선택한 자격증의 지정 과목 조합만 허용합니다.</p>}
          {practical && <p className="admin-form-note">실기 단답형은 검증된 정답표로 채점합니다. 본문·해설을 바꾸면 정답표 재검증 전까지 자동채점이 중지됩니다.</p>}
          <label>문제 본문<textarea rows={10} value={form.prompt} onChange={(event) => update("prompt", event.target.value)} placeholder="마크다운과 SQL 코드 블록을 사용할 수 있습니다." /></label>
          {!descriptive && (
            <div className="admin-form-grid">
              <label>선택지 · 한 줄에 하나<textarea rows={8} value={form.choices} onChange={(event) => update("choices", event.target.value)} /></label>
              <label>정답 번호 · 1부터 시작<input value={form.correctAnswers} onChange={(event) => update("correctAnswers", event.target.value)} placeholder="예: 2 또는 1, 3" /><small>복수 정답은 쉼표로 구분합니다.</small></label>
            </div>
          )}
          <label>정답 및 해설<textarea rows={14} value={form.explanation} onChange={(event) => update("explanation", event.target.value)} /></label>
          <div className="admin-form-grid">
            <label>태그 · 쉼표 구분<input value={form.tags} onChange={(event) => update("tags", event.target.value)} /></label>
            <label>난이도 판단 근거<input value={form.difficultyRationale} onChange={(event) => update("difficultyRationale", event.target.value)} /></label>
          </div>
          {descriptive && !practical && (
            <div className="admin-form-grid">
              <label>채점 기준 · 한 줄에 하나<textarea rows={7} value={form.scoringCriteria} onChange={(event) => update("scoringCriteria", event.target.value)} /></label>
              <label>필수 핵심 내용 · 한 줄에 하나<textarea rows={7} value={form.requiredConcepts} onChange={(event) => update("requiredConcepts", event.target.value)} /></label>
              <label>허용 가능한 해법<textarea rows={6} value={form.acceptableAlternatives} onChange={(event) => update("acceptableAlternatives", event.target.value)} /></label>
              <label>감점·오류 조건<textarea rows={6} value={`${form.deductionConditions}${form.deductionConditions && form.errorConditions ? "\n" : ""}${form.errorConditions}`} onChange={(event) => {
                update("deductionConditions", event.target.value);
                update("errorConditions", event.target.value);
              }} /></label>
            </div>
          )}
          <label className="admin-check"><input type="checkbox" checked={form.active} onChange={(event) => update("active", event.target.checked)} /> 활성 문제로 제공</label>
          {error && <p className="admin-form-error">{error}</p>}
          <footer className="admin-form-actions"><button type="button" className="admin-button secondary" onClick={onClose}>취소</button><button className="admin-button" disabled={busy}>{busy ? "저장 중…" : "저장"}</button></footer>
        </form>
      )}
    </Modal>
  );
}

function QuestionDetailModal({
  question,
  onClose,
  onEdit,
}: {
  question: AdminQuestion;
  onClose: () => void;
  onEdit: () => void;
}) {
  return (
    <Modal title={`문제 ${question.displayOrder} 상세`} onClose={onClose} wide>
      <div className="admin-detail-meta">
        <span>{examScopeLabel(question.examScope)}</span>
        <span>{question.category}</span><span>{question.topic}</span>
        <span>{question.kind === "descriptive" ? question.examScope === "IPEP" ? "단답형" : "서술형" : question.kind === "multiple" ? "복수 정답" : "단일 정답"}</span>
        <span>난이도 {question.difficulty}</span>
        <span>{question.active ? "활성" : "비활성"}</span>
      </div>
      <section className="admin-detail-section"><h3>문제</h3><MarkdownPreview value={question.displayPrompt ?? question.prompt} /></section>
      {question.kind !== "descriptive" && (
        <section className="admin-detail-section"><h3>선택지</h3><ol>{question.choices.map((choice, index) => <li key={`${index}-${choice}`} className={question.correctAnswers.includes(index) ? "correct" : ""}><MarkdownPreview value={choice} /></li>)}</ol></section>
      )}
      <section className="admin-detail-section"><h3>정답 및 해설</h3><MarkdownPreview value={question.explanation} /></section>
      <section className="admin-stat-strip">
        <div><span>총 제출</span><strong>{question.totalAttempts}회</strong></div>
        <div><span>정답</span><strong>{question.correctAttempts}회</strong></div>
        <div><span>오답·부분 정답</span><strong>{question.incorrectAttempts}회</strong></div>
        <div><span>정답률</span><strong>{question.correctnessRate === null ? "기록 없음" : `${question.correctnessRate}%`}</strong></div>
        <div><span>평균 풀이 시간</span><strong>{question.averageDurationSeconds === null ? "기록 없음" : `${question.averageDurationSeconds}초`}</strong></div>
        <div><span>오답 노트</span><strong>{question.wrongNoteCount}회</strong></div>
        <div><span>최근 출제</span><strong>{formatDate(question.lastAttemptAt)}</strong></div>
      </section>
      <footer className="admin-form-actions"><button className="admin-button secondary" type="button" onClick={onClose}>닫기</button><button className="admin-button" type="button" onClick={onEdit}>수정</button></footer>
    </Modal>
  );
}

function SwQuestionFormModal({
  question,
  options,
  onClose,
  onSaved,
}: {
  question: SwAdminQuestion | null;
  options: SwOptions;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    theoryId: String(question?.theoryId ?? options.theories[0]?.id ?? ""),
    displayOrder: String(question?.displayOrder ?? ""),
    difficulty: question?.difficulty ?? "중",
    difficultyRationale: question?.difficultyRationale ?? "",
    kind: question?.kind ?? "single",
    prompt: question?.prompt ?? "",
    choices: question?.choices.join("\n") ?? "",
    correctAnswers: question?.correctAnswers.map((answer) => answer + 1).join(", ") ?? "1",
    explanation: question?.explanation ?? "",
    tags: question?.tags.join(", ") ?? "",
    requiredConcepts: question?.requiredConcepts.join("\n") ?? "",
    active: question?.active ?? true,
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
      await apiAction(question ? "sw-question-update" : "sw-question-create", {
        ...(question ? { id: question.id } : {}),
        theoryId: Number(form.theoryId),
        displayOrder: Number(form.displayOrder) || 0,
        difficulty: form.difficulty,
        difficultyRationale: form.difficultyRationale,
        kind: form.kind,
        prompt: form.prompt,
        choices: splitLines(form.choices),
        correctAnswers: parseAdminAnswerNumbers(form.correctAnswers, splitLines(form.choices).length, form.kind),
        explanation: form.explanation,
        tags: form.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
        requiredConcepts: splitLines(form.requiredConcepts),
        active: form.active,
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
    <Modal title={question ? `SW 문제 ${question.displayOrder} 수정` : "새 SW 문제 등록"} onClose={onClose} wide>
      <div className="admin-modal-tabs" role="tablist" aria-label="문제 편집 방식">
        <button type="button" role="tab" aria-selected={!preview} className={!preview ? "active" : ""} onClick={() => setPreview(false)}>편집</button>
        <button type="button" role="tab" aria-selected={preview} className={preview ? "active" : ""} onClick={() => setPreview(true)}>미리보기</button>
      </div>
      {preview ? <div className="admin-preview-stack"><section><span>문제</span><MarkdownPreview value={form.prompt} /></section><section><span>선택지</span><ol>{splitLines(form.choices).map((choice) => <li key={choice}><MarkdownPreview value={choice} /></li>)}</ol></section><section><span>해설</span><MarkdownPreview value={form.explanation} /></section></div> : (
        <form className="admin-form" onSubmit={submit}>
          <div className="admin-form-grid three">
            <label>연결 이론<select required value={form.theoryId} onChange={(event) => update("theoryId", event.target.value)}><option value="">선택</option>{options.theories.map((theory) => <option value={theory.id} key={theory.id}>{theory.category} · {theory.title}</option>)}</select></label>
            <label>표시 순서<input type="number" min="0" value={form.displayOrder} onChange={(event) => update("displayOrder", event.target.value)} placeholder="자동 배정" /></label>
            <label>난이도<select value={form.difficulty} onChange={(event) => update("difficulty", event.target.value)}><option>하</option><option>중</option><option>상</option></select></label>
            <label>문제 유형<select value={form.kind} onChange={(event) => update("kind", event.target.value)}><option value="single">단일 정답</option><option value="multiple">복수 정답</option></select></label>
            <label>난이도 근거<input value={form.difficultyRationale} onChange={(event) => update("difficultyRationale", event.target.value)} /></label>
          </div>
          <label>문제 본문<textarea required rows={9} value={form.prompt} onChange={(event) => update("prompt", event.target.value)} /></label>
          <div className="admin-form-grid"><label>선택지 · 한 줄에 하나<textarea required rows={7} value={form.choices} onChange={(event) => update("choices", event.target.value)} /></label><label>정답 번호 · 1부터 시작<input required value={form.correctAnswers} onChange={(event) => update("correctAnswers", event.target.value)} placeholder="예: 2 또는 1, 3" /></label></div>
          <label>정답 및 해설<textarea required rows={12} value={form.explanation} onChange={(event) => update("explanation", event.target.value)} /></label>
          <div className="admin-form-grid"><label>태그 · 쉼표 구분<input value={form.tags} onChange={(event) => update("tags", event.target.value)} /></label><label>필수 개념 · 한 줄에 하나<textarea rows={5} value={form.requiredConcepts} onChange={(event) => update("requiredConcepts", event.target.value)} /></label></div>
          <label className="admin-check"><input type="checkbox" checked={form.active} onChange={(event) => update("active", event.target.checked)} /> 활성 문제로 제공</label>
          {error && <p className="admin-form-error" role="alert">{error}</p>}
          <footer className="admin-form-actions"><button type="button" className="admin-button secondary" onClick={onClose}>취소</button><button className="admin-button" disabled={busy}>{busy ? "저장 중…" : "저장"}</button></footer>
        </form>
      )}
    </Modal>
  );
}

function SwQuestionsSection({ onNotice }: { onNotice: (message: string, error?: boolean) => void }) {
  const searchParams = useSearchParams();
  const [focus, setFocus] = useState(searchParams.get("focus") ?? "");
  const [state, setState] = useState<LoadState<{ items: SwAdminQuestion[]; pagination: { page: number; pageSize: number; total: number; pages: number } }>>(emptyLoad);
  const [filters, setFilters] = useState({ search: searchParams.get("search") ?? "", subjectGroupId: searchParams.get("subjectGroupId") ?? "", subjectId: searchParams.get("subjectId") ?? "", difficulty: searchParams.get("difficulty") ?? "", active: focus ? "" : searchParams.get("active") ?? "active" });
  const [page, setPage] = useState(focus ? 1 : Number(searchParams.get("page")) || 1);
  const [pageSize, setPageSize] = useState(20);
  const [detail, setDetail] = useState<SwAdminQuestion | null>(null);
  const [editing, setEditing] = useState<SwAdminQuestion | "new" | null>(null);
  const handledFocus = useRef("");
  const listRequest = useRef(0);
  async function refresh() {
    const request = ++listRequest.current;
    setState((previous) => ({ ...previous, loading: true, error: "" }));
    const params = new URLSearchParams({ ...filters, page: String(page), pageSize: String(pageSize) });
    if (focus) params.set("id", focus);
    try {
      const data = await apiGet<{ items: SwAdminQuestion[]; pagination: { page: number; pageSize: number; total: number; pages: number } }>("sw-questions", params);
      if (request === listRequest.current) setState({ loading: false, error: "", data });
    } catch (failure) {
      if (request === listRequest.current) setState({ loading: false, error: failure instanceof Error ? failure.message : "조회 실패", data: null });
    }
  }
  useEffect(() => { const timer = window.setTimeout(() => void refresh(), 0); return () => { window.clearTimeout(timer); listRequest.current += 1; }; }, [page, pageSize, filters.subjectGroupId, filters.subjectId, filters.difficulty, filters.active, focus]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { updateContentQuery({ domain: "sw", ...filters, page, pageSize, ...(focus ? { focus } : {}) }); }, [filters, page, pageSize, focus]);
  useEffect(() => {
    if (!focus || !state.data || handledFocus.current === focus) return;
    const target = state.data.items.find((item) => item.id === focus);
    if (!target) return;
    handledFocus.current = focus;
    const timer = window.setTimeout(() => setDetail(target), 0);
    return () => window.clearTimeout(timer);
  }, [focus, state.data]);
  const rows = state.data?.items ?? [];
  const groups = SW_CURRICULUM_SUBJECT_GROUPS.map(group => [group.id, group.name] as const);
  const subjects = SW_CURRICULUM_SUBJECT_GROUPS.filter(group => !filters.subjectGroupId || group.id === filters.subjectGroupId).flatMap(group => group.subjects.map(subject => [subject.id, subject.name] as const));
  const setFilter = (key: string, value: string) => { setFocus(""); setPage(1); setFilters((previous) => ({ ...previous, [key]: value, ...(key === "subjectGroupId" ? { subjectId: "" } : {}) })); };
  async function deactivate(question: SwAdminQuestion) {
    if (!window.confirm("이 SW 문제를 비활성화할까요? 기존 콘텐츠와 기록은 삭제되지 않습니다.")) return;
    try { await apiAction("sw-question-deactivate", { id: question.id }); onNotice("SW 문제를 비활성화했습니다."); setDetail(null); await refresh(); } catch (failure) { onNotice(failure instanceof Error ? failure.message : "작업 실패", true); }
  }
  return (
    <div className="admin-section-stack">
      <section className="admin-section-head"><div><span>SW QUESTION BANK</span><h2>SW 전공 문제 관리</h2><p>분류별 문항과 이론 연결을 조회·편집합니다.</p></div><div className="admin-head-actions"><ExportLink className="admin-button secondary" parameters={{ scope: "sw-questions", ...filters }} onNotice={onNotice}>현재 조건 내보내기</ExportLink><button className="admin-button" type="button" onClick={() => setEditing("new")}>＋ 새 SW 문제</button></div></section>
      <section className="admin-card admin-filter-card"><form onSubmit={(event) => { event.preventDefault(); if (focus || page !== 1) { setFocus(""); setPage(1); } else void refresh(); }}><label className="admin-search"><span>검색</span><input value={filters.search} onChange={(event) => setFilters((previous) => ({ ...previous, search: event.target.value }))} placeholder="ID·본문·분류·주제" /><button>검색</button></label><label>대분류<select value={filters.subjectGroupId} onChange={(event) => setFilter("subjectGroupId", event.target.value)}><option value="">전체</option>{groups.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><label>소분류<select value={filters.subjectId} onChange={(event) => setFilter("subjectId", event.target.value)}><option value="">전체</option>{subjects.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><label>난이도<select value={filters.difficulty} onChange={(event) => setFilter("difficulty", event.target.value)}><option value="">전체</option><option>하</option><option>중</option><option>상</option></select></label><label>상태<select value={filters.active} onChange={(event) => setFilter("active", event.target.value)}><option value="">전체</option><option value="active">활성</option><option value="inactive">비활성</option></select></label></form></section>
      <section className="admin-card admin-table-card"><div className="admin-table-head"><strong>SW 문제 목록</strong><span>{state.data?.pagination.total ?? 0}문항</span></div>{state.loading && !state.data ? <LoadingBlock /> : state.error ? <ErrorState message={state.error} onRetry={refresh} /> : rows.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>순서</th><th>문제</th><th>분류</th><th>난이도</th><th>연결 이론</th><th>상태</th><th>작업</th></tr></thead><tbody>{rows.map((question) => <tr key={question.id} className={!question.active ? "inactive" : ""}><td><strong>{question.displayOrder}</strong><small>{question.id}</small></td><td><button type="button" className="admin-title-button" onClick={() => setDetail(question)}>{splitQuestionPromptForDisplay(question.prompt).stem}</button></td><td><span>{question.category}</span><small>{question.topic}</small></td><td>{question.difficulty}</td><td>{question.theory_title ?? `ID ${question.theoryId}`}</td><td><span className={question.active ? "admin-status success" : "admin-status muted"}>{question.active ? "활성" : "비활성"}</span></td><td><div className="admin-row-actions"><button type="button" onClick={() => setEditing(question)}>수정</button><button type="button" className="danger" disabled={!question.active} onClick={() => void deactivate(question)}>비활성화</button></div></td></tr>)}</tbody></table></div> : <EmptyState title="조건에 맞는 SW 문제가 없습니다." description="검색어나 필터를 변경해 보세요." />}{state.data && <div className="admin-pagination"><label>페이지당<select value={pageSize} onChange={(event) => { setPage(1); setPageSize(Number(event.target.value)); }}><option value={10}>10개</option><option value={20}>20개</option><option value={50}>50개</option></select></label><button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>← 이전</button><span>{page} / {state.data.pagination.pages}</span><button type="button" disabled={page >= state.data.pagination.pages} onClick={() => setPage((value) => value + 1)}>다음 →</button></div>}</section>
      {detail && <Modal title={`SW 문제 ${detail.displayOrder}`} onClose={() => setDetail(null)} wide><div className="admin-detail-meta"><span>{detail.category}</span><span>{detail.topic}</span><span>난이도 {detail.difficulty}</span><span>{detail.active ? "활성" : "비활성"}</span></div><section className="admin-detail-section"><h3>문제</h3><MarkdownPreview value={detail.prompt} /></section><section className="admin-detail-section"><h3>선택지</h3><ol>{detail.choices.map((choice, index) => <li key={`${index}-${choice}`} className={detail.correctAnswers.includes(index) ? "correct" : ""}><MarkdownPreview value={choice} /></li>)}</ol></section><section className="admin-detail-section"><h3>정답 및 해설</h3><MarkdownPreview value={detail.explanation} /></section><footer className="admin-form-actions"><button type="button" className="admin-button secondary" onClick={() => setDetail(null)}>닫기</button><button type="button" className="admin-button" onClick={() => { setEditing(detail); setDetail(null); }}>수정</button></footer></Modal>}
      {editing && <AdminQuestionOptionsGate<SwOptions> key={editing === "new" ? "new" : editing.id} resource="sw-options" onClose={() => setEditing(null)}>{options => <SwQuestionFormModal question={editing === "new" ? null : editing} options={options} onClose={() => setEditing(null)} onSaved={async () => { await refresh(); onNotice(editing === "new" ? "새 SW 문제를 등록했습니다." : "SW 문제를 수정했습니다."); }} />}</AdminQuestionOptionsGate>}
    </div>
  );
}

export default function QuestionsSection({ onNotice }: { onNotice: (message: string, error?: boolean) => void }) {
  const requestedDomain = useSearchParams().get("domain");
  const domain: ContentAdminDomain = parseContentAdminDomain(requestedDomain);
  return <><ContentDomainTabs section="questions" domain={domain} />{domain === "bae" && <section className="admin-card admin-padded-card"><h3>빅분기 실기 · 파일 실습</h3><p>문제별 실습 자료와 참고 풀이를 확인합니다. 아래 문제 목록은 필기 문항입니다.</p><div className="admin-domain-coverage">{releasedLocalPracticeCourses().flatMap(course => localPracticeWorkbooks(course)).map(item => <a className="admin-button secondary" key={item.id} href={item.href}>{item.title} · {item.release.questionCount}개</a>)}</div></section>}{domain === "sw" ? <SwQuestionsSection onNotice={onNotice} /> : <SqlQuestionsSection key={domain} domain={domain} onNotice={onNotice} />}</>;
}

function SqlQuestionsSection({
  domain,
  onNotice,
}: {
  domain: CertificationAdminDomain;
  onNotice: (message: string, error?: boolean) => void;
}) {
  const domainConfig = contentDomainOptions(domain);
  const searchParams = useSearchParams();
  const [focusQuestionId, setFocusQuestionId] = useState(Number(searchParams.get("focus")) || 0);
  const handledFocus = useRef(0);
  const [state, setState] = useState<LoadState<QuestionListData>>(emptyLoad);
  const [filters, setFilters] = useState({
    search: searchParams.get("search") ?? "",
    examScope: searchParams.get("examScope") ?? "",
    category: searchParams.get("category") ?? "",
    kind: searchParams.get("kind") ?? "",
    difficulty: searchParams.get("difficulty") ?? "",
    active: focusQuestionId ? "" : searchParams.get("active") ?? "active",
  });
  const [page, setPage] = useState(focusQuestionId ? 1 : Number(searchParams.get("page")) || 1);
  const [pageSize, setPageSize] = useState(Number(searchParams.get("pageSize")) || 20);
  const [selected, setSelected] = useState<number[]>([]);
  const [detail, setDetail] = useState<AdminQuestion | null>(null);
  const [editing, setEditing] = useState<AdminQuestion | "new" | null>(null);
  const [bulkOperation, setBulkOperation] = useState("deactivate");
  const [bulkValue, setBulkValue] = useState("");

  const listRequest = useRef(0);
  async function refresh() {
    const request = ++listRequest.current;
    setState((previous) => ({ ...previous, loading: true, error: "" }));
    const params = new URLSearchParams({ ...filters, contentDomain: domain, page: String(page), pageSize: String(pageSize) });
    if (focusQuestionId) params.set("id", String(focusQuestionId));
    try {
      const data = await apiGet<QuestionListData>("questions", params);
      if (request !== listRequest.current) return;
      setState({ loading: false, error: "", data });
      setSelected((ids) => ids.filter((id) => data.items.some((item) => item.id === id)));
    } catch (error) {
      if (request === listRequest.current) setState({ loading: false, error: error instanceof Error ? error.message : "조회 실패", data: null });
    }
  }
  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => { window.clearTimeout(timer); listRequest.current += 1; };
  }, [page, pageSize, filters.examScope, filters.category, filters.kind, filters.difficulty, filters.active, focusQuestionId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    updateContentQuery({ domain, ...filters, page, pageSize, ...(focusQuestionId ? { focus: focusQuestionId } : {}) });
  }, [domain, filters, page, pageSize, focusQuestionId]);
  useEffect(() => {
    if (!focusQuestionId || !state.data || handledFocus.current === focusQuestionId) return;
    const target = state.data.items.find((item) => item.id === focusQuestionId);
    if (!target) return;
    handledFocus.current = focusQuestionId;
    const timer = window.setTimeout(() => setDetail(target), 0);
    return () => window.clearTimeout(timer);
  }, [focusQuestionId, state.data]);

  function setFilter(name: string, value: string) {
    setFocusQuestionId(0);
    setPage(1);
    setFilters((previous) => ({ ...previous, [name]: value }));
  }

  async function runAction(action: string, values: JsonRecord, success: string) {
    try {
      await apiAction(action, values);
      onNotice(success);
      setDetail(null);
      await refresh();
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "작업 실패", true);
    }
  }

  async function runBulk() {
    if (!selected.length) return onNotice("변경할 문제를 선택해 주세요.", true);
    if (!window.confirm(`${selected.length}문항에 대량 작업을 적용할까요?`)) return;
    await runAction("question-bulk", {
      ids: selected,
      operation: bulkOperation,
      value: bulkValue,
    }, `${selected.length}문항을 변경했습니다.`);
    setSelected([]);
  }

  async function permanentlyDeleteInactive(question: AdminQuestion) {
    const confirmation = window.prompt(
      `비활성 문제 ID ${question.id}를 영구 삭제합니다.\n기존 풀이·북마크·모의고사 기록이 연결된 문제는 서버에서 삭제를 차단합니다.\n계속하려면 "문제 ${question.id} 삭제"를 입력해 주세요.`,
    );
    if (confirmation !== `문제 ${question.id} 삭제`) {
      if (confirmation !== null) onNotice("확인 문구가 일치하지 않아 삭제하지 않았습니다.", true);
      return;
    }
    try {
      await apiAction("question-delete-inactive", { id: question.id });
      setDetail(null);
      setSelected((ids) => ids.filter((id) => id !== question.id));
      setState((previous) => {
        if (!previous.data) return previous;
        const total = Math.max(0, previous.data.pagination.total - 1);
        return {
          ...previous,
          data: {
            ...previous.data,
            items: previous.data.items.filter((item) => item.id !== question.id),
            pagination: {
              ...previous.data.pagination,
              total,
              pages: Math.max(1, Math.ceil(total / previous.data.pagination.pageSize)),
            },
          },
        };
      });
      onNotice(`비활성 문제 ID ${question.id}를 영구 삭제했습니다.`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "문제를 삭제하지 못했습니다.", true);
    }
  }

  const rows = state.data?.items ?? [];
  const exportParams = new URLSearchParams({
    scope: "questions",
    contentDomain: domain,
    ...Object.fromEntries(
      Object.entries(filters)
        .filter(([, value]) => Boolean(value)),
    ),
  });
  return (
    <div className="admin-section-stack">
      <section className="admin-section-head">
        <div><span>{domainConfig.label} QUESTION BANK</span><h2>{domainConfig.label} 문제은행 관리</h2><p>안정적인 ID는 유지하고 표시 번호·범위·활성 상태를 관리합니다.</p></div>
        <div className="admin-head-actions">
          <ExportLink
            className="admin-button secondary"
            parameters={Object.fromEntries(exportParams.entries())}
            onNotice={onNotice}
          >
            현재 조건 JSON
          </ExportLink>
          <button className="admin-button" type="button" onClick={() => setEditing("new")}>＋ 새 문제</button>
        </div>
      </section>
      <section className="admin-card admin-filter-card">
        <form onSubmit={(event) => { event.preventDefault(); if (focusQuestionId || page !== 1) { setFocusQuestionId(0); setPage(1); } else void refresh(); }}>
          <label className="admin-search"><span>검색</span><input value={filters.search} onChange={(event) => setFilters((previous) => ({ ...previous, search: event.target.value }))} placeholder="문제 번호·ID·본문·소분류·태그" /><button type="submit">검색</button></label>
          <label>시험 범위<select value={filters.examScope} onChange={(event) => setFilter("examScope", event.target.value)}><option value="">전체</option>{domainConfig.scopeOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
          <label>과목<select value={filters.category} onChange={(event) => setFilter("category", event.target.value)}><option value="">전체</option>{domainConfig.subjects.map((subject) => <option key={subject}>{subject}</option>)}</select></label>
          <label>유형<select value={filters.kind} onChange={(event) => setFilter("kind", event.target.value)}><option value="">전체</option><option value="single">단일 정답</option><option value="multiple">복수 정답</option><option value="descriptive">{domain === "ipe" ? "실기 단답형" : "서술형"}</option></select></label>
          <label>난이도<select value={filters.difficulty} onChange={(event) => setFilter("difficulty", event.target.value)}><option value="">전체</option><option>하</option><option>중</option><option>상</option></select></label>
          <label>상태<select value={filters.active} onChange={(event) => setFilter("active", event.target.value)}><option value="">전체</option><option value="active">활성</option><option value="inactive">비활성</option></select></label>
        </form>
      </section>

      {domain === "ipe" && !PRACTICAL_PAST_EXAMS_PUBLISHED && <p className="admin-card">실기 기출문제 400문항은 관리자 전용으로 비공개 처리되어 있습니다. 활성 상태를 변경해도 학습 화면에는 공개되지 않으며, 원본과 기존 응시 기록은 보존됩니다.</p>}
      <section className="admin-card admin-bulk-bar">
        <span><strong>{selected.length}</strong>문항 선택</span>
        <select value={bulkOperation} onChange={(event) => { setBulkOperation(event.target.value); setBulkValue(""); }}>
          <option value="activate">활성화</option><option value="deactivate">비활성화</option>
          <option value="examScope">시험 범위 변경</option><option value="category">과목 변경</option>
          <option value="difficulty">난이도 변경</option><option value="addTag">태그 추가</option>
        </select>
        {bulkOperation === "examScope" && <select value={bulkValue} onChange={(event) => setBulkValue(event.target.value)}><option value="">값 선택</option>{domainConfig.scopeOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select>}
        {bulkOperation === "category" && <select value={bulkValue} onChange={(event) => setBulkValue(event.target.value)}><option value="">과목 선택</option>{domainConfig.subjects.map((subject) => <option key={subject}>{subject}</option>)}</select>}
        {bulkOperation === "difficulty" && <select value={bulkValue} onChange={(event) => setBulkValue(event.target.value)}><option value="">난이도 선택</option><option>하</option><option>중</option><option>상</option></select>}
        {bulkOperation === "addTag" && <input value={bulkValue} onChange={(event) => setBulkValue(event.target.value)} placeholder="추가할 태그" />}
        {selected.length > 0 && (
          <ExportLink
            className="admin-button small secondary"
            parameters={{ scope: "questions", ids: selected.join(",") }}
            onNotice={onNotice}
          >
            선택 문항 내보내기
          </ExportLink>
        )}
        <button className="admin-button small" type="button" disabled={!selected.length} onClick={runBulk}>적용</button>
      </section>

      <section className="admin-card admin-table-card">
        <div className="admin-table-head"><strong>문제 목록</strong><span>{state.data?.pagination.total ?? 0}문항</span></div>
        {state.loading && !state.data ? <LoadingBlock /> : state.error ? <ErrorState message={state.error} onRetry={refresh} /> : rows.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th><input type="checkbox" aria-label="현재 페이지 전체 선택" checked={rows.length > 0 && rows.every((item) => selected.includes(item.id))} onChange={(event) => setSelected(event.target.checked ? rows.map((item) => item.id) : [])} /></th><th>표시 번호</th><th>문제</th><th>범위·과목</th><th>유형</th><th>난이도</th><th>풀이 통계</th><th>상태</th><th>작업</th></tr></thead>
              <tbody>{rows.map((question) => {
                const rateWarning = question.correctnessRate !== null && (question.correctnessRate >= 95 || question.correctnessRate < 20);
                return <tr key={question.id} className={!question.active ? "inactive" : ""}>
                  <td><input type="checkbox" aria-label={`문제 ${question.displayOrder} 선택`} checked={selected.includes(question.id)} onChange={(event) => setSelected((ids) => event.target.checked ? [...ids, question.id] : ids.filter((id) => id !== question.id))} /></td>
                  <td><strong>{question.displayOrder}</strong><small>ID {question.id}</small></td>
                  <td><button className="admin-title-button" type="button" onClick={() => setDetail(question)}>{splitQuestionPromptForDisplay(question.displayPrompt ?? question.prompt).stem}</button><small>{question.topic}{question.theory_title ? ` · ${question.theory_title}` : " · 연결 이론 없음"}</small></td>
                  <td><span>{examScopeLabel(question.examScope)}</span><small>{question.category}</small></td>
                  <td>{question.kind === "descriptive" ? question.examScope === "IPEP" ? "단답형" : "서술형" : question.kind === "multiple" ? "복수 정답" : "단일 정답"}</td>
                  <td><span className={`admin-difficulty d-${question.difficulty}`}>{question.difficulty}</span></td>
                  <td><strong className={rateWarning ? "warning-text" : ""}>{question.correctnessRate === null ? "기록 없음" : `${question.correctnessRate}%`}</strong><small>제출 {question.totalAttempts}회</small></td>
                  <td><span className={question.active && !isHiddenPracticalPastQuestion(question.id) ? "admin-status success" : "admin-status muted"}>{isHiddenPracticalPastQuestion(question.id) ? "비공개 · 관리자 전용" : question.active ? "활성" : "비활성"}</span></td>
                  <td><div className="admin-row-actions"><button type="button" onClick={() => setEditing(question)}>수정</button><button type="button" onClick={() => runAction("question-duplicate", { id: question.id }, "문제를 복제했습니다.")}>복제</button>{question.active ? <button type="button" className="danger" onClick={() => window.confirm("문제를 비활성화할까요? 기존 풀이 기록은 보존됩니다.") && void runAction("question-deactivate", { id: question.id }, "문제를 비활성화하고 표시 번호를 정리했습니다.")}>비활성화</button> : <button type="button" className="danger permanent" onClick={() => void permanentlyDeleteInactive(question)}>영구 삭제</button>}</div></td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        ) : <EmptyState title="조건에 맞는 문제가 없습니다." description="필터를 조정하거나 새 문제를 등록해 주세요." />}
        {state.data && <div className="admin-pagination"><label>페이지당<select value={pageSize} onChange={(event) => { setPage(1); setPageSize(Number(event.target.value)); }}><option value={10}>10개</option><option value={20}>20개</option><option value={50}>50개</option></select></label><button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>← 이전</button><span>{page} / {state.data.pagination.pages} · 현재 {rows.length}문항</span><button type="button" disabled={page >= state.data.pagination.pages} onClick={() => setPage((value) => value + 1)}>다음 →</button></div>}
      </section>
      {detail && <QuestionDetailModal question={detail} onClose={() => setDetail(null)} onEdit={() => { setEditing(detail); setDetail(null); }} />}
      {editing && <AdminQuestionOptionsGate<AdminOptions> key={editing === "new" ? "new" : editing.id} resource="options" onClose={() => setEditing(null)}>{options => <QuestionFormModal question={editing === "new" ? null : editing} domain={domain} options={options} onClose={() => setEditing(null)} onSaved={async () => { await refresh(); onNotice(editing === "new" ? "새 문제를 등록했습니다." : "문제를 수정했습니다."); }} />}</AdminQuestionOptionsGate>}
    </div>
  );
}
