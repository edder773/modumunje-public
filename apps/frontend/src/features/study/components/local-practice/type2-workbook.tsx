"use client";
import { ReservedAdSlot } from "../../../advertising/reserved-ad-slot";

import { useState, useSyncExternalStore } from "react";
import type { LocalPracticeRelease } from "@shared/study/local-practice";
import { type2QuestionId, type Type2Index, type Type2Question, type Type2QuestionSummary, type Type2Reference } from "@shared/study/local-practice-type2";
import { AssetState, PracticeCode, useAsset } from "./workbook";

const EVENT = "baeumzip:type2-question";
function subscribe(listener: () => void) {
  window.addEventListener("popstate", listener); window.addEventListener(EVENT, listener);
  return () => { window.removeEventListener("popstate", listener); window.removeEventListener(EVENT, listener); };
}
const readLocation = () => window.location.search;
const rows = (value: number) => value.toLocaleString("ko-KR");
export const TYPE2_CSV_CHECK_PYTHON = 'import pandas as pd\nresult = pd.read_csv("result.csv")\nprint(result)';
export const TYPE2_CSV_CHECK_R = 'result <- read.csv("result.csv")\nprint(result)';

export function Type2Problem({ question }: { question: Type2Question }) {
  const s = question.submission;
  return <article className="card type2-problem" id="type2-problem">
    <header><h2>작업형 제2유형</h2><p className="local-practice-question-meta">예시문제 {String(question.number).padStart(2, "0")} · {question.title}</p><p className="type2-exam-category"><span>유형</span> 프로그래밍</p></header>
    <section aria-label="문제 지문"><p className="local-practice-statement">{question.statement}</p></section>
    <section aria-labelledby="type2-cautions"><h3 id="type2-cautions">【유의 사항】</h3><ol className="type2-exam-list">{question.cautions.map((item, i) => <li key={i}><span aria-hidden="true">{["㉠", "㉡"][i]}</span><span>{item}</span></li>)}</ol></section>
    <section aria-labelledby="type2-submission"><h3 id="type2-submission">【제출 형식】</h3><ol className="type2-exam-list">
      <li><span aria-hidden="true">㉠</span><span>CSV 파일명: <code>{s.filename}</code> (파일명에 디렉터리·폴더 지정 불가)</span></li>
      <li><span aria-hidden="true">㉡</span><span>예측값 칼럼명: <code>{s.columns.join(", ")}</code></span></li>
      <li><span aria-hidden="true">㉢</span><span>제출 칼럼 개수: <code>pred</code> 칼럼 {s.columns.length}개</span></li>
      <li><span aria-hidden="true">㉣</span><span>평가용 데이터와 예측 결과의 행 수 일치: {rows(s.rows)}개 (헤더 제외, test.csv의 행 순서 유지)</span></li>
    </ol></section>
    <section className="type2-exam-box" aria-labelledby="type2-data"><h3 id="type2-data">제공 데이터</h3>
      <div><h4>데이터 목록</h4><ol className="type2-data-list">{question.data.map(file => <li key={file.role}><code>{file.file}</code>: {file.role}용 데이터, {rows(file.rows)}개</li>)}</ol>
        <p className="type2-data-target">평가용 데이터에는 <code>{question.target}</code> 칼럼이 제공되지 않습니다.</p></div>
      <div><h4>데이터 설명</h4><table className="type2-exam-table"><caption className="type2-sr-only">{question.title} 데이터 칼럼 설명</caption>
        <thead><tr><th scope="col">칼럼명</th><th scope="col">칼럼 설명</th></tr></thead>
        <tbody>{question.columnDescriptions.map(column => <tr key={column.name}><th scope="row"><code>{column.name}</code></th><td>{column.description}</td></tr>)}</tbody>
      </table></div>
    </section>
    <section className="type2-exam-box" aria-labelledby="type2-csv"><h3 id="type2-csv">CSV 파일 형식 및 확인 방법</h3>
      <div><p>CSV 파일명: <code>{s.filename}</code></p><table className="type2-exam-table"><caption className="type2-sr-only">제출 CSV 칼럼 설명</caption>
        <thead><tr><th scope="col">칼럼명</th><th scope="col">칼럼 설명</th></tr></thead><tbody><tr><th scope="row"><code>pred</code></th><td>{s.prediction}</td></tr></tbody>
      </table></div>
      <div><h4>제출 CSV 파일 형식 예시</h4><pre className="type2-csv-example" tabIndex={0} aria-label="CSV 파일 예시"><code>{[...s.columns, ...s.exampleValues].join("\n")}</code></pre>
        <p className="local-practice-note">일부 행의 형식을 보여주는 예시이며, 실제 정답이나 예측 결과가 아닙니다.</p></div>
      <div><h4>CSV 파일 확인 방법</h4><p>생성한 파일을 다시 읽어 제출 형식을 확인합니다.</p><div className="type2-check-examples">
        <section aria-label="Python 예시"><h5>Python 예시</h5><pre tabIndex={0}><code>{TYPE2_CSV_CHECK_PYTHON}</code></pre></section>
        <section aria-label="R 예시"><h5>R 예시</h5><pre tabIndex={0}><code>{TYPE2_CSV_CHECK_R}</code></pre></section>
      </div></div>
    </section>
  </article>;
}
function Reference({ id, index, release }: { id: string; index: Type2Index; release: LocalPracticeRelease }) {
  const [open, setOpen] = useState(false), file = `references/${id}.json`;
  const data = useAsset<Type2Reference>(release, file, index.files[file], open);
  return <details className="card type2-reference" onToggle={event => setOpen(event.currentTarget.open)}><summary>참고 풀이</summary>
    {open && (data.value ? <Type2ReferenceContent reference={data.value} /> : <AssetState error={data.error} retry={data.retry} />)}
  </details>;
}
export function Type2ReferenceContent({ reference }: { reference: Type2Reference }) {
  return <div className="type2-reference-content">
    <p className="local-practice-note">데이터 확인부터 전처리, 학습·검증, 예측, CSV 저장까지 순서대로 작성한 기본 풀이입니다.</p>
    <PracticeCode title="참고 풀이 전체 코드" code={reference.code} copy />
    <details className="local-practice-guide"><summary>실행·검증 정보</summary>
      <p>{reference.selectedModel} · 검증 {reference.metric}: {reference.validationScore.toFixed(6)}</p>
      <p className="local-practice-note">학습 {rows(reference.fitRows)}행 / 검증 {rows(reference.validationRows)}행으로 확인한 값이며 시험 점수가 아닙니다.</p>
      <p className="local-practice-note">실행 환경: {Object.entries(reference.environment).map(([name, version]) => `${name} ${version}`).join(" · ")}. 환경에 따라 결과가 달라질 수 있습니다.</p>
    </details>
  </div>;
}
export function Type2Setup({ release, index, question }: { release: LocalPracticeRelease; index: Type2Index; question: Type2QuestionSummary }) {
  const kit = `kits/${question.id}.zip`;
  return <section className="card local-practice-setup"><div className="local-practice-setup-heading"><div><h2>{question.number}번 실습 파일</h2><p>{question.title}</p><p className="local-practice-note">학습·평가 CSV 2개 · Jupyter 노트북 1개</p></div>
    {Object.hasOwn(index.files, kit) ? <a className="primary-button" href={`${release.prefix}/${kit}`} download={`모두의 문제집_빅분기_2유형_${question.id}_실습파일.zip`}>{question.number}번 실습 파일 다운로드</a> : <p role="alert">실습 파일을 불러오지 못했습니다.</p>}</div>
    <p className="local-practice-note">학습용 가상 데이터로 구성한 예시 {index.count}선입니다.</p>
    <details className="local-practice-guide"><summary>설치·실습 방법</summary><section><p>포함된 노트북을 열어 패키지 설치 → 설치 확인 → 데이터 준비 순서로 실행하세요. 첫 설치에는 인터넷 연결이 필요합니다. pandas·NumPy·scikit-learn은 노트북 안에서 설치합니다.</p>
      <p>JupyterLab이 없다면 Python 3.12 환경의 터미널에서 아래 명령을 실행하고, 압축을 푼 폴더의 노트북을 여세요.</p>
      <PracticeCode title="JupyterLab 설치·실행" code={'python -m pip install jupyterlab\npython -m jupyterlab'} copy />
      <p>다른 문제는 해당 문제의 파일을 내려받아 그 폴더에서 실습하세요. 제출 파일은 현재 폴더의 result.csv로 저장하고, 문제에 명시된 조건을 확인합니다.</p>
      <p><a href={index.officialExample} target="_blank" rel="noreferrer">공식 제2유형 체험문제</a>의 안내 형식을 참고했습니다.</p></section></details>
  </section>;
}
function LoadedType2({ release, index }: { release: LocalPracticeRelease; index: Type2Index }) {
  const query = useSyncExternalStore(subscribe, readLocation, () => null);
  const id = type2QuestionId(query ?? ""), position = index.questions.findIndex(question => question.id === id);
  const file = `questions/${id}.json`, data = useAsset<Type2Question>(release, file, index.files[file], query !== null);
  function select(next: string) {
    window.history.pushState(null, "", `${window.location.pathname}?question=${encodeURIComponent(next)}`);
    window.dispatchEvent(new Event(EVENT));
    document.getElementById("type2-navigation")?.scrollIntoView({ block: "start" });
  }
  return <div className="local-practice-workbook">
    <nav className="card type2-navigation" id="type2-navigation" aria-label="2유형 문제 선택"><label>예시문제<select value={id} onChange={event => select(event.currentTarget.value)}>{index.questions.map(question => <option key={question.id} value={question.id}>{question.number}. {question.title}</option>)}</select></label>
      <div className="local-practice-pagination"><button className="outline-button" disabled={position <= 0} onClick={() => select(index.questions[position - 1].id)}>이전 문제</button><span>{position + 1} / {index.count}</span><button className="outline-button" disabled={position >= index.count - 1} onClick={() => select(index.questions[position + 1].id)}>다음 문제</button></div></nav>
    <Type2Setup key={id} release={release} index={index} question={index.questions[position]} />
    {data.value ? <><Type2Problem question={data.value} /><Reference key={id} id={id} index={index} release={release} /><ReservedAdSlot placement="practiceFooter" /></> : <AssetState error={data.error} retry={data.retry} />}
  </div>;
}
export default function Type2Workbook({ release }: { release: LocalPracticeRelease }) {
  const data = useAsset<Type2Index>(release, "index.json", release.indexSha256);
  return data.value ? <LoadedType2 index={data.value} release={release} /> : <AssetState error={data.error} retry={data.retry} />;
}
