"use client";

import { useCallback, useRef } from "react";
import {
  clientEventId,
  withSaveTimeout,
} from "../persistence/guest-learning-store";
import type { SaveStatusValue } from "./study-save-status";

type RetrySaveQueue = Map<string, () => Promise<void>>;

export default function useStudySaveOperations({
  retrySaveQueue,
  setSaveStatus,
}: {
  retrySaveQueue: RetrySaveQueue;
  setSaveStatus: (status: SaveStatusValue) => void;
}) {
  const saveOperationSequence = useRef(0);

  const runTrackedAccountSave = useCallback(async <T,>(
    operation: (signal: AbortSignal) => Promise<T>,
    options: { showProgress?: boolean; operationId?: string } = {},
  ): Promise<T> => {
    const operationId = options.operationId ?? clientEventId();
    let inFlight: Promise<T> | null = null;
    const retry = async () => { await execute(); };
    function execute(): Promise<T> {
      if (inFlight) return inFlight;
      const sequence = saveOperationSequence.current + 1;
      saveOperationSequence.current = sequence;
      setSaveStatus(options.showProgress === false ? "account-saved" : "saving");
      retrySaveQueue.set(operationId, retry);
      inFlight = withSaveTimeout(operation).then((result) => {
        if (saveOperationSequence.current === sequence) {
          setSaveStatus("account-saved");
        }
        if (retrySaveQueue.get(operationId) === retry) retrySaveQueue.delete(operationId);
        return result;
      }, (error) => {
        if (saveOperationSequence.current === sequence) {
          setSaveStatus("error");
        }
        throw error;
      }).finally(() => { inFlight = null; });
      return inFlight;
    }
    return execute();
  }, [retrySaveQueue, setSaveStatus]);

  const runTrackedLocalSave = useCallback((operation: () => void): boolean => {
    const operationId = clientEventId();
    function execute() {
      try {
        operation();
        retrySaveQueue.delete(operationId);
        setSaveStatus("local-saved");
        return true;
      } catch {
        setSaveStatus("error");
        retrySaveQueue.set(operationId, async () => {
          execute();
        });
        return false;
      }
    }
    return execute();
  }, [retrySaveQueue, setSaveStatus]);

  const retrySave = useCallback(() => {
    const retry = retrySaveQueue.values().next().value;
    if (!retry) return;
    void retry().catch(() => undefined);
  }, [retrySaveQueue]);

  return { retrySave, runTrackedAccountSave, runTrackedLocalSave };
}
