import { DatabaseRepository } from "@backend/infrastructure/database/database.repository";

const CLEANUP_BATCH_SIZE = 500;

export class OperationsRepository extends DatabaseRepository {
  async claimLease(task: string, owner: string, leaseMinutes: number) {
    const timestamp = new Date().toISOString();
    const result = await this.connection().prepare(`
      INSERT INTO maintenance_runs (
        task, lease_owner, lease_until, last_started_at, updated_at
      ) VALUES (?, ?, datetime(?, ?), ?, ?)
      ON CONFLICT(task) DO UPDATE SET
        lease_owner = excluded.lease_owner,
        lease_until = excluded.lease_until,
        last_started_at = excluded.last_started_at,
        updated_at = excluded.updated_at
      WHERE maintenance_runs.lease_until IS NULL
         OR julianday(maintenance_runs.lease_until) <= julianday(excluded.last_started_at)
    `).bind(task, owner, timestamp, `+${leaseMinutes} minutes`, timestamp, timestamp).run();
    return Number(result.meta.changes ?? 0) > 0;
  }

  async analyticsRetentionDays() {
    const setting = await this.connection().prepare(`
      SELECT value FROM site_settings WHERE key = 'analytics_retention_days'
    `).first<{ value: string }>();
    const parsed = Number(setting?.value ?? 90);
    return Number.isInteger(parsed) ? Math.max(7, Math.min(730, parsed)) : 90;
  }

  async readFreshness(task: string) {
    const row = await this.connection().prepare(`
      SELECT
        (SELECT last_succeeded_at FROM maintenance_runs WHERE task = ?) AS last_maintenance_at,
        (SELECT consecutive_failures FROM maintenance_runs WHERE task = ?) AS consecutive_failures,
        (
          SELECT created_at FROM backup_snapshots
          WHERE backup_type = 'auto-full' AND status = 'completed'
          ORDER BY created_at DESC LIMIT 1
        ) AS last_automatic_backup_at
    `).bind(task, task).first<{
      last_maintenance_at: string | null;
      consecutive_failures: number | null;
      last_automatic_backup_at: string | null;
    }>();
    return {
      lastMaintenanceAt: row?.last_maintenance_at ?? null,
      lastAutomaticBackupAt: row?.last_automatic_backup_at ?? null,
      consecutiveFailures: Number(row?.consecutive_failures ?? 0),
    };
  }

  async cleanupExpiredRows(retentionDays: number) {
    const database = this.connection();
    // Guest keys have a fixed, signed 24-hour expiry. Only this reserved
    // namespace is eligible; member records and historical data are untouched.
    const guestSessions = await database.batch([
      ...["exam_sessions", "sw_learning_sessions"].map((table) => database.prepare(`
        DELETE FROM ${table} WHERE id IN (
          SELECT id FROM ${table}
          WHERE user_key GLOB 'guest:[0-9]*:*'
            AND CAST(substr(user_key, 7, 10) AS INTEGER) < unixepoch('now')
          ORDER BY user_key LIMIT ?
        )
      `).bind(CLEANUP_BATCH_SIZE)),
    ]);
    const analytics = await database.prepare(`
      DELETE FROM analytics_events
      WHERE id IN (
        SELECT id FROM analytics_events
        WHERE occurred_at < datetime('now', ?)
        ORDER BY occurred_at, id LIMIT ?
      )
    `).bind(`-${retentionDays} days`, CLEANUP_BATCH_SIZE).run();
    const audits = await database.prepare(`
      DELETE FROM admin_audit_logs
      WHERE id IN (
        SELECT id FROM admin_audit_logs
        WHERE created_at < datetime('now', '-365 days')
        ORDER BY created_at, id LIMIT ?
      )
    `).bind(CLEANUP_BATCH_SIZE).run();
    const errors = await database.prepare(`
      DELETE FROM system_errors
      WHERE id IN (
        SELECT id FROM system_errors
        WHERE (status != 'open' AND COALESCE(last_seen_at, created_at) < datetime('now', '-90 days'))
           OR (status = 'open' AND COALESCE(last_seen_at, created_at) < datetime('now', '-365 days'))
        ORDER BY COALESCE(last_seen_at, created_at), id LIMIT ?
      )
    `).bind(CLEANUP_BATCH_SIZE).run();
    return {
      guestSessions: guestSessions.reduce((sum, result) => sum + Number(result.meta.changes ?? 0), 0),
      analytics: Number(analytics.meta.changes ?? 0),
      audits: Number(audits.meta.changes ?? 0),
      errors: Number(errors.meta.changes ?? 0),
    };
  }

  async completeLease(task: string, owner: string) {
    const timestamp = new Date().toISOString();
    await this.connection().prepare(`
      UPDATE maintenance_runs
      SET lease_owner = '', lease_until = NULL, last_succeeded_at = ?,
          consecutive_failures = 0, last_error = '', updated_at = ?
      WHERE task = ? AND lease_owner = ?
    `).bind(timestamp, timestamp, task, owner).run();
  }

  async failLease(task: string, owner: string, message: string) {
    const timestamp = new Date().toISOString();
    await this.connection().prepare(`
      UPDATE maintenance_runs
      SET lease_owner = '', lease_until = NULL, last_failed_at = ?,
          consecutive_failures = consecutive_failures + 1,
          last_error = ?, updated_at = ?
      WHERE task = ? AND lease_owner = ?
    `).bind(timestamp, message.slice(0, 500), timestamp, task, owner).run();
  }
}
