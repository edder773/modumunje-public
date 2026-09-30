export type LobbyPollDeadlines = { syncAt: number; heartbeatAt: number; consecutiveFailures?: number };

export function lobbySyncInterval(phase: string, visible: boolean) {
  return visible ? phase === "running" || phase === "finalizing" ? 3_000 : 15_000 : 30_000;
}

export function nextLobbyPoll(due: LobbyPollDeadlines, now: number) {
  return {
    delay: Math.max(0, Math.min(due.syncAt, due.heartbeatAt) - now),
    heartbeat: due.heartbeatAt <= now,
    sync: due.syncAt <= now,
  };
}

export function finishLobbyPoll(due: LobbyPollDeadlines, now: number, heartbeat: boolean, syncIncluded: boolean, phase: string, visible: boolean, success: boolean, jitter = 0): LobbyPollDeadlines {
  const interval = lobbySyncInterval(phase, visible);
  const consecutiveFailures = syncIncluded
    ? success ? 0 : Math.min((due.consecutiveFailures ?? 0) + 1, 5)
    : due.consecutiveFailures ?? 0;
  const retryDelay = Math.min(interval * (2 ** consecutiveFailures) + Math.max(0, Math.min(499, jitter)), visible ? 30_000 : 60_000);
  return {
    consecutiveFailures,
    syncAt: syncIncluded ? now + (success ? interval : retryDelay) : due.syncAt,
    heartbeatAt: heartbeat ? now + 20_000 : due.heartbeatAt,
  };
}
