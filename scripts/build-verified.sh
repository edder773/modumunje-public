#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${SITES_ENV_READY:-}" != "1" ]]; then
  exec "${script_dir}/sites-env.sh" -- "$0" "$@"
fi

vinext="${SITES_PROJECT_ROOT}/node_modules/.bin/vinext"
if [[ ! -x "${vinext}" ]]; then
  echo "vinext is unavailable. Run npm run install:ci and wait for it to finish before building." >&2
  exit 69
fi

# Make deployment identity an explicit build input so incremental bundler caches
# cannot retain metadata from the previously built commit. Resolve it separately
# because a failed command substitution inside an assignment does not reliably
# stop every Bash version even with `set -e` enabled.
if [[ -z "${BAEUMZIP_BUILD_SHA:-}" ]]; then
  if ! BAEUMZIP_BUILD_SHA="$(git -C "${SITES_PROJECT_ROOT}" rev-parse HEAD)"; then
    echo "Unable to resolve the source commit for the production build." >&2
    exit 65
  fi
fi
if [[ ! "${BAEUMZIP_BUILD_SHA}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "BAEUMZIP_BUILD_SHA must be a full lowercase Git commit SHA." >&2
  exit 65
fi
export BAEUMZIP_BUILD_SHA="${BAEUMZIP_BUILD_SHA}"
export BAEUMZIP_BUILT_AT="${BAEUMZIP_BUILT_AT:-$(date -u +"%Y-%m-%dT%H:%M:%SZ")}"

echo "Verifying security-sensitive build inputs..."
node "${script_dir}/verify-security-baseline.mjs"

echo "Verifying runtime hosting strategy..."
node "${script_dir}/audit-hosting-strategy.mjs"

echo "Verifying production module reachability..."
node "${script_dir}/audit-module-usage.mjs"

echo "Verifying generated course registry..."
node "${script_dir}/generate-course-registry.mjs" --check

echo "Verifying generated SW curriculum..."
node "${script_dir}/generate-sw-curriculum.mjs" --check

echo "Verifying the preserved S1 release..."
node "${script_dir}/generate-ipe-s1-upgrade-release.mjs" --check
node "${script_dir}/generate-ipe-s1-extra-questions.mjs" --check
node "${script_dir}/generate-ise-p1-questions.mjs" --check

echo "Verifying the S2 content release..."
node "${script_dir}/generate-ipe-s2-upgrade-release.mjs" --check

echo "Verifying the S3 content release..."
node "${script_dir}/generate-ipe-s3-upgrade-release.mjs" --check

echo "Verifying the S4 content release..."
node "${script_dir}/generate-ipe-s4-upgrade-release.mjs" --check

echo "Verifying the S5 content release..."
node "${script_dir}/generate-ipe-s5-upgrade-release.mjs" --check

echo "Verifying the practical IPE content release..."
node "${script_dir}/generate-ipe-practical-release.mjs" --check
node "${script_dir}/generate-ipe-practical-enhancement.mjs" --check
node "${script_dir}/generate-ipe-practical-past.mjs" --check

echo "Verifying information security theories and diagrams..."
node "${script_dir}/generate-ise-p1-diagrams.mjs" --check
node "${script_dir}/generate-ise-p1-theories.mjs" --check
node "${script_dir}/generate-ise-p2-diagrams.mjs" --check
node "${script_dir}/generate-ise-p2-theories.mjs" --check
node "${script_dir}/generate-ise-p3-diagrams.mjs" --check
node "${script_dir}/generate-ise-p3-theories.mjs" --check
node "${script_dir}/generate-ise-p4-diagrams.mjs" --check
node "${script_dir}/generate-ise-p4-theories.mjs" --check
node "${script_dir}/generate-ise-p5-diagrams.mjs" --check
node "${script_dir}/generate-ise-p5-theories.mjs" --check

echo "Verifying local practice content and downloads..."
node "${script_dir}/generate-bae-type1.mjs" --check
node "${script_dir}/generate-bae-type2.mjs" --check
node "${script_dir}/generate-bae-type3.mjs" --check

echo "Verifying redrawn practical question diagrams..."
node "${script_dir}/generate-ipe-practical-diagrams.mjs" --check
node "${script_dir}/generate-private-diagrams.mjs" --check

echo "Verifying per-course content releases..."
node "${script_dir}/generate-course-content-releases.mjs" --check

echo "Verifying server-only recovery content..."
node "${script_dir}/generate-server-question-bank.mjs" --check

echo "Verifying the schema/content delivery boundary..."
node "${script_dir}/audit-content-delivery.mjs" --quick

echo "Verifying the deterministic schema baseline..."
node "${script_dir}/generate-schema-baseline.mjs" --check

echo "Verifying the independent database bootstrap..."
node "${script_dir}/generate-database-bootstrap.mjs" --check

echo "Verifying DAsP/DAP question-to-theory links..."
node "${script_dir}/generate-da-question-theory-links.mjs" --check

echo "Type-checking the complete workspace..."
"${SITES_PROJECT_ROOT}/node_modules/.bin/tsc" --noEmit -p "${SITES_PROJECT_ROOT}/tsconfig.json"

"${SITES_PROJECT_ROOT}/node_modules/.bin/tsc" --noEmit -p "${SITES_PROJECT_ROOT}/tsconfig.core-js.json"

echo "Running vinext build..."
if command -v timeout >/dev/null; then
  timeout \
    --signal=TERM \
    --kill-after="${SITES_BUILD_KILL_AFTER:-10s}" \
    "${SITES_BUILD_TIMEOUT:-3m}" \
    "${vinext}" build
elif command -v gtimeout >/dev/null; then
  gtimeout \
    --signal=TERM \
    --kill-after="${SITES_BUILD_KILL_AFTER:-10s}" \
    "${SITES_BUILD_TIMEOUT:-3m}" \
    "${vinext}" build
else
  echo "GNU timeout is unavailable; running vinext without a watchdog." >&2
  "${vinext}" build
fi

node --import tsx "${script_dir}/generate-static-asset-headers.ts"

"${script_dir}/validate-artifact.sh"
