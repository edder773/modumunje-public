import assert from "node:assert/strict";
import test from "node:test";
import { tsImport } from "tsx/esm/api";

globalThis.__BAEUMZIP_APP_VERSION__ = "0.1.0-followup-test";
const { sqlLike, searchTokens } = await tsImport("../apps/backend/src/modules/admin/admin-query-parameters.ts", import.meta.url);
const { GET } = await tsImport("../apps/backend/src/modules/admin/admin-request-handlers.ts", import.meta.url);
const { completeGoogleAuth } = await tsImport("../apps/backend/src/modules/auth/auth.service.ts", import.meta.url);
const { createPendingGoogleOAuthValue, googlePendingCookie } = await tsImport("../apps/backend/src/common/auth/google-session.ts", import.meta.url);
const { AUTHENTICATED_USER_EMAIL_HEADER } = await tsImport("../packages/shared/src/auth/authenticated-user.ts", import.meta.url);

function environment(t, extras = {}) {
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { GOOGLE_AUTH_SESSION_SECRET: "followup-synthetic-secret-at-least-32-characters", ...extras };
  t.after(() => { globalThis.__BAEUMZIP_ENV__ = previous; });
}

test("admin search checks UTF-8 bytes after wildcard escaping and NFKC normalization", () => {
  for (const value of ["가".repeat(15), "가".repeat(16), "a".repeat(48), "%".repeat(24), "🙂".repeat(12)]) {
    assert.ok(new TextEncoder().encode(sqlLike(value)).byteLength <= 50);
  }
  for (const value of ["가".repeat(17), "a".repeat(49), "%".repeat(25), "\\".repeat(25), "🙂".repeat(13)]) {
    assert.throws(() => sqlLike(value), { name: "AdminSearchInputError", code: "ADMIN_SEARCH_TOO_LONG" });
  }
  assert.equal(sqlLike("a_%\\b"), "%a\\_\\%\\\\b%");
  assert.deepEqual(searchTokens("  ＳＱＬ　인덱스 "), ["SQL", "인덱스"]);
  assert.ok(searchTokens("가".repeat(16) + " " + "나".repeat(16)).every((token) => sqlLike(token)));
  assert.throws(() => sqlLike(searchTokens("㍿".repeat(5))[0]), { code: "ADMIN_SEARCH_TOO_LONG" });
});

test("admin rejects excessive search with a safe 400 before D1 and error-log writes", async (t) => {
  let queries = 0;
  environment(t, { ADMIN_EMAIL: "followup-admin@example.test", DB: { prepare() { queries++; throw new Error("unexpected D1 access"); } } });
  for (const resource of ["questions", "sw-questions", "theories", "sw-theories", "members", "reports", "logs", "export", "export-page"]) {
    const url = new URL("https://baeumzip.test/api/admin");
    url.search = new URLSearchParams({ resource, scope: "questions", search: "가".repeat(17) }).toString();
    const response = await GET(new Request(url, { headers: { [AUTHENTICATED_USER_EMAIL_HEADER]: "followup-admin@example.test" } }));
    assert.equal(response.status, 400, resource);
    assert.equal((await response.json()).code, "ADMIN_SEARCH_TOO_LONG", resource);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.equal(queries, 0);
});

async function oauth(t) {
  environment(t);
  let accounts = 0;
  const repository = {
    configuration: () => ({ clientId: "synthetic-client", clientSecret: "synthetic-secret", redirectUri: "https://baeumzip.test/api/auth/google/callback" }),
    ensureLearner: async () => { accounts++; },
  };
  const pending = await createPendingGoogleOAuthValue({ state: "synthetic-state", codeVerifier: "synthetic-verifier", returnTo: "/learn/sql" });
  const request = new Request("https://baeumzip.test/api/auth/google/callback?code=synthetic-code&state=synthetic-state", {
    headers: { cookie: googlePendingCookie(pending, "https://baeumzip.test").split(";")[0] },
  });
  return { run: () => completeGoogleAuth(request, repository), accounts: () => accounts };
}

function successfulToken() { return Response.json({ access_token: "synthetic-token", token_type: "Bearer" }); }
function successfulUser() { return Response.json({ sub: "synthetic-user", email: "followup@example.test", email_verified: true, name: "Synthetic" }); }
function assertNoSession(response, code) {
  assert.equal(response.status, 302);
  assert.equal(new URL(response.headers.get("location")).searchParams.get("auth_error"), code);
  assert.doesNotMatch(response.headers.get("set-cookie") ?? "", /__Host-baeumzip-google-session=/u);
  assert.match(response.headers.get("set-cookie"), /Max-Age=0/u);
}

for (const phase of ["token", "userinfo", "token-body", "userinfo-body"]) {
  test(`OAuth ${phase} stalls are aborted by the shared deadline without granting a session`, async (t) => {
    const flow = await oauth(t);
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let signal;
    let entered;
    const ready = new Promise((resolve) => { entered = resolve; });
    t.mock.method(globalThis, "fetch", async (url, init) => {
      const current = String(url).includes("/token") ? "token" : "userinfo";
      if (phase.startsWith(current)) {
        signal = init.signal;
        assert.ok(signal, "external request requires an AbortSignal");
        const stall = () => new Promise((_, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          entered();
        });
        return phase.endsWith("-body") ? { ok: true, json: stall } : stall();
      }
      t.mock.timers.tick(6_000);
      return successfulToken();
    });
    const response = flow.run();
    await ready;
    t.mock.timers.tick(phase.startsWith("userinfo") ? 4_000 : 10_000);
    assert.equal(signal.aborted, true);
    assertNoSession(await response, "google_unavailable");
    assert.equal(flow.accounts(), 0);
  });
}

test("OAuth completion within the shared budget keeps the normal login contract", async (t) => {
  const flow = await oauth(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const signals = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    signals.push(init.signal);
    t.mock.timers.tick(4_000);
    return String(url).includes("/token") ? successfulToken() : successfulUser();
  });
  const response = await flow.run();
  assert.equal(response.headers.get("location"), "https://baeumzip.test/learn/sql");
  assert.match(response.headers.get("set-cookie"), /__Host-baeumzip-google-session=/u);
  assert.equal(flow.accounts(), 1);
  assert.equal(signals[0], signals[1]);
  t.mock.timers.tick(20_000);
  assert.equal(signals[0].aborted, false, "completed callbacks clear their deadline timer");
});

test("an upstream result arriving after cancellation cannot create an account or session", async (t) => {
  const flow = await oauth(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(globalThis, "fetch", async () => {
    t.mock.timers.tick(10_001);
    return successfulToken();
  });
  assertNoSession(await flow.run(), "google_unavailable");
  assert.equal(flow.accounts(), 0);
});

for (const variant of ["token-401", "token-non-json", "userinfo-401", "userinfo-non-json"]) {
  test(`OAuth ${variant} returns a failure without account/session side effects`, async (t) => {
    const flow = await oauth(t);
    t.mock.method(globalThis, "fetch", async (url) => {
      const phase = String(url).includes("/token") ? "token" : "userinfo";
      if (variant.startsWith(phase)) return new Response("not JSON", { status: variant.endsWith("401") ? 401 : 200 });
      return successfulToken();
    });
    assertNoSession(await flow.run(), variant.startsWith("token") ? "google_token_failed" : "google_identity_failed");
    assert.equal(flow.accounts(), 0);
  });
}
