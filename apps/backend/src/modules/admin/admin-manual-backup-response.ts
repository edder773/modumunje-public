import { writeSystemError } from "@backend/common/observability";
import { createBackup, type BackupType } from "./admin-backup-use-cases";
import { advanceManualExternalBackup, cancelManualExternalBackup } from "./admin-manual-external-backup-use-cases";
import { readBackupList } from "./admin-read-use-cases";
import { BACKUP_TABLES, errorMessage, type AdminIdentity, type JsonRecord } from "./admin-use-case-runtime";

// A manual backup and its read-after-write metadata share the durable action
// budget. The list is optional; the completed backup itself is never optional.
export async function createManualBackupResponse(identity: AdminIdentity, payload: JsonRecord) {
  if (payload.action === "backup-cancel") {
    const canceled = await cancelManualExternalBackup(identity, String(payload.backupId ?? ""));
    return { response: canceled, audit: canceled };
  }
  const type = String(payload.type ?? "full") as BackupType;
  if (!Object.hasOwn(BACKUP_TABLES, type)) throw new Error("백업 유형이 유효하지 않습니다.");
  // Tabs opened before this deployment do not send backupId. Keep their
  // original one-shot response contract; only the new client opts into steps.
  if (typeof payload.backupId === "string" && payload.storageMode === "external" && type !== "settings") {
    const created = await advanceManualExternalBackup(
      identity, type, Boolean(payload.includeAnalytics), String(payload.backupId ?? ""),
    );
    // An intermediate step must not spend time on the optional list readback.
    let backupList: Awaited<ReturnType<typeof readBackupList>> | null = null;
    if (created.completed) {
      try { backupList = await readBackupList(); } catch { /* Completed snapshot stays successful. */ }
    }
    return { response: { ...created, backupList }, audit: created };
  }
  const created = await createBackup(identity, type, {
    includeAnalytics: Boolean(payload.includeAnalytics),
    storageMode: payload.storageMode === "external"
      ? "external"
      : payload.storageMode === "database" ? "database" : undefined,
  });
  let backupList: Awaited<ReturnType<typeof readBackupList>> | null = null;
  try {
    backupList = await readBackupList();
  } catch (error) {
    // Diagnostic formatting and persistence are both best-effort.
    try {
      await writeSystemError({
        errorType: "admin_backup_list_readback_failed",
        pagePath: "/admin/backups",
        message: errorMessage(error),
      });
    } catch { /* Preserve the completed backup result. */ }
  }
  return { response: { ...created, backupList }, audit: created };
}
