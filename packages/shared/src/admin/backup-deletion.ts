export function canDeleteBackup(item: { status: string; backup_type: string }) {
  return (item.status === "completed" || item.status === "failed")
    && item.backup_type !== "restore-stage";
}
