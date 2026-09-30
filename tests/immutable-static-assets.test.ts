import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fetchImmutableStaticAsset,
  isImmutableStaticAssetPath,
} from "../apps/frontend/worker/immutable-static-assets";

const origin = "https://modumunje.example";
const js = "/_next/static/chunks/index-N-5hxpJ-.js";
const css = "/_next/static/css/layout.DcOop7Jn.css";

function assetFetcher(response: Response) {
  let calls = 0;
  return {
    get calls() { return calls; },
    fetch: async () => { calls += 1; return response; },
  };
}

test("only content-hashed JS and CSS paths are eligible", () => {
  assert.equal(isImmutableStaticAssetPath(js), true);
  assert.equal(isImmutableStaticAssetPath(css), true);
  for (const path of [
    "/_next/static/chunks/index.js",
    "/_next/static/css/layout.css",
    "/_next/static/chunks/index-short.js",
    "/favicon.ico",
    "/api/study",
    "/_next/static/chunks/a-12345678.js/other",
  ]) assert.equal(isImmutableStaticAssetPath(path), false, path);
});

test("a successful hashed asset keeps body and validators with an immutable policy", async () => {
  for (const [path, contentType] of [[js, "text/javascript"], [css, "text/css"]]) {
    const upstream = new Response("safe static bytes", {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=0, must-revalidate",
        ETag: "asset-version",
      },
    });
    const assets = assetFetcher(upstream);
    const result = await fetchImmutableStaticAsset(new Request(origin + path), assets);
    assert.equal(assets.calls, 1);
    assert.equal(await result.text(), "safe static bytes");
    assert.equal(result.headers.get("etag"), "asset-version");
    assert.equal(result.headers.get("cache-control"), "public, max-age=31536000, immutable");
  }
});

test("private, cookie-bearing, HTML fallback, and missing assets retain upstream policy", async () => {
  const cases: Array<[string, Response]> = [
    [js, new Response("private", { headers: { "Content-Type": "text/javascript", "Cache-Control": "private, no-store" } })],
    [js, new Response("cookie", { headers: { "Content-Type": "text/javascript", "Set-Cookie": "session=test" } })],
    [js, new Response("html", { headers: { "Content-Type": "text/html" } })],
    [js, new Response("missing", { status: 404, headers: { "Content-Type": "text/javascript" } })],
    ["/api/study", new Response("api", { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } })],
    ["/favicon.ico", new Response("icon", { headers: { "Content-Type": "image/png" } })],
  ];
  for (const [path, upstream] of cases) {
    const result = await fetchImmutableStaticAsset(new Request(origin + path), assetFetcher(upstream));
    assert.equal(result, upstream, path);
  }
});


test("HEAD and typed 304 retain validators, compression and Vary while receiving the same immutable policy", async () => {
  for (const status of [200, 304]) {
    const request = new Request("https://example.test/_next/static/chunks/index-N-5hxpJ-.js", { method: "HEAD" });
    const response = await fetchImmutableStaticAsset(request, { fetch: async received => {
      assert.equal(received, request);
      return new Response(null, { status, headers: { "Content-Type": "text/javascript", ETag: '"stable"',
        "Content-Encoding": "br", Vary: "Accept-Encoding", "Cache-Control": "public, max-age=0" } });
    } });
    assert.equal(response.status, status);
    assert.equal(response.body, null);
    assert.equal(response.headers.get("Cache-Control"), "public, max-age=31536000, immutable");
    assert.equal(response.headers.get("ETag"), '"stable"');
    assert.equal(response.headers.get("Content-Encoding"), "br");
    assert.equal(response.headers.get("Vary"), "Accept-Encoding");
  }
  const original = new Response(null, { status: 304, headers: { ETag: '"unknown"' } });
  assert.equal(await fetchImmutableStaticAsset(new Request("https://example.test/_next/static/chunks/index-N-5hxpJ-.js"),
    { fetch: async () => original }), original);
});
