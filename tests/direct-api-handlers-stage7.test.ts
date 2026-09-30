import assert from "node:assert/strict";
import test from "node:test";
import { startGoogleAuth, logoutGoogleAuth } from "../apps/backend/src/modules/auth/auth.service";
import { POST as recordEvent } from "../apps/backend/src/modules/events/events.service";
import {
  GET as readReports,
  POST as createReport,
} from "../apps/backend/src/modules/reports/reports.service";
import { withApiErrorBoundary } from "../apps/backend/src/common/http/api-response";
import { learnerUserHash } from "../apps/backend/src/common/auth/admin-auth";
import { learnerContextDatabase } from "./helpers/learner-context-fake";

const learnerEmail = "stage7-learner@example.test";
const learnerAccount = {
  user_key: await learnerUserHash(learnerEmail),
  email: learnerEmail,
  display_name: "Stage 7 Learner",
  status: "active" as const,
  blocked_reason: "",
};

globalThis.__BAEUMZIP_ENV__ = {
  DB: learnerContextDatabase(learnerAccount) as never,
  GOOGLE_AUTH_SESSION_SECRET: "stage7-session-secret-with-at-least-32-characters",
};

function authenticatedRequest(url: string, init: RequestInit = {}) {
  return new Request(url, {
    ...init,
    headers: {
      "x-baeumzip-authenticated-user-email": learnerEmail,
      ...Object.fromEntries(new Headers(init.headers)),
    },
  });
}

test("Google start and logout run directly against an explicit repository", async () => {
  const repository = {
    configuration() {
      return {
        clientId: "stage7-client.apps.googleusercontent.com",
        clientSecret: "stage7-client-secret",
        redirectUri: "https://modumunje.com/api/auth/google/callback",
      };
    },
    async ensureLearner() {},
  };

  const start = await startGoogleAuth(
    new Request("https://modumunje.com/api/auth/google/start?return_to=%2Flearn%2Fsql"),
    repository as never,
  );
  assert.equal(start.status, 302);
  const authorization = new URL(start.headers.get("location") ?? "");
  assert.equal(authorization.origin, "https://accounts.google.com");
  assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
  assert.ok(authorization.searchParams.get("state"));

  const logout = await logoutGoogleAuth(
    new Request("https://modumunje.com/api/auth/google/logout?return_to=%2F", {
      method: "POST",
      headers: { origin: "https://modumunje.com" },
    }),
    repository as never,
  );
  assert.equal(logout.status, 303);
  assert.equal(logout.headers.get("location"), "https://modumunje.com/");
  assert.match(logout.headers.get("set-cookie") ?? "", /Max-Age=0/u);

  for (const request of [
    new Request("https://modumunje.com/api/auth/google/logout?return_to=%2F"),
    new Request("https://modumunje.com/api/auth/google/logout?return_to=%2F", {
      method: "POST",
      headers: { origin: "https://other.example" },
    }),
    new Request("https://modumunje.com/api/auth/google/logout?return_to=%2F", {
      method: "POST",
    }),
  ]) {
    const denied = await logoutGoogleAuth(request, repository as never);
    assert.ok([403, 405].includes(denied.status));
    assert.equal(denied.headers.get("set-cookie"), null);
  }
});

test("report reads and writes keep identity scope, validation, and rate limits", async () => {
  const created: Array<Record<string, unknown>> = [];
  const repository = {
    async findRecentForUser(userKey: string) {
      assert.equal(userKey, learnerAccount.user_key);
      return [{ id: "report-existing", status: "new" }];
    },
    async questionExists(questionId: number) {
      return questionId === 101;
    },
    async countRecentForUser(userKey: string) {
      assert.equal(userKey, learnerAccount.user_key);
      return 0;
    },
    async create(input: Record<string, unknown>) {
      created.push(input);
    },
  };

  const read = await readReports(
    authenticatedRequest("https://modumunje.com/api/reports"),
    repository as never,
  );
  assert.equal(read.status, 200);
  assert.deepEqual(await read.json(), { items: [{ id: "report-existing", status: "new" }] });

  const write = await createReport(
    authenticatedRequest("https://modumunje.com/api/reports", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-sql-study-user-request": "1",
      },
      body: JSON.stringify({
        category: "content",
        title: "내용 오류 제보",
        description: "설명과 정답의 근거를 다시 확인해 주세요.",
        questionId: 101,
      }),
    }),
    repository as never,
  );
  assert.equal(write.status, 201);
  assert.equal(created.length, 1);
  assert.equal(created[0]?.userKey, learnerAccount.user_key);
  assert.equal(created[0]?.questionId, 101);
  assert.equal("email" in (created[0] ?? {}), false);
});

test("analytics handler keeps bounded allow-listed storage without Nest", async () => {
  let inserted: readonly unknown[] | undefined;
  const repository = {
    async analyticsEnabled() {
      return true;
    },
    rateLimitBinding() {
      return { async limit() { return { success: true }; } };
    },
    async countRecentForSession() {
      throw new Error("D1 fallback should not run when the shared limiter succeeds");
    },
    async insertEvent(values: readonly unknown[]) {
      inserted = values;
      return "inserted" as const;
    },
  };

  const response = await recordEvent(
    authenticatedRequest("https://modumunje.com/api/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        eventType: "question_answer_submitted",
        anonymousSessionId: "stage7-session-1234",
        eventId: "stage7-event-123456",
        examScope: "BAE",
        questionId: 101,
        answerResult: "correct",
        pagePath: "/learn/big-data-analysis/bae-written/questions/101?secret=drop",
        referrerHost: "www.baeumzip.site",
      }),
    }),
    repository as never,
  );
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { accepted: true });
  assert.ok(inserted);
  assert.equal(inserted?.includes("stage7-session-1234"), false);
  assert.equal(inserted?.includes(learnerEmail), false);
  assert.ok(inserted?.includes("/learn/big-data-analysis/bae-written/questions/101"));
});

test("direct route failures retain the safe API envelope", async () => {
  const request = new Request("https://modumunje.com/api/reports", {
    headers: { "x-request-id": "stage7-request-id" },
  });
  const originalConsoleError = console.error;
  const logs: string[] = [];
  console.error = (...values: unknown[]) => logs.push(values.map(String).join(" "));
  let response: Response;
  try {
    response = await withApiErrorBoundary(request, async () => {
      throw new Error("private detail must not be returned");
    }, {
      code: "BACKEND_UNAVAILABLE",
      message: "서비스를 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    });
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("x-request-id"), "stage7-request-id");
  assert.match(response.headers.get("server-timing") ?? "", /app;dur=/u);
  const body = await response.json();
  assert.equal(body.code, "BACKEND_UNAVAILABLE");
  assert.doesNotMatch(JSON.stringify(body), /private detail/u);
  assert.match(logs.join("\n"), /BACKEND_UNAVAILABLE/u);
  assert.doesNotMatch(logs.join("\n"), /private detail/u);
});
