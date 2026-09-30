import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import DailyTrafficChart, { TrafficDayDetails, trafficChange, type DailyTraffic } from "../apps/frontend/src/features/admin/components/admin-daily-traffic-chart";

const previous: DailyTraffic = { label: "2026-09-10", pageViews: 1000, visitors: 40, returningVisitors: 10, submissions: 8 };
const current: DailyTraffic = { label: "2026-09-11", pageViews: 1250, visitors: 30, returningVisitors: 12, submissions: 9 };

test("daily details expose exact counts, a Korean date, and changes from the preceding calendar day", () => {
  const html = renderToStaticMarkup(<TrafficDayDetails item={current} previous={previous} />);
  for (const text of ["2026년 9월 11일 금", "1,250", "30", "12", "9", "전일 대비 +250회 (+25%)", "전일 대비 −10개 (−25%)", "한국 시간 기준"]) assert.ok(html.includes(text), text);
  for (const label of ["조회수", "방문 브라우저", "재방문 브라우저", "전체 답안 제출"]) assert.ok(html.includes(label));
});

test("comparisons distinguish absent data, date gaps, zero baselines and unchanged counts", () => {
  assert.equal(trafficChange(10, undefined, "회"), "이전 날짜 데이터 없음");
  assert.equal(trafficChange(0, 0, "회"), "전일과 같음");
  assert.equal(trafficChange(10, 0, "회"), "전일 0회 · +10회");
  assert.equal(trafficChange(0, 10, "회"), "전일 대비 −10회 (−100%)");
  const gap = renderToStaticMarkup(<TrafficDayDetails item={current} previous={{ ...previous, label: "2026-09-09" }} />);
  assert.match(gap, /이전 날짜 데이터 없음/u);
  assert.doesNotMatch(gap, /전일 대비/u);
  const monthBoundary = renderToStaticMarkup(<TrafficDayDetails item={{ ...current, label: "2026-10-01" }} previous={{ ...previous, label: "2026-09-30" }} />);
  assert.match(monthBoundary, /전일 대비 \+250회/u);
});

test("chart dates remain accessible interactive targets in both traffic modes, including zero days", () => {
  const zero = { ...previous, pageViews: 0, visitors: 0, returningVisitors: 0, submissions: 0 };
  for (const returning of [false, true]) {
    const html = renderToStaticMarkup(<DailyTrafficChart items={[zero, current]} returning={returning} />);
    assert.match(html, /role="group"/u);
    assert.equal((html.match(/class="admin-traffic-day"/gu) ?? []).length, 2);
    assert.equal((html.match(/tabindex="0"/gu) ?? []).length, 1);
    assert.match(html, /aria-label="2026-09-10 · 조회수 0회/u);
    assert.match(html, /aria-label="2026-09-11 · 조회수 1,250회/u);
    assert.match(html, /날짜를 선택하면 자격증별 답안 제출도 해당 날짜 기준으로 바뀝니다/u);
    assert.match(html, /키보드는 ← →로 이동합니다/u);
    assert.match(html, /role="region" aria-label="날짜별 상세 통계"/u);
    assert.match(html, /<time datetime="2026-09-11">/iu);
    assert.ok(html.indexOf('class="admin-traffic-details"') > html.lastIndexOf('</button>'));
    assert.doesNotMatch(html, /role="img"|role="tooltip"|traffic-anchor|title="2026|NaN|Infinity/u);
  }
  assert.match(renderToStaticMarkup(<DailyTrafficChart items={[]} />), /표시할 일간 통계가 없습니다/u);
});
