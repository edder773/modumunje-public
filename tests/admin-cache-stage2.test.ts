import assert from "node:assert/strict";
import test from "node:test";
import {
  apiAction,
  apiGet,
  invalidateAdminGetCache,
} from "../apps/frontend/src/features/admin/model/admin-api-client";

type FetchHandler = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function jsonResponse(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function withFetch(handler: FetchHandler, run: () => Promise<void>) {
  const previousFetch = globalThis.fetch;
  invalidateAdminGetCache();
  globalThis.fetch = handler as typeof fetch;
  try {
    await run();
  } finally {
    invalidateAdminGetCache();
    globalThis.fetch = previousFetch;
  }
}

test("resource invalidation ignores query order and preserves unrelated cache entries", async () => {
  const requests: string[] = [];
  await withFetch(async (input) => {
    requests.push(String(input));
    return jsonResponse({ request: requests.length });
  }, async () => {
    const resourceFirst = new URLSearchParams({ resource: "ignored", order: "first" });
    const resourceLast = new URLSearchParams({ order: "last" });
    await apiGet("quality", resourceFirst);
    await apiGet("quality", resourceLast);
    await apiGet("dashboard", new URLSearchParams({ range: "7d" }));

    invalidateAdminGetCache({ resource: "quality" });

    await apiGet("quality", resourceFirst);
    await apiGet("quality", resourceLast);
    await apiGet("dashboard", new URLSearchParams({ range: "7d" }));
    assert.equal(requests.filter((url) => url.includes("resource=quality")).length, 4);
    assert.equal(requests.filter((url) => url.includes("resource=dashboard")).length, 1);
  });
});

test("normal reads deduplicate in-flight work and reuse the 15-second completed result", async () => {
  let requestCount = 0;
  let release: ((response: Response) => void) | undefined;
  await withFetch(async () => {
    requestCount += 1;
    return new Promise<Response>((resolve) => {
      release = resolve;
    });
  }, async () => {
    const first = apiGet("dashboard");
    const second = apiGet("dashboard");
    assert.equal(requestCount, 1);
    release?.(jsonResponse({ request: 1 }));
    assert.deepEqual(await first, { request: 1 });
    assert.deepEqual(await second, { request: 1 });
    assert.deepEqual(await apiGet("dashboard"), { request: 1 });
    assert.equal(requestCount, 1);
  });
});

test("normal completed reads expire after the 15-second TTL", async () => {
  const realDateNow = Date.now;
  let timestamp = 1_000_000;
  let requestCount = 0;
  Date.now = () => timestamp;
  try {
    await withFetch(async () => {
      requestCount += 1;
      return jsonResponse({ request: requestCount });
    }, async () => {
      assert.deepEqual(await apiGet("dashboard"), { request: 1 });
      timestamp += 15_000;
      assert.deepEqual(await apiGet("dashboard"), { request: 2 });
      assert.equal(requestCount, 2);
    });
  } finally {
    Date.now = realDateNow;
  }
});

test("forced quality scans bypass completed client results", async () => {
  let requestCount = 0;
  await withFetch(async () => {
    requestCount += 1;
    return jsonResponse({ request: requestCount, cached: false });
  }, async () => {
    const forcedGet = apiGet as unknown as <T>(
      resource: string,
      params?: URLSearchParams,
      options?: { bypassCache?: boolean },
    ) => Promise<T>;
    const params = new URLSearchParams({ refresh: "1" });
    assert.deepEqual(await forcedGet("quality", params, { bypassCache: true }), {
      request: 1,
      cached: false,
    });
    assert.deepEqual(await forcedGet("quality", params, { bypassCache: true }), {
      request: 2,
      cached: false,
    });
    assert.equal(requestCount, 2);
  });
});

test("a late rejected request cannot evict the newer result for the same key", async () => {
  let requestCount = 0;
  let rejectOld: ((error: Error) => void) | undefined;
  let resolveNew: ((response: Response) => void) | undefined;
  await withFetch(async () => {
    requestCount += 1;
    if (requestCount === 1) {
      return new Promise<Response>((_resolve, reject) => {
        rejectOld = reject;
      });
    }
    if (requestCount > 2) return jsonResponse({ request: requestCount });
    return new Promise<Response>((resolve) => {
      resolveNew = resolve;
    });
  }, async () => {
    const oldRequest = apiGet("quality");
    invalidateAdminGetCache();
    const newRequest = apiGet<{ request: number }>("quality");
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(requestCount, 2);
    assert.ok(resolveNew);
    resolveNew(jsonResponse({ request: 2 }));
    assert.deepEqual(await newRequest, { request: 2 });
    assert.ok(rejectOld);
    rejectOld(new TypeError("old request failed"));
    await assert.rejects(oldRequest);
    assert.deepEqual(await apiGet("quality"), { request: 2 });
    assert.equal(requestCount, 2);
  });
});

test("failed reads retry, successful mutations invalidate, and permission loss clears prior reads", async () => {
  let requestCount = 0;
  let dashboardVersion = 0;
  let failTransient = true;
  await withFetch(async (input, init) => {
    requestCount += 1;
    if (init?.method === "POST") return jsonResponse({ ok: true });
    const url = new URL(String(input), "https://app.local");
    if (url.searchParams.get("resource") === "transient" && failTransient) {
      failTransient = false;
      return jsonResponse({ error: "temporary" }, 500);
    }
    if (url.searchParams.get("resource") === "permission-check") {
      return jsonResponse({ error: "forbidden" }, 403);
    }
    if (url.searchParams.get("resource") === "dashboard") {
      dashboardVersion += 1;
      return jsonResponse({ version: dashboardVersion });
    }
    return jsonResponse({ ok: true });
  }, async () => {
    await assert.rejects(apiGet("transient"));
    assert.deepEqual(await apiGet("transient"), { ok: true });

    assert.deepEqual(await apiGet("dashboard"), { version: 1 });
    await apiAction("settings-update", { site_notice: "" });
    assert.deepEqual(await apiGet("dashboard"), { version: 2 });

    await assert.rejects(apiGet("permission-check"));
    assert.deepEqual(await apiGet("dashboard"), { version: 3 });
    assert.equal(requestCount, 7);
  });
});
