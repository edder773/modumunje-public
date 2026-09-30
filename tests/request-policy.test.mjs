import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { waitForSharedRequest } from "../packages/shared/src/runtime/abortable-shared-request.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("frontend requests enforce one bounded retry and normalize every failure", () => {
  const transport = source("apps/frontend/src/shared/api/request-json.ts");
  const study = source("apps/frontend/src/features/study/model/study-api-client.ts");
  const sw = source("apps/frontend/src/features/study/model/sw-study-api-client.ts");
  assert.match(transport, /DEFAULT_TOTAL_BUDGET_MS = 5_000/u);
  assert.match(transport, /DEFAULT_ATTEMPT_TIMEOUT_MS = 3_000/u);
  assert.match(transport, /SLOW_REQUEST_NOTICE_MS = 2_000/u);
  assert.match(transport, /\[429, 502, 503, 504\]/u);
  assert.match(transport, /retry-after/u);
  assert.match(transport, /250 \+ Math\.floor\(Math\.random\(\) \* 251\)/u);
  assert.match(transport, /REQUEST_ABORTED/u);
  assert.match(transport, /UNEXPECTED_CLIENT_ERROR/u);
  assert.match(transport, /baeumzip:api-retrying/u);
  assert.match(study, /maxAttempts: 2/u);
  assert.match(sw, /maxAttempts: prefetch \? 1 : 2/u);
  assert.match(sw, /totalBudgetMs: prefetch \? 3_000 : 5_000/u);
});

test("signal-bound SW requests share prefetch work without sharing cancellation", async () => {
  const sw = source("apps/frontend/src/features/study/model/sw-study-api-client.ts");
  assert.match(sw, /const pending = inFlightRequests\.get\(cacheKey\)/u);
  assert.match(sw, /waitForSharedRequest\(pending, signal\)/u);

  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const firstController = new AbortController();
  const first = waitForSharedRequest(pending, firstController.signal);
  const second = waitForSharedRequest(pending);
  firstController.abort();
  finish({ questions: [1] });

  await assert.rejects(first, (error) => error?.name === "AbortError");
  assert.deepEqual(await second, { questions: [1] });
});
