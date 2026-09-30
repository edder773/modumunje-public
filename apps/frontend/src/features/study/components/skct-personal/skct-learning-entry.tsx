"use client";

export const SKCT_LEARNING_UNITS = [
  { id: "U01", name: "언어이해", summary: "글의 중심 주장과 문장 사이의 근거를 확인합니다." },
  { id: "U02", name: "자료해석", summary: "표와 그래프의 단위·비율·변화를 비교합니다." },
  { id: "U03", name: "창의수리", summary: "수량 관계를 정리하고 조건에 맞는 값을 구합니다." },
  { id: "U04", name: "언어추리", summary: "주어진 조건으로 가능한 경우와 결론을 판단합니다." },
  { id: "U05", name: "수열추리", summary: "항 사이의 규칙을 찾아 전체 수열에 적용합니다." },
] as const;

export const SKCT_SECTION_LINKS = [
  { view: "home", href: "/learn/skct-personal", label: "학습 홈", icon: "▣" },
  { view: "practice", href: "/learn/skct-personal/practice", label: "문제 풀이", icon: "✎" },
  { view: "mock", href: "/learn/skct-personal/mock-exams", label: "모의고사", icon: "◷" },
  { view: "records", href: "/learn/skct-personal/records", label: "학습 기록", icon: "▤" },
] as const;

export function SkctLearningHome({ authenticated, signInPath }: { authenticated: boolean; signInPath: string }) {
  const actions = [
    { title: "문제 풀이", icon: "문제", href: "/learn/skct-personal/practice",
      description: "원하는 영역을 골라 5문항씩 연습합니다. 정답을 확인한 뒤 다음 문항을 이어 풀 수 있습니다.",
      meta: "문항별 채점·해설", action: "문제 풀이 선택" },
    { title: "모의고사", icon: "시험", href: "/learn/skct-personal/mock-exams",
      description: "한 영역의 10문항을 풀고 답안을 모아 제출합니다. 제출 후 결과와 해설을 확인합니다.",
      meta: "영역별 10문항 · 시간 제한 없음", action: "모의고사 선택" },
    { title: "학습 기록", icon: "기록", href: "/learn/skct-personal/records",
      description: "진행 중인 학습을 이어 풀거나 완료한 문제 풀이와 모의고사 결과를 다시 확인합니다.",
      meta: "이어 풀기·결과 복습", action: "학습 기록 보기" },
  ];
  return <div className="page-stack dashboard-home learning-entry-page skct-learning-home">
    <section className="learning-actions-section" aria-labelledby="skct-learning-actions-title">
      <div className="section-heading entry-section-heading"><div>
        <span className="section-kicker">학습 기능</span>
        <h2 id="skct-learning-actions-title">원하는 방식으로 학습하세요.</h2>
        <p>문제 풀이, 모의고사, 학습 기록을 SKCT 개인학습 안에서 이용합니다.</p>
      </div></div>
      <nav className="learning-action-grid" aria-label="학습 메뉴">
        {actions.map((action, index) => <a className="card topic-card" href={action.href} key={action.title}
          aria-labelledby={`skct-action-${index}`} aria-describedby={`skct-action-description-${index}`}>
          <span className="topic-icon" aria-hidden="true">{action.icon}</span>
          <h3 id={`skct-action-${index}`}>{action.title}</h3><p id={`skct-action-description-${index}`}>{action.description}</p>
          <div className="topic-meta"><span>{action.meta}</span><strong>{action.action}</strong></div>
        </a>)}
      </nav>
    </section>
    <section className="card skct-area-overview" aria-labelledby="skct-learning-areas-title">
      <div className="section-heading"><div><span className="section-kicker">학습 범위</span>
        <h2 id="skct-learning-areas-title">다섯 영역을 골라 연습합니다.</h2>
        <p>문제 풀이와 모의고사에서 같은 영역 구성을 사용합니다.</p>
      </div></div>
      <ul>{SKCT_LEARNING_UNITS.map((unit,index) => <li key={unit.id}>
        <span className="skct-area-number" aria-hidden="true">{String(index + 1).padStart(2,"0")}</span>
        <div><h3>{unit.name}</h3><p>{unit.summary}</p></div>
      </li>)}</ul>
    </section>
    {!authenticated && <section className="card skct-entry-login" aria-label="학습 시작 안내">
      <div><h2>로그인하고 학습을 시작하세요.</h2><p>문제 풀이와 모의고사 답안, 풀이 시간, 학습 기록을 계정에 저장합니다.</p></div>
      <a className="primary-button" href={signInPath}>로그인</a>
    </section>}
    <p className="skct-content-note">기업의 실제 채용검사나 공식 기출문제가 아닌 독립적인 학습용 창작 문항입니다.</p>
  </div>;
}

export function SkctLearningSetup({ mode, units, selectedUnitId, onSelectUnit, onStart, busy, pending, available, loading }: {
  mode: "practice" | "mock"; units: { id: string; name: string }[];
  selectedUnitId: string; onSelectUnit: (id: string) => void; onStart: (id: string) => void;
  busy: boolean; pending: boolean; available: boolean; loading: boolean;
}) {
  const mock = mode === "mock";
  const selected = units.find(unit => unit.id === selectedUnitId) ?? units[0];
  return <section className="page-stack skct-learning-setup" aria-labelledby="skct-unit-title">
    <div className="section-heading"><div><span className="section-kicker">{mock ? "영역별 모의고사" : "영역별 연습"}</span>
      <h2 id="skct-unit-title">{mock ? "모의고사" : "문제 풀이"} · 영역 선택</h2>
      <p className="skct-mode-guide">{mock
        ? "답안을 모아 제출한 뒤 채점합니다. 연습할 영역과 응시 구성을 확인하세요."
        : "연습할 영역을 선택하세요. 한 번에 5문항씩 시작하고 다음 문항을 이어 풀 수 있습니다."}</p>
    </div></div>
    <div className="practice-setup skct-setup-layout">
      <div className="card skct-setup-card">
        <fieldset className="skct-area-selector" disabled={busy || pending || loading}>
          <legend>학습 영역</legend>
          <div className="skct-unit-grid">{units.map(unit => {
            const summary = SKCT_LEARNING_UNITS.find(item => item.id === unit.id)?.summary;
            return <label key={unit.id} className={`skct-unit-option${selected?.id === unit.id ? " selected" : ""}`}>
              <input type="radio" name={`skct-${mode}-unit`} value={unit.id} checked={selected?.id === unit.id}
                onChange={() => onSelectUnit(unit.id)} />
              <span><strong>{unit.name}</strong>{summary && <span>{summary}</span>}</span>
            </label>;
          })}</div>
        </fieldset>
        <div className="skct-setup-summary" aria-label="선택한 학습 구성">
          <strong>{selected?.name ?? "학습 영역"}</strong>
          <dl className="skct-mode-facts">
            <div><dt>문항 구성</dt><dd>{mock ? "10문항" : "5문항씩 이어 풀기"}</dd></div>
            <div><dt>시간</dt><dd>제한 없음 · 풀이 시간 기록</dd></div>
            <div><dt>정답·해설</dt><dd>{mock ? "제출 확정 후 확인" : "문항별 정답 확인 후 공개"}</dd></div>
          </dl>
          <button className="primary-button" type="button" disabled={busy || pending || !available || !selected}
            onClick={() => selected && onStart(selected.id)}>{busy ? "준비 중…" : mock ? "모의고사 시작" : "문제 풀기"}</button>
          {loading && <p role="status">학습 가능 상태를 확인하고 있습니다.</p>}
          {!available && !loading && <p>학습 가능 상태가 확인되면 시작할 수 있습니다.</p>}
        </div>
      </div>
      <aside className="study-tip skct-setup-tip">
        <span>{mock ? "모의고사 안내" : "문제 풀이 안내"}</span>
        <h3>{mock ? "제출 전에는 답안을 바꿀 수 있습니다." : "정답 확인 후 해설을 읽어 보세요."}</h3>
        <p>{mock
          ? "문항 사이를 이동하며 답안을 고칩니다. 제출할 때 미응답 문항을 확인하고, 제출 확정 후 결과와 해설을 봅니다."
          : "선택지를 고르는 것만으로는 채점되지 않습니다. 정답 확인을 누르면 답안이 확정되고 해설을 볼 수 있습니다."}</p>
        <p>진행 중인 학습과 완료한 결과는 학습 기록에서 다시 열 수 있습니다.</p>
        <a href="/learn/skct-personal/records">학습 기록 보기</a>
      </aside>
    </div>
  </section>;
}
