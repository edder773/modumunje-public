"use client";

import { useEffect, useRef, useState } from "react";
import { apiGet } from "@frontend/features/admin/model/admin-api-client";

import {
  EmptyState,
  ErrorState,
  LoadingBlock,
  emptyLoad,
  type LoadState,
} from "./admin-ui";
import { MetricCard, PeriodControls } from "./admin-section-primitives";
import CertificationSubmissions from "./admin-certification-submissions";
import type { SubjectSubmissionCount } from "@shared/admin/submission-analytics";
import { koreanDateKey } from "../model/traffic-chart-period";
import DailyTrafficChart, { type DailyTraffic } from "./admin-daily-traffic-chart";

type AnalyticsData = {
  period: { range: string; start: string; end: string };
  excludeAdmin: boolean;
  summary: {
    pageViews: number;
    visitors: number;
    returningVisitors: number;
    returningRate: number | null;
    guestSubmissions: number;
    submissions: number;
    memberSubmissions: number;
  };
  daily: DailyTraffic[];
  bySubject: SubjectSubmissionCount[];
  byDate: Record<string, SubjectSubmissionCount[]>;
};

export default function AnalyticsSection() {
  const [range, setRange] = useState("14d");
  const [excludeAdmin, setExcludeAdmin] = useState(true);
  const [returningChart, setReturningChart] = useState(false);
  const [customStart, setCustomStart] = useState<string | null>(null);
  const [customEnd, setCustomEnd] = useState<string | null>(null);
  const [state, setState] = useState<LoadState<AnalyticsData>>(emptyLoad);
  const requestVersion = useRef(0);
  const [periodError, setPeriodError] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const startInput = customStart ?? koreanDateKey(state.data?.period.start ?? "");
  const endInput = customEnd ?? koreanDateKey(state.data?.period.end ?? "");
  async function refresh() {
    const version = ++requestVersion.current;
    setState((previous) => ({ ...previous, loading: true, error: "" }));
    const params = new URLSearchParams({ range, excludeAdmin: String(excludeAdmin) });
    if (range === "custom") {
      params.set("start", startInput);
      params.set("end", endInput);
    }
    try {
      const data = await apiGet<AnalyticsData>("analytics", params);
      if (version === requestVersion.current) setState({ loading: false, error: "", data });
    } catch (error) {
      if (version !== requestVersion.current) return;
      setState(previous => ({ ...previous, loading: false, error: error instanceof Error ? error.message : "조회 실패" }));
    }
  }
  useEffect(() => {
    if (range === "custom" && (!startInput || !endInput || startInput > endInput)) return;
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => { window.clearTimeout(timer); requestVersion.current += 1; };
  }, [range, excludeAdmin]); // eslint-disable-line react-hooks/exhaustive-deps
  const data = state.data;
  const periodStart = koreanDateKey(data?.period.start ?? "");
  const periodEnd = koreanDateKey(data?.period.end ?? "");
  const activeDate = selectedDate >= periodStart && selectedDate <= periodEnd ? selectedDate : periodEnd;
  if (state.loading && !data) return <LoadingBlock label="방문 및 학습 지표를 집계하는 중입니다." />;
  if (state.error && !data) return <ErrorState message={state.error} onRetry={refresh} />;
  if (!data) return null;
  return (
    <div className="admin-section-stack">
      <section className="admin-section-head">
        <div><span>FIRST-PARTY ANALYTICS</span><h2>방문자 및 학습 분석</h2><p>로그인 여부와 관계없이 방문을 집계합니다. 방문자는 사람이 아닌 브라우저 식별자 기준 추정치입니다.</p></div>
        <PeriodControls range={range} onRange={value => {
          if (value === "custom" && (!startInput || !endInput || startInput > endInput)) {
            setPeriodError("시작일과 종료일을 확인해 주세요. 시작일은 종료일보다 늦을 수 없습니다.");
            return;
          }
          setPeriodError(""); setRange(value);
        }} ranges={[["today", "오늘"], ["7d", "최근 7일"], ["14d", "최근 14일"], ["custom", "사용자 지정"]]} excludeAdmin={excludeAdmin} onExcludeAdmin={setExcludeAdmin} />
      </section>
      <form className="admin-custom-period" onSubmit={event => {
        event.preventDefault();
        if (!startInput || !endInput || startInput > endInput) {
          setPeriodError("시작일과 종료일을 확인해 주세요. 시작일은 종료일보다 늦을 수 없습니다.");
          return;
        }
        setPeriodError("");
        setRange("custom");
        if (range === "custom") void refresh();
      }}>
        <label>시작일<input type="date" required value={startInput} onChange={event => { setCustomStart(event.target.value); setPeriodError(""); }} /></label>
        <label>종료일<input type="date" required value={endInput} onChange={event => { setCustomEnd(event.target.value); setPeriodError(""); }} /></label>
        <button type="submit" disabled={state.loading}>기간 적용</button>
      </form>
      {(periodError || state.error) && <p role="alert" className="admin-period-error">{periodError || state.error}</p>}
      <p className="admin-applied-period" aria-live="polite">집계 기간: {koreanDateKey(data.period.start)} ~ {koreanDateKey(data.period.end)} · 한국 시간{state.loading ? " · 조회 중…" : ""}</p>
      <section className="admin-metric-grid admin-analytics-metrics">
        <MetricCard label="조회수" value={data.summary.pageViews} unit="회" tone="accent" />
        <MetricCard label="순 방문 브라우저" value={data.summary.visitors} unit="개" tone="accent" />
        <MetricCard label="기간 내 재방문 비율" value={data.summary.returningRate ?? "-"} unit={data.summary.returningRate == null ? "" : "%"} />
        <MetricCard label="전체 답안 제출" value={data.summary.submissions} unit="회" />
        <MetricCard label="회원 답안 제출" value={data.summary.memberSubmissions} unit="회" />
        <MetricCard label="비회원 답안 제출" value={data.summary.guestSubmissions} unit="회" />
      </section>
      {!data.summary.pageViews && !data.summary.visitors && !data.summary.submissions ? (
        <section className="admin-card"><EmptyState title="통계를 표시할 방문·학습 기록이 아직 없습니다." description="이벤트 수집이 활성화된 뒤 실제 사용 기록이 쌓이면 기간별 지표가 표시됩니다." /></section>
      ) : (
        <>
          <section className="admin-card admin-traffic-card"><div className="admin-card-head"><div><h3>{returningChart ? "일간 재방문" : "일간 조회수와 방문"}</h3><p>한국 시간 기준. 재방문은 선택 기간 내 서로 다른 날짜에 2일 이상 방문한 브라우저입니다. 당일 반복 조회는 재방문으로 세지 않습니다.</p><p>브라우저 데이터 삭제·기기 변경·추적 차단과 수집이 누락된 과거 기간의 영향으로 실제 재방문과 차이가 있습니다.</p></div><button type="button" onClick={() => setReturningChart((value) => !value)} aria-pressed={returningChart}>{returningChart ? "조회수 그래프 보기" : "재방문 그래프 보기"}</button></div><DailyTrafficChart key={`${data.period.start}:${data.period.end}`} items={data.daily} period={data.period} returning={returningChart} selectedDate={activeDate} onSelectDate={setSelectedDate} /></section>
          <CertificationSubmissions date={activeDate} items={data.byDate?.[activeDate] ?? []} />
        </>
      )}
    </div>
  );
}
