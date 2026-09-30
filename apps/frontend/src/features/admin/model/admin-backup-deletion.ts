import { ApiRequestError } from "@frontend/shared/api/request-json";
import { apiAction } from "./admin-api-client";

export type BackupDeletionResult = {
  deleted: string[];
  failed: Array<{ id: string; message: string }>;
  skipped: string[];
};

export async function deleteBackupsSequentially(
  selectedIds: readonly string[],
  onProgress: (finished: number, total: number) => void,
): Promise<BackupDeletionResult> {
  // Freeze the targets and limit storage load to one deletion at a time.
  const ids = [...new Set(selectedIds)];
  const result: BackupDeletionResult = { deleted: [], failed: [], skipped: [] };
  for (const [index, id] of ids.entries()) {
    try {
      const response = await apiAction<{ id: string; deleted: boolean }>("backup-delete", { id });
      if (response.id !== id || response.deleted !== true) throw new Error("삭제 결과를 확인하지 못했습니다. 목록을 새로고침해 주세요.");
      result.deleted.push(id);
    } catch (error) {
      result.failed.push({ id, message: error instanceof Error ? error.message : "삭제 실패" });
      if (error instanceof ApiRequestError && (error.status === 401 || error.status === 403)) {
        result.skipped = ids.slice(index + 1);
        onProgress(index + 1, ids.length);
        break;
      }
    }
    onProgress(index + 1, ids.length);
  }
  return result;
}
