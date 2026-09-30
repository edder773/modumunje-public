export const AUTOMATIC_BACKUP_MIN_INTERVAL_MS = 20 * 60 * 60 * 1000;
export const OPERATIONAL_FRESHNESS_LIMIT_MS = 26 * 60 * 60 * 1000;

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

function isFreshTimestamp(value, now, maximumAge) {
  if (!value) return false;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/u.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) return false;
  const age = now - timestamp;
  return age >= -MAX_CLOCK_SKEW_MS && age <= maximumAge;
}

export function evaluateOperationalFreshness(status, now = Date.now()) {
  const consecutiveFailures = Number(status?.consecutiveFailures ?? 0);
  return {
    lastMaintenanceAt: status?.lastMaintenanceAt ?? null,
    lastAutomaticBackupAt: status?.lastAutomaticBackupAt ?? null,
    consecutiveFailures,
    maintenanceFresh: consecutiveFailures === 0 && isFreshTimestamp(
      status?.lastMaintenanceAt,
      now,
      OPERATIONAL_FRESHNESS_LIMIT_MS,
    ),
    backupFresh: isFreshTimestamp(
      status?.lastAutomaticBackupAt,
      now,
      OPERATIONAL_FRESHNESS_LIMIT_MS,
    ),
  };
}
