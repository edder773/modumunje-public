import assert from "node:assert/strict";
import test, { after } from "node:test";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";
import { sqliteD1 } from "./helpers/sqlite-d1.mjs";
const database = openCanonicalTestDatabase(process.cwd());
after(() => database.close());

const { default: worker } = await import("../dist/server/index.js");
const origin = "https://modumunje.com";
const env = { DB: sqliteD1(database), ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };
const context = { waitUntil() {}, passThroughOnException() {} };

function read(path, userAgent = "BaeumzipIndexingAudit/1.0") {
  return worker.fetch(new Request(new URL(path, origin), {
    headers: { accept: "text/html", "user-agent": userAgent },
  }), env, context);
}

function attribute(tag, name) {
  return tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`, "iu"))?.[1] ?? "";
}

function canonicalUrls(html) {
  return [...html.matchAll(/<link\b[^>]*>/giu)]
    .map(([tag]) => attribute(tag, "rel") === "canonical" ? attribute(tag, "href") : "")
    .filter(Boolean);
}

test("initial HTML advertises the PNG favicon and the conventional path redirects to it", async () => {
  const html = await (await read("/")).text();
  const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/iu)?.[1] ?? "";
  const icons = [...head.matchAll(/<link\b[^>]*>/giu)]
    .map(([tag]) => tag).filter(tag => attribute(tag, "rel") === "icon");
  assert.equal(icons.length, 1);
  assert.equal(attribute(icons[0], "href"), "/favicon.png");
  assert.equal(attribute(icons[0], "type"), "image/png");
  assert.equal(attribute(icons[0], "sizes"), "96x96");
  const response = await read("/favicon.ico");
  assert.equal(response.status, 308);
  assert.equal(response.headers.get("location"), `${origin}/favicon.png`);
});

test("every sitemap page renders its own title, one primary heading and indexable canonical", async (t) => {
  const sitemap = await read("/sitemap.xml");
  assert.equal(sitemap.status, 200);
  const urls = [...(await sitemap.text()).matchAll(/<loc>([^<]+)<\/loc>/gu)].map((match) => match[1]);
  assert.ok(urls.length >= 9);
  assert.equal(new Set(urls).size, urls.length);
  const titles = new Set();
  for (const url of urls) {
    assert.equal(new URL(url).origin, origin);
    assert.doesNotMatch(new URL(url).pathname, /^\/(?:admin|api)(?:\/|$)/u);
    const response = await read(url);
    assert.equal(response.status, 200, url);
    assert.doesNotMatch(response.headers.get("x-robots-tag") ?? "", /noindex/iu, url);
    const html = await response.text();
    assert.doesNotMatch(html, /학습 화면을 불러오지 못했습니다/u, url);
    const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/iu)?.[1] ?? "";
    assert.equal(canonicalUrls(head).length, 1, `canonical must be in the initial head: ${url}`);
    const canonical = canonicalUrls(html);
    assert.equal(canonical.length, 1, url);
    assert.equal(new URL(canonical[0]).href, url, url);
    assert.equal([...html.matchAll(/<h1\b/giu)].length, 1, url);
    const robots = [...html.matchAll(/<meta\b[^>]*>/giu)]
      .filter(([tag]) => ["robots", "googlebot"].includes(attribute(tag, "name")))
      .map(([tag]) => attribute(tag, "content"));
    assert.ok(robots.length > 0, url);
    assert.doesNotMatch(robots.join(","), /noindex|none/iu, url);
    const title = html.match(/<title>([^<]+)<\/title>/u)?.[1];
    assert.ok(title, url);
    assert.ok(!titles.has(title), `duplicate title: ${title}`);
    titles.add(title);
  }
  t.diagnostic(`${urls.length}/${urls.length} public sitemap URLs verified`);
});

test("private learning pages expose exclusion headers to crawlers while preserving the authentication gate", async () => {
  const robots = await (await read("/robots.txt")).text();
  assert.doesNotMatch(robots, /^Disallow:\s*\/learn\/?\s*$/mu);
  assert.match(robots, /^Disallow:\s*\/api\//mu);
  for (const path of ["/learn/sql/sqld/practice", "/learn/sql/sqlp/mock-exams"]) {
    const response = await read(path, "Googlebot");
    assert.equal(response.status, 307, path);
    assert.match(response.headers.get("x-robots-tag") ?? "", /noindex/u, path);
    assert.match(response.headers.get("location") ?? "", /\/login\?return_to=/u, path);
  }
  for (const path of ["/learn/sql/sqld/records", "/admin"]) {
    const response = await read(path, "Googlebot");
    assert.match(response.headers.get("x-robots-tag") ?? "", /noindex/u, path);
    assert.ok([302, 303, 307, 308].includes(response.status), path);
    assert.match(response.headers.get("location") ?? "", /\/login\?return_to=/u, path);
  }
  const api = await read("/api/study?scope=records");
  assert.equal(api.status, 401);
  assert.equal((await api.json()).code, "AUTHENTICATION_REQUIRED");
});

test("missing and malformed URLs return real 404s without claiming the home page as canonical", async () => {
  for (const path of ["/$", "/&", "/nonexistent-audit-page", "/guides/nonexistent-audit-course", "/learn/invalid-audit-route"]) {
    const response = await read(path);
    assert.equal(response.status, 404, path);
    const html = await response.text();
    assert.deepEqual(canonicalUrls(html), [], path);
    assert.match(html, /찾을 수 없습니다/u, path);
  }
});

test("canonical redirects preserve deep paths and tracking parameters without indexing duplicates", async () => {
  for (const host of ["https://baeumzip.site", "https://www.baeumzip.site", "https://www.modumunje.com", "https://sqlp-study-lab.edder773.chatgpt.site", "http://modumunje.com"]) {
    const response = await read(`${host}/guides/sqld?utm_source=audit`);
    assert.equal(response.status, 308);
    assert.equal(response.headers.get("location"), `${origin}/guides/sqld?utm_source=audit`);
  }
  for (const path of ["/guides/sqld?utm_source=audit", "/?auth_error=google_state_invalid"]) {
    const response = await read(path);
    assert.equal(response.status, 200);
    assert.equal(new URL(canonicalUrls(await response.text())[0]).href, new URL(path.split("?")[0], origin).href);
  }
});
