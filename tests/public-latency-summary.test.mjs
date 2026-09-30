import assert from "node:assert/strict";
import { test } from "node:test";
import { publicLatencyBaseline, summarizeLatencyRuns, isSuccessfulLatencySample } from "../scripts/lib/public-latency-summary.mjs";

const page = { path: "/about", kind: "page", baseline: { ttfbMs: 60 } };
const options = { base: "https://modumunje.com", keepAlive: false };
const run = (status, ttfbMs = 10) => ({ status, ttfbMs, bytes: 1024, serverTiming: { app: 5, d1_ops: 1, boot: "warm" } });

test("blocked, redirected, missing and failed responses never appear as successful latency improvements", () => {
  const runs = [run(403), run(401), run(404), run(302), run(500), { status: 0, error: "connection lost" }];
  const summary = summarizeLatencyRuns(page, runs, publicLatencyBaseline(page, null, options));
  assert.equal(summary.successfulSamples, 0);
  assert.equal(summary.rejectedSamples, 6);
  for (const key of ["ttfbMs", "ttfbMinMs", "ttfbMaxMs", "serverMs", "d1Ops", "kb"]) assert.equal(summary[key], null, key);
  assert.equal(summary.change, "");
  assert.equal(summary.comparisonUnavailable, "no successful HTTP samples");
  assert.deepEqual(summary.runs, runs);
  assert.ok(runs.every(value => !isSuccessfulLatencySample(value)));
});

test("mixed outcomes keep failed samples visible without contaminating the successful median", () => {
  const summary = summarizeLatencyRuns(page, [run(200, 40), run(403, 1), run(200, 80)], publicLatencyBaseline(page, null, options));
  assert.equal(summary.successfulSamples, 2);
  assert.equal(summary.rejectedSamples, 1);
  assert.equal(summary.ttfbMs, 60);
  assert.equal(summary.ttfbMinMs, 40);
  assert.equal(summary.ttfbMaxMs, 80);
  assert.equal(summary.change, "0%");
  assert.equal(summary.status, "200/403/200");
});

test("logged-in API baselines do not produce anonymous comparison percentages", () => {
  for (const path of ["/api/study?scope=overview", "/api/study?scope=theories&exam=SQLD", "/api/sw-study?view=summary"]) {
    const target = { path, kind: "api", baseline: { serverMs: 400 } };
    const baseline = publicLatencyBaseline(target, { site: options.base, apis: [{ api: path, serverMs: 400 }] }, options);
    const summary = summarizeLatencyRuns(target, [run(200)], baseline);
    assert.equal(summary.change, "");
    assert.equal(summary.baselineServerMs, null);
    assert.equal(summary.comparisonUnavailable, "no comparable anonymous API baseline");
  }
});

test("public health baseline arrays are aggregated and missing timings stay unavailable", () => {
  const target = { path: "/api/health", kind: "api", baseline: { serverMs: 184 } };
  const baseline = publicLatencyBaseline(target, { site: options.base, apis: [{ api: target.path, serverMs: [177, 188] }] }, options);
  assert.equal(baseline.values.serverMs, 182.5);
  assert.match(baseline.source, /supplied baseline/u);
  const summary = summarizeLatencyRuns(target, [{ status: 200, ttfbMs: 40, bytes: 10, serverTiming: {} }], baseline);
  assert.equal(summary.change, "");
  assert.equal(summary.comparisonUnavailable, "timing metric unavailable");
});

test("page baseline provenance and connection/site incompatibility are explicit", () => {
  const document = { site: options.base, pages: [{ path: page.path, medMs: 35 }], apis: [] };
  assert.equal(publicLatencyBaseline(page, document, options).values.ttfbMs, 60);
  assert.match(publicLatencyBaseline(page, document, options).source, /embedded anonymous/u);
  for (const changed of [{ ...options, keepAlive: true }, { ...options, base: "https://preview.invalid" }]) {
    const summary = summarizeLatencyRuns(page, [run(200)], publicLatencyBaseline(page, document, changed));
    assert.equal(summary.change, "");
    assert.equal(summary.baselineTtfbMs, null);
    assert.ok(summary.comparisonUnavailable);
  }
});
