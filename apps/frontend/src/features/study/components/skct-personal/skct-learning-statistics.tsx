import { SKCT_LEARNING_UNITS } from "./skct-learning-entry";
export type SkctUnitStatistics = { unit_id: string; attempts: number; graded_count: number;
  answered_count: number; correct_count: number; elapsed_seconds: number };
export function SkctLearningStatistics({ statistics }: { statistics: SkctUnitStatistics[] | null }) {
  const graded = statistics?.reduce((sum,row) => sum+row.graded_count,0) ?? 0;
  const correct = statistics?.reduce((sum,row) => sum+row.correct_count,0) ?? 0;
  return <section className="skct-statistics" aria-labelledby="skct-statistics-title">
    <div className="section-heading"><div><span className="section-kicker">학습 현황</span>
      <h2 id="skct-statistics-title">영역별 정답률</h2></div>
      <p>{graded ? `전체 ${Math.round(correct/graded*100)}% · ${correct}/${graded}문항 정답` : "채점한 기록이 쌓이면 정답률을 확인할 수 있습니다."}</p></div>
    <div className="skct-stat-grid">{SKCT_LEARNING_UNITS.map(unit => {
      const row = statistics?.find(item => item.unit_id === unit.id);
      const count = row?.graded_count ?? 0;
      const rate = count ? Math.round((row?.correct_count ?? 0)/count*100) : null;
      const average = row?.answered_count ? Math.round(row.elapsed_seconds/row.answered_count) : null;
      return <article className="card skct-stat-card" key={unit.id} aria-label={`${unit.name} 학습 통계`}>
        <h3>{unit.name}</h3><strong className="skct-stat-rate">{statistics === null ? "…" : rate === null ? "—" : `${rate}%`}</strong>
        <div className="skct-stat-bar" role="progressbar" aria-label={`${unit.name} 정답률`}
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={rate ?? undefined} aria-valuetext={rate === null ? "채점 기록 없음" : `${rate}%`}>
          <span style={{ width: `${rate ?? 0}%` }} /></div>
        <dl><div><dt>정답 / 채점</dt><dd>{row?.correct_count ?? 0} / {count}</dd></div>
          <div><dt>미응답</dt><dd>{count-(row?.answered_count ?? 0)}문항</dd></div>
          <div><dt>평균 풀이</dt><dd>{average === null ? "—" : `${average}초`}</dd></div></dl>
      </article>;
    })}</div>
    <p className="skct-stat-note">확인한 연습 답안과 제출한 모의고사 전체 문항을 집계합니다. 모의고사의 미응답 문항도 정답률에 포함하며, 진행 중인 모의고사는 제출 후 반영됩니다.</p>
  </section>;
}
