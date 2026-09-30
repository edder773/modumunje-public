export function integer(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

export function boundedInteger(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
) {
  return Math.min(max, Math.max(min, integer(value, fallback)));
}

export class AdminSearchInputError extends Error {
  readonly code = "ADMIN_SEARCH_TOO_LONG";

  constructor() {
    super("검색어의 한 단어가 너무 깁니다. 단어를 줄이거나 공백으로 나눠 검색해 주세요.");
    this.name = "AdminSearchInputError";
  }
}

export function sqlLike(value: string) {
  const pattern = `%${value.replace(/[\\%_]/g, "\\$&")}%`;
  // D1 counts UTF-8 bytes after escaping, including the surrounding wildcards.
  if (new TextEncoder().encode(pattern).byteLength > 50) throw new AdminSearchInputError();
  return pattern;
}

export function searchTokens(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 8);
}

export function startOfKoreanDay(date = new Date()) {
  const shifted = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return new Date(Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
  ) - 9 * 60 * 60 * 1000);
}

export function readRange(url: URL) {
  const range = url.searchParams.get("range") ?? "7d";
  const end = new Date();
  let start: Date;
  if (range === "today") start = startOfKoreanDay(end);
  else if (range === "14d") start = new Date(startOfKoreanDay(end).getTime() - 13 * 86_400_000);
  else if (range === "30d") start = new Date(end.getTime() - 30 * 86_400_000);
  else if (range === "custom") {
    const startValue = url.searchParams.get("start") ?? "";
    const endValue = url.searchParams.get("end") ?? "";
    const requestedStart = /^\d{4}-\d{2}-\d{2}$/.test(startValue)
      ? new Date(`${startValue}T00:00:00.000+09:00`)
      : new Date(startValue);
    const requestedEnd = /^\d{4}-\d{2}-\d{2}$/.test(endValue)
      ? new Date(`${endValue}T23:59:59.999+09:00`)
      : new Date(endValue);
    if (!Number.isFinite(requestedStart.getTime()) || !Number.isFinite(requestedEnd.getTime())) {
      throw new Error("사용자 지정 기간이 유효하지 않습니다.");
    }
    start = requestedStart;
    end.setTime(requestedEnd.getTime());
  } else start = new Date(end.getTime() - 7 * 86_400_000);
  if (start > end) throw new Error("조회 시작일은 종료일보다 늦을 수 없습니다.");
  return { range, start: start.toISOString(), end: end.toISOString() };
}

export function analyticsAdminClause(excludeAdmin: boolean, alias = "e") {
  return excludeAdmin ? ` AND ${alias}.is_admin = 0` : "";
}
