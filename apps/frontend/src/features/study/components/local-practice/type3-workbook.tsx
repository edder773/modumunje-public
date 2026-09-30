"use client";
import { ReservedAdSlot } from "../../../advertising/reserved-ad-slot";

import { useState, useSyncExternalStore } from "react";
import type { LocalPracticeRelease } from "@shared/study/local-practice";
import { type3QuestionId, type Type3Index, type Type3Question, type Type3Summary, type Type3Reference } from "@shared/study/local-practice-type3";
import { AssetState, PracticeCode, useAsset } from "./workbook";

const EVENT = "baeumzip:type3-question";
const CIRCLED = ["①", "②", "③"];
function subscribe(listener: () => void) {
  window.addEventListener("popstate", listener); window.addEventListener(EVENT, listener);
  return () => { window.removeEventListener("popstate", listener); window.removeEventListener(EVENT, listener); };
}
const readLocation = () => window.location.search;

export function Type3Problem({ question }: { question: Type3Question }) {
  return <article className="card type2-problem type3-problem" id="type3-problem">
    <header><h2>작업형 제3유형</h2><p className="local-practice-question-meta">사례 {String(question.number).padStart(2, "0")} · {question.title}</p><p className="type2-exam-category"><span>유형</span> 통계 분석 · 소문항 {question.subquestionCount}개</p></header>
    <section aria-label="문제 지문"><p className="local-practice-statement">{question.statement}</p></section>
    <section aria-labelledby="type3-conditions"><h3 id="type3-conditions">【분석 조건】</h3><ol>{question.conditions.map((item, i) => <li key={i}>{item}</li>)}</ol></section>
    <section aria-labelledby="type3-subquestions"><h3 id="type3-subquestions">【소문항】</h3>
      <p className="local-practice-note">소문항별로 수치 하나를 구합니다. 중간 계산값은 반올림하지 않고 최종 답만 지정한 자릿수로 표시하세요.</p>
      <ol className="type3-subquestions">{question.subquestions.map((sub, i) => <li key={sub.id}><span className="type3-subquestion-number" aria-hidden="true">{CIRCLED[i]}</span><div><p>{sub.prompt}</p><p className="type3-answer-format"><strong>제출 형식</strong> {sub.format}</p></div></li>)}</ol>
    </section>
    <section className="type2-exam-box" aria-labelledby="type3-data"><h3 id="type3-data">제공 데이터</h3>
      <p><code>{question.data.file}</code> · {question.data.rows.toLocaleString("ko-KR")}행 · {question.data.columnCount}열 (헤더 제외)</p>
      <table className="type2-exam-table"><caption className="type2-sr-only">{question.title} 데이터 칼럼 설명</caption><thead><tr><th scope="col">칼럼명</th><th scope="col">칼럼 설명</th></tr></thead><tbody>{question.data.columns.map(c => <tr key={c.name}><th scope="row"><code>{c.name}</code></th><td>{c.description}</td></tr>)}</tbody></table>
    </section>
  </article>;
}
export function Type3Setup({ release, index, question }: { release: LocalPracticeRelease; index: Type3Index; question: Type3Summary }) {
  const file = `kits/${question.id}.zip`;
  return <section className="card local-practice-setup"><div className="local-practice-setup-heading"><div><h2>{question.number}번 실습 파일</h2><p>{question.title}</p><p className="local-practice-note">CSV 1개 · Jupyter 노트북 1개</p></div>
    {Object.hasOwn(index.files, file) ? <a className="primary-button" href={`${release.prefix}/${file}`} download={`모두의 문제집_빅분기_3유형_${question.id}_실습파일.zip`}>{question.number}번 실습 파일 다운로드</a> : <p role="alert">실습 파일을 불러오지 못했습니다.</p>}</div>
    <p className="local-practice-note">학습용 가상 데이터 · {index.count}개 사례 · {index.subquestionCount}개 소문항</p>
    <details className="local-practice-guide"><summary>설치·실습 방법</summary><section>
      <p>포함된 노트북에서 패키지 설치 → 설치 확인 → 데이터 준비 순서로 실행한 뒤, 소문항 ①·②·③의 풀이를 작성하세요. 첫 설치에는 인터넷 연결이 필요합니다.</p>
      <p>pandas·NumPy·SciPy·statsmodels는 노트북 안에서 설치합니다. JupyterLab이 없다면 Python 3.12 환경의 터미널에서 아래 명령을 실행하고 압축을 푼 폴더의 노트북을 여세요.</p>
      <PracticeCode title="JupyterLab 설치·실행" code={'python -m pip install jupyterlab\npython -m jupyterlab'} copy />
      <p>각 소문항의 출력 형식에 맞춰 수치를 확인합니다. 정수는 단위·천 단위 쉼표 없이 표시하고, 소수는 지정한 자릿수를 유지하세요. 다른 사례는 그 사례의 실습 파일을 내려받아 시작합니다.</p>
      <p><a href={index.officialExample} target="_blank" rel="noreferrer">공식 제3유형 체험문제</a>의 소문항별 답안 형식을 참고했습니다.</p>
    </section></details>
  </section>;
}
export function Type3ReferenceContent({ reference }: { reference: Type3Reference }) {
  return <div className="type2-reference-content">
    <dl className="type3-answers">{reference.answers.map((a, i) => <div key={a.id}><dt>소문항 {CIRCLED[i]}</dt><dd><code>{a.display}</code></dd></div>)}</dl>
    <ul className="type3-explanations">{reference.explanation.map((line, i) => <li key={i}>{line}</li>)}</ul><p>{reference.interpretation}</p>
    <PracticeCode title="참고 풀이 전체 코드" code={reference.code} copy />
    <PracticeCode title="실제 출력 · 소문항 ①~③ 순서" code={reference.stdout} />
    <details className="local-practice-guide"><summary>계산 확인값·실행 환경</summary><section>
      <p className="local-practice-note">아래 코드는 참고 풀이를 실행한 뒤 같은 노트북에서 확인할 수 있습니다.</p>
      <PracticeCode title="계산 확인 코드" code={reference.diagnosticCode} copy />
      <PracticeCode title="계산 확인 출력" code={reference.diagnosticStdout} />
      <p className="local-practice-note">실행 환경: {Object.entries(reference.environment).map(([name, version]) => `${name} ${version}`).join(" · ")}</p>
    </section></details>
  </div>;
}
export function Type3ReferencePanel({ id, index, release }: { id: string; index: Type3Index; release: LocalPracticeRelease }) {
  const [open, setOpen] = useState(false), file = `references/${id}.json`;
  const data = useAsset<Type3Reference>(release, file, index.files[file], open);
  return <details className="card type2-reference" onToggle={event => setOpen(event.currentTarget.open)}><summary>정답·풀이 확인</summary>
    {open && (data.value ? <Type3ReferenceContent reference={data.value} /> : <AssetState error={data.error} retry={data.retry} />)}
  </details>;
}
function LoadedType3({ release, index }: { release: LocalPracticeRelease; index: Type3Index }) {
  const query = useSyncExternalStore(subscribe, readLocation, () => null);
  const id = type3QuestionId(query ?? ""), position = index.questions.findIndex(q => q.id === id), file = `questions/${id}.json`;
  const data = useAsset<Type3Question>(release, file, index.files[file], query !== null);
  function select(next: string) {
    window.history.pushState(null, "", `${window.location.pathname}?question=${encodeURIComponent(next)}`);
    window.dispatchEvent(new Event(EVENT)); document.getElementById("type3-navigation")?.scrollIntoView({ block: "start" });
  }
  return <div className="local-practice-workbook">
    <nav className="card type2-navigation" id="type3-navigation" aria-label="3유형 사례 선택"><label>사례 선택<select value={id} onChange={event => select(event.currentTarget.value)}>{index.questions.map(q => <option key={q.id} value={q.id}>{q.number}. {q.title}</option>)}</select></label>
      <div className="local-practice-pagination"><button className="outline-button" disabled={position <= 0} onClick={() => select(index.questions[position - 1].id)}>이전 사례</button><span>{position + 1} / {index.count}</span><button className="outline-button" disabled={position >= index.count - 1} onClick={() => select(index.questions[position + 1].id)}>다음 사례</button></div>
    </nav>
    <Type3Setup key={id} release={release} index={index} question={index.questions[position]} />
    {data.value ? <><Type3Problem question={data.value} /><Type3ReferencePanel key={id} id={id} index={index} release={release} /><ReservedAdSlot placement="practiceFooter" /></> : <AssetState error={data.error} retry={data.retry} />}
  </div>;
}
export default function Type3Workbook({ release }: { release: LocalPracticeRelease }) {
  const data = useAsset<Type3Index>(release, "index.json", release.indexSha256);
  return data.value ? <LoadedType3 index={data.value} release={release} /> : <AssetState error={data.error} retry={data.retry} />;
}
