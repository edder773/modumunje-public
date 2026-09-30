import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("retention and automatic backups run behind a bounded database lease", () => {
  const repository = source("apps/backend/src/modules/operations/operations.repository.ts");
  const service = source("apps/backend/src/modules/operations/operations.service.ts");
  const worker = source("apps/frontend/worker/index.ts");
  const adminApp = source("apps/frontend/src/features/admin/components/admin-app.tsx");
  const adminHandlers = source("apps/backend/src/modules/admin/admin-request-handlers.ts");
  const adminEntryBackup = source("apps/backend/src/modules/admin/admin-backup-entry.ts");
  const runtimeEnv = source("apps/backend/src/infrastructure/database/index.ts");
  const adminStatus = source("apps/backend/src/modules/admin/admin-operational-status.ts");
  const backupLifecycle = source("apps/backend/src/modules/admin/backup-lifecycle.ts");
  const schedule = source("packages/shared/src/admin/backup-schedule.mjs");
  const workflow = source(".github/workflows/operations.yml");
  assert.match(repository, /ON CONFLICT\(task\) DO UPDATE SET/u);
  assert.match(repository, /julianday\(maintenance_runs\.lease_until\) <= julianday\(excluded\.last_started_at\)/u);
  assert.match(repository, /LIMIT \?/u);
  assert.match(repository, /CLEANUP_BATCH_SIZE = 500/u);
  assert.match(service, /claimLease\(TASK, owner, 15\)/u);
  assert.match(service, /cleanupExpiredRows/u);
  assert.match(service, /maybeCreateAutomaticBackup/u);
  assert.match(service, /failLease/u);
  assert.match(service, /writeSystemError/u);
  assert.match(service, /readOperationalFreshness/u);
  assert.match(repository, /last_automatic_backup_at/u);
  assert.match(worker, /ctx\.waitUntil/u);
  assert.match(worker, /async scheduled/u);
  assert.match(worker, /\/api\/internal\/maintenance/u);
  assert.match(worker, /MAINTENANCE_TRIGGER_SECRET/u);
  assert.match(worker, /crypto\.subtle\.digest/u);
  assert.match(worker, /"Cache-Control": "no-store"/u);
  const conditionalEntryBackup = adminApp.match(
    /apiAction<\{ backupScheduleVerified: boolean \}>\("admin-session"\)[\s\S]*?\.then\(\(\{ backupScheduleVerified \}\) => \{\s*if \(!backupScheduleVerified\) return apiAction\("backup-auto-if-due"\);\s*\}\)/u,
  );
  assert.ok(conditionalEntryBackup, "the existing admin-entry backup remains enabled by default");
  assert.doesNotMatch(
    adminApp.replace(conditionalEntryBackup[0], ""),
    /apiAction\("backup-auto-if-due"\)/u,
    "no unconditional second backup call may bypass the verified-schedule gate",
  );
  assert.match(adminEntryBackup, /backupScheduleVerified: getRuntimeEnv\(\)\.BACKUP_SCHEDULE_VERIFIED === "true"/u);
  assert.match(adminHandlers, /result = adminSessionState\(\)/u);
  assert.match(adminHandlers, /await maybeAdminEntryBackup\(identity\)/u);
  assert.match(adminEntryBackup, /if \(adminSessionState\(\)\.backupScheduleVerified\) return/u);
  assert.match(runtimeEnv, /BACKUP_SCHEDULE_VERIFIED: processEnvironment\.BACKUP_SCHEDULE_VERIFIED/u);
  assert.match(adminStatus, /자동 백업이 비활성화되어 있습니다/u);
  assert.match(backupLifecycle, /AUTOMATIC_BACKUP_TASK = "automatic_backup"/u);
  assert.match(backupLifecycle, /ON CONFLICT\(task\) DO UPDATE SET/u);
  assert.match(schedule, /AUTOMATIC_BACKUP_MIN_INTERVAL_MS = 20 \* 60 \* 60 \* 1000/u);
  assert.match(schedule, /OPERATIONAL_FRESHNESS_LIMIT_MS = 26 \* 60 \* 60 \* 1000/u);
  assert.match(workflow, /cron: "37 18 \* \* \*"/u);
  assert.match(workflow, /secrets\.MAINTENANCE_TRIGGER_SECRET/u);
  assert.match(workflow, /maintenanceFresh == true/u);
  assert.match(workflow, /backupFresh == true/u);
  const fetchHandler = worker.slice(worker.indexOf("async fetch"), worker.indexOf("async scheduled"));
  assert.match(fetchHandler, /\/api\/internal\/maintenance/u);
  assert.doesNotMatch(fetchHandler.slice(fetchHandler.indexOf("return handler.fetch")), /scheduleMaintenance/u);
});

test("operational freshness rejects stale, failed, malformed, and future timestamps", async () => {
  const {
    AUTOMATIC_BACKUP_MIN_INTERVAL_MS,
    OPERATIONAL_FRESHNESS_LIMIT_MS,
    evaluateOperationalFreshness,
  } = await import("../packages/shared/src/admin/backup-schedule.mjs");
  assert.equal(AUTOMATIC_BACKUP_MIN_INTERVAL_MS, 20 * 60 * 60 * 1000);
  assert.equal(OPERATIONAL_FRESHNESS_LIMIT_MS, 26 * 60 * 60 * 1000);
  const now = Date.parse("2026-08-24T18:37:00.000Z");
  const healthy = evaluateOperationalFreshness({
    lastMaintenanceAt: "2026-08-24T18:36:00.000Z",
    lastAutomaticBackupAt: "2026-08-24T18:35:00.000Z",
    consecutiveFailures: 0,
  }, now);
  assert.equal(healthy.maintenanceFresh, true);
  assert.equal(healthy.backupFresh, true);
  assert.equal(evaluateOperationalFreshness({
    lastMaintenanceAt: "2026-08-24 18:36:00",
    lastAutomaticBackupAt: "2026-08-24 18:35:00",
    consecutiveFailures: 0,
  }, now).backupFresh, true);
  assert.equal(evaluateOperationalFreshness({
    lastMaintenanceAt: "2026-08-23T15:00:00.000Z",
    lastAutomaticBackupAt: "invalid",
    consecutiveFailures: 0,
  }, now).backupFresh, false);
  assert.equal(evaluateOperationalFreshness({
    lastMaintenanceAt: "2026-08-24T18:36:00.000Z",
    lastAutomaticBackupAt: "2026-08-24T18:35:00.000Z",
    consecutiveFailures: 1,
  }, now).maintenanceFresh, false);
  assert.equal(evaluateOperationalFreshness({
    lastMaintenanceAt: "2026-08-24T19:00:00.000Z",
    lastAutomaticBackupAt: "2026-08-24T19:00:00.000Z",
    consecutiveFailures: 0,
  }, now).backupFresh, false);
});

test("health is shallow, real, and separates deployment metadata from database state", () => {
  const service = source("apps/backend/src/modules/health/health.service.ts");
  const repository = source("apps/backend/src/modules/health/health.repository.ts");
  const route = source("apps/frontend/app/api/health/route.ts");
  const worker = source("apps/frontend/worker/index.ts");
  assert.match(service, /__BAEUMZIP_BUILD_SHA__/u);
  assert.match(service, /__BAEUMZIP_BUILT_AT__/u);
  assert.match(service, /__BAEUMZIP_APP_VERSION__/u);
  assert.match(service, /PUBLIC_HEALTH_CACHE_MS = 10_000/u);
  assert.match(service, /export async function readHealthDiagnostics/u);
  assert.match(service, /status: diagnostics[.]status,[\s\S]*service: diagnostics[.]service/u);
  assert.match(worker, /readHealthDiagnostics/u);
  assert.match(worker, /application,/u);
  assert.match(repository, /SELECT 1 AS reachable/u);
  assert.match(repository, /app_schema_state/u);
  assert.match(repository, /content_releases/u);
  assert.match(repository, /sqlite_master/u);
  assert.match(repository, /json_group_array/u);
  assert.doesNotMatch(repository, /Promise\.all/u);
  assert.doesNotMatch(repository, /COUNT\(\*\).*questions|checksum|json_each/su);
  assert.match(route, /GET as handleHealthGet/u);
  assert.match(route, /GET = \(request: Request\) => handleHealthGet\(request\)/u);
});

test("dependency updates, full audits, and private disclosure stay automated", () => {
  const dependabot = source(".github/dependabot.yml");
  const securityWorkflow = source(".github/workflows/security.yml");
  const ciWorkflow = source(".github/workflows/ci.yml");
  const policy = source("SECURITY.md");
  assert.match(dependabot, /package-ecosystem: npm/u);
  assert.match(dependabot, /package-ecosystem: github-actions/u);
  assert.match(dependabot, /production-dependencies:[\s\S]*update-types:[\s\S]*- minor[\s\S]*- patch/u);
  assert.match(dependabot, /development-dependencies:[\s\S]*update-types:[\s\S]*- minor[\s\S]*- patch/u);
  assert.match(dependabot, /dependency-name: ["']?\*["']?[\s\S]*version-update:semver-major/u);
  assert.match(securityWorkflow, /npm audit --audit-level=low/u);
  assert.match(ciWorkflow, /npm audit --audit-level=low/u);
  assert.match(policy, /비공개 보안 권고/u);
  assert.match(policy, /GOOGLE_AUTH_SESSION_SECRET/u);
});

test("system errors aggregate repeated fingerprints instead of growing unbounded", () => {
  const observability = source("apps/backend/src/common/observability/index.ts");
  assert.match(observability, /occurrence_count = occurrence_count \+ 1/u);
  assert.match(observability, /'-5 minutes'/u);
  assert.match(observability, /if \(Number\(repeated\.meta\.changes/u);
});
