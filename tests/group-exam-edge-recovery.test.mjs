import assert from "node:assert/strict";
import test from "node:test";
import { tsImport } from "tsx/esm/api";

const events = [];
globalThis.location = new URL("https://example.test/groups");
globalThis.document = { visibilityState: "visible" };
globalThis.window = Object.assign(globalThis, {
  dispatchEvent(event) { events.push(event); return true; },
});
globalThis.CustomEvent = class CustomEvent {
  constructor(type, init) { this.type = type; this.detail = init?.detail; }
};

const { groupExamApi, GroupApiError } = await tsImport(
  "../apps/frontend/src/features/group-exams/group-exam-api.ts",
  import.meta.url,
);

function json(payload, status = 200, requestId = "skct_test_request") {
  return Response.json(payload, { status, headers: { "x-request-id": requestId } });
}

test("GET retries one missing-envelope edge 500 with the same correlation id", async () => {
  events.length = 0;
  const requests = [];
  globalThis.fetch = async (_url, init) => {
    requests.push(new Headers(init.headers).get("x-request-id"));
    return requests.length === 1 ? new Response("", { status: 500 }) : json({ ok: true }, 200, requests[0]);
  };
  assert.deepEqual(await groupExamApi("/api/group-exams?scope=sync"), { ok: true });
  assert.equal(requests.length, 2);
  assert.equal(requests[0], requests[1]);
  assert.equal(events.filter((event) => event.type === "group-exam-edge-retry").length, 1);
});

test("idempotent POST replays once, while a POST without an idempotency key does not", async () => {
  let calls = 0;
  globalThis.fetch = async () => (++calls === 1 ? new Response("", { status: 500 }) : json({ accepted: true }));
  const body = JSON.stringify({ action: "invite-accept", idempotencyKey: "invite-accept:test-key" });
  assert.deepEqual(await groupExamApi("/api/group-exams", { method: "POST", body }), { accepted: true });
  assert.equal(calls, 2);

  calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response("", { status: 500 }); };
  await assert.rejects(
    groupExamApi("/api/group-exams", { method: "POST", body: JSON.stringify({ action: "presence-heartbeat" }) }),
    (error) => error instanceof GroupApiError && error.code === "GROUP_INVALID_RESPONSE",
  );
  assert.equal(calls, 1);
});

test("valid application JSON errors are never retried or hidden", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return json({ code: "GROUP_INTERNAL_ERROR", error: "실패" }, 500); };
  await assert.rejects(
    groupExamApi("/api/group-exams?scope=sync"),
    (error) => error instanceof GroupApiError && error.code === "GROUP_INTERNAL_ERROR",
  );
  assert.equal(calls, 1);
});

test("malformed, scalar, and array JSON edge 500 responses retry once", async (t) => {
  const cases = [
    ["malformed", "{"],
    ["scalar", '"edge"'],
    ["array", '[{"edge":true}]'],
  ];
  for (const [name, firstBody] of cases) {
    await t.test(name, async () => {
      let calls = 0;
      globalThis.fetch = async (_url, init) => {
        calls += 1;
        return calls === 1
          ? new Response(firstBody, { status: 500, headers: { "content-type": "application/json" } })
          : json({ ok: true }, 200, new Headers(init.headers).get("x-request-id"));
      };
      assert.deepEqual(await groupExamApi("/api/group-exams?scope=sync"), { ok: true });
      assert.equal(calls, 2);
    });
  }
});

test("an x-request-id marks even an empty 500 as an application response", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response("", { status: 500, headers: { "x-request-id": "skct_server_error" } });
  };
  await assert.rejects(
    groupExamApi("/api/group-exams?scope=sync"),
    (error) => error instanceof GroupApiError
      && error.code === "GROUP_INVALID_RESPONSE"
      && error.requestId === "skct_server_error",
  );
  assert.equal(calls, 1);
});

test("two missing-envelope failures remain visible as an error", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response("", { status: 500 }); };
  await assert.rejects(
    groupExamApi("/api/group-exams?scope=sync"),
    (error) => error instanceof GroupApiError && error.code === "GROUP_INVALID_RESPONSE",
  );
  assert.equal(calls, 2);
});
