import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  ensureCanonicalDatabaseCache,
  TEST_DATABASE_ENV,
} from "./lib/canonical-database.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const deepTestNames = new Set([
  "admin-export-worker.test.mjs",
  "admin-export.test.mjs",
  "content-delivery-stage9.test.mjs",
  "content-release-gate.test.mjs",
  "content-release-pipeline.test.mjs",
  "course-content-release-stage3.test.mjs",
  "sw-profile-query-performance.test.mjs",
  "theory-summary-report-overflow-round40.test.mjs",
]);
const browserTestNames = new Set([
  "ipe-public-assets.test.mjs",
]);
const serialTestNames = new Set([
  "study-query-integration.test.mjs",
  // Keep latency samples free of CPU contention from parallel database fixtures.
  "sw-profile-query-performance.test.mjs",
]);
const suiteIndex = process.argv.indexOf("--suite");
const requestedSuite = suiteIndex >= 0 ? process.argv[suiteIndex + 1] : "";
let testFiles = process.argv.slice(2);
if (suiteIndex >= 0) {
  if (!new Set(["all", "fast", "deep", "browser"]).has(requestedSuite)) {
    throw new Error("--suite must be all, fast, deep, or browser");
  }
  const allTests = fs.readdirSync(path.join(root, "tests"))
    .filter((name) => name.endsWith(".test.mjs"))
    .sort();
  let selected;
  if (requestedSuite === "all") {
    selected = allTests;
  } else if (requestedSuite === "deep") {
    selected = allTests.filter((name) => deepTestNames.has(name));
  } else if (requestedSuite === "browser") {
    selected = allTests.filter((name) => browserTestNames.has(name));
  } else {
    selected = allTests.filter((name) => (
      !deepTestNames.has(name) && !browserTestNames.has(name)
    ));
  }
  testFiles = selected.map((name) => path.join("tests", name));
}
if (testFiles.length === 0) throw new Error("At least one test file is required");
const testConcurrency = process.env.TEST_CONCURRENCY?.trim() || "4";
if (!/^\d+$/u.test(testConcurrency) || Number(testConcurrency) < 1) {
  throw new Error("TEST_CONCURRENCY must be a positive integer");
}

let fixture = process.env[TEST_DATABASE_ENV]?.trim();
if (!fixture && requestedSuite !== "browser") {
  const cached = ensureCanonicalDatabaseCache(
    root,
    path.join(root, ".ci-artifacts", "test-database-cache"),
  );
  fixture = cached.databaseFile;
  console.log(`[test-db] ${cached.reused ? "reused" : "created"} ${cached.fingerprint.slice(0, 12)}`);
  if (cached.pruned > 0) console.log(`[test-db] pruned ${cached.pruned} stale cache file(s)`);
}

// These tests exercise TypeScript services directly and need the same alias
// resolver as the registered TS suite. They remain part of every selected suite.
const tsxTestNames = new Set(["public-theory-roundtrips.test.mjs", "record-read-roundtrips.test.mjs", "deployed-skct-bank-activation.test.mjs"]);
function run(files, concurrency, useTsx = false) {
  if (files.length === 0) return 0;
  const result = spawnSync(
    process.execPath,
    [...(useTsx ? ["--import", "tsx"] : []), "--test", `--test-concurrency=${concurrency}`, ...files],
    {
      cwd: root,
      env: fixture
        ? { ...process.env, [TEST_DATABASE_ENV]: path.resolve(fixture) }
        : process.env,
      stdio: "inherit",
    },
  );
  if (result.error) throw result.error;
  return result.status ?? 1;
}

const serialFiles = testFiles.filter((file) => serialTestNames.has(path.basename(file)));
const tsxFiles = testFiles.filter(file => tsxTestNames.has(path.basename(file)));
const parallelFiles = testFiles.filter((file) => !serialTestNames.has(path.basename(file)) && !tsxTestNames.has(path.basename(file)));
const parallelStatus = run(parallelFiles, testConcurrency);
const tsxStatus = run(tsxFiles, testConcurrency, true);
const serialStatus = run(serialFiles, "1");
process.exitCode = parallelStatus || tsxStatus || serialStatus;
