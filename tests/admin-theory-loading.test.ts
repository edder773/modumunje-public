import assert from "node:assert/strict";
import test from "node:test";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";
import { sqliteD1 } from "./helpers/sqlite-d1.mjs";
import { loadAdminTheory } from "../apps/frontend/src/features/admin/model/admin-theory-loader";
import { invalidateAdminGetCache } from "../apps/frontend/src/features/admin/model/admin-api-client";

test("lightweight theory lists preserve every field, filter and count while full details remain available", async () => {
  const database = openCanonicalTestDatabase(process.cwd());
  Object.defineProperty(globalThis, "__BAEUMZIP_APP_VERSION__", { value: "admin-theory-loading-test", configurable: true });
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(database) as unknown as D1Database };
  const { readTheoryList, readSwTheoryAdminList } = await import("../apps/backend/src/modules/admin/admin-read-use-cases");
  for (const domain of ["sql", "da", "bae", "ipe", "sw"]) {
    const read = domain === "sw" ? readSwTheoryAdminList : readTheoryList;
    for (const page of [1,2]) {
      const url = new URL(`https://example.test/api/admin?contentDomain=${domain}&active=active&page=${page}&pageSize=20`);
      const full = await read(url);
      url.searchParams.set("view", "summary");
      const list = await read(url);
      assert.deepEqual(list.pagination, full.pagination);
      assert.deepEqual(list.items.map(item => item.id), full.items.map(item => item.id));
      assert.ok(Buffer.byteLength(JSON.stringify(list)) < Buffer.byteLength(JSON.stringify(full)) / 5);
      for (const [index, item] of list.items.entries()) {
        const original = full.items[index];
        for (const key of ["title", "summary", "category", "topic", "active", "sortOrder", "linkedQuestions"]) assert.deepEqual((item as Record<string, unknown>)[key], (original as Record<string, unknown>)[key]);
        assert.equal("content" in item, false);
        assert.equal("review_answers" in item, false);
        const detailUrl = new URL(`https://example.test/api/admin?contentDomain=${domain}&id=${item.id}`);
        const detail = await read(detailUrl);
        assert.equal(detail.items.length, 1);
        assert.equal((detail.items[0] as Record<string, unknown>).content, (original as Record<string, unknown>).content);
        assert.ok("reviewAnswers" in detail.items[0] && "reviewAnswers" in original);
        assert.equal(detail.items[0].reviewAnswers, original.reviewAnswers);
        assert.ok("keywords" in detail.items[0] && "keywords" in original);
        assert.deepEqual(detail.items[0].keywords, original.keywords);
      }
    }
  }
  database.close();
});

test("every summary page stays under 20 KB and legacy 50-item links retain complete pagination", async () => {
  const database = openCanonicalTestDatabase(process.cwd());
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(database) as unknown as D1Database };
  const { readTheoryList, readSwTheoryAdminList } = await import("../apps/backend/src/modules/admin/admin-read-use-cases");
  try {
    for (const domain of ["sql", "da", "bae", "ipe", "ise", "sw"]) {
      const read = domain === "sw" ? readSwTheoryAdminList : readTheoryList;
      const seen = new Set<number>();
      let total = 0;
      let pages = 0;
      for (let page = 1; page <= Math.max(1, pages); page += 1) {
        const url = new URL(`https://example.test/api/admin?contentDomain=${domain}&active=active&page=${page}&pageSize=50&view=summary`);
        const result = await read(url);
        assert.equal(result.pagination.pageSize, 20, domain);
        assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 20 * 1024, `${domain} page ${page}`);
        assert.ok(result.items.length <= 20, domain);
        for (const item of result.items) {
          assert.equal(seen.has(item.id), false, `${domain}: duplicate ${item.id}`);
          seen.add(item.id);
          assert.equal("content" in item, false);
          assert.equal(Object.keys(item).some((key) => key.includes("_")), false);
        }
        total = result.pagination.total;
        pages = result.pagination.pages;
      }
      assert.equal(seen.size, total, domain);
    }
  } finally { globalThis.__BAEUMZIP_ENV__ = previous; database.close(); }
});

test("opening or editing a listed theory fetches one full body and reuses only its matching cache", async () => {
  const originalFetch = globalThis.fetch;
  const urls: URL[] = [];
  invalidateAdminGetCache();
  globalThis.fetch = async input => {
    const url = new URL(String(input), "https://example.test"); urls.push(url);
    assert.equal(url.searchParams.has("view"), false);
    return Response.json({ items: [{ id: Number(url.searchParams.get("id")), content: "본문", reviewAnswers: "복습 답안", keywords: ["키워드"] }] });
  };
  try {
    const theory = await loadAdminTheory("theories", 717, "sql");
    assert.equal(theory.content, "본문");
    assert.deepEqual(await loadAdminTheory("theories", 717, "sql"), theory);
    assert.equal(urls.length, 1);
    assert.equal(urls[0].searchParams.get("contentDomain"), "sql");
    await loadAdminTheory("sw-theories", 717);
    assert.equal(urls.length, 2);
    assert.equal(urls[1].searchParams.get("resource"), "sw-theories");
    invalidateAdminGetCache();
    await loadAdminTheory("theories", 717, "sql");
    assert.equal(urls.length, 3);
  } finally { globalThis.fetch = originalFetch; invalidateAdminGetCache(); }
});

test("a missing or summary-only detail cannot enter the editor", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const items of [[], [{id: 1, content: "다른 이론"}], [{id: 717, title: "요약만 있는 이론"}]]) {
      invalidateAdminGetCache();
      globalThis.fetch = async () => Response.json({items});
      await assert.rejects(loadAdminTheory("theories", 717, "sql"), /이론 본문을 불러오지 못했습니다/u);
    }
  } finally { globalThis.fetch = originalFetch; invalidateAdminGetCache(); }
});
