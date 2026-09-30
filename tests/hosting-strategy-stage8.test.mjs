import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { auditHostingStrategy } from "../scripts/lib/hosting-strategy.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Sites remains primary while AdSense stays a controlled frontend activation", () => {
  const report = auditHostingStrategy(root);

  assert.deepEqual(report.failures, []);
  assert.equal(report.result, "pass");
  assert.equal(report.decision, "retain-sites");
  assert.equal(report.advertising.platformFit, "supported-with-controlled-activation");
  assert.equal(report.advertising.activationState, "reserved-only");
  assert.equal(report.advertising.prerequisiteCount, 6);
  assert.equal(report.currentControls.publisherCodeAbsent, true);
  assert.equal(report.currentControls.ownershipMetaPresent, true);
  assert.equal(report.currentControls.adsTxtAbsent, false);
  assert.equal(report.currentControls.adsTxtAuthorized, true);
  assert.equal(report.currentControls.thirdPartyCspClosed, true);
});

test("ads.txt authorizes only the verified publisher while ad delivery stays disabled", () => {
  const contents = fs.readFileSync(path.join(root, "apps/frontend/public/ads.txt"), "utf8");
  assert.equal(contents, "google.com, pub-4499860671643104, DIRECT, f08c47fec0942fa0\n");
  const report = auditHostingStrategy(root);
  assert.equal(report.currentControls.ownershipMetaPresent, true);
  assert.equal(report.currentControls.publisherCodeAbsent, true);
  assert.equal(report.currentControls.thirdPartyCspClosed, true);
  assert.equal(report.advertising.activationState, "reserved-only");
});

test("the hosting gate rejects missing, placeholder, foreign or extra ads.txt entries", (t) => {
  const adsTxtPath = path.join(root, "apps/frontend/public/ads.txt");
  const readFileSync = fs.readFileSync.bind(fs);
  const existsSync = fs.existsSync.bind(fs);
  let contents = "";
  let present = true;
  t.mock.method(fs, "readFileSync", (file, ...args) => file === adsTxtPath ? contents : readFileSync(file, ...args));
  t.mock.method(fs, "existsSync", (file) => file === adsTxtPath ? present : existsSync(file));
  for (const invalid of [
    "",
    "google.com, pub-0000000000000000, DIRECT, f08c47fec0942fa0",
    "google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0",
    "google.com, pub-4499860671643104, RESELLER, f08c47fec0942fa0",
    "google.com, pub-4499860671643104, DIRECT, f08c47fec0942fa0\ngoogle.com, pub-0000000000000000, DIRECT, f08c47fec0942fa0",
    "<html>Not found</html>",
  ]) {
    contents = invalid;
    const report = auditHostingStrategy(root);
    assert.equal(report.result, "fail");
    assert.equal(report.currentControls.adsTxtAuthorized, false);
    assert.ok(report.failures.some((failure) => failure.startsWith("ads.txt")));
  }
  present = false;
  assert.equal(auditHostingStrategy(root).currentControls.adsTxtAuthorized, false);
});

test("an independent NestJS backend requires evidence and keeps the frontend on Sites", () => {
  const policy = JSON.parse(fs.readFileSync(
    path.join(root, "config/runtime-platform-policy.json"),
    "utf8",
  ));

  assert.equal(policy.fallback.target, "independent-nestjs-http-backend");
  assert.equal(policy.fallback.frontendHosting, "openai-sites");
  assert.deepEqual(policy.fallback.requiredEvidence, [
    "required-capability-named",
    "sites-limitation-reproduced",
    "in-platform-mitigation-measured",
    "cost-security-and-rollback-reviewed",
    "architecture-decision-approved",
  ]);
  assert.ok(policy.fallback.triggers.includes("required-third-party-integration-is-proven-incompatible-with-sites"));
  assert.ok(policy.fallback.nonTriggers.includes("adsense-head-script-or-meta-tag"));
  assert.ok(policy.fallback.nonTriggers.includes("root-ads-txt-hosting"));
  assert.ok(policy.fallback.nonTriggers.includes("traffic-growth-without-measured-breach"));
});

test("the hosting strategy audit runs in CI and before every production build", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const workflow = fs.readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");
  const build = fs.readFileSync(path.join(root, "scripts/build-verified.sh"), "utf8");

  assert.equal(packageJson.scripts["verify:hosting-strategy"], "node scripts/audit-hosting-strategy.mjs");
  assert.match(workflow, /npm run verify:hosting-strategy/u);
  assert.match(build, /audit-hosting-strategy[.]mjs/u);
});
