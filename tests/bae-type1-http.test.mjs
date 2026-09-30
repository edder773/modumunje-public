import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import test, { after } from "node:test";
import worker from "../dist/server/index.js";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";
import { sqliteD1 } from "./helpers/sqlite-d1.mjs";

const database = openCanonicalTestDatabase(process.cwd());
after(() => database.close());
const origin = "https://modumunje.com", secret = "local-practice-http-test-only-session-secret";
const environment = { DB: sqliteD1(database), GOOGLE_AUTH_SESSION_SECRET: secret, ASSETS: { fetch: async request => {
  const filename = path.join(process.cwd(), "dist/client", new URL(request.url).pathname);
  if (!filename.startsWith(path.join(process.cwd(), "dist/client")) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) return new Response(null, { status: 404 });
  const contentType = filename.endsWith(".zip") ? "application/zip" : filename.endsWith(".json") ? "application/json" : "text/plain; charset=utf-8";
  return new Response(fs.readFileSync(filename), { headers: { "content-type": contentType } });
} } };
const context = { waitUntil() {}, passThroughOnException() {} };
const home = "/learn/big-data-analysis/bae-practical/home", workbook = "/learn/big-data-analysis/bae-practical/type-1";
function cookie() {
  const now = Math.floor(Date.now() / 1000);
  const value = Buffer.from(JSON.stringify({ v: 1, sub: "local-practice-test", email: "local-practice@example.test", name: "Local Test", iat: now, exp: now + 3600 })).toString("base64url");
  return `__Host-baeumzip-google-session=${value}.${crypto.createHmac("sha256", secret).update(value).digest("base64url")}`;
}
function read(url, authenticated = false) { return worker.fetch(new Request(new URL(url, origin), { headers: { accept: "text/html", "user-agent": "Googlebot", ...(authenticated ? { cookie: cookie() } : {}) } }), environment, context); }

test("built Worker keeps course introductions public and requires login for local practice", async () => {
  const root = await read("/"); assert.equal(root.status, 200); assert.match(await root.text(), /빅데이터분석기사 실기/u);
  const field = await read("/learn/big-data-analysis"); assert.equal(field.status, 200); assert.ok((await field.text()).includes(home));
  const response = await read(home); assert.equal(response.status, 200);
  const html = await response.text(); assert.match(html, /유형별 학습/u); assert.ok(html.includes(workbook));
  const before = database.prepare("SELECT COUNT(*) n FROM attempts").get().n;
  const guest = await read(workbook); assert.equal(guest.status, 307);
  assert.match(guest.headers.get("location"), /\/login\?return_to=/u);
  const exercise = await read(workbook, true); assert.equal(exercise.status, 200);
  const exerciseHtml = await exercise.text(); assert.match(exerciseHtml, /작업형 제1유형/u); assert.doesNotMatch(exerciseHtml, /solution_core|60\.4000/u);
  const cssLinks = [...exerciseHtml.matchAll(/<link\b[^>]*href="([^"]+\.css)"[^>]*>/gu)].map(match => match[1]);
  assert.ok(cssLinks.length > 0, "initial workbook includes stylesheet links");
  // Cloudflare serves generated CSS from its assets directory before invoking the Worker.
  const css = (await Promise.all(cssLinks.map(async link => {
    const response = await environment.ASSETS.fetch(new Request(new URL(link, origin)));
    assert.equal(response.status, 200, link); return response.text();
  }))).join("\n");
  assert.match(css, /\.local-practice-setup-heading/u, "local workbook layout CSS is delivered in the initial response");
  assert.match(css, /\.local-practice-code pre/u, "code overflow styling is delivered");
  assert.match(css, /\.local-practice-filter-form/u, "restored filter layout styling is delivered");
  assert.match(css, /\.local-practice-data-heading/u, "CSV group headings have their layout styling");
  assert.equal(database.prepare("SELECT COUNT(*) n FROM attempts").get().n, before);
  assert.equal((await read("/learn/big-data-analysis/bae-practical/type-4")).status, 404);
  for (const url of ["/learn/big-data-analysis/bae-written/home", "/learn/information-processing/ipe-practical/home", "/learn/sql/sqld/home", "/learn/software-major"]) assert.equal((await read(url)).status, 200, url);
  for (const url of ["/learn/big-data-analysis/bae-written/practice", "/learn/information-processing/ipe-practical/practice", "/learn/information-processing/ipe-practical/mock-exams"]) assert.equal((await read(url)).status, 307, url);
  for (const url of ["/learn/information-processing/ipe-practical/records", "/admin"]) {
    const response = await read(url);
    assert.ok([302, 303, 307, 308].includes(response.status), url);
    assert.ok(response.headers.get("location")?.includes(encodeURIComponent(url)), url);
  }
});

test("build serves the new practice kit and withdraws all legacy bank exports", async () => {
  const releaseSource = fs.readFileSync("packages/shared/src/study/local-practice-release.ts", "utf8");
  const prefix = releaseSource.match(/"prefix": "([^"]+)"/u)[1];
  const response = await read(`${prefix}/index.json`); assert.equal(response.status, 200);
  const index = await response.json(); assert.equal(index.count, 200);
  for (const file of ["practice-kit.zip", "guide.json", "questions/1.json", "questions/20.json", "answers/T1-006.json"]) {
    const download = await read(`${prefix}/${file}`); assert.equal(download.status, 200, file);
    const bytes = Buffer.from(await download.arrayBuffer());
    assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), index.files[file], file);
    assert.doesNotMatch(download.headers.get("content-type"), /text\/html/u);
  }
  for (const directory of fs.readdirSync("dist/client/content/bae/type1")) {
    if (!prefix.endsWith(`/${directory}`)) {
      assert.equal(fs.existsSync(path.join("dist/client/content/bae/type1", directory, "index.json")), false);
      assert.equal((await read(`/content/bae/type1/${directory}/index.json`)).status, 404);
    }
    for (const file of ["workbook.zip", "solutions.zip", "practice.zip", "data.zip", "practice/T1_001.py", "practice/T1_200.py"]) {
      assert.equal(fs.existsSync(path.join("dist/client/content/bae/type1", directory, file)), false);
      const retired = await read(`/content/bae/type1/${directory}/${file}`);
      assert.equal(retired.status, 404, `${directory}/${file}`);
    }
  }
});

test("built Worker requires login for the type 2 workbook and preserves published materials", async () => {
  const workbook = "/learn/big-data-analysis/bae-practical/type-2";
  const homeHtml = await (await read(home)).text();
  assert.ok(homeHtml.includes(workbook)); assert.match(homeHtml, /작업형 제2유형/u);
  const guest = await read(`${workbook}?question=T2-030`); assert.equal(guest.status, 307);
  assert.equal(new URL(guest.headers.get("location"), origin).searchParams.get("return_to"), `${workbook}?question=T2-030`);
  const response = await read(workbook, true); assert.equal(response.status, 200);
  const html = await response.text(); assert.match(html, /<title>[^<]*작업형 제2유형/u); assert.doesNotMatch(html, /RandomForestClassifier|test_labels|selected_validation_score/u);
  const source = fs.readFileSync("packages/shared/src/study/local-practice-type2-release.ts", "utf8");
  const prefix = source.match(/"prefix": "([^"]+)"/u)[1];
  const indexResponse = await read(`${prefix}/index.json`); assert.equal(indexResponse.status, 200);
  const index = await indexResponse.json(); assert.equal(index.count, 30);
  for (const file of Object.keys(index.files)) {
    const asset = await read(`${prefix}/${file}`); assert.equal(asset.status, 200);
    assert.equal(crypto.createHash("sha256").update(Buffer.from(await asset.arrayBuffer())).digest("hex"), index.files[file]);
  }
  for (const file of ["practice-kit.zip", "kits/T2-031.zip", "evaluation/labels/T2_001_test_labels.csv", "assessment/truth/T2_011/truth.csv", "reference_results/T2_001/result.csv", "START_HERE.html"]) assert.equal((await read(`${prefix}/${file}`)).status, 404);
});

test("built Worker requires login for type 3 cases without leaking answers into the page", async () => {
  const workbook = "/learn/big-data-analysis/bae-practical/type-3";
  const homeHtml = await (await read(home)).text(); assert.ok(homeHtml.includes(workbook));
  assert.match(homeHtml, /개 사례.*개 소문항/u); assert.doesNotMatch(homeHtml, /준비 중/u);
  assert.equal((await read(`${workbook}?question=T3-050`)).status, 307);
  const page = await read(`${workbook}?question=T3-050`, true); assert.equal(page.status, 200); assert.equal(page.headers.get("location"), null);
  const html = await page.text(); assert.match(html, /작업형 제3유형/u); assert.match(html, /role="status">자료를 불러오고 있습니다\./u);
  assert.doesNotMatch(html, /answer1|0\.006370|smf\.logit|로그인하고 실습 시작/u);
  const source = fs.readFileSync("packages/shared/src/study/local-practice-type3-release.ts", "utf8");
  const prefix = source.match(/"prefix": "([^"]+)"/u)[1];
  const indexResponse = await read(`${prefix}/index.json`); assert.equal(indexResponse.status, 200);
  const index = await indexResponse.json(); assert.equal(index.count, 50); assert.equal(index.subquestionCount, 150);
  for (const [file, hash] of Object.entries(index.files)) {
    const asset = await read(`${prefix}/${file}`); assert.equal(asset.status, 200);
    assert.equal(crypto.createHash("sha256").update(Buffer.from(await asset.arrayBuffer())).digest("hex"), hash);
  }
  for (const file of ["practice-kit.zip", "kits/T3-051.zip", "answers.json", "START_HERE.html", "downloads/type3_001_010_basic.zip"]) assert.equal((await read(`${prefix}/${file}`)).status, 404);
});
