const KOREA_DATE_FORMATTER = new Intl.DateTimeFormat("en", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function parseUtcDate(value) {
  // SQLite UTC timestamps lack a timezone suffix; browsers otherwise parse
  // them as local wall time. Explicit offsets and ISO timestamps are retained.
  const normalized = typeof value === "string"
    && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/u.test(value)
    ? `${value.replace(" ", "T")}Z` : value;
  return new Date(normalized);
}

const KOREA_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function dateTimeLabel(value) {
  return value ? KOREA_DATE_TIME_FORMATTER.format(parseUtcDate(value)) : "기록 없음";
}

export function koreaDateKey(value) {
  const parts = KOREA_DATE_FORMATTER.formatToParts(parseUtcDate(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function koreaDayStreak(days, now = new Date()) {
  const dateSet = new Set(days);
  let streak = 0;
  const cursor = new Date(now);
  for (let index = 0; index < 365; index += 1) {
    const key = koreaDateKey(cursor);
    if (!dateSet.has(key)) {
      if (index === 0) {
        cursor.setUTCDate(cursor.getUTCDate() - 1);
        continue;
      }
      break;
    }
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}
