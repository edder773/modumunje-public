import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import useStudySaveOperations from "../apps/frontend/src/features/study/model/use-study-save-operations";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function harness() {
  const retrySaveQueue = new Map<string, () => Promise<void>>();
  let operations!: ReturnType<typeof useStudySaveOperations>;
  function Probe() {
    operations = useStudySaveOperations({ retrySaveQueue, setSaveStatus: () => {} });
    return null;
  }
  renderToString(createElement(Probe));
  return { operations, retrySaveQueue };
}

test("account save retries share one in-flight request", async () => {
  const previousWindow = globalThis.window;
  globalThis.window = globalThis as unknown as Window & typeof globalThis;
  try {
    const { operations, retrySaveQueue } = harness();
    const gate = deferred();
    let calls = 0;
    await assert.rejects(operations.runTrackedAccountSave(async () => {
      calls += 1;
      if (calls === 1) throw new Error("offline");
      await gate.promise;
    }, { operationId: "same-save" }));
    const retry = retrySaveQueue.get("same-save")!;
    const first = retry();
    const second = retry();
    const concurrentCalls = calls;
    gate.resolve();
    await Promise.all([first, second]);
    assert.equal(concurrentCalls, 2);
    assert.equal(retrySaveQueue.size, 0);
  } finally {
    globalThis.window = previousWindow;
  }
});

test("an older success cannot remove a newer save's retry entry", async () => {
  const previousWindow = globalThis.window;
  globalThis.window = globalThis as unknown as Window & typeof globalThis;
  try {
    const { operations, retrySaveQueue } = harness();
    const gate = deferred();
    const first = operations.runTrackedAccountSave(() => gate.promise, { operationId: "exam-save:session" });
    await assert.rejects(operations.runTrackedAccountSave(async () => {
      throw new Error("newer write failed");
    }, { operationId: "exam-save:session" }));
    const newerRetry = retrySaveQueue.get("exam-save:session");
    gate.resolve();
    await first;
    assert.equal(retrySaveQueue.get("exam-save:session"), newerRetry);
  } finally {
    globalThis.window = previousWindow;
  }
});
