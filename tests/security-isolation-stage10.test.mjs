import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  readBoundedJsonBody,
  RequestBodyError,
} from "../packages/shared/src/http/bounded-json-body.mjs";
import {
  redactSensitiveText,
  sanitizeObservabilityValue,
} from "../packages/shared/src/security/observability-redaction.mjs";
import { readFeatureSource } from "./helpers/feature-source.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (file) => readFeatureSource(path.join(root, file), "utf8");

function chunkedRequest(bytes, onCancel = () => undefined) {
  return new Request("https://modumunje.com/api/study", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
      },
      cancel: onCancel,
    }),
    duplex: "half",
  });
}

test("bounded JSON reader stops chunked bodies at the byte limit", async () => {
  const body = new TextEncoder().encode(JSON.stringify({ value: "가나다" }));
  const accepted = new Request("https://modumunje.com/api/study", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  assert.deepEqual(await readBoundedJsonBody(accepted, body.byteLength), { value: "가나다" });

  let cancelled = false;
  await assert.rejects(
    readBoundedJsonBody(chunkedRequest(new Uint8Array(65), () => { cancelled = true; }), 64),
    (error) => error instanceof RequestBodyError
      && error.status === 413
      && error.code === "REQUEST_BODY_TOO_LARGE",
  );
  assert.equal(cancelled, true);
});

test("bounded JSON reader distinguishes malformed and empty bodies", async () => {
  await assert.rejects(
    readBoundedJsonBody(new Request("https://modumunje.com/api/study", {
      method: "POST",
      body: "{not-json",
    }), 128),
    (error) => error instanceof RequestBodyError
      && error.status === 400
      && error.code === "REQUEST_BODY_INVALID_JSON",
  );
  await assert.rejects(
    readBoundedJsonBody(new Request("https://modumunje.com/api/study", { method: "POST" }), 128),
    (error) => error instanceof RequestBodyError
      && error.status === 400
      && error.code === "REQUEST_BODY_EMPTY",
  );
});

test("observability sanitization removes personal and credential material", () => {
  const token = `ghp_${"a".repeat(36)}`;
  const sanitized = sanitizeObservabilityValue({
    email: "person@example.com",
    user_key: "private-user-key",
    nested: {
      message: `Bearer ${token} from person@example.com`,
      safe: "operation failed",
    },
  });
  const serialized = JSON.stringify(sanitized);
  assert.doesNotMatch(serialized, /person@example[.]com|private-user-key|ghp_/u);
  assert.match(serialized, /\[redacted\]/u);
  assert.match(serialized, /operation failed/u);
  assert.equal(
    redactSensitiveText("https://example.test/?token=visible&next=%2F"),
    "https://example.test/?token=[redacted]&next=%2F",
  );
  assert.equal(
    redactSensitiveText("Cookie: session=visible; csrftoken=also-visible"),
    "Cookie=[redacted]",
  );
});

test("mutation APIs enforce bounded streaming bodies and report quotas", () => {
  const reports = source("apps/backend/src/modules/reports/reports.service.ts");
  const reportRepository = source("apps/backend/src/modules/reports/reports.repository.ts");
  const events = source("apps/backend/src/modules/events/events.service.ts");
  const swStudy = source("apps/backend/src/modules/sw-study/sw-study.service.ts");
  const study = source("apps/backend/src/modules/study/study.service.ts");
  const admin = source("apps/backend/src/modules/admin/admin-request-handlers.ts");

  for (const api of [reports, events, swStudy, study, admin]) {
    assert.match(api, /readBoundedJsonBody\(request,/u);
  }
  assert.match(reports, /REPORT_RATE_LIMIT = 10/u);
  assert.match(reports, /countRecentForUser/u);
  assert.match(reportRepository, /WHERE user_key = \? AND created_at >= \?/u);
  assert.match(events, /analytics-session:/u);
  assert.match(events, /sessionIdHash/u);
  assert.match(events, /optionalPagePath\(payload[.]apiRoute\)/u);
  assert.match(events, /referrerHostname\(payload[.]referrerHost\)/u);
});

test("security headers and repository build-input gate remain wired", () => {
  const proxy = source("proxy.ts");
  const build = source("scripts/build-verified.sh");
  const workflow = source(".github/workflows/ci.yml");
  const packageJson = JSON.parse(source("package.json"));
  const packageLock = source("package-lock.json");
  const securityGate = source("scripts/verify-security-baseline.mjs");
  const schemaGate = source("scripts/verify-schema-model.mjs");
  const artifactValidator = source("scripts/validate-sites-artifact.mjs");

  for (const header of [
    "Cross-Origin-Opener-Policy",
    "Origin-Agent-Cluster",
    "X-DNS-Prefetch-Control",
    "X-Permitted-Cross-Domain-Policies",
  ]) assert.match(proxy, new RegExp(header));
  assert.match(proxy, /crypto[.]getRandomValues/u);
  assert.match(proxy, /'nonce-\$\{nonce\}' 'strict-dynamic'/u);
  assert.match(proxy, /script-src-attr 'none'/u);
  assert.doesNotMatch(proxy, /script-src 'self' 'unsafe-inline'/u);
  assert.doesNotMatch(proxy, /Content-Security-Policy-Report-Only/u);
  assert.match(build, /verify-security-baseline[.]mjs/u);
  assert.match(workflow, /npm run verify:security/u);
  assert.equal(packageJson.scripts["verify:security"], "node scripts/verify-security-baseline.mjs");
  assert.match(securityGate, /forbiddenImageExtensions/u);
  assert.match(securityGate, /possible committed credential or private key/u);
  assert.match(schemaGate, /getTableConfig/u);
  assert.match(schemaGate, /schemaContract/u);
  assert.doesNotMatch(schemaGate, /child_process|drizzle-kit/u);
  assert.equal(packageJson.devDependencies["drizzle-kit"], undefined);
  assert.equal(packageJson.overrides["@esbuild-kit/core-utils"], undefined);
  assert.doesNotMatch(packageLock, /node_modules\/(?:drizzle-kit|@esbuild-kit\/)/u);
  assert.equal(fs.existsSync(path.join(root, "drizzle.config.ts")), false);
  assert.match(artifactValidator, /serverArtifactIncludes/u);
  assert.match(artifactValidator, /dist\/server JavaScript does not contain the expected source commit/u);
});

test("learner reads and private response caches stay owner isolated", () => {
  const reports = source("apps/backend/src/modules/reports/reports.repository.ts");
  const records = source("apps/backend/src/modules/study/study-records.repository-queries.ts");
  const sessions = source("apps/backend/src/modules/study/study-session.repository.ts");
  const sw = source("apps/backend/src/modules/sw-study/sw-study.repository.ts");
  const studyCache = source("apps/backend/src/modules/study/study-response-cache.ts");
  const swService = source("apps/backend/src/modules/sw-study/sw-study.service.ts");

  assert.match(reports, /WHERE user_key = \?/u);
  assert.ok((records.match(/user_key = \?/gu) ?? []).length >= 5);
  assert.match(sessions, /WHERE id = \? AND user_key = \?/u);
  assert.ok((sw.match(/user_key = \?/gu) ?? []).length >= 4);
  assert.match(studyCache, /if \(isPrivate\) headers[.]set\("Vary", "Cookie"\)/u);
  assert.match(swService, /"private, no-store"/u);
});
