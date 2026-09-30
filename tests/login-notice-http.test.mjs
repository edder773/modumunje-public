import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test, { after } from "node:test";
import worker from "../dist/server/index.js";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";
import { sqliteD1 } from "./helpers/sqlite-d1.mjs";

const db = openCanonicalTestDatabase(process.cwd());
after(() => db.close());
const queries = [];
const origin = "https://modumunje.com";
const secret = "login-notice-synthetic-test-secret-at-least-32-characters";
const env = {
  DB: sqliteD1(db, queries), GOOGLE_AUTH_SESSION_SECRET: secret,
  GOOGLE_CLIENT_ID: "notice-test-client", GOOGLE_CLIENT_SECRET: "notice-test-secret",
  GOOGLE_OAUTH_REDIRECT_URI: `${origin}/api/auth/google/callback`,
  ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
};
const context = { waitUntil() {}, passThroughOnException() {} };
const read = (url, cookie = "") => worker.fetch(new Request(new URL(url, origin), {
  headers: { accept: "text/html", "user-agent": "Googlebot", cookie },
}), env, context);
const notice = destination => `/login?return_to=${encodeURIComponent(destination)}`;
const signInLink = html => {
  const href = html.match(/<a\b[^>]*href="([^"]+)"[^>]*>Google로 로그인<\/a>/u)?.[1];
  assert.ok(href, "The notice needs an explicit sign-in link");
  return new URL(href.replaceAll("&amp;", "&"), origin);
};
function cookie(expiration = 3600) {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ v: 1, sub: "notice-user", email: "notice@example.test", name: "Notice Learner", iat: now - 60, exp: now + expiration })).toString("base64url");
  return `__Host-baeumzip-google-session=${payload}.${crypto.createHmac("sha256", secret).update(payload).digest("base64url")}`;
}

test("every protected entry explains login before any external auth or private query", async t => {
  let externalRequests = 0;
  t.mock.method(globalThis, "fetch", async () => { externalRequests++; throw new Error("unexpected external request"); });
  for (const destination of [
    "/learn/sql/sqld/practice?question=123", "/learn/sql/sqlp/mock-exams",
    "/learn/software-major/practice", "/learn/software-major/mock-exams",
    "/learn/big-data-analysis/bae-practical/type-1", "/learn/big-data-analysis/bae-practical/type-2", "/learn/big-data-analysis/bae-practical/type-3",
    "/learn/sql/sqld/records", "/learn/sql/sqlp/records/incorrect",
    "/learn/information-processing/ipe-practical/records?formId=2024-1&tag=one&tag=two",
    "/learn/sql/sqld/bookmarks", "/admin/questions",
  ]) {
    queries.length = 0;
    const entry = await read(destination);
    assert.ok([302,303,307,308].includes(entry.status), destination);
    const location = new URL(entry.headers.get("location"), origin);
    assert.equal(location.origin, origin);
    assert.equal(location.pathname, "/login");
    assert.equal(location.searchParams.get("return_to"), destination);
    assert.equal(entry.headers.get("set-cookie"), null);
    const response = await read(location);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("location"), null);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.match(response.headers.get("cache-control"), /no-store/);
    assert.match(response.headers.get("x-robots-tag"), /noindex/);
    const html = await response.text();
    assert.match(html, /로그인이 필요합니다/);
    assert.match(html, /로그인하면 선택한 화면으로 돌아옵니다/);
    assert.match(html, /학습 홈으로/);
    assert.match(html, /name="robots" content="noindex, nofollow"/);
    assert.doesNotMatch(html, /http-equiv="refresh"|correctAnswers|scoringCriteria|Internal Server Error/);
    assert.equal(signInLink(html).searchParams.get("return_to"), destination);
    assert.equal(queries.length, 0, "The explanation must not load private learning data");
  }
  assert.equal(externalRequests, 0);
});

test("only the explicit Google button starts OAuth with the requested destination", async () => {
  const destination = "/learn/sql/sqld/practice?question=123";
  const response = await read(notice(destination));
  const href = signInLink(await response.text());
  const start = await read(href);
  assert.equal(start.status, 302);
  assert.equal(new URL(start.headers.get("location")).origin, "https://accounts.google.com");
  const pending = start.headers.getSetCookie().find(value => value.startsWith("__Host-baeumzip-google-pending="));
  assert.ok(pending);
  const encoded = pending.split("=")[1].split(".")[0];
  assert.equal(JSON.parse(Buffer.from(encoded, "base64url").toString()).returnTo, destination);
});

test("signed-in visitors resume directly while expired or forged sessions keep the notice", async () => {
  const destination = "/learn/information-processing/ipe-practical/practice?formId=2024-1";
  const active = await read(notice(destination), cookie());
  assert.ok([302,303,307,308].includes(active.status));
  assert.equal(new URL(active.headers.get("location"), origin).href, origin + destination);
  for (const invalid of [cookie(-10), "__Host-baeumzip-google-session=forged"] ) {
    const response = await read(notice(destination), invalid);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /로그인이 필요합니다/);
  }
});

test("the login notice rejects external return targets and recursive login paths", async () => {
  for (const target of ["https://evil.test/x", "//evil.test/x", "/\\evil.test/x", "/.//evil.test/x", "/x/..//evil.test/x", "/%2e//evil.test/x", "/api/auth/google/start", "/login", "/login?return_to=/login", "/login/again"]) {
    const response = await read(notice(target));
    assert.equal(response.status, 200);
    assert.equal(signInLink(await response.text()).searchParams.get("return_to"), "/", target);
    const active = await read(notice(target), cookie());
    assert.equal(new URL(active.headers.get("location"), origin).href, origin + "/", target);
  }
});

test("public learning remains open and private APIs still deny anonymous access", async () => {
  for (const url of ["/learn/sql/sqld/home", "/learn/sql/sqld/theories", "/learn/big-data-analysis/bae-practical/home"]) {
    const response = await read(url);
    assert.equal(response.status, 200, url);
    assert.equal(response.headers.get("location"), null);
  }
  for (const url of ["/api/study?scope=records&exam=SQLD", "/api/sw-study?view=state", "/api/admin?resource=questions"]) {
    const response = await read(url);
    assert.equal(response.status, 401);
    assert.equal((await response.json()).code, "AUTHENTICATION_REQUIRED");
  }
});

test("learning navigation retains the shared login guard without directly starting OAuth", () => {
  for (const relative of ["components/sw-curriculum-planner.tsx", "model/use-practice-session.ts"]) {
    const source = fs.readFileSync(path.join("apps/frontend/src/features/study", relative), "utf8");
    assert.match(source, /window\.location\.assign\(loginNoticePath\(/);
    assert.doesNotMatch(source, /learningSignInPath|window\.location\.assign\([^;]*api\/auth\/google/);
  }
  const app = fs.readFileSync("apps/frontend/src/features/study/components/study-app.tsx", "utf8");
  assert.match(app, /!isAuthenticated && !isPublicLearningRoute\(routeForView/u);
});
