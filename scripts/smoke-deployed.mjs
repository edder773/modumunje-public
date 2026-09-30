import assert from "node:assert/strict";
import { EXPECTED_SCHEMA_VERSION } from "../packages/shared/src/database/schema-contract.mjs";

const baseUrl = (process.env.DEPLOYED_BASE_URL ?? "https://modumunje.com").replace(/\/$/u, "");
const expectedBuildSha = process.env.EXPECTED_BUILD_SHA?.trim();
const maintenanceSecret = process.env.MAINTENANCE_TRIGGER_SECRET?.trim();
const expectedSkctReleaseSha = process.env.EXPECTED_SKCT_GROUP_RELEASE_SHA?.trim();
const headers = { "User-Agent": "baeumzip-read-only-smoke/2.0" };

async function fetchJson(path, expectedStatus = 200) {
  const response = await fetch(`${baseUrl}${path}`, { headers, redirect: "follow" });
  assert.equal(response.status, expectedStatus, `${path} returned ${response.status}`);
  assert.match(response.headers.get("content-type") ?? "", /application\/json/u, path);
  assert.ok(response.headers.get("x-request-id"), `${path} omitted x-request-id`);
  assert.match(response.headers.get("server-timing") ?? "", /app;dur=/u, path);
  return { response, payload: await response.json() };
}

async function fetchAuthenticationRequired(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...headers, ...options.headers },
    redirect: "manual",
  });
  assert.equal(response.status, 401, `${path} returned ${response.status}`);
  assert.match(response.headers.get("content-type") ?? "", /application\/json/u, path);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/u, path);
  const payload = await response.json();
  assert.equal(payload.code, "AUTHENTICATION_REQUIRED", path);
}

const canonical = await fetch(baseUrl, { headers, redirect: "follow" });
assert.equal(canonical.status, 200);
assert.equal(new URL(canonical.url).hostname, new URL(baseUrl).hostname);
const canonicalHtml = await canonical.text();
assert.match(canonicalHtml, /무엇을 공부할까요\?/u);
assert.match(canonicalHtml, /학습 과정/u);
assert.match(canonicalHtml, /모두의 문제집/u);
console.log("200 canonical landing");

// A browser must be able to reuse built JS/CSS without a network revalidation.
// Keep this scoped to content-hashed build assets; HTML and API stay no-store.
const hashedAsset = canonicalHtml.match(/\/_next\/static\/(?:chunks\/[^"'\s<>]+-[A-Za-z0-9_-]{8,16}\.js|css\/[^"'\s<>]+\.[A-Za-z0-9_-]{8,16}\.css)/u)?.[0];
assert.ok(hashedAsset, "landing page omitted a content-hashed JS/CSS asset");
const staticResponse = await fetch(`${baseUrl}${hashedAsset}`, { method: "HEAD", headers });
assert.equal(staticResponse.status, 200, `${hashedAsset} returned ${staticResponse.status}`);
assert.match(staticResponse.headers.get("cache-control") ?? "", /(?:^|,)\s*public\b[^,]*max-age=31536000\b[^,]*immutable/u, hashedAsset);
console.log(`200 immutable static asset ${hashedAsset}`);

const faviconRedirect = await fetch(`${baseUrl}/favicon.ico`, { headers, redirect: "manual" });
assert.equal(faviconRedirect.status, 308);
assert.equal(new URL(faviconRedirect.headers.get("location"), baseUrl).pathname, "/favicon.png");
const favicon = await fetch(`${baseUrl}/favicon.ico`, { headers, redirect: "follow" });
assert.equal(favicon.status, 200);
assert.match(favicon.headers.get("content-type") ?? "", /image\/png/u);
console.log("200 standard favicon request");

const health = await fetchJson("/api/health");
assert.equal(health.payload.status, "ok");
assert.equal(health.payload.service, "baeumzip");
for (const privateField of ["build", "schema", "database", "contentRelease", "groupExam"]) {
  assert.equal(health.payload[privateField], undefined, `public health exposed ${privateField}`);
}
assert.match(health.response.headers.get("cache-control") ?? "", /no-store/u);
console.log("200 minimal public health");

if (expectedBuildSha && !maintenanceSecret) {
  throw new Error("MAINTENANCE_TRIGGER_SECRET is required when EXPECTED_BUILD_SHA is set");
}
if (maintenanceSecret) {
  const operational = await fetch(`${baseUrl}/api/internal/maintenance`, {
    headers: {
      ...headers,
      Authorization: `Bearer ${maintenanceSecret}`,
    },
  });
  assert.equal(operational.status, 200, `/api/internal/maintenance returned ${operational.status}`);
  assert.match(operational.headers.get("content-type") ?? "", /application\/json/u);
  assert.match(operational.headers.get("cache-control") ?? "", /no-store/u);
  const diagnostics = await operational.json();
  assert.equal(diagnostics.application?.status, "ok");
  assert.equal(diagnostics.application?.schema?.expected, EXPECTED_SCHEMA_VERSION);
  assert.equal(diagnostics.application?.schema?.applied, EXPECTED_SCHEMA_VERSION);
  assert.equal(diagnostics.application?.database?.reachable, true);
  assert.deepEqual(diagnostics.application?.database?.missingObjects, []);
  assert.ok(
    diagnostics.application?.contentRelease?.version,
    "protected diagnostics omitted active content release",
  );
  if (expectedBuildSha) {
    assert.equal(
      diagnostics.application?.build?.sha,
      expectedBuildSha,
      "deployed build SHA differs from expected SHA",
    );
  }
  if (expectedSkctReleaseSha) {
    assert.equal(diagnostics.application?.groupExam?.enabled, true, "SKCT group feature flag is not enabled");
    assert.equal(diagnostics.application?.groupExam?.ready, true, "SKCT group bank is not ready");
    assert.equal(
      diagnostics.application?.groupExam?.releaseSha256,
      expectedSkctReleaseSha,
      "active SKCT group release differs from expected SHA",
    );
    assert.equal(diagnostics.application?.groupExam?.activeReleaseCount, 1);
    assert.equal(
      diagnostics.application?.groupExam?.publicCount,
      diagnostics.application?.groupExam?.secretCount,
    );
    assert.ok(diagnostics.application?.groupExam?.selectableCount >= 15);
    console.log(`200 protected SKCT readiness ${diagnostics.application.groupExam.releaseId}`);
  }
  console.log(`200 protected diagnostics ${diagnostics.application?.build?.sha ?? "unknown-sha"}`);
}

await fetchAuthenticationRequired("/api/study?scope=practice");
await fetchAuthenticationRequired("/api/sw-study?view=practice");
await fetchAuthenticationRequired("/api/reports?view=mine");
await fetchAuthenticationRequired("/api/admin?resource=dashboard", {
  headers: { "x-baeumzip-authenticated-user-email": "maintainer@example.com" },
});
console.log("401 protected learning and administration APIs");

if (expectedSkctReleaseSha) {
  await fetchAuthenticationRequired("/api/group-exams?scope=groups");
  const groupsPage = await fetch(`${baseUrl}/groups`, { headers, redirect: "manual" });
  assert.ok([302, 303, 307, 308].includes(groupsPage.status));
  assert.match(groupsPage.headers.get("location") ?? "", /\/login\?return_to=%2Fgroups/u);
  console.log("401 group API and login redirect for the enabled group page");
}

for (const path of ["/admin-review", "/api/admin-review-session"]) {
  const retired = await fetch(`${baseUrl}${path}`, {
    method: path.startsWith("/api/") ? "POST" : "GET",
    headers,
    redirect: "follow",
  });
  assert.equal(retired.status, 404, `${path} is still exposed`);
}
console.log("404 retired administrator review routes");

const protectedPage = await fetch(`${baseUrl}/learn/sql/sqld/practice`, { headers, redirect: "manual" });
assert.ok([302, 303, 307, 308].includes(protectedPage.status));
assert.match(
  protectedPage.headers.get("location") ?? "",
  /\/login\?return_to=%2Flearn%2Fsql/u,
);
const notice = await fetch(new URL(protectedPage.headers.get("location"), baseUrl), { headers });
assert.equal(notice.status, 200);
assert.match(await notice.text(), /로그인이 필요합니다/u);
console.log("200 explicit login notice before Google sign-in");

const missingPage = await fetch(`${baseUrl}/learn/invalid-audit-route`, { headers, redirect: "follow" });
assert.equal(missingPage.status, 404);
assert.match(await missingPage.text(), /찾을 수 없습니다/u);
console.log("404 missing page");
