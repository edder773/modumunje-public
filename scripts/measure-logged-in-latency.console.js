// modumunje.com logged-in latency snippet for audited GET routes.
// How to run: sign in at https://modumunje.com, open DevTools Console on any
// modumunje.com page, paste this whole file, and press Enter.
// Some GET routes can write state. Keep this target list limited to audited reads.
// Output: console.table + window.__modumunjeLatency (and clipboard via copy() when available).
// Personal identifiers (email, user key, group id) are not included in the output.

(async () => {
  const SAMPLES = 3;
  const V = "v=latency-probe";
  const SQLD_PRACTICE = "category=%EC%A0%84%EC%B2%B4+%EA%B3%BC%EB%AA%A9&difficulty=%EC%A0%84%EC%B2%B4&kind=objective&limit=5";

  // Logged-in baselines measured on 2026-09-28 (Server-Timing app;dur, ms).
  const targets = [
    { name: "study shell", url: `/api/study?scope=shell&${V}`, baseline: 556 },
    { name: "study overview", url: `/api/study?scope=overview&${V}`, baseline: 551 },
    { name: "study theories SQLD", url: `/api/study?scope=theories&${V}&exam=SQLD`, baseline: 374 },
    { name: "study practice-meta SQLD", url: `/api/study?scope=practice-meta&${V}&exam=SQLD`, baseline: 553 },
    { name: "study practice SQLD (5)", url: `/api/study?scope=practice&${V}&exam=SQLD&${SQLD_PRACTICE}`, baseline: 743 },
    { name: "study records SQLD", url: `/api/study?scope=records&${V}&exam=SQLD`, baseline: 932 },
    { name: "study mock SQLD", url: `/api/study?scope=mock&${V}&exam=SQLD`, baseline: 542 },
    { name: "sw-study summary", url: "/api/sw-study?view=summary", baseline: 205 },
    { name: "skct home", url: "/api/skct-personal?view=home", baseline: 366 },
    { name: "skct records", url: "/api/skct-personal?view=records", baseline: 360 },
    { name: "group groups", url: "/api/group-exams?scope=groups", baseline: 539 },
  ];
  const adminHeader = { "x-sql-study-admin-request": "1" };
  const adminTargets = [
    { name: "admin dashboard 7d", url: "/api/admin?range=7d&excludeAdmin=true&resource=dashboard", baseline: 805 },
    { name: "admin members", url: "/api/admin?resource=members", baseline: 191 },
    { name: "admin questions (20)", url: "/api/admin?search=&examScope=&category=&kind=&difficulty=&active=active&contentDomain=sql&page=1&pageSize=20&resource=questions", baseline: 225 },
    { name: "admin theories (20)", url: "/api/admin?search=&examScope=&category=&active=active&linked=&contentDomain=sql&page=1&pageSize=20&resource=theories", baseline: 993, baselineKB: 407.7 },
    { name: "admin logs", url: "/api/admin?search=&limit=100&resource=logs", baseline: 214 },
    { name: "admin group-exams", url: "/api/group-exams/admin?page=1&pageSize=20", baseline: 545 },
  ];

  const timing = (header) => Object.fromEntries((header ?? "").split(",").map((part) => {
    const [name, ...params] = part.trim().split(";");
    const dur = params.find((p) => p.trim().startsWith("dur="));
    const desc = params.find((p) => p.trim().startsWith("desc="));
    return [name, dur ? Number(dur.split("=")[1]) : desc ? desc.split("=")[1].replace(/"/g, "") : true];
  }).filter(([name]) => name));
  const median = (values) => {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
  };

  async function measure(target, headers = {}) {
    const runs = [];
    for (let i = 0; i < SAMPLES; i += 1) {
      const started = performance.now();
      const response = await fetch(target.url, { cache: "no-store", credentials: "same-origin", headers });
      const body = await response.text();
      const t = timing(response.headers.get("server-timing"));
      runs.push({
        status: response.status,
        wallMs: performance.now() - started,
        serverMs: t.app ?? t.group_total,
        d1Ms: t.d1 ?? t.group_d1,
        sqlMs: t.sql ?? t.group_sql,
        d1Ops: t.d1_ops ?? Number(response.headers.get("x-db-ops") ?? response.headers.get("x-group-db-ops") ?? NaN),
        boot: t.boot,
        kb: body.length / 1024,
        body: i === 0 ? body : null,
      });
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const serverMs = median(runs.map((r) => r.serverMs));
    return {
      name: target.name,
      status: runs.map((r) => r.status).join("/"),
      wallMs: Math.round(median(runs.map((r) => r.wallMs))),
      serverMs: serverMs === null ? null : Math.round(serverMs),
      baselineMs: target.baseline ?? null,
      change: serverMs && target.baseline ? `${serverMs <= target.baseline ? "" : "+"}${Math.round(((serverMs - target.baseline) / target.baseline) * 100)}%` : "",
      d1Ms: median(runs.map((r) => r.d1Ms)),
      sqlMs: median(runs.map((r) => r.sqlMs)),
      d1Ops: median(runs.map((r) => r.d1Ops)),
      boot: runs.map((r) => r.boot).filter(Boolean).join("/") || null,
      kb: Math.round(runs[0].kb * 10) / 10,
      baselineKB: target.baselineKB ?? null,
      _firstBody: runs[0].body,
    };
  }

  const rows = [];
  for (const target of targets) rows.push(await measure(target));

  // Group detail is a read-only lookup. Do not probe sync/current: they may
  // reconcile a run, mark a participant connected, or finalize results.
  try {
    const groups = JSON.parse(rows.find((r) => r.name === "group groups")?._firstBody ?? "{}");
    const list = groups.groups ?? groups.items ?? [];
    const groupId = list[0]?.id;
    if (groupId) {
      const q = encodeURIComponent(groupId);
      rows.push(await measure({ name: "group detail", url: `/api/group-exams?scope=group&groupId=${q}`, baseline: 917 }));
    }
  } catch { /* no group: skip */ }

  for (const target of adminTargets) {
    const row = await measure(target, adminHeader);
    if (row.status.startsWith("401") || row.status.startsWith("403")) break; // not an admin account
    rows.push(row);
  }

  const output = rows.map((row) => {
    const clean = { ...row };
    delete clean._firstBody;
    return clean;
  });
  console.table(output);
  const result = { measuredAt: new Date().toISOString(), origin: location.origin, samples: SAMPLES, rows: output };
  const assetEntries = performance.getEntriesByType("resource").filter((entry) => {
    try { return new URL(entry.name).origin === location.origin && new URL(entry.name).pathname.startsWith("/_next/static/"); }
    catch { return false; }
  });
  const revalidated = assetEntries.filter((entry) => entry.transferSize > 0 && entry.transferSize < 600);
  result.staticAssets = {
    observed: assetEntries.length,
    browserCacheOrNoTransfer: assetEntries.filter((entry) => entry.transferSize === 0).length,
    revalidated: revalidated.length,
    downloaded: assetEntries.filter((entry) => entry.transferSize >= 600).length,
    revalidationMedianMs: median(revalidated.map((entry) => entry.duration)),
    revalidationMaxMs: revalidated.length ? Math.max(...revalidated.map((entry) => entry.duration)) : null,
    // Performance entries can be unavailable after navigation or restricted by
    // the browser; these are observations, not a guaranteed full page waterfall.
  };
  window.__modumunjeLatency = result;
  try { copy(JSON.stringify(result, null, 2)); console.log("Copied JSON to clipboard."); }
  catch { console.log("Run copy(JSON.stringify(window.__modumunjeLatency, null, 2)) to copy the result."); }
})();
