import { writeSystemError } from "@backend/common/observability";
import { maybeCreateAutomaticBackup } from "@backend/modules/admin/admin-backup-use-cases";
import { evaluateOperationalFreshness } from "@shared/admin/backup-schedule.mjs";
import { OperationsRepository } from "./operations.repository";

const TASK = "operational_housekeeping";

export async function readOperationalFreshness(
  repository = new OperationsRepository(),
) {
  return evaluateOperationalFreshness(await repository.readFreshness(TASK));
}

export async function runOperationalMaintenance(
  repository = new OperationsRepository(),
) {
  const owner = crypto.randomUUID();
  if (!await repository.claimLease(TASK, owner, 15)) {
    return {
      claimed: false,
      cleanup: null,
      backup: null,
      freshness: await readOperationalFreshness(repository),
    };
  }
  try {
    const retentionDays = await repository.analyticsRetentionDays();
    const cleanup = await repository.cleanupExpiredRows(retentionDays);
    const backup = await maybeCreateAutomaticBackup({
      email: "scheduled-maintenance@baeumzip.local",
      hash: "scheduled-maintenance",
    });
    await repository.completeLease(TASK, owner);
    return {
      claimed: true,
      retentionDays,
      cleanup,
      backup: backup ?? null,
      freshness: await readOperationalFreshness(repository),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Operational maintenance failed";
    await repository.failLease(TASK, owner, message).catch(() => undefined);
    await writeSystemError({
      errorType: "operational_maintenance_failed",
      pagePath: "/internal/maintenance",
      impact: "retention_or_backup_delayed",
      message,
    });
    throw error;
  }
}
