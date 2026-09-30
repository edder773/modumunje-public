import { readFeatureSource } from "./helpers/feature-source.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  createLatestRequestCoordinator,
  isExpectedRequestCancellation,
} from "../packages/shared/src/runtime/latest-request-coordinator.mjs";
import { createLatestValueQueue } from "../packages/shared/src/runtime/latest-value-queue.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function source(file) {
  return readFeatureSource(path.join(projectRoot, file), "utf8");
}

test("latest request leases abort superseded work and reject stale UI commits", () => {
  const coordinator = createLatestRequestCoordinator();
  const first = coordinator.begin("content");
  const independent = coordinator.begin("questions");
  const latest = coordinator.begin("content");

  assert.equal(first.signal.aborted, true);
  assert.equal(first.isCurrent(), false);
  assert.equal(independent.isCurrent(), true);
  assert.equal(latest.isCurrent(), true);

  coordinator.cancelAll("navigation");
  assert.equal(independent.isCurrent(), false);
  assert.equal(latest.isCurrent(), false);
  assert.equal(isExpectedRequestCancellation({ code: "REQUEST_ABORTED" }), true);
  assert.equal(isExpectedRequestCancellation({ name: "AbortError" }), true);
});

test("latest value queue serializes writes and coalesces rapid state changes", async () => {
  let releaseFirst;
  let active = 0;
  let maxActive = 0;
  const writes = [];
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const queue = createLatestValueQueue(async (_key, value) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    writes.push(value);
    if (value === 1) await firstGate;
    active -= 1;
  });

  const first = queue.enqueue("session", 1);
  await Promise.resolve();
  const second = queue.enqueue("session", 2);
  const third = queue.enqueue("session", 3);
  releaseFirst();
  await Promise.all([first, second, third]);

  assert.deepEqual(writes, [1, 3]);
  assert.equal(maxActive, 1);
  assert.equal(queue.hasPending("session"), false);
});

test("failed latest writes remain retryable without changing their order", async () => {
  let fail = true;
  const writes = [];
  const queue = createLatestValueQueue(async (_key, value) => {
    writes.push(value);
    if (fail) throw new Error("offline");
  });

  await assert.rejects(queue.enqueue("session", "draft"), /offline/u);
  assert.equal(queue.hasPending("session"), true);
  fail = false;
  await queue.retry("session");
  assert.deepEqual(writes, ["draft", "draft"]);
  assert.equal(queue.hasPending("session"), false);
});

test("SQL and SW screens enforce cancellation, single-flight, and ordered saves", () => {
  const study = source("apps/frontend/src/features/study/components/study-app.tsx");
  const sw = source("apps/frontend/src/features/study/components/sw-curriculum-planner.tsx");
  const swRunner = source("apps/frontend/src/features/study/components/sw-question-runners.tsx");

  assert.match(study, /createLatestRequestCoordinator/u);
  assert.match(study, /isExpectedRequestCancellation/u);
  assert.match(study, /selectedExamSaveQueue\.enqueue/u);
  assert.doesNotMatch(study, /theoryProgressSaveQueue\.enqueue/u);
  assert.match(study, /bookmarkSaveQueue\.enqueue/u);
  assert.match(study, /examStartingRef\.current/u);
  assert.match(study, /practiceGradingRef\.current/u);
  assert.match(study, /key=\{`\$\{userKeyHash\}:\$\{selectedField\.id\}`\}/u);

  assert.match(sw, /createLatestValueQueue/u);
  assert.match(sw, /swSessionSaveQueue\.enqueue/u);
  assert.match(sw, /swFinalizingRef\.current/u);
  assert.match(sw, /swGradingRequestsRef\.current/u);
  assert.match(sw, /addEventListener\("online"/u);
  assert.match(swRunner, /제출 처리 중/u);
  assert.match(swRunner, /채점 중/u);
});
