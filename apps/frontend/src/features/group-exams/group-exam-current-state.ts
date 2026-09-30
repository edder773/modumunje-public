export type BoundCurrentRun<T> = {
  groupId: string;
  runId: string;
  payload: T;
};

export const SCHEDULED_DUE_RETRY_DELAYS_MS = [0, 3_000, 8_000, 15_000] as const;

export function currentForSelection<T>(
  binding: BoundCurrentRun<T> | null,
  groupId: string,
  recentRunId: string,
) {
  if (!binding || binding.groupId !== groupId) return null;
  if (recentRunId && binding.runId !== recentRunId) return null;
  return binding.payload;
}

export function acceptsCurrentResponse(input: {
  requestGroupId: string;
  responseRunId: string;
  requestSequence: number;
  selectedGroupId: string;
  selectedRecentRunId: string;
  latestSequence: number;
}) {
  return Boolean(input.responseRunId)
    && input.requestGroupId === input.selectedGroupId
    && input.requestSequence === input.latestSequence
    && (!input.selectedRecentRunId || input.responseRunId === input.selectedRecentRunId);
}
