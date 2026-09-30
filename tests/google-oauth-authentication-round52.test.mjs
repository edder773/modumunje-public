import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import test, { after } from "node:test";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";
import { sqliteD1 } from "./helpers/sqlite-d1.mjs";
import { pathToFileURL } from "node:url";

const workerUrl = pathToFileURL(path.resolve("dist/server/index.js"));
workerUrl.searchParams.set("google-auth-worker-test", String(Date.now()));
const worker = (await import(workerUrl.href)).default;

const databases = [];
after(() => { for (const database of databases) database.close(); });
function fakeD1() {
  const database = openCanonicalTestDatabase(process.cwd());
  databases.push(database);
  return {
    ...sqliteD1(database),
    get account() { return database.prepare("SELECT * FROM user_accounts LIMIT 1").get() ?? null; },
  };
}

function environment(database, overrides = {}) {
  return {
    DB: database,
    GOOGLE_CLIENT_ID: "google-client-id.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "google-client-secret",
    GOOGLE_AUTH_SESSION_SECRET: "google-auth-session-secret-with-32-characters",
    GOOGLE_OAUTH_REDIRECT_URI: "https://modumunje.com/api/auth/google/callback",
    ADMIN_EMAIL: "maintainer@example.com",
    ...overrides,
  };
}

const executionContext = { waitUntil() {}, passThroughOnException() {} };

function sessionCookie(email) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    v: 1,
    sub: `test-${email}`,
    email,
    name: "Test User",
    iat: issuedAt,
    exp: issuedAt + 3600,
  })).toString("base64url");
  const signature = crypto.createHmac(
    "sha256",
    "google-auth-session-secret-with-32-characters",
  ).update(payload).digest("base64url");
  return `__Host-baeumzip-google-session=${payload}.${signature}`;
}

function cookiePair(response, name) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie") ?? ""];
  const value = values.find((item) => item.startsWith(`${name}=`));
  assert.ok(value, `${name} cookie`);
  return value.split(";", 1)[0];
}

test("Google authorization uses canonical redirect, state, and PKCE without exposing secrets", async () => {
  const response = await worker.fetch(
    new Request("https://modumunje.com/api/auth/google/start?return_to=%2Flearn%2Fsql"),
    environment(fakeD1()),
    executionContext,
  );
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get("location"));
  assert.equal(location.origin, "https://accounts.google.com");
  assert.equal(location.searchParams.get("redirect_uri"), "https://modumunje.com/api/auth/google/callback");
  assert.equal(location.searchParams.get("scope"), "openid email profile");
  assert.equal(location.searchParams.get("code_challenge_method"), "S256");
  assert.ok(location.searchParams.get("state"));
  assert.ok(location.searchParams.get("code_challenge"));
  assert.doesNotMatch(location.toString(), /google-client-secret/u);
  const pendingCookie = cookiePair(response, "__Host-baeumzip-google-pending");
  assert.match(pendingCookie, /^__Host-baeumzip-google-pending=[A-Za-z0-9_.-]+$/u);
  assert.match(response.headers.get("set-cookie") ?? "", /HttpOnly/u);
  assert.match(response.headers.get("set-cookie") ?? "", /SameSite=Lax/u);
  assert.match(response.headers.get("set-cookie") ?? "", /Secure/u);
});

test("Google callback preserves the email account key and establishes a first-party session", async () => {
  const database = fakeD1();
  const env = environment(database);
  const startResponse = await worker.fetch(
    new Request("https://modumunje.com/api/auth/google/start?return_to=%2Flearn%2Fsql"),
    env,
    executionContext,
  );
  const authorizationLocation = new URL(startResponse.headers.get("location"));
  const pendingCookie = cookiePair(startResponse, "__Host-baeumzip-google-pending");
  const originalFetch = globalThis.fetch;
  const externalRequests = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    externalRequests.push({ url, init });
    if (url === "https://oauth2.googleapis.com/token") {
      const body = new URLSearchParams(String(init.body));
      assert.equal(body.get("client_secret"), "google-client-secret");
      assert.ok(body.get("code_verifier"));
      return Response.json({ access_token: "access-token", token_type: "Bearer" });
    }
    if (url === "https://openidconnect.googleapis.com/v1/userinfo") {
      assert.equal(new Headers(init.headers).get("authorization"), "Bearer access-token");
      return Response.json({
        sub: "google-user-773",
        email: "maintainer@example.com",
        email_verified: true,
        name: "Google Learner",
      });
    }
    throw new Error(`Unexpected external request: ${url}`);
  };
  try {
    const callback = new URL("https://modumunje.com/api/auth/google/callback");
    callback.searchParams.set("code", "authorization-code");
    callback.searchParams.set("state", authorizationLocation.searchParams.get("state"));
    const response = await worker.fetch(
      new Request(callback, { headers: { cookie: pendingCookie } }),
      env,
      executionContext,
    );
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "https://modumunje.com/learn/sql");
    const sessionCookie = cookiePair(response, "__Host-baeumzip-google-session");
    assert.match(sessionCookie, /^__Host-baeumzip-google-session=[A-Za-z0-9_.-]+$/u);
    assert.match(response.headers.get("set-cookie") ?? "", /Max-Age=86400/u);
    assert.equal(database.account.email, "maintainer@example.com");
    assert.equal(database.account.display_name, "Google Learner");
    assert.equal(externalRequests.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Google callback rejects mismatched state before contacting Google", async () => {
  const database = fakeD1();
  const env = environment(database);
  const startResponse = await worker.fetch(
    new Request("https://modumunje.com/api/auth/google/start"),
    env,
    executionContext,
  );
  const pendingCookie = cookiePair(startResponse, "__Host-baeumzip-google-pending");
  const callback = new URL("https://modumunje.com/api/auth/google/callback");
  callback.searchParams.set("code", "authorization-code");
  callback.searchParams.set("state", "attacker-state");
  const response = await worker.fetch(
    new Request(callback, { headers: { cookie: pendingCookie } }),
    env,
    executionContext,
  );
  assert.equal(response.status, 302);
  assert.equal(new URL(response.headers.get("location")).searchParams.get("auth_error"), "google_state_invalid");
  assert.equal(database.account, null);
});

test("application logout clears Google cookies and returns directly to the application", async () => {
  const returnTo = "/";
  const url = `https://modumunje.com/api/auth/google/logout?return_to=${encodeURIComponent(returnTo)}`;
  const env = environment(fakeD1());
  const cookie = sessionCookie("learner@example.test");
  const get = await worker.fetch(new Request(url, { headers: { cookie } }), env, executionContext);
  assert.equal(get.status, 405);
  assert.equal(get.headers.get("set-cookie"), null);
  for (const origin of ["https://attacker.example", ""]) {
    const headers = { cookie, ...(origin ? { origin } : {}) };
    const denied = await worker.fetch(new Request(url, {
      method: "POST",
      headers,
    }), env, executionContext);
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get("set-cookie"), null);
  }
  const response = await worker.fetch(new Request(url, {
    method: "POST",
    headers: { cookie, origin: "https://modumunje.com" },
  }), env, executionContext);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), `https://modumunje.com${returnTo}`);
  const cookies = response.headers.get("set-cookie") ?? "";
  assert.match(cookies, /__Host-baeumzip-google-session=;/u);
  assert.match(cookies, /Max-Age=0/u);
});

test("learner admin pages return HTTP 403 and keep the account switch form", async () => {
  const env = environment(fakeD1());
  const cookie = sessionCookie("learner@example.test");
  for (const path of ["/admin", "/admin/members", "/admin/skct-personal"]) {
    const response = await worker.fetch(
      new Request(`https://modumunje.com${path}`, { headers: { cookie } }),
      env,
      executionContext,
    );
    assert.equal(response.status, 403, path);
    const html = await response.text();
    assert.match(html, /관리자 권한이 없습니다/u);
    assert.match(html, /method="post"/u);
    assert.match(html, /다른 계정으로 로그인/u);
  }
  const admin = await worker.fetch(
    new Request("https://modumunje.com/admin", {
      headers: { cookie: sessionCookie("maintainer@example.com") },
    }),
    env,
    executionContext,
  );
  assert.equal(admin.status, 200);
  const html = await admin.text();
  assert.match(html, /method="post"/u);
  assert.match(html, /로그아웃/u);
});

test("anonymous visitors must sign in to access personal records and admin APIs", async () => {
  const env = environment(fakeD1());
  for (const request of [
    new Request("https://modumunje.com/api/study?scope=records"),
    new Request("https://modumunje.com/api/sw-study?view=state"),
    new Request("https://modumunje.com/api/reports?view=mine"),
    new Request("https://modumunje.com/api/admin?resource=dashboard", {
      headers: { "x-baeumzip-authenticated-user-email": "maintainer@example.com" },
    }),
  ]) {
    const response = await worker.fetch(request, env, executionContext);
    assert.equal(response.status, 401, new URL(request.url).pathname);
    assert.equal((await response.json()).code, "AUTHENTICATION_REQUIRED");
    assert.match(response.headers.get("cache-control") ?? "", /no-store/u);
  }

  const learningPage = await worker.fetch(
    new Request("https://modumunje.com/learn/sql/sqld/records"),
    env,
    executionContext,
  );
  assert.ok([302, 303, 307, 308].includes(learningPage.status));
  assert.match(
    learningPage.headers.get("location") ?? "",
    /\/login\?return_to=%2Flearn%2Fsql/u,
  );
});

test("public health is minimal and does not disclose deployment or database metadata", async () => {
  const response = await worker.fetch(
    new Request("https://modumunje.com/api/health"),
    environment(fakeD1()),
    executionContext,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok", service: "baeumzip" });
  assert.match(response.headers.get("cache-control") ?? "", /no-store/u);
});

test("the worker throttles repeated authentication requests by hashed client address", async () => {
  const env = environment(fakeD1());
  let response;
  for (let attempt = 0; attempt < 31; attempt += 1) {
    response = await worker.fetch(
      new Request("https://modumunje.com/api/auth/google/start", {
        headers: { "cf-connecting-ip": "203.0.113.52" },
      }),
      env,
      executionContext,
    );
  }
  assert.equal(response.status, 429);
  assert.equal((await response.json()).code, "REQUEST_RATE_LIMITED");
  assert.match(response.headers.get("retry-after") ?? "", /^\d+$/u);
});

test("the worker honors the shared Cloudflare rate-limit decision", async () => {
  const response = await worker.fetch(
    new Request("https://modumunje.com/api/health", {
      headers: { "cf-connecting-ip": "203.0.113.53" },
    }),
    environment(fakeD1(), {
      EVENT_RATE_LIMITER: { async limit() { return { success: false }; } },
    }),
    executionContext,
  );
  assert.equal(response.status, 429);
  assert.equal((await response.json()).code, "REQUEST_RATE_LIMITED");
});
