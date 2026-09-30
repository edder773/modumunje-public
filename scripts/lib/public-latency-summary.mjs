export function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

const round = value => Number.isFinite(value) ? Math.round(value) : null;
const delta = (now, before) => now === null || !Number.isFinite(before) || before <= 0
  ? "" : `${now <= before ? "" : "+"}${Math.round(((now - before) / before) * 100)}%`;
export const isSuccessfulLatencySample = run => run.status >= 200 && run.status < 300;

export function publicLatencyBaseline(target, document, { base, keepAlive }) {
  const baselineSite = document?.site ?? "https://modumunje.com";
  if (base.replace(/\/$/u, "") !== baselineSite.replace(/\/$/u, "")) {
    return { values: {}, source: null, reason: "different site" };
  }
  if (target.kind !== "api") {
    if (keepAlive) return { values: {}, source: null, reason: "connection method differs" };
    // The supplied document's page values are logged-in browser measurements.
    // Keep the separately recorded anonymous, fresh-connection page baseline.
    return { values: target.baseline, source: "embedded anonymous fresh-connection reference (2026-09-28)", reason: null };
  }
  const label = target.path === "/api/study?scope=shell"
    ? `${target.path} (anonymous)` : target.path === "/api/health" ? target.path : null;
  if (!label) return { values: {}, source: null, reason: "no comparable anonymous API baseline" };
  const row = document?.apis?.find(value => value.api === label);
  const serverMs = median(Array.isArray(row?.serverMs) ? row.serverMs : [row?.serverMs]);
  return serverMs !== null
    ? { values: { serverMs }, source: `supplied baseline: ${label}`, reason: null }
    : { values: target.baseline, source: "embedded anonymous/public API reference (2026-09-28)", reason: null };
}

export function summarizeLatencyRuns(target, runs, baseline) {
  const ok = runs.filter(isSuccessfulLatencySample);
  const ttfb = round(median(ok.map(run => run.ttfbMs)));
  const server = round(median(ok.map(run => run.serverTiming?.app)));
  const timing = target.kind === "api" ? server : ttfb;
  const previous = target.kind === "api" ? baseline.values.serverMs : baseline.values.ttfbMs;
  return {
    path: target.path,
    status: runs.map(run => run.status).join("/"),
    successfulSamples: ok.length,
    rejectedSamples: runs.length - ok.length,
    ttfbMs: ttfb,
    ttfbMinMs: round(Math.min(...ok.map(run => run.ttfbMs))),
    ttfbMaxMs: round(Math.max(...ok.map(run => run.ttfbMs))),
    serverMs: server,
    d1Ops: median(ok.map(run => run.serverTiming?.d1_ops)),
    boot: ok.map(run => run.serverTiming?.boot).filter(Boolean).join("/") || null,
    kb: ok[0] ? Math.round((ok[0].bytes / 1024) * 10) / 10 : null,
    baselineTtfbMs: baseline.values.ttfbMs ?? null,
    baselineServerMs: baseline.values.serverMs ?? null,
    baselineSource: baseline.source,
    comparisonUnavailable: !ok.length ? "no successful HTTP samples"
      : baseline.reason ?? (timing === null ? "timing metric unavailable"
        : !Number.isFinite(previous) ? "baseline metric unavailable" : null),
    change: delta(timing, previous),
    // Preserve error responses for diagnosis, but exclude them from success timings.
    runs,
  };
}
