import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { staticAssetHeaders } from "../scripts/generate-static-asset-headers";

test("asset-first headers enumerate only existing hashed JS/CSS, and reject platform rule overflow", async () => {
  const root = await mkdtemp(join(tmpdir(), "modumunje-headers-"));
  const chunks = join(root, "_next/static/chunks");
  const css = join(root, "_next/static/css");
  try {
    await mkdir(chunks, { recursive: true }); await mkdir(css, { recursive: true });
    for (const [file, text] of [["index.html", "html"], ["_next/static/chunks/plain.js", "js"],
      ["_next/static/chunks/index-12345678.js", "js"], ["_next/static/css/index.12345678.css", "css"]]) await writeFile(join(root, file), text);
    const headers = await staticAssetHeaders(root);
    assert.equal(headers.split("\n").filter(line => line.startsWith("/")).length, 2);
    assert.doesNotMatch(headers, /index\.html|plain\.js|\*/u);
    assert.match(headers, /X-Baeumzip-Asset-Route: static-manifest/u);
    for (let i = 0; i < 100; i++) await writeFile(join(chunks, `more${i}-12345678.js`), "js");
    await assert.rejects(staticAssetHeaders(root), /1–100/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});
