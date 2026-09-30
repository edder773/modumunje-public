import { readFeatureSource } from "./helpers/feature-source.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("admin request graph excludes embedded recovery banks and requires explicit verified restore", () => {
  const service = readFeatureSource(path.join(root, "apps/backend/src/modules/admin/admin-request-handlers.ts"), "utf8");
  const adapter = readFeatureSource(path.join(
    root,
    "apps/backend/src/modules/admin/infrastructure/canonical-content-source.ts",
  ), "utf8");
  assert.doesNotMatch(service, /server-(?:question|theory)-bank/u);
  assert.match(service, /canonicalContentSource\.loadQuestions/u);
  assert.match(service, /canonicalContentSource\.loadTheories/u);
  assert.doesNotMatch(adapter, /server-(?:question|theory)-bank|COMPRESSED_|await import/u);
  assert.match(adapter, /available: false/u);
  assert.match(adapter, /검증된 비공개 콘텐츠 릴리스 또는 백업/u);
});
