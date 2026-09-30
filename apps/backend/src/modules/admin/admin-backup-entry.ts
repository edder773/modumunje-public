import { getRuntimeEnv } from "@backend/infrastructure/database";
import { maybeCreateAutomaticBackup } from "./admin-backup-use-cases";
import type { AdminIdentity } from "./admin-use-case-runtime";

export function adminSessionState() {
  return {
    ok: true,
    backupScheduleVerified: getRuntimeEnv().BACKUP_SCHEDULE_VERIFIED === "true",
  };
}

export async function maybeAdminEntryBackup(identity: AdminIdentity) {
  // An old open tab can still call this endpoint after schedule verification.
  // Scheduled operations call maybeCreateAutomaticBackup directly and remain active.
  if (adminSessionState().backupScheduleVerified) return;
  return maybeCreateAutomaticBackup(identity);
}
