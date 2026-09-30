import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { submitUserReport } from "../apps/frontend/src/features/study/model/user-report-client";
import UserReportModal from "../apps/frontend/src/features/study/components/sql/reports/user-report-modal";
import { ApiRequestError } from "../apps/frontend/src/shared/api/request-json";

const draft = { category: "content", title: "문제 정답 확인", description: "문제의 정답과 해설을 다시 확인해 주세요.", questionId: 123 };

test("report submission preserves its question context and requires a saved report receipt", async () => {
  const originalFetch = globalThis.fetch;
  const receipt = { id: "saved-report-id", status: "new", createdAt: "2026-09-09T10:00:00Z" };
  globalThis.fetch = async (input, init) => {
    assert.equal(input, "/api/reports");
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("x-sql-study-user-request"), "1");
    assert.deepEqual(JSON.parse(String(init?.body)), draft);
    return Response.json({ report: receipt }, { status: 201 });
  };
  try { assert.deepEqual(await submitUserReport(draft), receipt); }
  finally { globalThis.fetch = originalFetch; }
});

test("malformed success responses and HTML errors cannot show report submission as complete", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const payload of [{}, { ok: true }, { report: null }, { report: { id: "", status: "new", createdAt: "2026-09-09" } }, { report: { id: "1", status: "new", createdAt: "invalid" } }]) {
      globalThis.fetch = async () => Response.json(payload);
      await assert.rejects(submitUserReport(draft), /제보 접수 결과를 확인하지 못했습니다/u);
    }
    globalThis.fetch = async () => new Response("<html>Unavailable</html>", { status: 502, headers: { "content-type": "text/html" } });
    await assert.rejects(submitUserReport(draft), /제보 접수 결과를 확인할 수 없는 응답/u);
  } finally { globalThis.fetch = originalFetch; }
});

test("server rejection remains actionable and never automatically resends a report", async () => {
  const originalFetch = globalThis.fetch;
  let count = 0;
  globalThis.fetch = async () => { count += 1; return Response.json({ error: "제보 요청이 너무 많습니다. 10분 후 다시 시도해 주세요." }, { status: 429 }); };
  try {
    await assert.rejects(submitUserReport(draft), /10분 후/u);
    assert.equal(count, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test("an unresponsive report request releases the pending state after ten seconds without resending", async context => {
  const originalFetch = globalThis.fetch;
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let count = 0;
  globalThis.fetch = async (_input, init) => {
    count += 1;
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Timeout", "AbortError")), { once: true });
    });
  };
  try {
    const rejected = assert.rejects(submitUserReport(draft), error => error instanceof ApiRequestError && error.code === "REQUEST_TIMEOUT");
    context.mock.timers.tick(10_000);
    await rejected;
    assert.equal(count, 1);
  } finally { globalThis.fetch = originalFetch; context.mock.timers.reset(); }
});

test("both report dialogs retain accessible fields and problem-specific instructions after legacy removal", () => {
  for (const mode of ["general", "question"] as const) {
    const html = renderToStaticMarkup(<UserReportModal mode={mode} questionId={mode === "question" ? 123 : undefined} onClose={() => undefined} onSubmitted={() => undefined} />);
    assert.match(html, /role="dialog"/u);
    assert.match(html, /제보 유형/u);
    assert.match(html, /minLength="4"/u);
    assert.match(html, /minLength="10"/u);
    assert.match(html, /제보 접수/u);
    assert.doesNotMatch(html, /새 문제 만들기|새 이론 만들기|풀이 요약/u);
    if (mode === "question") assert.match(html, /현재 보고 있는 문제를 함께 전송합니다/u);
  }
});
