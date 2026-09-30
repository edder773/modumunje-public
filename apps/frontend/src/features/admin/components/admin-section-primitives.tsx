"use client";

export function PeriodControls({
  range,
  onRange,
  excludeAdmin,
  onExcludeAdmin,
  ranges = [["today", "오늘"], ["7d", "최근 7일"], ["30d", "최근 30일"], ["custom", "사용자 지정"]],
}: {
  range: string;
  onRange: (value: string) => void;
  excludeAdmin: boolean;
  onExcludeAdmin: (value: boolean) => void;
  ranges?: ReadonlyArray<readonly [string, string]>;
}) {
  return (
    <div className="admin-period-controls">
      <div>
        {ranges.map(([value, label]) => (
          <button
            type="button"
            key={value}
            className={range === value ? "active" : ""}
            aria-pressed={range === value}
            onClick={() => onRange(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <label>
        <input
          type="checkbox"
          checked={excludeAdmin}
          onChange={(event) => onExcludeAdmin(event.target.checked)}
        />
        관리자 활동 제외
      </label>
    </div>
  );
}

export function MetricCard({
  label,
  value,
  unit,
  note,
  tone = "normal",
  compactValue = false,
}: {
  label: string;
  value: string | number;
  unit?: string;
  note?: string;
  tone?: "normal" | "warning" | "accent";
  compactValue?: boolean;
}) {
  return (
    <article className={`admin-card admin-metric ${tone}${compactValue ? " compact-value" : ""}`}>
      <span>{label}</span>
      <strong>{value}<small>{unit}</small></strong>
      {note && <p>{note}</p>}
    </article>
  );
}
