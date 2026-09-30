import assert from "node:assert/strict";
import test from "node:test";
import { automatedAnalyticsAgent } from "../packages/shared/src/runtime/analytics-agent";
import { POST } from "../apps/backend/src/modules/events/events.service";
import { trackEvent } from "../apps/frontend/src/features/study/telemetry/study-telemetry";

test("automation events are discarded before any server analytics read or write", async () => {
  let reads = 0;
  const repository = { analyticsEnabled: async () => { reads += 1; return false; } } as Parameters<typeof POST>[1];
  for (const agent of ["Googlebot/2.1", "Mozilla/5.0 HeadlessChrome/140", "Lighthouse", "ExampleCrawler"]) {
    assert.equal(automatedAnalyticsAgent(agent), true);
    const response = await POST(new Request("https://modumunje.com/api/events", { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": agent }, body: "{}" }), repository);
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  }
  assert.equal(reads, 0);
  await POST(new Request("https://modumunje.com/api/events", { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0 Chrome/140 Safari/537.36" }, body: "{}" }), repository);
  assert.equal(reads, 1);
});

test("webdriver and privacy preferences prevent client storage and event transmission", () => {
  const names = ["window", "navigator", "fetch"] as const;
  const originals = names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  let calls = 0;
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: () => { calls += 1; throw Error("unexpected network"); } });
  try {
    for (const navigator of [{ webdriver: true, userAgent: "Chrome" }, { webdriver: false, userAgent: "HeadlessChrome" }, { userAgent: "Chrome", doNotTrack: "1" }, { userAgent: "Chrome", globalPrivacyControl: true }]) {
      Object.defineProperty(globalThis, "navigator", { configurable: true, value: navigator });
      assert.doesNotThrow(() => trackEvent({ eventType: "page_view" }));
    }
    assert.equal(calls, 0);
  } finally {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
