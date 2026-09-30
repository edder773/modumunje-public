import assert from "node:assert/strict";
import test from "node:test";
import {
  checkDistributedRateLimit,
  createLocalFixedWindowLimiter,
} from "../apps/backend/src/modules/events/events-rate-limit.mjs";

const LIMIT = 120;
const WINDOW_MS = 60_000;
const NOW = Date.parse("2026-08-24T00:01:00.000Z");

function localLimit() {
  return createLocalFixedWindowLimiter({ limit: LIMIT, windowMs: WINDOW_MS });
}

test("event rate limiter uses a shared binding and does not query D1 on success", async () => {
  let databaseReads = 0;
  const decision = await checkDistributedRateLimit({
    key: "session-hash",
    limit: LIMIT,
    windowMs: WINDOW_MS,
    localLimit: localLimit(),
    rateLimitBinding: { limit: async () => ({ success: true }) },
    countRecent: async () => databaseReads += 1,
    now: NOW,
  });

  assert.deepEqual(decision, { allowed: true, retryAfterSeconds: 0, source: "binding" });
  assert.equal(databaseReads, 0);
});

test("event rate limiter returns the binding denial at the boundary", async () => {
  const decision = await checkDistributedRateLimit({
    key: "session-hash",
    limit: LIMIT,
    windowMs: WINDOW_MS,
    localLimit: localLimit(),
    rateLimitBinding: { limit: async () => ({ success: false }) },
    countRecent: async () => assert.fail("D1 fallback must not override a binding denial"),
    now: NOW,
  });

  assert.deepEqual(decision, { allowed: false, retryAfterSeconds: 60, source: "binding" });
});

test("event rate limiter falls back to shared D1 state when the binding fails", async () => {
  let observedSince = "";
  let observedError;
  const decision = await checkDistributedRateLimit({
    key: "session-hash",
    limit: LIMIT,
    windowMs: WINDOW_MS,
    localLimit: localLimit(),
    rateLimitBinding: { limit: async () => { throw new Error("binding unavailable"); } },
    countRecent: async (since) => {
      observedSince = since;
      return LIMIT;
    },
    onBindingError: (error) => { observedError = error; },
    now: NOW,
  });

  assert.equal(observedSince, "2026-08-24T00:00:00.000Z");
  assert.match(String(observedError), /binding unavailable/u);
  assert.deepEqual(decision, { allowed: false, retryAfterSeconds: 60, source: "d1" });
});

test("event rate limiter uses D1 when Sites does not provide the binding", async () => {
  const allowed = await checkDistributedRateLimit({
    key: "session-a",
    limit: LIMIT,
    windowMs: WINDOW_MS,
    localLimit: localLimit(),
    countRecent: async () => LIMIT - 1,
    now: NOW,
  });
  const denied = await checkDistributedRateLimit({
    key: "session-b",
    limit: LIMIT,
    windowMs: WINDOW_MS,
    localLimit: localLimit(),
    countRecent: async () => LIMIT,
    now: NOW,
  });

  assert.equal(allowed.allowed, true);
  assert.deepEqual(denied, { allowed: false, retryAfterSeconds: 60, source: "d1" });
});

test("local first layer stops a same-isolate burst without shared-store reads", async () => {
  const local = createLocalFixedWindowLimiter({ limit: 2, windowMs: WINDOW_MS });
  let databaseReads = 0;
  const options = {
    key: "burst-key",
    limit: LIMIT,
    windowMs: WINDOW_MS,
    localLimit: local,
    countRecent: async () => databaseReads += 1,
    now: NOW,
  };

  assert.equal((await checkDistributedRateLimit(options)).allowed, true);
  assert.equal((await checkDistributedRateLimit(options)).allowed, true);
  const denied = await checkDistributedRateLimit(options);
  assert.equal(denied.allowed, false);
  assert.equal(denied.source, "local");
  assert.equal(databaseReads, 2);
});
