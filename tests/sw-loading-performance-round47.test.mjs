import { readFeatureSource } from "./helpers/feature-source.mjs";
import assert from "node:assert/strict";
import test from "node:test";

function source(path) {
  return readFeatureSource(new URL(`../${path}`, import.meta.url), "utf8");
}

test("the SW read route bypasses Nest bootstrap while retaining the common error boundary", () => {
  const route = source("apps/frontend/app/api/sw-study/route.ts");

  assert.match(route, /GET as handleSwStudyGet/u);
  assert.match(route, /GET = \(request: Request\) =>[\s\S]*withSiteIdentity\(request, handleSwStudyGet,/u);
  assert.match(route, /allowAnonymous: isPublicSwStudyView/u);
  assert.doesNotMatch(route, /SwStudyController|invokeBackend|AppModule/u);
  assert.match(source("apps/backend/src/modules/sw-study/sw-study.service.ts"), /withApiErrorBoundary/u);
});

test("SW requests share validation, timeout, deduplication and bounded caches", () => {
  const client = source("apps/frontend/src/features/study/model/sw-study-api-client.ts");
  const transport = source("apps/frontend/src/shared/api/request-json.ts");

  assert.match(transport, /DEFAULT_TOTAL_BUDGET_MS/u);
  assert.match(transport, /DEFAULT_ATTEMPT_TIMEOUT_MS/u);
  assert.match(client, /responseCache = new Map/u);
  assert.match(client, /inFlightRequests = new Map/u);
  assert.match(client, /cacheMode.*"reuse".*"consume"/su);
  assert.match(transport, /content-type/u);
  assert.match(client, /requestJson/u);
  assert.match(client, /PREFETCHED_PRACTICE_TTL_MS/u);
});

test("SW navigation warms content and preserves the current screen while loading", () => {
  const study = source("apps/frontend/src/features/study/components/study-app.tsx");

  assert.match(study, /prefetchSwStudyData\(\{[\s\S]*view:\s*"theories"/u);
  assert.match(study, /prefetchSwStudyData\(\{[\s\S]*view:\s*"practice"/u);
  assert.match(study, /void preloadMarkdownRenderer\(\)/u);
  assert.match(study, /requestSwStudyData/u);
  assert.match(study, /function SwContentLoadingIndicator/u);
  assert.doesNotMatch(study, /if \(contentLoading\) \{[\s\S]{0,120}return/u);
});
