#!/usr/bin/env node
// Anonymous latency probe for audited public routes (no login, GET only).
// Node >= 22, no dependencies. Each request opens a new TLS connection by default,
// so TTFB includes DNS/TCP/TLS setup (~15-30 ms from Korea).
//
// Usage:
//   node scripts/measure-production-latency.mjs                       # 3 samples per target
//   node scripts/measure-production-latency.mjs --samples 5 --out result.json
//   node scripts/measure-production-latency.mjs --cold 8 --gap 90     # spaced-request probe (about 12 min)
//   node scripts/measure-production-latency.mjs --base https://modumunje.com --keepalive
//
// Do not use this for load testing. A GET is not automatically read-only;
// review server handlers before adding targets. Keep samples small and polite.

import https from "node:https";
import { readFileSync, writeFileSync } from "node:fs";
import {
  countBoundedResponseBytes,
  publicLatencyRequestOptions,
  publicLatencyResponseByteLimit,
  readBoundedWebText,
  isLongLivedImmutableCacheControl,
} from "./lib/public-latency-request.mjs";

import {
  isSuccessfulLatencySample,
  median,
  publicLatencyBaseline,
  summarizeLatencyRuns,
} from "./lib/public-latency-summary.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith("--") ? args[index + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const base = option("base", "https://modumunje.com").replace(/\/$/u, "");
const samples = Math.max(1, Math.min(10, Number(option("samples", "3"))));
const coldCount = Number(option("cold", "0"));
const gapSeconds = Math.max(30, Number(option("gap", "90")));
const outPath = option("out", "");
const baselinePath = option("baseline", "");
const baselineDocument = baselinePath ? JSON.parse(readFileSync(baselinePath, "utf8")) : null;
if (baselineDocument && baselineDocument.schema !== "modumunje-latency-baseline@1") {
  throw new Error("Unsupported latency baseline schema");
}
const keepAlive = flag("keepalive");
const agent = keepAlive ? new https.Agent({ keepAlive: true, maxSockets: 1 }) : false;

// Anonymous baselines measured on 2026-09-28 (ICN edge, curl, new connection).
// ttfbMs = median time to first byte; serverMs = Server-Timing app;dur.
const TARGETS = [
  { path: "/", kind: "page", baseline: { ttfbMs: 60 } },
  { path: "/about", kind: "page", baseline: { ttfbMs: 60 } },
  { path: "/guides/sqld", kind: "page", baseline: { ttfbMs: 66 } },
  { path: "/learn/sql/sqld/home", kind: "page", baseline: { ttfbMs: 77 } },
  { path: "/learn/sql/sqld/theories", kind: "page", baseline: { ttfbMs: 654 } },
  { path: "/learn/sql/sqld/theories/lesson-29f0", kind: "page", baseline: { ttfbMs: 719 } },
  { path: "/learn/software-major/theories", kind: "page", baseline: {} },
  { path: "/theory-sitemap.xml", kind: "page", baseline: {} },
  { path: "/api/health", kind: "api", baseline: { serverMs: 184 } },
  { path: "/api/study?scope=shell", kind: "api", baseline: { serverMs: 175 } },
  { path: "/api/study?scope=overview", kind: "api", baseline: {} },
  { path: "/api/study?scope=theories&exam=SQLD", kind: "api", baseline: {} },
  { path: "/api/sw-study?view=summary", kind: "api", baseline: {} },
];

const COLD_TARGETS = ["/about", "/learn/sql/sqld/home"];


function request(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, base);
    const started = process.hrtime.bigint();
    const req = https.request(url, publicLatencyRequestOptions(path, agent), (res) => {
      const ttfbMs = Number(process.hrtime.bigint() - started) / 1e6;
      countBoundedResponseBytes(res, publicLatencyResponseByteLimit(path)).then((bytes) => resolve({
        status: res.statusCode,
        ttfbMs,
        totalMs: Number(process.hrtime.bigint() - started) / 1e6,
        bytes,
        serverTiming: parseServerTiming(res.headers["server-timing"]),
        cacheControl: res.headers["cache-control"] ?? null,
        contentEncoding: res.headers["content-encoding"] ?? null,
        protocol: `HTTP/${res.httpVersion}`,
      }), reject);
    });
    req.on("error", reject);
    req.setTimeout(30_000, () => req.destroy(new Error(`timeout: ${path}`)));
    req.end();
  });
}

function parseServerTiming(header) {
  const text = Array.isArray(header) ? header.join(",") : header ?? "";
  const metrics = {};
  for (const part of text.split(",")) {
    const [rawName, ...params] = part.trim().split(";");
    if (!rawName) continue;
    const entry = {};
    for (const param of params) {
      const [key, value] = param.trim().split("=");
      entry[key] = key === "dur" ? Number(value) : value?.replace(/^"|"$/gu, "");
    }
    metrics[rawName.trim()] = entry.dur ?? entry.desc ?? true;
  }
  return metrics;
}

const round = (value) => (Number.isFinite(value) ? Math.round(value) : null);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function measureTargets() {
  const rows = [];
  for (const target of TARGETS) {
    const baseline = publicLatencyBaseline(target, baselineDocument, { base, keepAlive });
    const runs = [];
    for (let i = 0; i < samples; i += 1) {
      try { runs.push(await request(target.path)); }
      catch (error) { runs.push({ status: 0, error: String(error.message ?? error) }); }
      await sleep(300);
    }
    rows.push(summarizeLatencyRuns(target, runs, baseline));
  }
  return rows;
}

async function coldProbe() {
  const rows = [];
  for (let i = 0; i < coldCount; i += 1) {
    const row = { at: new Date().toISOString() };
    for (const path of COLD_TARGETS) {
      try {
        const run = await request(path);
        row[path] = isSuccessfulLatencySample(run) ? Math.round(run.ttfbMs) : `HTTP ${run.status}`;
        row[`${path} status`] = run.status;
        if (run.serverTiming?.boot) row[`${path} boot`] = run.serverTiming.boot;
      } catch (error) { row[path] = `error: ${error.message}`; }
    }
    rows.push(row);
    console.log(JSON.stringify(row));
    if (i < coldCount - 1) await sleep(gapSeconds * 1000);
  }
  const summary = Object.fromEntries(COLD_TARGETS.map((path) => {
    const values = rows.map((row) => row[path]).filter((v) => typeof v === "number");
    return [path, { medianMs: round(median(values)), over1s: values.filter((v) => v > 1000).length, n: values.length }];
  }));
  return { gapSeconds, rows, summary, baseline2026_09_28: { "/about": { medianMs: 2207, over1s: 9, n: 10, slowRangeMs: [1250, 3219] } } };
}

const result = { measuredAt: new Date().toISOString(), base, samples, freshConnectionPerRequest: !keepAlive,
  measurementScope: "anonymous GET only; descriptive samples, not a causal performance guarantee",
  baselineDataset: baselineDocument ? { measuredAt: baselineDocument.measuredAt, sourceCommit: baselineDocument.sourceCommit } : null };
if (flag("cache-only")) {
  result.staticAsset = await staticAssetCacheControl();
  console.log(JSON.stringify(result.staticAsset));
} else if (coldCount > 0) {
  console.log(`Spaced-request probe (cold-start hypothesis): ${coldCount} rounds, ${gapSeconds}s apart, targets ${COLD_TARGETS.join(", ")}`);
  result.cold = await coldProbe();
  console.table(result.cold.summary);
} else {
  result.targets = await measureTargets();
  console.table(result.targets.map(({ path, status, successfulSamples, rejectedSamples, ttfbMs, serverMs, d1Ops, boot, kb, change, comparisonUnavailable }) => ({ path, status, successfulSamples, rejectedSamples, ttfbMs, serverMs, d1Ops, boot, kb, change, comparisonUnavailable })));
  result.staticAsset = await staticAssetCacheControl();
  console.log("Static asset cache-control:", result.staticAsset);
}

// Read-only P8-0 inventory for one representative public page. Its static
// requests use bounded GET streams, as required by the audited probe contract.
async function staticAssetCacheControl() {
  try {
    const page = "/about";
    const response = await fetch(`${base}${page}`, { headers: { accept: "text/html" } });
    if (!response.ok) return { page, status: response.status, assets: [] };
    const html = await readBoundedWebText(response);
    const assets = [...new Set(html.match(/\/_next\/static\/[^"'\s<>]+\.(?:js|css)/gu) ?? [])];
    const rows = [];
    for (const asset of assets) {
      try {
        const run = await request(asset);
        rows.push({ asset, status: run.status, cacheControl: run.cacheControl,
          contentEncoding: run.contentEncoding, protocol: run.protocol,
          immutable: isSuccessfulLatencySample(run) && isLongLivedImmutableCacheControl(run.cacheControl) });
      } catch (error) {
        rows.push({ asset, status: 0, error: String(error.message ?? error), immutable: false });
      }
    }
    return {
      page,
      listed: assets.length,
      checked: rows.length,
      immutable: rows.filter((row) => row.immutable).length,
      transport: "Node HTTPS probe uses HTTP/1.1; browser protocol needs Resource Timing",
      revalidationCandidates: rows.filter((row) => row.status === 200 && !row.immutable).length,
      assets: rows,
      baseline2026_09_28: "public, max-age=0, must-revalidate",
    };
  } catch (error) {
    return { error: String(error.message ?? error) };
  }
}
if (outPath) {
  writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`Saved ${outPath}`);
}
