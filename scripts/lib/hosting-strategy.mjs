import fs from "node:fs";
import path from "node:path";

const EXPECTED_AD_PREREQUISITES = [
  "approved-site-and-publisher-id",
  "manual-placement-and-slot-id",
  "regional-certified-cmp",
  "least-privilege-csp-allowlist",
  "root-ads-txt",
  "privacy-and-browser-verification",
];

const EXPECTED_FALLBACK_EVIDENCE = [
  "required-capability-named",
  "sites-limitation-reproduced",
  "in-platform-mitigation-measured",
  "cost-security-and-rollback-reviewed",
  "architecture-decision-approved",
];

function read(root, relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function hasEvery(values, expected) {
  return expected.every((value) => values.includes(value));
}

export function auditHostingStrategy(root) {
  const policy = JSON.parse(read(root, "config/runtime-platform-policy.json"));
  const hosting = JSON.parse(read(root, ".openai/hosting.json"));
  const packageJson = JSON.parse(read(root, "package.json"));
  const adPolicy = read(
    root,
    "apps/frontend/src/features/advertising/ad-placement-policy.ts",
  );
  const rootLayout = read(root, "apps/frontend/app/layout.tsx");
  // Ownership verification is inert; only this approved tag is exempted.
  // Ad scripts, other publisher identities and duplicate tags remain blocked.
  const ownershipMeta = '<meta name="google-adsense-account" content="ca-pub-4499860671643104" />';
  const layoutWithoutOwnershipMeta = rootLayout.replace(ownershipMeta, "");
  // Authorizing the verified seller does not enable advertising scripts.
  const adsTxtPath = path.join(root, "apps/frontend/public/ads.txt");
  const adsTxtPresent = fs.existsSync(adsTxtPath);
  const adsTxtAuthorized = adsTxtPresent && fs.readFileSync(adsTxtPath, "utf8").trim()
    === "google.com, pub-4499860671643104, DIRECT, f08c47fec0942fa0";
  const proxy = read(root, "proxy.ts");
  const architectureDecision = read(
    root,
    "docs/decisions/ADR-0001-sites-primary-nest-fallback.md",
  );
  const failures = [];
  const pass = (condition, message) => {
    if (!condition) failures.push(message);
  };

  pass(policy.schemaVersion === 1, "runtime platform policy schema must be version 1");
  pass(policy.decisionId === "ADR-0001", "runtime platform policy must reference ADR-0001");
  pass(
    policy.currentPlatform?.decision === "retain-sites",
    "Sites must remain the default runtime until a measured transition decision is approved",
  );
  pass(
    policy.currentPlatform?.runtime === "single-worker",
    "the current production runtime must stay declared as a single Worker",
  );
  pass(
    policy.advertising?.platformFit === "supported-with-controlled-activation",
    "AdSense must be classified as a controlled frontend activation, not a backend trigger",
  );
  pass(
    policy.advertising?.activationState === "reserved-only",
    "AdSense activation must remain reserved-only before publisher approval",
  );
  pass(
    policy.advertising?.backendRequired === false,
    "AdSense must not be used as justification for an independent backend",
  );
  pass(
    hasEvery(policy.advertising?.activationPrerequisites ?? [], EXPECTED_AD_PREREQUISITES),
    "AdSense activation prerequisites are incomplete",
  );
  pass(
    policy.fallback?.target === "independent-nestjs-http-backend",
    "the approved fallback target must be an independent NestJS HTTP backend",
  );
  pass(
    policy.fallback?.frontendHosting === "openai-sites",
    "the fallback must preserve Sites as the frontend host by default",
  );
  pass(
    hasEvery(policy.fallback?.requiredEvidence ?? [], EXPECTED_FALLBACK_EVIDENCE),
    "the independent-backend evidence gate is incomplete",
  );
  pass(
    (policy.fallback?.triggers?.length ?? 0) >= 5,
    "the independent-backend trigger set is incomplete",
  );
  pass(
    (policy.fallback?.nonTriggers ?? []).includes("adsense-head-script-or-meta-tag")
      && (policy.fallback?.nonTriggers ?? []).includes("root-ads-txt-hosting")
      && (policy.fallback?.nonTriggers ?? []).includes("general-slowness-without-route-level-evidence"),
    "common non-triggers must not justify reintroducing NestJS",
  );

  pass(hosting.project_id?.startsWith("appgprj_"), "Sites project_id is missing");
  pass(hosting.d1 === "DB", "the current Sites D1 binding must remain explicit");
  pass(packageJson.dependencies?.["@nestjs/common"] === undefined, "NestJS runtime is active in dependencies");
  pass(packageJson.dependencies?.["@nestjs/core"] === undefined, "NestJS core is active in dependencies");
  pass(/mode: "manual-only"/u.test(adPolicy), "advertising must remain manual-only");
  pass(/implementationStatus: "reserved-only"/u.test(adPolicy), "advertising source is not reserved-only");
  pass(
    !/adsbygoogle|pagead2|googlesyndication|ca-pub-/iu.test(layoutWithoutOwnershipMeta),
    "publisher delivery code was added before the activation gate",
  );
  pass(
    adsTxtAuthorized,
    "ads.txt must contain only the verified AdSense publisher authorization",
  );
  pass(
    /script-src 'self' 'nonce-\$\{nonce\}' 'strict-dynamic'/u.test(proxy)
      && /frame-src 'none'/u.test(proxy)
      && /connect-src 'self'/u.test(proxy),
    "pre-activation CSP must keep third-party delivery closed",
  );
  pass(
    /결정:\s*(?:[*]{2})?Sites 유지/u.test(architectureDecision)
      && /독립 NestJS HTTP 백엔드/u.test(architectureDecision)
      && /재현/u.test(architectureDecision)
      && /롤백/u.test(architectureDecision),
    "ADR-0001 must document the current decision, evidence, NestJS fallback, and rollback",
  );

  return {
    result: failures.length === 0 ? "pass" : "fail",
    decision: policy.currentPlatform?.decision ?? null,
    advertising: {
      platformFit: policy.advertising?.platformFit ?? null,
      activationState: policy.advertising?.activationState ?? null,
      prerequisiteCount: policy.advertising?.activationPrerequisites?.length ?? 0,
    },
    fallback: {
      target: policy.fallback?.target ?? null,
      triggerCount: policy.fallback?.triggers?.length ?? 0,
      evidenceGateCount: policy.fallback?.requiredEvidence?.length ?? 0,
    },
    currentControls: {
      sitesProjectConfigured: Boolean(hosting.project_id),
      d1Binding: hosting.d1 ?? null,
      publisherCodeAbsent: !/adsbygoogle|pagead2|googlesyndication|ca-pub-/iu.test(layoutWithoutOwnershipMeta),
      ownershipMetaPresent: rootLayout.includes(ownershipMeta),
      adsTxtAbsent: !adsTxtPresent,
      adsTxtAuthorized,
      thirdPartyCspClosed: /frame-src 'none'/u.test(proxy),
      nestRuntimeAbsent: packageJson.dependencies?.["@nestjs/core"] === undefined,
    },
    failures,
  };
}
