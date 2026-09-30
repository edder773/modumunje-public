import { apiAction } from "@frontend/features/admin/model/admin-api-client";
import { ApiRequestError } from "@frontend/shared/api/request-json";

export type DurableBackupKind = "content" | "learning" | "full";
type DurableStep = {
  id: string;
  completed: boolean;
  canceled?: boolean;
  backupList?: unknown;
  progress?: { phase: string; tableIndex: number; tableCount: number; revision: number };
};

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export function durableRetryDelay(error: unknown, failures: number): number | null {
  if (!(error instanceof ApiRequestError)) return null;
  if (error.status === 429) {
    // The worker's 120/min application limit is independent of backup work.
    // Respect its Retry-After rather than retrying in a three-second burst.
    return Math.max(1_000, error.retryAfterMs ?? 60_000);
  }
  if (error.status === 401 || error.status === 403) return null;
  if (/다른 백업 단계가 진행 중/u.test(error.message)) return 185_000;
  if (error.status === 400 || error.status === 404 || error.status === 422) return null;
  if (!error.retryable && !(typeof error.status === "number" && error.status >= 500)) return null;
  return Math.min(30_000, 3_000 * 2 ** Math.min(failures, 3));
}

export async function runDurableAdminBackup(options: {
  backupId: string;
  type: DurableBackupKind;
  includeAnalytics: boolean;
  shouldCancel: () => boolean;
  onProgress: (message: string) => void;
  action?: (name: string, values: Record<string, unknown>) => Promise<DurableStep>;
  sleep?: (ms: number) => Promise<void>;
}) {
  const action = options.action ?? ((name: string, values: Record<string, unknown>) => apiAction<DurableStep>(name, values));
  const sleep = options.sleep ?? wait;
  let lastRevision = -1;
  let errors = 0;
  let rateLimits = 0;
  for (let steps = 0; steps < 2_000; steps += 1) {
    if (options.shouldCancel()) {
      try {
        return await action("backup-cancel", { backupId: options.backupId });
      } catch (error) {
        const delay = durableRetryDelay(error, errors);
        if (delay === null) throw error;
        if (error instanceof ApiRequestError && error.status === 429) {
          if (++rateLimits > 8) throw error;
        } else if (errors++ >= 2) throw error;
        options.onProgress("진행 중인 단계를 마친 뒤 백업을 취소합니다.");
        await sleep(delay);
        continue;
      }
    }
    let result: DurableStep;
    try {
      result = await action("backup-create", {
        backupId: options.backupId, type: options.type,
        includeAnalytics: options.includeAnalytics, storageMode: "external",
      });
    } catch (error) {
      const delay = durableRetryDelay(error, errors);
      if (delay === null) throw error;
      if (error instanceof ApiRequestError && error.status === 429) {
        if (++rateLimits > 8) throw error;
        options.onProgress("요청 제한에 따라 서버가 지정한 시간 후 같은 백업 작업을 이어갑니다.");
      } else {
        if (errors++ >= 3) throw error;
        options.onProgress(delay === 185_000 ? "이전 단계의 잠금이 해제되기를 기다립니다."
          : "완료 여부를 같은 작업 ID로 다시 확인합니다.");
      }
      await sleep(delay);
      continue;
    }
    errors = 0;
    rateLimits = 0;
    if (result.completed) return result;
    const progress = result.progress;
    if (!progress || progress.revision <= lastRevision) {
      throw new Error("백업 진행 상태가 전진하지 않았습니다. 목록에서 작업을 확인해 주세요.");
    }
    lastRevision = progress.revision;
    options.onProgress(`${progress.phase === "verify" ? "원본 재검증" : "비공개 저장"} ${progress.tableIndex}/${progress.tableCount}종`);
  }
  throw new Error("백업 단계 제한에 도달했습니다. 목록에서 작업을 확인해 주세요.");
}
