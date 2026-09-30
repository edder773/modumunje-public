import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const retiredPaths = [
  "apps/frontend/app/admin-review/page.tsx",
  "apps/frontend/app/admin-review/layout.tsx",
  "apps/frontend/app/admin-review/[section]/page.tsx",
  "apps/frontend/app/api/admin-review-session/route.ts",
  "apps/frontend/src/features/admin-review/pages/review-page.tsx",
  "apps/frontend/src/features/admin-review/components/review-access.tsx",
  "apps/backend/src/modules/admin-review/admin-review.module.ts",
  "apps/backend/src/modules/admin-review/admin-review.controller.ts",
  "apps/backend/src/modules/admin-review/admin-review.service.ts",
  "apps/backend/src/modules/admin-review/admin-review.repository.ts",
  "apps/backend/src/modules/admin-review/domain/admin-review.domain.ts",
];

const runtimeContractFiles = [
  ".env.example",
  "vite.config.ts",
  "apps/backend/src/common/auth/admin-auth.ts",
  "apps/backend/src/infrastructure/database/index.ts",
  "apps/frontend/src/server/auth/page-session.ts",
  "apps/frontend/worker/index.ts",
  "packages/shared/src/auth/page-session.ts",
];

test("temporary administrator review surface stays retired", () => {
  for (const path of retiredPaths) {
    assert.equal(existsSync(path), false, `${path} must remain absent`);
  }
  for (const path of runtimeContractFiles) {
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(source, /admin-review|ADMIN_REVIEW|AdminReview|reviewer/u, path);
  }
});
