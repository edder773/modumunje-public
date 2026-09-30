import assert from "node:assert/strict";
import test, { after } from "node:test";
import crypto from "node:crypto";
import worker from "../dist/server/index.js";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";
import { sqliteD1 } from "./helpers/sqlite-d1.mjs";

const database = openCanonicalTestDatabase(process.cwd());
after(() => database.close());
const queries = [];
const origin = "https://modumunje.com";
const secret = "local-public-theory-regression-only";
const env = { DB: sqliteD1(database, queries), GOOGLE_AUTH_SESSION_SECRET: secret, ASSETS: { fetch: async () => new Response(null, { status: 404 }) } };
const context = { waitUntil() {}, passThroughOnException() {} };
function read(path, options = {}) { return worker.fetch(new Request(new URL(path, origin), { ...options, headers: { accept: "text/html", "user-agent": "Googlebot", ...options.headers } }), env, context); }
function cookie() {
  const now = Math.floor(Date.now() / 1000);
  const value = Buffer.from(JSON.stringify({ v: 1, sub: "theory-retirement-test", email: "theory-retirement@example.test", name: "Local Test", iat: now, exp: now + 3600 })).toString("base64url");
  return `__Host-baeumzip-google-session=${value}.${crypto.createHmac("sha256", secret).update(value).digest("base64url")}`;
}
function locations(xml) { return [...xml.matchAll(/<loc>([^<]+)<\/loc>/gu)].map((match) => match[1]); }

test("all active theory documents have public, indexable server HTML and one canonical sitemap entry", async (t) => {
  const sitemap = await read("/theory-sitemap.xml");
  assert.equal(sitemap.status, 200);
  assert.match(sitemap.headers.get("content-type"), /application\/xml/u);
  const urls = locations(await sitemap.text());
  const expected = database.prepare("SELECT COUNT(*) AS n FROM theories WHERE active = 1").get().n
    + database.prepare("SELECT COUNT(*) AS n FROM sw_theories WHERE active = 1").get().n;
  assert.equal(urls.length, expected);
  assert.equal(new Set(urls).size, expected);
  const samples = [];
  const start = performance.now();
  queries.length = 0;
  for (const url of urls) {
    const begin = performance.now();
    const response = await read(url);
    assert.equal(response.status, 200, url);
    assert.doesNotMatch(response.headers.get("x-robots-tag") ?? "", /noindex/u, url);
    const html = await response.text();
    const head = html.match(/<head[^>]*>([\s\S]*?)<\/head>/iu)?.[1] ?? "";
    assert.equal([...html.matchAll(/<h1\b/gu)].length, 1, url);
    assert.match(head, /<title>[^<]+\|[^<]*모두의 문제집<\/title>/u, url);
    assert.match(head, /name="robots" content="index, follow"/u, url);
    assert.ok(head.includes(`href="${url}"`), url);
    assert.match(html, /<article\b[\s\S]*<h2\b[\s\S]*<\/article>/u, url);
    assert.match(html, /<article class="card theory-reader"/u, url);
    assert.match(html, /class="theory-content"/u, url);
    const toc = html.match(/<nav class="theory-toc"[\s\S]*?<\/nav>/u)?.[0] ?? "";
    for (const [, id] of toc.matchAll(/href="#([^"]+)"/gu)) {
      assert.ok(html.includes(`id="${id}"`), `${url}: missing table-of-contents target ${id}`);
    }
    assert.doesNotMatch(html, /이론 학습 상태 선택|theory-progress-panel|TheoryCompletionControl/u, url);
    samples.push({ path: new URL(url).pathname, durationMs: +(performance.now() - begin).toFixed(2), bytes: Buffer.byteLength(html) });
  }
  assert.ok(queries.every(({ sql }) => !/\b(?:theory_progress|sw_theory_progress|user_accounts|user_settings|attempts)\b/u.test(sql)));
  t.diagnostic(JSON.stringify({ verified: urls.length, total: expected, totalMs: +(performance.now() - start).toFixed(1), maxHtmlBytes: Math.max(...samples.map((s) => s.bytes)), totalQueries: queries.length }));
});

test("all theory documents remain reachable through native category links without JavaScript", async (t) => {
  const lists = locations(await (await read("/sitemap.xml")).text()).filter((url) => url.endsWith("/theories"));
  assert.equal(lists.length, 9);
  const reachable = new Set();
  let categoryPages = 0;
  for (const list of lists) {
    const initial = await (await read(list)).text();
    const categories = initial.match(/<nav class="theory-category-tabs"[\s\S]*?<\/nav>/u)?.[0] ?? "";
    const paths = [...categories.matchAll(/href="([^"]+)"/gu)].map((match) => match[1].replaceAll("&amp;", "&"));
    if (list.includes("software-major")) paths.push(list);
    assert.ok(paths.length > 0, list);
    for (const path of paths) {
      const response = await read(path);
      assert.equal(response.status, 200, path);
      const html = await response.text();
      assert.match(html, /class="theory-grid(?: sw-theory-grid)?"/u, path);
      assert.match(html, /name="robots" content="index, follow"/u, path);
      const category = new URL(path, origin).searchParams.get("category");
      if (category) assert.ok(html.includes(`<span>${category}</span>`), path);
      const cards = [...html.matchAll(/<a(?=[^>]*class="card theory-card")[^>]*href="([^"]+)"/gu)];
      assert.ok(cards.length > 0, path);
      for (const [, href] of cards) reachable.add(new URL(href, origin).href);
      categoryPages += 1;
    }
  }
  const canonical = locations(await (await read("/theory-sitemap.xml")).text());
  for (const url of canonical) assert.ok(reachable.has(url), `No native category link reaches ${url}`);
  t.diagnostic(JSON.stringify({ collections: lists.length, categoryPages, reachableCanonicalDocuments: canonical.length }));
});

test("anonymous theory reads contain editorial content only and forged identity cannot unlock account records", async () => {
  for (const path of ["/api/study?scope=theories&exam=SQLD", "/api/study?scope=theory&exam=SQLD&id=1", "/api/sw-study?view=summary", "/api/sw-study?view=theories&subjects=algorithms"]) {
    // id=1 is allowed to be outside SQLD; nonexistent content stays a real 404.
    const response = await read(path);
    assert.ok([200, 404].includes(response.status), `${path}: ${response.status}`);
    const body = await response.json();
    assert.equal(body.questions?.length ?? 0, 0);
    assert.equal(body.attempts?.length ?? 0, 0);
    assert.equal(body.theoryProgress?.length ?? 0, 0);
    assert.doesNotMatch(JSON.stringify(body), /correctAnswers|selectedAnswers|userKey":"[^"\s]+/u);
  }
  for (const path of ["/api/study?scope=records", "/api/sw-study?view=state", "/api/admin?resource=questions"]) {
    const response = await read(path, { headers: { "x-baeumzip-authenticated-user-email": "theory-retirement@example.test" } });
    assert.equal(response.status, 401, path);
    assert.equal((await response.json()).code, "AUTHENTICATION_REQUIRED");
  }
});

test("private page gates preserve return destinations while invalid theory routes stay 404", async () => {
  for (const path of ["/learn/sql/sqld/records", "/learn/sql/sqld/bookmarks", "/admin/questions"]) {
    const response = await read(path);
    assert.ok([302, 303, 307, 308].includes(response.status), path);
    assert.match(response.headers.get("x-robots-tag"), /noindex/u);
    assert.ok(response.headers.get("location").includes(`return_to=${encodeURIComponent(path)}`));
  }
  for (const path of ["/learn/sql/sqld/theories/lesson-zzzzzz", "/learn/software-major/theories/lesson-zzzzzz", "/learn/sql/sqld/theories/bad-id"]) assert.equal((await read(path)).status, 404, path);
});

test("retired progress endpoints reject authenticated writes without recreating dropped progress tables", async () => {
  const email = "theory-retirement@example.test";
  const key = crypto.createHash("SHA-256").update(`sql-study-user:${email}`).digest("hex");
  const retiredTables = () => database.prepare("SELECT name FROM sqlite_master WHERE name IN ('theory_progress', 'sw_theory_progress')").all();
  assert.deepEqual(retiredTables(), []);
  for (const [path, action] of [["/api/study", "theory-progress"], ["/api/sw-study", "sw-progress"]]) {
    const response = await read(path, { method: "POST", headers: { Cookie: cookie(), Origin: origin, "Content-Type": "application/json", "x-sql-study-user-request": "1", "x-baeumzip-sw-owner": key }, body: JSON.stringify({ action, theoryId: 1, examType: "SQLD", completed: true }) });
    assert.equal(response.status, 410, JSON.stringify(await response.clone().json()));
    assert.equal((await response.json()).code, "THEORY_PROGRESS_RETIRED");
  }
  assert.deepEqual(retiredTables(), []);
});
