import { adminRepository } from "./admin.repository";

const STALLED_BACKUP_MESSAGE = "백업 요청이 중단되어 완료되지 않았습니다.";
const AUTOMATIC_BACKUP_TASK = "automatic_backup";
const BACKUP_CREATE_TASK = "backup_create";
const RESTORE_TASK = "backup_restore";

export async function expireStalledBackups() {
  await adminRepository.batch([
    {
      sql: `
        UPDATE backup_snapshots
        SET status = 'failed', error_message = ?
        WHERE status = 'creating'
          AND julianday(created_at) < julianday('now', '-15 minutes')
          AND (CASE WHEN json_valid(payload)
            THEN COALESCE(json_extract(payload, '$.kind'), '') ELSE '' END) <> 'external-progress'
      `,
      values: [STALLED_BACKUP_MESSAGE],
    },
    {
      sql: `
        UPDATE maintenance_runs
        SET lease_owner = '', lease_until = NULL
        WHERE task = ?
          AND julianday(last_started_at) < julianday('now', '-15 minutes')
          AND EXISTS (
            SELECT 1 FROM backup_snapshots
            WHERE status = 'failed' AND error_message = ?
              AND julianday(created_at) >= julianday(maintenance_runs.last_started_at)
          )
      `,
      values: [BACKUP_CREATE_TASK, STALLED_BACKUP_MESSAGE],
    },
    {
      sql: `
        DELETE FROM backup_chunks
        WHERE snapshot_id IN (
          SELECT id FROM backup_snapshots
          WHERE status = 'failed' AND error_message = ?
        )
      `,
      values: [STALLED_BACKUP_MESSAGE],
    },
  ]);
}

export async function claimAutomaticBackupLease(owner: string) {
  const timestamp = new Date().toISOString();
  const result = await adminRepository.execute(`
    INSERT INTO maintenance_runs (
      task, lease_owner, lease_until, last_started_at, updated_at
    ) VALUES (?, ?, datetime(?, '+20 minutes'), ?, ?)
    ON CONFLICT(task) DO UPDATE SET
      lease_owner = excluded.lease_owner,
      lease_until = excluded.lease_until,
      last_started_at = excluded.last_started_at,
      updated_at = excluded.updated_at
    WHERE maintenance_runs.lease_until IS NULL
       OR julianday(maintenance_runs.lease_until) <= julianday(excluded.last_started_at)
  `, [AUTOMATIC_BACKUP_TASK, owner, timestamp, timestamp, timestamp]);
  return Number(result.meta.changes ?? 0) > 0;
}

export async function completeAutomaticBackupLease(owner: string) {
  const timestamp = new Date().toISOString();
  await adminRepository.execute(`
    UPDATE maintenance_runs
    SET lease_owner = '', lease_until = NULL, last_succeeded_at = ?,
        consecutive_failures = 0, last_error = '', updated_at = ?
    WHERE task = ? AND lease_owner = ?
  `, [timestamp, timestamp, AUTOMATIC_BACKUP_TASK, owner]);
}

export async function failAutomaticBackupLease(owner: string, message: string) {
  const timestamp = new Date().toISOString();
  await adminRepository.execute(`
    UPDATE maintenance_runs
    SET lease_owner = '', lease_until = NULL, last_failed_at = ?,
        consecutive_failures = consecutive_failures + 1,
        last_error = ?, updated_at = ?
    WHERE task = ? AND lease_owner = ?
  `, [timestamp, message.slice(0, 500), timestamp, AUTOMATIC_BACKUP_TASK, owner]);
}

async function claimLease(task: string, owner: string, minutes: number) {
  const timestamp = new Date().toISOString();
  const result = await adminRepository.execute(`
    INSERT INTO maintenance_runs (
      task, lease_owner, lease_until, last_started_at, updated_at
    ) VALUES (?, ?, datetime(?, '+' || ? || ' minutes'), ?, ?)
    ON CONFLICT(task) DO UPDATE SET
      lease_owner = excluded.lease_owner,
      lease_until = excluded.lease_until,
      last_started_at = excluded.last_started_at,
      updated_at = excluded.updated_at
    WHERE maintenance_runs.lease_until IS NULL
       OR julianday(maintenance_runs.lease_until) <= julianday(excluded.last_started_at)
  `, [task, owner, timestamp, minutes, timestamp, timestamp]);
  return Number(result.meta.changes ?? 0) > 0;
}

async function completeLease(task: string, owner: string) {
  const timestamp = new Date().toISOString();
  await adminRepository.execute(`
    UPDATE maintenance_runs
    SET lease_owner = '', lease_until = NULL, last_succeeded_at = ?,
        consecutive_failures = 0, last_error = '', updated_at = ?
    WHERE task = ? AND lease_owner = ?
  `, [timestamp, timestamp, task, owner]);
}

async function failLease(task: string, owner: string, message: string) {
  const timestamp = new Date().toISOString();
  await adminRepository.execute(`
    UPDATE maintenance_runs
    SET lease_owner = '', lease_until = NULL, last_failed_at = ?,
        consecutive_failures = consecutive_failures + 1,
        last_error = ?, updated_at = ?
    WHERE task = ? AND lease_owner = ?
  `, [timestamp, message.slice(0, 500), timestamp, task, owner]);
}

export function claimRestoreLease(owner: string) {
  return claimLease(RESTORE_TASK, owner, 30);
}

export function completeRestoreLease(owner: string) {
  return completeLease(RESTORE_TASK, owner);
}

export function failRestoreLease(owner: string, message: string) {
  return failLease(RESTORE_TASK, owner, message);
}

export function claimBackupCreationLease(owner: string) {
  return claimLease(BACKUP_CREATE_TASK, owner, 30);
}

// A manual external step is bounded to one 100-row page; an interrupted invocation
// releases its claim after three minutes without invalidating durable progress.
export function claimBackupCreationStepLease(owner: string) {
  return claimLease(BACKUP_CREATE_TASK, owner, 3);
}

export function completeBackupCreationLease(owner: string) {
  return completeLease(BACKUP_CREATE_TASK, owner);
}

export function failBackupCreationLease(owner: string, message: string) {
  return failLease(BACKUP_CREATE_TASK, owner, message);
}
