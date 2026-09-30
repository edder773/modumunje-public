const documentationPatterns = [
  /^docs\//u,
  /(?:^|\/)README(?:[.][^/]+)?$/iu,
  /[.]md$/iu,
];

const dataPatterns = [
  /^apps\/backend\/drizzle\//u,
  /^apps\/backend\/src\/infrastructure\/database\/schema[.]ts$/u,
  /^apps\/backend\/resources\/content\//u,
  /^apps\/backend\/resources\/course-registry\//u,
  /^apps\/backend\/src\/common\/content\//u,
  /^packages\/shared\/src\/admin\/backup-contract[.]mjs$/u,
  /^packages\/shared\/src\/content\//u,
  /^packages\/shared\/src\/study\/course-(?:registry[.]source[.]json|contract[.](?:mjs|d[.]mts))$/u,
  /^packages\/shared\/src\/study\/course-release-contract[.](?:mjs|d[.]mts)$/u,
  /^scripts\/generate-course-(?:registry|content-releases)[.]mjs$/u,
  /^scripts\/(?:audit-content-delivery|content-release|promote-content-release|verify-content-release|verify-backup-recovery|verify-data-integrity|verify-ipe-site-integrations|measure-(?:scoped-payloads|latency-improvements))[.]mjs$/u,
  /^scripts\/(?:prepare-test-database|verify-migration-safety|verify-schema-model)[.]mjs$/u,
  /^scripts\/lib\/(?:backup-recovery-verifier|canonical-database|content-delivery|content-release(?:-gate)?|data-integrity|migration-safety)[.]mjs$/u,
  /^scripts\/lib\/ipe-site-integration-verifier[.]mjs$/u,
  /^scripts\/lib\/course-registry-generator[.]mjs$/u,
];

const deepNodeTestPatterns = [
  /^scripts\/run-node-tests[.]mjs$/u,
  /^tests\/(?:admin-export(?:-worker)?|advanced-code-plan-import-round40|content-delivery-stage9|content-release-(?:gate|pipeline)|course-content-release-stage3|operational-migration|reviewed-question-replacement-round18|sqlp-learning-pairs-round39|subject3-question-refresh-round33|sw-profile-query-performance|theory-summary-report-overflow-round40)[.]test[.]mjs$/u,
];

const rootFrontendServerPatterns = [
  /^proxy[.]ts$/u,
];

const e2ePatterns = [
  ...rootFrontendServerPatterns,
  /^apps\/frontend\//u,
  /^apps\/backend\/src\//u,
  /^package(?:-lock)?[.]json$/u,
  /^packages\/shared\//u,
  /^scripts\/run-node-tests[.]mjs$/u,
  /^tests\/ipe-public-assets[.]test[.]mjs$/u,
  /^tests\/e2e\//u,
  /^playwright(?:[.][^.]+)?[.]config[.]ts$/u,
  /^(?:vite|next)[.]config[.]/u,
];

const frontendTestPatterns = [
  /^tests\/(?:branding|frontend|home-|learner-ux|performance-stage9|platform-hierarchy|public-landing|service-entry|ui-).*[.]test[.]mjs$/u,
];

const frontendScopedPatterns = [
  ...rootFrontendServerPatterns,
  /^apps\/frontend\//u,
  /^tests\/e2e\//u,
  /^playwright(?:[.][^.]*)?[.]config[.]ts$/u,
  /^(?:vite|next)[.]config[.]/u,
  ...frontendTestPatterns,
];

const frontendServerPatterns = [
  ...rootFrontendServerPatterns,
  /^apps\/frontend\/app\/api\//u,
  /^apps\/frontend\/src\/server\//u,
  /^apps\/frontend\/src\/shared\/api\//u,
  /^apps\/frontend\/(?:middleware|proxy|worker)(?:[./]|$)/u,
];

const fullE2ePatterns = [
  /^apps\/backend\/src\//u,
  /^packages\/shared\//u,
  ...frontendServerPatterns,
  /^tests\/e2e\//u,
  /^playwright(?:[.][^.]*)?[.]config[.]ts$/u,
  /^(?:vite|next)[.]config[.]/u,
];

function matchesAny(file, patterns) {
  return patterns.some((pattern) => pattern.test(file));
}

export function classifyChanges(files, { full = false } = {}) {
  const normalized = files.map((file) => file.trim()).filter(Boolean);
  const docsOnly = normalized.length > 0
    && normalized.every((file) => matchesAny(file, documentationPatterns));
  const source = full || (normalized.length > 0 && !docsOnly);
  const frontendOnly = !full && source && normalized.length > 0
    && normalized.every((file) => matchesAny(file, frontendScopedPatterns))
    && !normalized.some((file) => matchesAny(file, frontendServerPatterns));
  return {
    build: source,
    data: full || normalized.some((file) => matchesAny(file, dataPatterns)),
    deepNodeTests: full || normalized.some((file) => (
      matchesAny(file, dataPatterns) || matchesAny(file, deepNodeTestPatterns)
    )),
    dependencies: full || normalized.some((file) => /(?:^|\/)package(?:-lock)?[.]json$/u.test(file)),
    docsOnly,
    e2e: full || normalized.some((file) => matchesAny(file, e2ePatterns)),
    e2eFull: full || normalized.some((file) => matchesAny(file, fullE2ePatterns)),
    frontendNodeTests: frontendOnly,
    nodeTests: source && !frontendOnly,
    prepareDatabase: source && !frontendOnly,
    source,
  };
}
