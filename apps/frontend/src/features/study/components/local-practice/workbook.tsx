"use client";
import { ReservedAdSlot } from "../../../advertising/reserved-ad-slot";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  loadPracticeAsset, parsePracticeFilters, practiceFilterQuery, practicePage, PRACTICE_DIFFICULTIES,
  type LocalPracticeRelease, type PracticeAnswer, type PracticeFilters, type PracticeGuide, type PracticeIndex, type PracticeQuestion, type PracticePageSection,
} from "@shared/study/local-practice";

const LOCATION_EVENT = "baeumzip:local-practice-location";
function subscribeLocation(listener: () => void) {
  window.addEventListener("popstate", listener); window.addEventListener(LOCATION_EVENT, listener);
  return () => { window.removeEventListener("popstate", listener); window.removeEventListener(LOCATION_EVENT, listener); };
}
const readLocation = () => window.location.search;

export function useAsset<T>(release: LocalPracticeRelease, file: string, digest: string | undefined, enabled = true) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string; value?: T; error?: string }>({ key: "" });
  const key = `${release.version}/${file}/${digest}/${attempt}`;
  useEffect(() => {
    if (!enabled || !digest) return;
    const controller = new AbortController();
    loadPracticeAsset<T>(release, file, digest, controller.signal).then(value => {
      if (!controller.signal.aborted) setState({ key, value });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setState({ key, error: error instanceof Error ? error.message : "자료를 불러오지 못했습니다." });
    });
    return () => controller.abort();
  }, [release, file, digest, enabled, attempt, key]);
  return { value: state.key === key ? state.value : undefined, error: state.key === key ? state.error : undefined, retry: () => setAttempt(n => n + 1) };
}

export function AssetState({ error, retry }: { error?: string; retry: () => void }) {
  return error ? <p role="alert">{error} <button className="outline-button" onClick={retry}>다시 시도</button></p>
    : <p role="status">자료를 불러오고 있습니다.</p>;
}
export function PracticeCode({ title, code, copy = false }: { title: string; code: string; copy?: boolean }) {
  const [message, setMessage] = useState("");
  async function copyCode() {
    try { await navigator.clipboard.writeText(code); setMessage("복사했습니다."); }
    catch { setMessage("복사하지 못했습니다. 코드 내용을 선택해 복사해 주세요."); }
  }
  return <section className="local-practice-code" aria-label={title}><div><strong>{title}</strong>{copy && <button className="outline-button" onClick={copyCode}>{title} 복사</button>}</div>
    <pre tabIndex={0}><code>{code}</code></pre>{message && <p role="status">{message}</p>}</section>;
}
export function PracticeAnswerContent({ answer }: { answer: PracticeAnswer }) {
  return <div className="local-practice-answer-content">
    <p className="local-practice-final">최종 정답 <strong>{answer.answer}</strong></p>
    <p><strong>입력 전제</strong> · {answer.solution_inputs.map(item => `${item.variable} ← ${item.file}`).join(" / ")}</p>
    <PracticeCode title="핵심 풀이" code={answer.solution_core} copy />
    <PracticeCode title="실제 최종 출력" code={answer.execution.stdout} />
    <p>{answer.learning_point}</p>
    {answer.execution.checkpoints.length > 0 && <details className="local-practice-intermediate"><summary>중간 과정 확인</summary>{answer.execution.checkpoints.map((checkpoint, i) => <section className="local-practice-checkpoint" key={i}>
      <h4>{checkpoint.label}</h4><p>{checkpoint.description}</p>
      {typeof checkpoint.rows_total === "number" && typeof checkpoint.rows_shown === "number" && checkpoint.rows_shown < checkpoint.rows_total
        && <p>전체 {checkpoint.rows_total}행 중 {checkpoint.rows_shown}행 표시</p>}
      <PracticeCode title="미리 검증한 중간 출력" code={checkpoint.stdout} />
      <details><summary>중간 확인용 코드와 삽입 위치</summary><p>핵심 풀이에서 다음 문장 직전에 넣는 확인용 코드입니다. 최종 정답 계산에는 필요하지 않습니다.</p>
        <PracticeCode title="삽입 위치 · 이 문장 직전" code={checkpoint.before_core_statement} />
        <PracticeCode title="중간 확인용 코드" code={checkpoint.code} copy /></details>
    </section>)}</details>}
  </div>;
}
export function PracticeQuestionCard({ question, index, release }: {
  question: PracticeQuestion; index: PracticeIndex; release: LocalPracticeRelease;
}) {
  const [open, setOpen] = useState(false);
  const file = `answers/${question.id}.json`;
  const data = useAsset<PracticeAnswer>(release, file, index.files[file], open);
  return <article className="card local-practice-question" id={question.id}>
    <header><p className="local-practice-question-meta"><a href={`#${question.id}`}>{question.id}</a><span>{question.module}. {question.module_title}</span><span>{question.difficulty}</span></p><h3>{question.title}</h3></header>
    <p className="local-practice-statement">{question.statement}</p>
    <dl className="local-practice-question-info"><div><dt>사용 파일</dt><dd>{question.datasets.map(file => <code key={file}>{file}</code>)}</dd></div><div><dt>답안 형식</dt><dd>{question.answer_format}</dd></div></dl>
    <details className="local-practice-answer" onToggle={e => setOpen(e.currentTarget.open)}><summary>정답·풀이 확인</summary>
      {open && (data.value?.id === question.id ? <PracticeAnswerContent answer={data.value} /> : <AssetState error={data.error} retry={data.retry} />)}</details>
  </article>;
}
export function PracticeSetup({ index, release }: { index: PracticeIndex; release: LocalPracticeRelease }) {
  const [open, setOpen] = useState(false);
  const guide = useAsset<PracticeGuide>(release, "guide.json", index.files["guide.json"], open);
  return <section className="card local-practice-setup"><div className="local-practice-setup-heading"><div><h2>실습 파일</h2><p>CSV {release.datasetCount}개 · Jupyter 노트북 1개</p></div>
    {Object.hasOwn(index.files, "practice-kit.zip") ? <a className="primary-button" href={`${release.prefix}/practice-kit.zip`} download="모두의 문제집_빅분기_실기1유형_실습파일.zip">실습 파일 다운로드</a> : <p role="alert">실습 파일을 불러오지 못했습니다. 새로고침해 주세요.</p>}</div>
    <p className="local-practice-note">문제와 풀이는 이 페이지에서 확인하고, 내려받은 노트북에 코드를 작성하세요.</p>
    <details className="local-practice-guide" onToggle={e => setOpen(e.currentTarget.open)}><summary>설치·실행 방법</summary>
      {open && (guide.value ? guide.value.sections.map(section => <section key={section.title}><h3>{section.title}</h3>{section.paragraphs.map((p, i) => <p key={i}>{p}</p>)}{section.examples?.map(example => <PracticeCode key={example.title} title={example.title} code={example.code} copy />)}</section>) : <AssetState error={guide.error} retry={guide.retry} />)}</details>
  </section>;
}

export function PracticeDatasetHeading({ section }: { section: PracticePageSection }) {
  const code = section.group.inputs.map(input => `${input.variable} = load_csv(${JSON.stringify(input.file)})`).join("\n");
  return <header className="card local-practice-data-heading">
    <p className="local-practice-note">{section.group.datasets.length === 1 ? "단일 CSV 실습" : "여러 CSV 결합 실습"} · 이 데이터의 문제 {section.start}–{section.start + section.rows.length - 1} / {section.total}</p>
    <h2>{section.group.datasets.join(" + ")}</h2>
    <details><summary>데이터 준비 코드</summary><p className="local-practice-note">노트북의 데이터 불러오기 셀에 넣으세요. 같은 묶음에서는 파일명을 유지하고, 새 문제를 시작할 때 이 셀을 다시 실행하세요.</p>
      <PracticeCode title="데이터 불러오기" code={code} copy /></details>
  </header>;
}
function QuestionPage({ rows, sections, index, release, viewKey }: {
  rows: PracticeIndex["questions"]; sections: PracticePageSection[]; index: PracticeIndex; release: LocalPracticeRelease; viewKey: string;
}) {
  const [state, setState] = useState<{ key: string; questions?: PracticeQuestion[]; error?: string }>({ key: "" });
  const [attempt, setAttempt] = useState(0);
  const ids = rows.map(q => q.id).join(","), modules = [...new Set(rows.map(q => q.module))].join(",");
  const key = `${ids}/${attempt}`;
  useEffect(() => {
    const controller = new AbortController();
    Promise.all(modules.split(",").filter(Boolean).map(module => {
      const file = `questions/${module}.json`;
      return loadPracticeAsset<{ version: string; questions: PracticeQuestion[] }>(release, file, index.files[file], controller.signal);
    })).then(chunks => {
      if (controller.signal.aborted) return;
      const byId = new Map(chunks.flatMap(c => c.questions).map(q => [q.id, q]));
      const questions = ids.split(",").filter(Boolean).map(id => byId.get(id));
      if (questions.some(q => !q)) throw new Error("일부 문항을 불러오지 못했습니다.");
      setState({ key, questions: questions as PracticeQuestion[] });
    }).catch((error: unknown) => { if (!controller.signal.aborted) setState({ key, error: error instanceof Error ? error.message : "문항을 불러오지 못했습니다." }); });
    return () => controller.abort();
  }, [release, index, ids, modules, key]);
  useEffect(() => {
    if (state.key === key && state.questions && /^#T1-\d{3}$/u.test(window.location.hash)) document.getElementById(window.location.hash.slice(1))?.scrollIntoView();
  }, [state, key]);
  if (!rows.length) return <p className="card" role="status">조건에 맞는 문제가 없습니다. 검색어나 필터를 바꿔 주세요.</p>;
  if (state.key !== key || !state.questions) return <AssetState error={state.key === key ? state.error : undefined} retry={() => setAttempt(n => n + 1)} />;
  const byId = new Map(state.questions.map(question => [question.id, question]));
  return <div className="local-practice-questions">{sections.map(section => <section className="local-practice-data-section" key={`${viewKey}/${section.group.key}`}>
    <PracticeDatasetHeading section={section} />
    {section.rows.map(row => <PracticeQuestionCard key={`${viewKey}/${row.id}`} question={byId.get(row.id)!} index={index} release={release} />)}
  </section>)}<ReservedAdSlot placement="practiceFooter" /></div>;
}

export function PracticePagination({ page, pages, onPage }: { page: number; pages: number; onPage: (page: number) => void }) {
  const start = Math.max(1, Math.min(page - 1, pages - 2));
  const numbers = [...new Set([1, pages, ...Array.from({ length: Math.min(3, pages) }, (_, i) => start + i)])].sort((a, b) => a - b);
  return <nav className="local-practice-pagination" aria-label="문제 페이지">
    <button className="outline-button" disabled={page <= 1} onClick={() => onPage(page - 1)}>이전</button>
    {numbers.map((number, i) => <span className="local-practice-page-group" key={number}>
      {i > 0 && number - numbers[i - 1] > 1 && <span className="local-practice-page-gap" aria-hidden="true">…</span>}
      {number === page ? <span className="local-practice-page-current" aria-current="page" aria-label={`${number}페이지`}>{number}</span>
        : <button className="outline-button local-practice-page-number" aria-label={`${number}페이지`} onClick={() => onPage(number)}>{number}</button>}
    </span>)}
    <button className="outline-button" disabled={page >= pages} onClick={() => onPage(page + 1)}>다음</button>
  </nav>;
}
export function PracticeFilterControls({ filters, modules, onChange }: {
  filters: PracticeFilters; modules: PracticeIndex["modules"]; onChange: (filters: Partial<PracticeFilters>) => void;
}) {
  function apply(form: HTMLFormElement) {
    const data = new FormData(form);
    onChange({ q: String(data.get("q") ?? "").trim(), module: String(data.get("module") ?? ""), difficulty: String(data.get("difficulty") ?? "") });
  }
  return <form className="local-practice-filter-form" role="search" aria-label="문제 검색과 필터" onSubmit={event => { event.preventDefault(); apply(event.currentTarget); }}>
    <label>문제 검색<input key={filters.q} name="q" type="search" defaultValue={filters.q} maxLength={200} placeholder="문제 번호, 제목, 소단원, CSV" /></label>
    <label>소단원<select name="module" value={filters.module} onChange={event => apply(event.currentTarget.form!)}>
      <option value="">전체 소단원</option>{modules.map(item => <option key={item.number} value={item.number}>{item.number}. {item.title}</option>)}</select></label>
    <label>난이도<select name="difficulty" value={filters.difficulty} onChange={event => apply(event.currentTarget.form!)}>
      <option value="">전체 난이도</option>{PRACTICE_DIFFICULTIES.map(level => <option key={level}>{level}</option>)}</select></label>
    <div className="local-practice-filter-actions"><button className="primary-button" type="submit">검색</button>
      <button className="outline-button" type="button" onClick={event => { event.currentTarget.form?.reset(); onChange(parsePracticeFilters("")); }}>초기화</button></div>
  </form>;
}
export function LoadedWorkbook({ release, index }: { release: LocalPracticeRelease; index: PracticeIndex }) {
  const locationQuery = useSyncExternalStore(subscribeLocation, readLocation, () => null);
  const loaded = locationQuery !== null;
  const filters = useMemo(() => parsePracticeFilters(locationQuery ?? ""), [locationQuery]);
  const page = useMemo(() => practicePage(index, filters), [index, filters]);
  function update(patch: Partial<PracticeFilters>, paging = false) {
    const query = practiceFilterQuery({ ...filters, ...patch, page: paging ? patch.page ?? 1 : 1 });
    window.history.pushState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
    window.dispatchEvent(new Event(LOCATION_EVENT));
    if (paging) document.getElementById("type1-questions")?.scrollIntoView({ block: "start" });
  }
  useEffect(() => {
    if (!loaded) return;
    const query = practiceFilterQuery({ ...filters, page: page.page }), search = query ? `?${query}` : "";
    if (locationQuery === search) return;
    window.history.replaceState(null, "", `${window.location.pathname}${search}${window.location.hash}`);
    window.dispatchEvent(new Event(LOCATION_EVENT));
  }, [loaded, locationQuery, filters, page.page]);
  const viewKey = practiceFilterQuery({ ...filters, page: page.page });
  const onPage = (number: number) => update({ page: number }, true);
  return <div className="local-practice-workbook"><PracticeSetup index={index} release={release} />
    <section className="card local-practice-list-heading" id="type1-questions" aria-label="문제 목록">
      <h2>문제 목록</h2>
      <p className="local-practice-note">같은 CSV의 문제를 이어서 풀고, 여러 CSV를 결합하는 문제는 마지막에 연습합니다. 문제 번호는 기존 번호를 유지합니다.</p>
      <PracticeFilterControls filters={filters} modules={index.modules} onChange={update} />
      <p className="local-practice-note" role="status">전체 {index.count}문항 중 {page.total}문항 · {page.page} / {page.pages}페이지 · 페이지당 10문항</p>
      <PracticePagination page={page.page} pages={page.pages} onPage={onPage} />
    </section>
    {loaded ? <QuestionPage rows={page.rows} sections={page.sections} index={index} release={release} viewKey={viewKey} /> : <p role="status">문제를 불러오고 있습니다.</p>}
    <PracticePagination page={page.page} pages={page.pages} onPage={onPage} />
  </div>;
}
export default function LocalPracticeWorkbook({ release }: { release: LocalPracticeRelease }) {
  const index = useAsset<PracticeIndex>(release, "index.json", release.indexSha256);
  return index.value ? <LoadedWorkbook key={release.version} release={release} index={index.value} /> : <AssetState error={index.error} retry={index.retry} />;
}
