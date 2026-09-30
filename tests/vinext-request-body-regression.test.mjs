import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("vinext URL rewrites preserve the original POST body for route dispatch", async () => {
  const [guard, config, packageJson] = await Promise.all([
    source("build/vinext-request-body-guard.ts"),
    source("vite.config.ts"),
    source("package.json").then(JSON.parse),
  ]);

  assert.equal(packageJson.devDependencies.vinext, "1.0.0-beta.9");
  assert.match(guard, /request\.body && !request\.bodyUsed \? request\.clone\(\) : request/u);
  assert.match(guard, /occurrences !== 1/u);
  assert.match(config, /preserveVinextRequestBodies\(\)/u);
});
