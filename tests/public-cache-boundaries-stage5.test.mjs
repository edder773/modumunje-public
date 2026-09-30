import { readFeatureSource } from "./helpers/feature-source.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (relativePath) => readFeatureSource(path.join(root, relativePath), "utf8");

test("stage 5 public cache loaders contain content only and private responses remain no-store", () => {
  const study = source("apps/backend/src/modules/study/study.service.ts");
  const publicContent = source("apps/backend/src/modules/study/study-public-content-cache.ts");
  const questions = source("apps/backend/src/modules/study/study-question-delivery.ts");
  const sw = source("apps/backend/src/modules/sw-study/sw-study.service.ts");
  const cache = source("apps/backend/src/common/content/public-content-cache.ts");

  assert.match(publicContent, /loader: \(\) => repository\.readCourseContentOverview\(\)/u);
  assert.match(publicContent, /loader: \(\) => repository\.findTheoryRows\(selectedExam\)/u);
  assert.match(publicContent, /loader: \(\) => repository\.findTheoryDetailRow/u);
  assert.match(questions, /loader: \(\) => repository\.findPracticeMeta\(selectedExam\)/u);
  assert.match(sw, /namespace: "sw-(?:summary|theories|theory)"/u);
  assert.match(study, /const PRIVATE_CACHE_CONTROL = "private, no-store"/u);
  assert.match(sw, /"private, no-store"/u);
  assert.doesNotMatch(cache, /correct_answers|correctAnswers|userKey|bookmark|progress|adminAccess/u);
});

test("stage 5 response keys and mutations use a data revision rather than only a build SHA", () => {
  const study = source("apps/backend/src/modules/study/study.service.ts");
  const studyCache = source("apps/backend/src/modules/study/study-response-cache.ts");
  const sw = source("apps/backend/src/modules/sw-study/sw-study.service.ts");
  const admin = source("apps/backend/src/modules/admin/admin-request-handlers.ts");
  const repository = source("apps/backend/src/modules/admin/admin.repository.ts");
  const shared = source("apps/backend/src/common/http/shared-response-cache.ts");

  const publicContent = source("apps/backend/src/modules/study/study-public-content-cache.ts");
  assert.match(publicContent, /readContentCacheRevision\(\)/u);
  assert.match(study, /sharedStudyCacheKey\([^;]+responseRev\)/u);
  assert.match(studyCache, /key\.set\("revision", contentRevision\)/u);
  assert.match(sw, /const sharedCacheKey = `(?:summary|theories|theory):\$\{revision\}/u);
  assert.match(repository, /statements\.push\(contentCacheRevisionStatement\(d1\)\)/u);
  assert.match(repository, /await d1\.batch\(statements\)/u);
  assert.match(admin, /"quality-fix"/u);
  // Live site-setting reads are covered by the handler test in content-cache-revision-stage5.test.ts.
  assert.match(study, /public, max-age=0, must-revalidate/u);
  assert.match(shared, /public, max-age=300/u);
});
