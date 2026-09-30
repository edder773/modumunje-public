import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("admin routes bypass the full Nest bootstrap and stale deployment chunks self-recover", () => {
  const route = source("apps/frontend/app/api/admin/route.ts");
  const app = source("apps/frontend/src/features/admin/components/admin-app.tsx");
  const boundary = source("apps/frontend/src/features/errors/retry-boundary.tsx");

  assert.match(route, /GET as handleAdminGet/u);
  assert.match(route, /withApiErrorBoundary/u);
  assert.doesNotMatch(route, /invokeBackend|AdminController/u);
  assert.match(app, /installStaleDeploymentRecovery/u);
  assert.match(app, /<RetryBoundary/u);
  assert.match(boundary, /vite:preloadError/u);
  assert.match(boundary, /unhandledrejection/u);
  assert.match(boundary, /asset[.]includes\("\/_next\/static\/"\)/u);
  assert.match(boundary, /window[.]location[.]replace/u);
  assert.match(boundary, /CHUNK_RELOAD_GUARD_MS/u);
});

test("quality results use a durable chunked cache and avoid unbounded row projections", () => {
  const quality = source("apps/backend/src/modules/admin/admin-quality-use-cases.ts");
  const handlers = source("apps/backend/src/modules/admin/admin-request-handlers.ts");
  const database = openCanonicalTestDatabase(root);
  try {
    const columns = database.prepare("PRAGMA table_info(admin_quality_cache)").all()
      .map((column) => String(column.name));
    assert.deepEqual(columns, ["cache_key", "chunk_index", "payload", "generated_at", "expires_at"]);
    assert.match(quality, /QUALITY_CACHE_CHUNK_CHARACTERS/u);
    assert.match(quality, /readDurableQualitySnapshot/u);
    assert.match(quality, /writeDurableQualitySnapshot/u);
    assert.doesNotMatch(quality, /SELECT \* FROM (?:questions|theories|sw_questions|sw_theories)/u);
    assert.match(handlers, /QUALITY_INVALIDATING_ACTIONS/u);
    assert.match(handlers, /await invalidateQualitySnapshot/u);
  } finally {
    database.close();
  }
});

test("practice grading batches account, settings, exam lock, and feedback reads", () => {
  const query = source("apps/backend/src/modules/study/study-attempt.repository-query.ts");
  const service = source("apps/backend/src/modules/study/study.service.ts");
  const authorization = source("apps/backend/src/modules/study/study-practice-authorization.ts");
  const attempts = source("apps/backend/src/modules/study/study-attempt.service.ts");
  const telemetry = source("apps/frontend/src/features/study/telemetry/study-telemetry.ts");

  assert.match(query, /readPracticeMutationContext/u);
  assert.match(query, /await database[.]batch/u);
  assert.match(query, /INSERT INTO user_accounts/u);
  assert.match(query, /FROM site_settings/u);
  assert.match(query, /FROM exam_session_items/u);
  assert.match(query, /FROM questions/u);
  assert.match(authorization, /PRACTICE_FEEDBACK_ACTIONS/u);
  assert.match(authorization, /findPracticeMutationContext/u);
  assert.match(service, /authorizeStudyMutation/u);
  assert.match(attempts, /context: practiceContext/u);
  assert.match(telemetry, /void fetch\("\/api\/events"/u);
});
