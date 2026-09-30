import assert from "node:assert/strict";
import { test } from "node:test";
import { tsImport } from "tsx/esm/api";
const { ApiRequestError, requestJson } = await tsImport("../apps/frontend/src/shared/api/request-json.ts", import.meta.url);
const options = { failureMessage: "failed", invalidResponseMessage: "invalid response" };

test("successful malformed JSON retains response context without retrying a mutation", async () => {
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return new Response("{", { status: 201, headers: { "content-type": "application/json", "x-request-id": "parse-test" } });
  };
  try {
    await assert.rejects(requestJson("https://local.test/api/study", { method: "POST" }, options), error => {
      assert.ok(error instanceof ApiRequestError);
      assert.equal(error.code, "INVALID_API_RESPONSE");
      assert.equal(error.status, 201);
      assert.equal(error.requestId, "parse-test");
      assert.equal(error.retryable, false);
      return true;
    });
    assert.equal(requests, 1);
  } finally { globalThis.fetch = original; }
});

test("explicit cancellation during JSON parsing takes precedence over ambiguous success", async () => {
  const original = globalThis.fetch;
  const controller = new AbortController();
  globalThis.fetch = async () => ({
    ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }),
    async json() { controller.abort(); throw new SyntaxError("truncated JSON"); },
  });
  try {
    await assert.rejects(requestJson("https://local.test/api/study", { signal: controller.signal }, options), error => {
      assert.equal(error.code, "REQUEST_ABORTED");
      return true;
    });
  } finally { globalThis.fetch = original; }
});

test("unrelated client errors are not classified as malformed successful responses", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("unexpected local failure"); };
  try {
    await assert.rejects(requestJson("https://local.test/api/study", {}, options), error => {
      assert.equal(error.code, "UNEXPECTED_CLIENT_ERROR");
      assert.equal(error.status, undefined);
      return true;
    });
  } finally { globalThis.fetch = original; }
});


test("API timing and retry events keep their public names and payloads", async () => {
  const originalFetch = globalThis.fetch;
  const originalDispatch = globalThis.dispatchEvent;
  const events = [];
  let requests = 0;
  globalThis.dispatchEvent = event => { events.push({ type: event.type, detail: event.detail }); return true; };
  globalThis.fetch = async () => {
    requests += 1;
    return requests === 1
      ? Response.json({ error: "temporary", code: "TEMPORARY" }, { status: 503 })
      : Response.json({ ok: true }, { headers: { "x-request-id": "event-test", "cf-cache-status": "MISS" } });
  };
  try {
    await requestJson("https://local.test/api/study?scope=shell", {}, { ...options, maxAttempts: 2 });
    assert.deepEqual(events.map(event => event.type), ["baeumzip:api-retrying", "baeumzip:api-timing"]);
    assert.equal(events[0].detail.route, "/api/study");
    assert.equal(events[0].detail.attempt, 2);
    assert(events[0].detail.delayMs >= 250 && events[0].detail.delayMs <= 500);
    assert.equal(events[1].detail.outcome, "success");
    assert.equal(events[1].detail.status, 200);
    assert.equal(events[1].detail.retries, 1);
    assert.equal(events[1].detail.requestId, "event-test");
    assert.equal(events[1].detail.cacheSource, "MISS");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalDispatch === undefined) delete globalThis.dispatchEvent;
    else globalThis.dispatchEvent = originalDispatch;
  }
});
