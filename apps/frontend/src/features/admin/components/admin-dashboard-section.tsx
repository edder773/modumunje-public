"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { contentDomainForLabel } from "@shared/admin/content-domains";
import { apiGet } from "@frontend/features/admin/model/admin-api-client";
import {
  EmptyState,
  ErrorState,
  LoadingBlock,
  daysAgoLabel,
  emptyLoad,
  formatDate,
  type JsonRecord,
  type LoadState,
} from "./admin-ui";
import { MetricCard, PeriodControls } from "./admin-section-primitives";
import AdminPerformanceCard, {
  type AdminPerformanceData,
  type AdminRetentionData,
} from "./admin-performance-card";

type DashboardData = {
  period: { range: string; start: string; end: string };
  excludeAdmin: boolean;
  operationalWarnings: string[];
  performance: AdminPerformanceData;
  retention: AdminRetentionData;
  metrics: {
    dailyActiveUsers: number;
    monthlyActiveUsers: number;
    visitors: number;
    totalQuestions: number;
    activeQuestions: number;
    totalTheories: number;
    questionAttempts: number;
    totalQuestionAttempts: number;
    recentErrors: number;
    lastBackupAt: string | null;
  };
  contentBreakdown: Array<{
    field: string;
    totalQuestions: number;
    activeQuestions: number;
    totalTheories: number;
    activeTheories: number;
    questionAttempts: number;
    totalQuestionAttempts: number;
  }>;
  recent: {
    questions: JsonRecord[];
    theories: JsonRecord[];
    audits: JsonRecord[];
    errors: JsonRecord[];
    backups: JsonRecord[];
  };
  activityTrend: Array<{
    day: string;
    dau: number;
    mau: number;
    questionAttempts: number;
  }>;
};

function TrendChart({
  title,
  description,
  data,
  series,
}: {
  title: string;
  description: string;
  data: DashboardData["activityTrend"];
  series: Array<{
    key: "dau" | "mau" | "questionAttempts";
    label: string;
    color: string;
  }>;
}) {
  const rawMaximum = Math.max(
    1,
    ...data.flatMap((item) => series.map((entry) => item[entry.key])),
  );
  const tickStep = Math.max(1, Math.ceil(rawMaximum / 4));
  const maximum = tickStep * 4;
  const tickValues = Array.from({ length: 5 }, (_, index) => maximum - tickStep * index);
  const points = (key: typeof series[number]["key"]) => data
    .map((item, index) => {
      const x = data.length <= 1 ? 0 : index / (data.length - 1) * 100;
      const y = 96 - item[key] / maximum * 88;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  return (
    <article className="admin-card admin-trend-card">
      <div className="admin-card-head">
        <div><span>TREND</span><h3>{title}</h3><p>{description}</p></div>
        <strong>최대 {maximum.toLocaleString("ko-KR")}</strong>
      </div>
      <div className="admin-trend-legend">
        {series.map((entry) => <span key={entry.key}><i style={{ background: entry.color }} />{entry.label}</span>)}
      </div>
      <div className="admin-trend-plot" role="img" aria-label={`${title} 최근 30일 변화`}>
        <div className="admin-trend-y-axis" aria-hidden="true">
          {tickValues.map((value) => <span key={value}>{value.toLocaleString("ko-KR")}</span>)}
        </div>
        <div className="admin-trend-chart">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none">
            {[8, 30, 52, 74, 96].map((y) => <line key={y} x1="0" x2="100" y1={y} y2={y} />)}
            {series.map((entry) => (
              <polyline
                key={entry.key}
                points={points(entry.key)}
                style={{ stroke: entry.color }}
              />
            ))}
          </svg>
          <div className="admin-trend-labels">
            <span>{data[0]?.day.slice(5) ?? "-"}</span>
            <span>{data[Math.floor(data.length / 2)]?.day.slice(5) ?? "-"}</span>
            <span>{data.at(-1)?.day.slice(5) ?? "-"}</span>
          </div>
        </div>
      </div>
      <details className="admin-trend-data">
        <summary>일별 수치 보기</summary>
        <div>
          {data.map((item) => (
            <p key={item.day}>
              <strong>{item.day}</strong>
              {series.map((entry) => <span key={entry.key}>{entry.label} {item[entry.key].toLocaleString("ko-KR")}</span>)}
            </p>
          ))}
        </div>
      </details>
    </article>
  );
}
export default function DashboardSection({
  onNotice,
}: {
  onNotice: (message: string, error?: boolean) => void;
}) {
  const [range, setRange] = useState("7d");
  const [excludeAdmin, setExcludeAdmin] = useState(true);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [trendView, setTrendView] = useState<"combined" | "single">("combined");
  const [trendMetric, setTrendMetric] = useState<
    "dau" | "mau" | "questionAttempts"
  >("dau");
  const [state, setState] = useState<LoadState<DashboardData>>(emptyLoad);
  const refresh = async () => {
    setState((previous) => ({ ...previous, loading: true, error: "" }));
    const params = new URLSearchParams({
      range,
      excludeAdmin: String(excludeAdmin),
    });
    if (range === "custom") {
      params.set("start", customStart);
      params.set("end", customEnd);
    }
    try {
      setState({ loading: false, error: "", data: await apiGet("dashboard", params) });
    } catch (error) {
      setState({ loading: false, error: error instanceof Error ? error.message : "조회 실패", data: null });
    }
  };
  useEffect(() => {
    if (range === "custom" && (!customStart || !customEnd)) return;
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [range, excludeAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  if (state.loading && !state.data) return <LoadingBlock label="운영 현황을 집계하는 중입니다." />;
  if (state.error && !state.data) return <ErrorState message={state.error} onRetry={refresh} />;
  const data = state.data!;
  const metrics = data.metrics;
  const singleTrend = {
    dau: {
      title: "일간 활성 사용자 (DAU)",
      description: "날짜별 활성 사용자 수입니다.",
      label: "DAU",
      color: "var(--amber-dark)",
    },
    mau: {
      title: "월간 활성 사용자 (MAU)",
      description: "각 날짜 기준 최근 30일 활성 사용자 수입니다.",
      label: "MAU",
      color: "var(--ink)",
    },
    questionAttempts: {
      title: "문제 풀이 수",
      description: "날짜별 답안 제출 횟수입니다.",
      label: "문제 풀이",
      color: "var(--olive)",
    },
  }[trendMetric];
  const recentActivity = [
    ...data.recent.audits.map((item) => ({
      key: `audit-${item.id}`,
      title: String(item.action ?? "관리자 작업"),
      meta: `${String(item.target_type ?? "system")} · ${formatDate(item.created_at)}`,
      timestamp: Date.parse(String(item.created_at ?? "")) || 0,
      success: Boolean(item.success),
    })),
    ...data.recent.errors.map((item, index) => ({
      key: `error-${index}-${item.created_at}`,
      title: `${String(item.error_type ?? "오류")}${item.status === "resolved" ? " · 해결" : ""}`,
      meta: `${String(item.page_path ?? "")} · ${formatDate(item.created_at)}`,
      timestamp: Date.parse(String(item.created_at ?? "")) || 0,
      success: item.status === "resolved",
    })),
  ].sort((first, second) => second.timestamp - first.timestamp).slice(0, 8);

  return (
    <div className="admin-section-stack">
      <section className="admin-section-head">
        <div><span>OVERVIEW</span><h2>운영 현황 요약</h2><p>방문·학습·콘텐츠·오류 상태를 한 기준 기간으로 확인합니다.</p></div>
        <PeriodControls range={range} onRange={setRange} excludeAdmin={excludeAdmin} onExcludeAdmin={setExcludeAdmin} />
      </section>
      {range === "custom" && (
        <section className="admin-custom-period">
          <label>시작일<input type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} /></label>
          <label>종료일<input type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} /></label>
          <button type="button" disabled={!customStart || !customEnd} onClick={() => void refresh()}>기간 적용</button>
        </section>
      )}
      {data.operationalWarnings.length > 0 && (
        <section className="admin-warning-box" role="alert">
          <strong>운영 자동화 확인 필요</strong>
          {data.operationalWarnings.map((warning) => <p key={warning}>{warning}</p>)}
        </section>
      )}
      <section className="admin-active-user-grid" aria-label="활성 사용자 지표">
        <MetricCard label="일간 활성 사용자 (DAU)" value={metrics.dailyActiveUsers} unit="명" note="오늘 한국 시간 · 익명 방문 식별자 기준" tone="accent" />
        <MetricCard label="월간 활성 사용자 (MAU)" value={metrics.monthlyActiveUsers} unit="명" note="최근 30일 · 익명 방문 식별자 기준" tone="accent" />
      </section>
      <section className="admin-metric-grid">
        <MetricCard label="순 방문자 수" value={metrics.visitors} unit="명" note="익명 세션 기준" tone="accent" />
        <MetricCard
          label="문제 풀이 수"
          value={metrics.questionAttempts}
          unit="회"
          note={`선택 기간 · 누적 ${metrics.totalQuestionAttempts.toLocaleString("ko-KR")}회`}
        />
        <MetricCard label="활성 문제" value={metrics.activeQuestions} unit="문항" note={`전체 ${metrics.totalQuestions}문항`} />
        <MetricCard label="전체 이론" value={metrics.totalTheories} unit="개" />
        <Link
          className="admin-metric-link"
          href="/admin/logs?view=errors"
          aria-label={`최근 오류 ${metrics.recentErrors}건 상세 보기`}
        >
          <MetricCard
            label="최근 오류"
            value={metrics.recentErrors}
            unit="건"
            note="오류 및 시스템 상태에서 상세 확인"
            tone={metrics.recentErrors ? "warning" : "normal"}
          />
        </Link>
        <MetricCard label="마지막 백업" value={daysAgoLabel(metrics.lastBackupAt)} compactValue />
      </section>
      <section className="admin-learning-field-grid" aria-label="학습 분야별 운영 현황">
        {data.contentBreakdown.map((item) => (
          <article className="admin-card admin-learning-field-card" key={item.field}>
            <div className="admin-card-head">
              <div><span>LEARNING FIELD</span><h3>{item.field}</h3><p>해당 분야의 콘텐츠와 선택 기간 풀이 기록입니다.</p></div>
            </div>
            <dl>
              <div><dt>활성 문제</dt><dd>{item.activeQuestions.toLocaleString("ko-KR")}<small> / 전체 {item.totalQuestions.toLocaleString("ko-KR")}</small></dd></div>
              <div><dt>활성 이론</dt><dd>{item.activeTheories.toLocaleString("ko-KR")}<small> / 전체 {item.totalTheories.toLocaleString("ko-KR")}</small></dd></div>
              <div>
                <dt>선택 기간 풀이</dt>
                <dd>
                  {item.questionAttempts.toLocaleString("ko-KR")}<small>회 · 누적 {item.totalQuestionAttempts.toLocaleString("ko-KR")}회</small>
                </dd>
              </div>
            </dl>
          </article>
        ))}
      </section>
      <AdminPerformanceCard performance={data.performance} retention={data.retention} />
      <section className="admin-trend-toolbar">
        <div><span>TREND VIEW</span><strong>지표 변화 그래프</strong><p>여러 지표를 비교하거나 한 지표만 선택해 수치 축과 함께 확인합니다.</p></div>
        <div role="group" aria-label="그래프 표시 방식">
          <button type="button" className={trendView === "combined" ? "active" : ""} onClick={() => setTrendView("combined")}>묶어서 보기</button>
          <button type="button" className={trendView === "single" ? "active" : ""} onClick={() => setTrendView("single")}>각각 보기</button>
        </div>
      </section>
      {trendView === "single" && (
        <section className="admin-trend-metric-tabs" role="group" aria-label="단일 그래프 지표 선택">
          {([
            ["dau", "DAU"],
            ["mau", "MAU"],
            ["questionAttempts", "문제 풀이"],
          ] as const).map(([key, label]) => (
            <button
              type="button"
              key={key}
              className={trendMetric === key ? "active" : ""}
              onClick={() => setTrendMetric(key)}
            >
              {label}
            </button>
          ))}
        </section>
      )}
      <section className={`admin-trend-grid ${trendView}`}>
        {trendView === "combined" ? (
          <>
            <TrendChart
              title="DAU·MAU 변화"
              description="일간·최근 30일 활성 사용자의 흐름입니다."
              data={data.activityTrend}
              series={[
                { key: "dau", label: "DAU", color: "var(--amber-dark)" },
                { key: "mau", label: "MAU", color: "var(--ink)" },
              ]}
            />
            <TrendChart
              title="문제 풀이 변화"
              description="날짜별 제출된 객관식 문제 풀이 횟수입니다."
              data={data.activityTrend}
              series={[
                { key: "questionAttempts", label: "문제 풀이", color: "var(--olive)" },
              ]}
            />
          </>
        ) : (
          <TrendChart
            title={singleTrend.title}
            description={singleTrend.description}
            data={data.activityTrend}
            series={[{
              key: trendMetric,
              label: singleTrend.label,
              color: singleTrend.color,
            }]}
          />
        )}
      </section>

      <section className="admin-dashboard-grid">
        <article className="admin-card">
          <div className="admin-card-head"><div><span>RECENT CONTENT</span><h3>최근 콘텐츠</h3></div><Link href="/admin/questions">문제 관리 →</Link></div>
          <div className="admin-activity-list admin-content-activity">
            {[...data.recent.questions.map((item) => ({
              key: `q-${item.field}-${item.id}`,
              title: `${String(item.field ?? "SQL")} 문제 · ${String(item.prompt ?? "")}`,
              meta: `${String(item.category ?? "")} · ${formatDate(item.created_at)}`,
              href: `/admin/questions?domain=${contentDomainForLabel(item.field)}&focus=${String(item.id)}`,
            })), ...data.recent.theories.map((item) => ({
              key: `t-${item.field}-${item.id}`,
              title: `${String(item.field ?? "SQL")} · ${String(item.title ?? "")}`,
              meta: `${String(item.category ?? "")} · ${formatDate(item.updated_at)}`,
              href: `/admin/theories?domain=${contentDomainForLabel(item.field)}&focus=${String(item.id)}`,
            }))].slice(0, 8).map((item) => (
              <Link href={item.href} key={item.key}>
                <strong>{item.title}</strong>
                <span>{item.meta}</span>
                <b>확인 →</b>
              </Link>
            ))}
            {!data.recent.questions.length && !data.recent.theories.length && (
              <EmptyState title="최근 콘텐츠가 없습니다." description="새 문제나 이론을 추가하면 여기에 표시됩니다." />
            )}
          </div>
        </article>
        <article className="admin-card">
          <div className="admin-card-head"><div><span>OPERATIONS</span><h3>최근 작업과 오류</h3></div><Link href="/admin/logs">전체 로그 →</Link></div>
          <div className="admin-activity-list">
            {recentActivity.map((item) => (
              <div key={item.key}>
                <i className={item.success ? "success" : "error"} />
                <strong>{item.title}</strong>
                <span>{item.meta}</span>
              </div>
            ))}
            {!recentActivity.length && (
              <EmptyState title="최근 오류가 없습니다." description="관리자 작업과 시스템 오류가 여기에 표시됩니다." />
            )}
          </div>
        </article>
      </section>

      <section className="admin-card admin-quick-actions">
        <div><span>QUICK ACTIONS</span><h3>자주 쓰는 운영 작업</h3></div>
        <Link href="/admin/questions">새 문제 등록</Link>
        <Link href="/admin/theories">새 이론 등록</Link>
        <Link href="/admin/backups">백업 생성</Link>
        <button type="button" onClick={() => {
          void refresh().then(() => onNotice("운영 현황을 새로 집계했습니다."));
        }}>지표 새로고침</button>
      </section>
    </div>
  );
}
