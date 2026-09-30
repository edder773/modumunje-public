import assert from "node:assert/strict";
import test from "node:test";

test("renders canonical Korean public metadata without development markers", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  const html = await response.text();
  assert.match(html, /<html[^>]*\blang=["']ko["']/i);
  assert.match(
    html,
    /<title>모두의 문제집에서 무엇을 공부할까요\? \| 자격증·전공 학습 플랫폼<\/title>/i,
  );
  assert.match(
    html,
    /<link(?=[^>]*\brel=["']canonical["'])(?=[^>]*\bhref=["']https:\/\/modumunje\.com\/?["'])[^>]*>/i,
  );
  assert.doesNotMatch(html, /\bcodex-preview\b/i);
});
