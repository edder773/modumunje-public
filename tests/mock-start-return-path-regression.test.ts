import assert from "node:assert/strict";
import test from "node:test";
import {
  createPendingGoogleOAuthValue,
  googlePendingCookie,
  safeRelativeReturnPath,
} from "../apps/backend/src/common/auth/google-session";
import {
  completeGoogleAuth,
  logoutGoogleAuth,
  startGoogleAuth,
} from "../apps/backend/src/modules/auth/auth.service";
import { requestStudyMutation } from "../apps/frontend/src/features/study/model/study-mutation-api-client";

const origin = "https://modumunje.com";
const config = {
  clientId: "local-client",
  clientSecret: "local-secret",
  redirectUri: `${origin}/api/auth/google/callback`,
};
const repository = {
  configuration: () => config,
  ensureLearner: async () => null,
};

test("mock start fills display defaults while submission keeps server grading content intact", async (t) => {
  t.mock.method(globalThis, "fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
    const action = JSON.parse(String(init?.body)).action;
    assert.ok(["exam-start", "exam-submit"].includes(action));
    return Response.json({
      session: { id: "local-session" },
      questions: [{ id: 1, prompt: "Local question", choices: ["A", "B"],
        ...(action === "exam-submit" ? { correctAnswers: [1], explanation: "Server explanation" } : {}) }],
      ...(action === "exam-start" ? { resumed: false } : {}),
    });
  });
  const started = await requestStudyMutation<{ questions: Array<Record<string, unknown>> }>(
    "exam-start", { examType: "SQLD" },
  );
  assert.equal(started.questions[0]?.explanation, "");
  assert.deepEqual(started.questions[0]?.correctAnswers, []);
  const submitted = await requestStudyMutation<{ questions: Array<Record<string, unknown>> }>(
    "exam-submit", { sessionId: "local-session", revision: 0, answers: {} },
  );
  assert.equal(submitted.questions[0]?.explanation, "Server explanation");
  assert.deepEqual(submitted.questions[0]?.correctAnswers, [1]);
});

test("normalized return paths cannot become protocol-relative destinations", async (t) => {
  const previousEnv = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = {
    GOOGLE_AUTH_SESSION_SECRET: "local-return-path-test-secret-more-than-32-characters",
  };
  t.after(() => { globalThis.__BAEUMZIP_ENV__ = previousEnv; });
  const attackPaths = ["/.//evil.example/phish", "/x/..//evil.example/phish", "/%2e//evil.example/phish"];
  for (const target of attackPaths) {
    assert.equal(safeRelativeReturnPath(target), "/", target);
    const logout = await logoutGoogleAuth(
      new Request(`${origin}/api/auth/google/logout?return_to=${encodeURIComponent(target)}`, {
        method: "POST",
        headers: { origin },
      }),
      repository as never,
    );
    assert.equal(logout.headers.get("location"), `${origin}/`, target);

    const start = await startGoogleAuth(
      new Request(`${origin}/api/auth/google/start?return_to=${encodeURIComponent(target)}`),
      repository as never,
    );
    const signedCookie = (start.headers.get("set-cookie") ?? "").split(";", 1)[0];
    assert.ok(signedCookie);
    const pending = signedCookie.split("=")[1]?.split(".")[0] ?? "";
    assert.equal(JSON.parse(Buffer.from(pending, "base64url").toString()).returnTo, "/", target);

    const value = await createPendingGoogleOAuthValue({
      state: "local-state",
      codeVerifier: "local-verifier",
      returnTo: target,
    });
    t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => String(input).includes("/token")
      ? Response.json({ access_token: "local-token", token_type: "Bearer" })
      : Response.json({ sub: "local-id", email: "learner@example.test", email_verified: true }));
    const callback = await completeGoogleAuth(new Request(
      `${origin}/api/auth/google/callback?code=local-code&state=local-state`,
      { headers: { cookie: googlePendingCookie(value, origin).split(";", 1)[0] } },
    ), repository as never);
    assert.equal(callback.headers.get("location"), `${origin}/`, target);
    t.mock.restoreAll();
  }
  assert.equal(safeRelativeReturnPath("/learn/sql/sqld?question=1"), "/learn/sql/sqld?question=1");
  assert.equal(safeRelativeReturnPath("/api/auth/google/start"), "/");
});
