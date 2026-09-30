import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  ADMIN_IMPORT_FILE_MAX_BYTES,
  ADMIN_REQUEST_MAX_BYTES,
} from "../packages/shared/src/admin/admin-transfer-limits.mjs";

const root = path.resolve(import.meta.dirname, "..");
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("admin content transfer has one compatible browser and server byte budget", () => {
  assert.equal(ADMIN_IMPORT_FILE_MAX_BYTES, 24 * 1024 * 1024);
  assert.equal(ADMIN_REQUEST_MAX_BYTES, 25 * 1024 * 1024);
  assert.ok(ADMIN_IMPORT_FILE_MAX_BYTES < ADMIN_REQUEST_MAX_BYTES);
  assert.match(source("apps/frontend/src/features/admin/components/admin-core-sections.tsx"), /ADMIN_IMPORT_FILE_MAX_BYTES/u);
  assert.match(source("apps/backend/src/modules/admin/admin-request-handlers.ts"), /ADMIN_REQUEST_MAX_BYTES/u);
  const promotion = source("scripts/promote-content-release.mjs");
  assert.match(promotion, /fileBytes > ADMIN_IMPORT_FILE_MAX_BYTES/u);
  assert.match(promotion, /requestBytes > ADMIN_REQUEST_MAX_BYTES/u);
});

test("post-deploy verification defaults to canonical production without reporting auth skips", () => {
  const packageJson = JSON.parse(source("package.json"));
  assert.equal(packageJson.scripts["test:post-deploy"], "node scripts/run-post-deploy.mjs");
  const runner = source("scripts/run-post-deploy.mjs");
  assert.match(runner, /https:\/\/modumunje[.]com/u);
  assert.match(runner, /DEPLOYED_REQUIRE_AUTH/u);
  const config = source("playwright.deployed.config.ts");
  assert.match(config, /deployment-auth-quality[.]spec[.]ts/u);
  assert.doesNotMatch(source("tests/e2e/deployment-quality.spec.ts"), /testInfo[.]project/u);
});

test("baseline measurement reports the adopted compact installation path", () => {
  const benchmark = source("scripts/measure-schema-baseline.mjs");
  assert.match(benchmark, /schema-baseline-adopted/u);
  assert.match(benchmark, /schemaWithBootstrapPercent/u);
  assert.doesNotMatch(benchmark, /apps\/backend\/drizzle.*(?:write|rm|rename)/u);
});
