import assert from "node:assert/strict";
import test from "node:test";

import {
  createPublicContentCache,
} from "../apps/backend/src/common/content/public-content-cache";
import { readPracticeMeta } from "../apps/backend/src/modules/study/study-question-delivery";
import type { StudyRepository } from "../apps/backend/src/modules/study/study.repository";

test("stage 5 public cache deduplicates cold loads and keeps revisions independent", async () => {
  const cache = createPublicContentCache({ ttlMs: 60_000, maxItems: 8, maxBytes: 8_192 });
  let loads = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const loader = async () => {
    loads += 1;
    await gate;
    return { title: "공개 이론", content: "정답이 아닌 공개 본문" };
  };

  const first = cache.read({ namespace: "theory", key: "1", revision: "r1", loader });
  const second = cache.read({ namespace: "theory", key: "1", revision: "r1", loader });
  release();
  assert.deepEqual(await first, await second);
  assert.equal(loads, 1);

  await cache.read({ namespace: "theory", key: "1", revision: "r2", loader: async () => {
    loads += 1;
    return { title: "수정된 공개 이론" };
  } });
  assert.equal(loads, 2);
});

test("stage 5 invalidation prevents an older pending load from repopulating the cache", async () => {
  const cache = createPublicContentCache({ ttlMs: 60_000, maxItems: 8, maxBytes: 8_192 });
  let release!: () => void;
  const pending = cache.read({
    namespace: "overview",
    key: "all",
    revision: "r1",
    loader: async () => {
      await new Promise<void>((resolve) => { release = resolve; });
      return { value: "old" };
    },
  });
  await Promise.resolve();
  cache.invalidate();
  release();
  await pending;

  let freshLoads = 0;
  const fresh = await cache.read({
    namespace: "overview",
    key: "all",
    revision: "r1",
    loader: async () => {
      freshLoads += 1;
      return { value: "fresh" };
    },
  });
  assert.deepEqual(fresh, { value: "fresh" });
  assert.equal(freshLoads, 1);
});

test("stage 5 cache enforces item and byte limits", async () => {
  const cache = createPublicContentCache({ ttlMs: 60_000, maxItems: 2, maxBytes: 120 });
  for (const key of ["1", "2", "3"]) {
    await cache.read({
      namespace: "theory",
      key,
      revision: "r1",
      loader: async () => ({ text: key.repeat(12) }),
    });
  }
  assert.ok(cache.diagnostics().items <= 2);
  assert.ok(cache.diagnostics().bytes <= 120);

  await cache.read({
    namespace: "theory",
    key: "large",
    revision: "r1",
    loader: async () => ({ text: "x".repeat(256) }),
  });
  assert.equal(cache.diagnostics().keys.some((key) => JSON.parse(key)[2] === "large"), false);
});

test("cached and deduplicated reads return independent objects and expire on TTL", async (t) => {
  let now = 100;
  t.mock.method(Date, "now", () => now);
  const cache = createPublicContentCache({ ttlMs: 10, maxItems: 8, maxBytes: 1_024 });
  let loads = 0;
  const input = { namespace: "theory", key: "clone", revision: "r1", loader: async () => {
    loads += 1;
    return { nested: { title: "original" } };
  } };
  const [first, second] = await Promise.all([cache.read(input), cache.read(input)]);
  first.nested.title = "private mutation";
  assert.equal(second.nested.title, "original");
  assert.equal((await cache.read(input)).nested.title, "original");
  assert.equal(loads, 1);
  now = 110;
  await cache.read(input);
  assert.equal(loads, 2);
});

test("public cache peek keeps clone, TTL, eviction, and invalidation boundaries", async (t) => {
  let now = 100;
  t.mock.method(Date, "now", () => now);
  const cache = createPublicContentCache({ ttlMs: 10, maxItems: 2, maxBytes: 1_024 });
  assert.equal(cache.peek("theory", "one"), null);
  await cache.read({ namespace: "theory", key: "one", revision: "r1", loader: async () => ({ nested: { value: 1 } }) });
  const peeked = cache.peek<{ nested: { value: number } }>("theory", "one")!;
  assert.equal(peeked.revision, "r1");
  peeked.value.nested.value = 9;
  assert.equal(cache.peek<{ nested: { value: number } }>("theory", "one")!.value.nested.value, 1);
  assert.equal(cache.peek("other", "one"), null);
  await cache.read({ namespace: "theory", key: "two", revision: "r1", loader: async () => ({ value: 2 }) });
  cache.peek("theory", "one"); // Peek is an LRU touch, as read() is.
  await cache.read({ namespace: "theory", key: "three", revision: "r1", loader: async () => ({ value: 3 }) });
  assert.equal(cache.peek("theory", "two"), null);
  now = 110;
  assert.equal(cache.peek("theory", "one"), null);
  cache.invalidate();
  assert.equal(cache.peek("theory", "three"), null);
});

test("pending tracking is bounded and loader failures are retryable", async () => {
  const cache = createPublicContentCache({ ttlMs: 100, maxItems: 2, maxBytes: 1_024, maxPending: 1 });
  let release!: () => void;
  const pending = cache.read({ namespace: "theory", key: "slow", revision: "r1", loader: async () => {
    await new Promise<void>((resolve) => { release = resolve; });
    return "slow";
  } });
  assert.equal(await cache.read({ namespace: "theory", key: "overflow", revision: "r1", loader: async () => "overflow" }), "overflow");
  assert.equal(cache.diagnostics().pending, 1);
  release();
  await pending;
  const input = { namespace: "theory", key: "retry", revision: "r1" };
  await assert.rejects(cache.read({ ...input, loader: async () => { throw new Error("D1 unavailable"); } }));
  assert.equal(cache.diagnostics().pending, 0);
  assert.equal(await cache.read({ ...input, loader: async () => "recovered" }), "recovered");
});

test("stage 5 shares only public practice metadata while user settings stay per request", async () => {
  let publicReads = 0;
  let privateReads = 0;
  const repository = {
    async findPracticeMeta() {
      publicReads += 1;
      return {
        rows: [{ category: "SQL", difficulty: "basic", kind: "single", item_count: 3, eligible_group_count: 2 }],
        summary: { item_count: 3, eligible_group_count: 2 },
      };
    },
    async readUserSetting(userKey: string) {
      privateReads += 1;
      return { userKey, selectedExam: userKey === "user-a" ? "SQLD" : "SQLP" };
    },
  } as unknown as StudyRepository;

  const first = await readPracticeMeta(repository, "user-a", "SQLD", "stage5-practice-r1");
  const second = await readPracticeMeta(repository, "user-b", "SQLD", "stage5-practice-r1");
  assert.equal(publicReads, 1);
  assert.equal(privateReads, 2);
  assert.equal((first.settings as { userKey?: string }).userKey, "user-a");
  assert.equal((second.settings as { userKey?: string }).userKey, "user-b");
  assert.equal(JSON.stringify(first.practiceMeta).includes("correctAnswers"), false);
});
