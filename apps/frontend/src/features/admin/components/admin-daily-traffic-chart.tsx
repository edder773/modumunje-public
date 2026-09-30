"use client";

import { useId, useRef, useState, type KeyboardEvent, type CSSProperties } from "react";
import { EmptyState } from "./admin-ui";

import { trafficWindow, type DailyTraffic } from "../model/traffic-chart-period";
export type { DailyTraffic } from "../model/traffic-chart-period";

const number = (value: number) => value.toLocaleString("ko-KR");
const dateFormat = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric", weekday: "short" });

export function trafficChange(value: number, previous: number | undefined, unit: string) {
  if (previous === undefined) return "이전 날짜 데이터 없음";
  const difference = value - previous;
  if (!difference) return "전일과 같음";
  const change = `${difference > 0 ? "+" : "−"}${number(Math.abs(difference))}${unit}`;
  if (previous === 0) return `전일 0${unit} · ${change}`;
  const percentage = number(Math.round(Math.abs(difference) / previous * 1000) / 10);
  return `전일 대비 ${change} (${difference > 0 ? "+" : "−"}${percentage}%)`;
}

export function TrafficDayDetails({ item, previous }: { item: DailyTraffic; previous?: DailyTraffic }) {
  // Do not describe a gap or the first day of a range as a zero-valued previous day.
  const previousDay = previous && Date.parse(item.label) - Date.parse(previous.label) === 86_400_000 ? previous : undefined;
  return <>
    <div className="admin-traffic-detail-date">
      <strong><time dateTime={item.label}>{dateFormat.format(new Date(`${item.label}T12:00:00+09:00`))}</time></strong>
      <span className="admin-traffic-timezone">한국 시간 기준</span>
    </div>
    <dl>
      <div><dt>조회수</dt><dd>{number(item.pageViews)}회<small>{trafficChange(item.pageViews, previousDay?.pageViews, "회")}</small></dd></div>
      <div><dt>방문 브라우저</dt><dd>{number(item.visitors)}개<small>{trafficChange(item.visitors, previousDay?.visitors, "개")}</small></dd></div>
      <div><dt>재방문 브라우저</dt><dd>{number(item.returningVisitors)}개</dd></div>
      <div><dt>전체 답안 제출</dt><dd>{number(item.submissions)}회</dd></div>
    </dl>
  </>;
}

export default function DailyTrafficChart({ items: allItems, returning = false, period, selectedDate, onSelectDate }: {
  items: DailyTraffic[];
  returning?: boolean;
  period?: { start: string; end: string };
  selectedDate?: string;
  onSelectDate?: (date: string) => void;
}) {
  const [page, setPage] = useState(0);
  const window = trafficWindow(allItems, page, period);
  const items = window.items;
  const [hovered, setHovered] = useState<string | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const dayRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const detailsId = useId();
  const helpId = useId();
  const active = hovered ?? selectedDate;
  const activeIndex = items.findIndex(item => item.label === active);
  const detailIndex = activeIndex >= 0 ? activeIndex : items.length - 1;
  const detailItem = items[detailIndex];
  const focusIndex = Math.max(0, items.findIndex(item => item.label === selectedDate));
  const maximum = Math.max(1, ...items.map(item => returning ? Math.max(item.visitors, item.returningVisitors) : Math.max(item.pageViews, item.visitors)));

  function selectDate(date: string) { setHovered(null); onSelectDate?.(date); }
  function changePage(next: number) {
    setHovered(null);
    setPage(next);
    const nextItems = trafficWindow(allItems, next, period).items;
    if (nextItems.length) onSelectDate?.(nextItems.at(-1)!.label);
  }
  function navigateDays(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let target: number;
    if (event.key === "ArrowLeft") target = Math.max(0, index - 1);
    else if (event.key === "ArrowRight") target = Math.min(items.length - 1, index + 1);
    else if (event.key === "Home") target = 0;
    else if (event.key === "End") target = items.length - 1;
    else return;
    event.preventDefault();
    dayRefs.current[target]?.focus();
  }
  if (!items.length) return <EmptyState title="표시할 일간 통계가 없습니다." description="선택한 기간에 수집된 방문 기록이 없습니다." />;
  return <div className="admin-traffic-chart" ref={chartRef} role="group"
    aria-label={returning ? "날짜별 전체 방문 브라우저와 재방문 브라우저" : "날짜별 조회수와 방문 브라우저"}
    aria-describedby={helpId} onPointerLeave={() => setHovered(null)}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setHovered(null); }}
    onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); setHovered(null); } }}>
    <div className="admin-traffic-window">
      <p aria-live="polite"><time>{items[0].label}</time> ~ <time>{items.at(-1)!.label}</time></p>
      {window.pages > 1 && <nav aria-label="일간 그래프 기간 이동">
        <button type="button" disabled={window.page === 0} onClick={() => changePage(window.page - 1)}>이전 14일</button>
        <span>{window.page + 1} / {window.pages}</span>
        <button type="button" disabled={window.page === window.pages - 1} onClick={() => changePage(window.page + 1)}>다음 14일</button>
      </nav>}
    </div>
    <div className="admin-traffic-legend"><span className="views">{returning ? "전체 방문" : "조회수"}</span><span className="visitors">{returning ? "재방문" : "방문 브라우저"}</span></div>
    <p id={helpId} className="admin-traffic-help">막대에 마우스를 올리면 아래 상세 수치를 미리 볼 수 있습니다. 날짜를 선택하면 자격증별 답안 제출도 해당 날짜 기준으로 바뀝니다. 키보드는 ← →로 이동합니다.</p>
    <div className="admin-traffic-scroll">
      <div className="admin-traffic-plot" style={{ "--traffic-days": items.length } as CSSProperties}>
        {items.map((item, index) => <button className="admin-traffic-day" key={item.label} type="button"
          ref={element => { dayRefs.current[index] = element; }} tabIndex={index === focusIndex ? 0 : -1}
          data-active={active === item.label || undefined}
          aria-pressed={selectedDate === item.label}
          data-date-tick={index === 0 || index === items.length - 1 || (index % 3 === 0 && index < items.length - 2) || undefined}
          aria-label={`${item.label} · 조회수 ${number(item.pageViews)}회 · 방문 브라우저 ${number(item.visitors)}개 · 재방문 ${number(item.returningVisitors)}개 · 전체 답안 제출 ${number(item.submissions)}회`}
          aria-describedby={active === item.label ? detailsId : undefined}
          onPointerEnter={event => { if (event.pointerType !== "touch") setHovered(item.label); }}
          onFocus={() => selectDate(item.label)}
          onClick={() => selectDate(item.label)}
          onKeyDown={event => navigateDays(event, index)}>
          <span className="admin-traffic-bars" aria-hidden="true">
            <i className="views" style={{ height: `${(returning ? item.visitors : item.pageViews) / maximum * 100}%` }} />
            <i className="visitors" style={{ height: `${(returning ? item.returningVisitors : item.visitors) / maximum * 100}%` }} />
          </span>
          <strong aria-hidden="true">{number(returning ? item.returningVisitors : item.pageViews)}</strong>
          <span className="admin-traffic-date" aria-hidden="true">{item.label.slice(5).replace("-", "/")}</span>
        </button>)}
      </div>
    </div>
    <div id={detailsId} className="admin-traffic-details" role="region" aria-label="날짜별 상세 통계">
      <TrafficDayDetails item={detailItem} previous={detailIndex === 0 ? window.previous : items[detailIndex - 1]} />
    </div>
  </div>;
}
