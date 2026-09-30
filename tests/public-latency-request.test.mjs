import assert from "node:assert/strict";
import { test } from "node:test";
import { PassThrough } from "node:stream";
import {
  MAX_PUBLIC_API_RESPONSE_BYTES,
  MAX_PUBLIC_HTML_BYTES,
  MAX_STATIC_ASSET_RESPONSE_BYTES,
  countBoundedResponseBytes,
  publicLatencyRequestOptions,
  publicLatencyResponseByteLimit,
  readBoundedWebText,
  isLongLivedImmutableCacheControl,
} from "../scripts/lib/public-latency-request.mjs";

test("public latency probe uses only GET and sends no account credentials", () => {
  for (const [path, accept] of [
    ["/about", "text/html"],
    ["/api/health", "application/json"],
    ["/_next/static/chunks/index-12345678.js", "*/*"],
  ]) {
    const options = publicLatencyRequestOptions(path, false);
    assert.equal(options.method, "GET");
    assert.equal(options.agent, false);
    assert.equal(options.headers.accept, accept);
    assert.equal(options.headers.authorization, undefined);
    assert.equal(options.headers.cookie, undefined);
  }
  assert.equal(MAX_STATIC_ASSET_RESPONSE_BYTES, 8 * 1024 * 1024);
  assert.equal(publicLatencyResponseByteLimit("/_next/static/chunks/index-12345678.js"), MAX_STATIC_ASSET_RESPONSE_BYTES);
  assert.equal(publicLatencyResponseByteLimit("/api/health"), MAX_PUBLIC_API_RESPONSE_BYTES);
  assert.equal(publicLatencyResponseByteLimit("/about"), MAX_PUBLIC_HTML_BYTES);
  assert.equal(publicLatencyResponseByteLimit("/theory-sitemap.xml"), MAX_PUBLIC_HTML_BYTES);
});

test("public HTML fetch reads only within its byte cap", async () => {
  assert.equal(await readBoundedWebText(new Response("<main>ok</main>"), 32), "<main>ok</main>");
  await assert.rejects(
    readBoundedWebText(new Response("<main>too long</main>"), 4),
    /response exceeded 4 bytes/u,
  );
});

test("bounded GET response streaming accepts a small body and rejects an oversized body", async () => {
  const small = new PassThrough();
  const smallResult = countBoundedResponseBytes(small, 4);
  small.end(Buffer.from("1234"));
  assert.equal(await smallResult, 4);

  const oversized = new PassThrough();
  const rejected = countBoundedResponseBytes(oversized, 4);
  oversized.end(Buffer.from("12345"));
  await assert.rejects(rejected, /response exceeded 4 bytes/u);
  assert.throws(() => countBoundedResponseBytes(new PassThrough(), Infinity), /finite positive/u);
});

test("oversized public page and API GET responses are rejected", async () => {
  for (const path of ["/about", "/api/study?scope=shell"]) {
    const cap = publicLatencyResponseByteLimit(path);
    const response = new PassThrough();
    const rejected = countBoundedResponseBytes(response, cap);
    response.end(Buffer.alloc(cap + 1));
    await assert.rejects(rejected, new RegExp(`response exceeded ${cap} bytes`, "u"));
  }
});


test("static cache inventory recognizes directive order and refuses contradictory private policies", () => {
  for (const header of ["public, max-age=31536000, immutable", "immutable, Public, max-age=\"31536000\""]) {
    assert.equal(isLongLivedImmutableCacheControl(header), true, header);
  }
  for (const header of [null, "", "public, max-age=0, must-revalidate", "public, max-age=31536000", "private, max-age=31536000, immutable", "public, max-age=31536000, immutable, no-store", "public, max-age=31536000, immutable, no-cache"]) {
    assert.equal(isLongLivedImmutableCacheControl(header), false, String(header));
  }
});
