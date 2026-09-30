import assert from "node:assert/strict";
import test from "node:test";
import { readRange } from "../apps/backend/src/modules/admin/admin-query-parameters";
import { koreanDateKey, trafficWindow, type DailyTraffic } from "../apps/frontend/src/features/admin/model/traffic-chart-period";

const row = (label: string, pageViews = 10): DailyTraffic => ({ label, pageViews, visitors: 2, returningVisitors: 1, submissions: 3 });

test("recent 14 days includes today and starts at Korean midnight across a year boundary", context => {
  context.mock.timers.enable({ apis: ["Date"], now: new Date("2026-01-01T15:00:00.000Z") });
  const period = readRange(new URL("https://example.test/?range=14d"));
  assert.equal(period.start, "2025-12-19T15:00:00.000Z");
  assert.equal(period.end, "2026-01-01T15:00:00.000Z");
  const result = trafficWindow([], 0, period);
  assert.equal(result.items.length, 14);
  assert.equal(result.items[0].label, "2025-12-20");
  assert.equal(result.items.at(-1)?.label, "2026-01-02");
});

test("sparse traffic preserves zero dates and paging covers a long selected range without overlaps", () => {
  const period = { start: "2026-08-31T15:00:00.000Z", end: "2026-09-30T14:59:59.999Z" };
  const rows = [row("2026-09-30", 30), row("2026-09-14", 14), row("2026-09-01", 1)];
  const pages = [0, 1, 2].map(page => trafficWindow(rows, page, period));
  assert.deepEqual(pages.map(page => page.items.length), [14, 14, 2]);
  assert.equal(pages[0].items[1].pageViews, 0);
  assert.equal(pages[1].previous?.pageViews, 14);
  const labels = pages.flatMap(page => page.items.map(item => item.label));
  assert.equal(new Set(labels).size, 30);
  assert.equal(labels[0], "2026-09-01");
  assert.equal(labels.at(-1), "2026-09-30");
  assert.equal(pages[2].items.at(-1)?.pageViews, 30);
  assert.equal(trafficWindow(rows, 99, period).page, 2);
});

test("single-day, leap-day and empty periods remain bounded with no invented prior-day baseline", () => {
  const leap = trafficWindow([row("2024-03-01")], 0, { start: "2024-02-28", end: "2024-03-01" });
  assert.deepEqual(leap.items.map(item => item.label), ["2024-02-28", "2024-02-29", "2024-03-01"]);
  assert.equal(leap.previous, undefined);
  assert.equal(trafficWindow([row("2026-09-14")], 0).items.length, 1);
  assert.deepEqual(trafficWindow([], 0).items, []);
  assert.deepEqual(trafficWindow([], 0, { start: "2026-09-14", end: "2026-09-01" }).items, []);
  assert.equal(koreanDateKey("2026-09-13T15:00:00Z"), "2026-09-14");
  assert.equal(trafficWindow([], 0, { start: "1900-01-01", end: "2100-01-01" }).items.length, 14);
});
