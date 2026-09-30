import { adminRepository } from "./admin.repository";
import { OPERATIONAL_FRESHNESS_LIMIT_MS, evaluateOperationalFreshness } from "@shared/admin/backup-schedule.mjs";

type Row = Record<string, unknown>;

export async function readAdminOperationalStatus(
  period: { start: string; end: string },
  excludeAdmin: boolean,
) {
  const [
    autoBackupResult,
    lastAutomaticBackupResult,
    maintenanceResult,
    analyticsLifecycleResult,
    webVitalsResult,
    apiTimingsResult,
  ] = await adminRepository.readBatch([
    { sql: `
      SELECT value FROM site_settings WHERE key = 'auto_backup_enabled'
    ` },
    { sql: `
      SELECT created_at FROM backup_snapshots
      WHERE backup_type = 'auto-full' AND status = 'completed'
      ORDER BY created_at DESC LIMIT 1
    ` },
    { sql: `
      SELECT last_succeeded_at, last_failed_at, consecutive_failures, last_error
      FROM maintenance_runs WHERE task = 'operational_housekeeping'
    ` },
    { sql: `
      SELECT MIN(occurred_at) AS oldest_event_at,
        SUM(occurred_at < datetime(
          'now',
          '-' || COALESCE((SELECT value FROM site_settings WHERE key = 'analytics_retention_days'), '90') || ' days'
        )) AS expired_count,
        CAST(COALESCE((SELECT value FROM site_settings WHERE key = 'analytics_retention_days'), '90') AS INTEGER) AS retention_days
      FROM analytics_events
    ` },
    { sql: `
      WITH ranked AS (
        SELECT metric_name, metric_value,
          ROW_NUMBER() OVER (PARTITION BY metric_name ORDER BY metric_value) AS row_number,
          COUNT(*) OVER (PARTITION BY metric_name) AS total
        FROM analytics_events
        WHERE event_type = 'web_vital'
          AND occurred_at BETWEEN ? AND ?
          AND metric_name IS NOT NULL AND metric_value IS NOT NULL
          ${excludeAdmin ? "AND is_admin = 0" : ""}
      )
      SELECT metric_name, MAX(total) AS samples, AVG(metric_value) AS average,
        MIN(CASE WHEN row_number >= total * 0.50 THEN metric_value END) AS p50,
        MIN(CASE WHEN row_number >= total * 0.75 THEN metric_value END) AS p75,
        MIN(CASE WHEN row_number >= total * 0.95 THEN metric_value END) AS p95
      FROM ranked GROUP BY metric_name ORDER BY metric_name
    `, values: [period.start, period.end] },
    { sql: `
      SELECT api_route, http_status, retry_count, cache_source,
        COUNT(*) AS samples, AVG(duration_ms) AS average_duration_ms,
        MAX(duration_ms) AS maximum_duration_ms
      FROM analytics_events
      WHERE event_type = 'api_timing'
        AND occurred_at BETWEEN ? AND ?
        ${excludeAdmin ? "AND is_admin = 0" : ""}
      GROUP BY api_route, http_status, retry_count, cache_source
      ORDER BY samples DESC, api_route LIMIT 20
    `, values: [period.start, period.end] },
  ]);
  const autoBackupSetting = (autoBackupResult?.results ?? [])[0] as { value: string } | undefined;
  const lastAutomaticBackup = (lastAutomaticBackupResult?.results ?? [])[0] as { created_at: string } | undefined;
  const maintenanceStatus = (maintenanceResult?.results ?? [])[0] as {
    last_succeeded_at: string | null; last_failed_at: string | null;
    consecutive_failures: number; last_error: string;
  } | undefined;
  const analyticsLifecycle = (analyticsLifecycleResult?.results ?? [])[0] as {
    oldest_event_at: string | null; expired_count: number; retention_days: number;
  } | undefined;
  const webVitals = (webVitalsResult?.results ?? []) as Row[];
  const apiTimings = (apiTimingsResult?.results ?? []) as Row[];

  const operationalWarnings: string[] = [];
  if (autoBackupSetting?.value !== "true") {
    operationalWarnings.push("자동 백업이 비활성화되어 있습니다.");
  } else {
    const lastAutomaticBackupAt = lastAutomaticBackup?.created_at
      ? new Date(lastAutomaticBackup.created_at).getTime()
      : 0;
    if (!lastAutomaticBackupAt || Date.now() - lastAutomaticBackupAt > OPERATIONAL_FRESHNESS_LIMIT_MS) {
      operationalWarnings.push("자동 백업이 일일 실행 허용 시간을 넘겨 완료되지 않았습니다.");
    }
  }
  const maintenanceFreshness = evaluateOperationalFreshness({
    lastMaintenanceAt: maintenanceStatus?.last_succeeded_at ?? null,
    lastAutomaticBackupAt: lastAutomaticBackup?.created_at ?? null,
    consecutiveFailures: Number(maintenanceStatus?.consecutive_failures ?? 0),
  });
  if (!maintenanceFreshness.maintenanceFresh && Number(maintenanceStatus?.consecutive_failures ?? 0) === 0) {
    operationalWarnings.push("정기 유지보수가 26시간 이상 완료되지 않았습니다. 예약 실행 상태를 확인해 주세요.");
  }
  if (Number(maintenanceStatus?.consecutive_failures ?? 0) > 0) {
    operationalWarnings.push(
      `운영 유지보수 작업이 ${Number(maintenanceStatus?.consecutive_failures ?? 0)}회 연속 실패했습니다.`,
    );
  }

  return {
    operationalWarnings,
    retention: {
      retentionDays: Number(analyticsLifecycle?.retention_days ?? 90),
      oldestEventAt: analyticsLifecycle?.oldest_event_at ?? null,
      expiredRowCount: Number(analyticsLifecycle?.expired_count ?? 0),
      lastCleanupAt: maintenanceStatus?.last_succeeded_at ?? null,
      lastFailureAt: maintenanceStatus?.last_failed_at ?? null,
      consecutiveFailures: Number(maintenanceStatus?.consecutive_failures ?? 0),
    },
    performance: {
      webVitals: webVitals.map((row: Row) => ({
        metricName: String(row.metric_name ?? "unknown"),
        samples: Number(row.samples ?? 0),
        average: Number(row.average ?? 0),
        p50: Number(row.p50 ?? 0),
        p75: Number(row.p75 ?? 0),
        p95: Number(row.p95 ?? 0),
      })),
      apiTimings: apiTimings.map((row: Row) => ({
        route: String(row.api_route ?? "unknown"),
        status: Number(row.http_status ?? 0),
        retryCount: Number(row.retry_count ?? 0),
        cacheSource: String(row.cache_source ?? "unknown"),
        samples: Number(row.samples ?? 0),
        averageDurationMs: Number(row.average_duration_ms ?? 0),
        maximumDurationMs: Number(row.maximum_duration_ms ?? 0),
      })),
    },
  };
}
