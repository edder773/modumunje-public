export const TRAFFIC_WINDOW_DAYS = 14;
const DAY_MS = 86_400_000;

export type DailyTraffic = {
  label: string;
  pageViews: number;
  visitors: number;
  returningVisitors: number;
  submissions: number;
};

export function koreanDateKey(value: string) {
  const time = Date.parse(value.length === 10 ? `${value}T00:00:00+09:00` : value);
  return Number.isFinite(time) ? new Date(time + 9 * 60 * 60 * 1000).toISOString().slice(0, 10) : "";
}

export function trafficWindow(items: DailyTraffic[], page: number, period?: { start: string; end: string }) {
  const sorted = [...items].sort((a, b) => a.label.localeCompare(b.label));
  const start = koreanDateKey(period?.start ?? sorted[0]?.label ?? "");
  const end = koreanDateKey(period?.end ?? sorted.at(-1)?.label ?? "");
  const first = Date.parse(start);
  const last = Date.parse(end);
  const totalDays = Number.isFinite(first) && Number.isFinite(last) && last >= first ? Math.round((last - first) / DAY_MS) + 1 : 0;
  const pages = Math.max(1, Math.ceil(totalDays / TRAFFIC_WINDOW_DAYS));
  const currentPage = Math.max(0, Math.min(pages - 1, Math.trunc(page) || 0));
  const offset = currentPage * TRAFFIC_WINDOW_DAYS;
  const byDate = new Map(items.map(item => [item.label, item]));
  const at = (day: number): DailyTraffic => {
    const label = new Date(first + day * DAY_MS).toISOString().slice(0, 10);
    return byDate.get(label) ?? { label, pageViews: 0, visitors: 0, returningVisitors: 0, submissions: 0 };
  };
  return {
    items: Array.from({ length: Math.min(TRAFFIC_WINDOW_DAYS, totalDays - offset) }, (_, i) => at(offset + i)),
    previous: offset > 0 ? at(offset - 1) : undefined,
    page: currentPage,
    pages,
  };
}
