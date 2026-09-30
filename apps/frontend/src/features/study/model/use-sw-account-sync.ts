"use client";

import { useEffect, useMemo, useState } from "react";
import { createSwAccountSync } from "./sw-account-sync";
import { mergeSwAccountState } from "./sw-account-state";
import { requestSwStudyMutation } from "./study-mutation-api-client";
import { requestSwStudyData, type SwAccountState } from "./sw-study-api-client";
import { createSwLearningStore, parseSwLearningState } from "../persistence/sw-learning-store";
import { learnerSafeErrorMessage } from "../components/learning-feedback";
import { isSwStudyPayload } from "@shared/study/sw-study-contract.mjs";

export default function useSwAccountSync(
  enabled: boolean,
  userKeyHash: string,
  learningStore: ReturnType<typeof createSwLearningStore>,
) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const sync = useMemo(() => createSwAccountSync<SwAccountState>({
    snapshot() {
      const local = parseSwLearningState(learningStore.readSwCurriculumSelection());
      return JSON.stringify({ activeSession: local.activeSession });
    },
    importSnapshot: (snapshot, signal) => requestSwStudyMutation(
      "sw-import", JSON.parse(snapshot), signal, userKeyHash,
    ),
    accountFromImport: (result) => {
      const account = result && typeof result === "object" && "account" in result
        ? result.account : undefined;
      return isSwStudyPayload("state", account) ? account as SwAccountState : undefined;
    },
    readAccount: (signal) => requestSwStudyData<SwAccountState>({
      expectedUserKey: userKeyHash, view: "state", cacheMode: "none", signal,
    }),
    applyAccount: (account) => learningStore.writeSwLearningState((saved) => mergeSwAccountState(saved, account)),
    onBusy: setBusy,
    onError: (failure) => setError(failure === null ? "" : learnerSafeErrorMessage(
      failure, "계정의 SW 학습 기록을 동기화하지 못했습니다. 이 브라우저의 기록은 유지됩니다.",
    )),
  }), [learningStore, userKeyHash]);

  useEffect(() => {
    if (!enabled) return;
    const retry = () => { void sync.run(); };
    const timer = window.setTimeout(retry, 0);
    window.addEventListener("online", retry);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("online", retry);
      sync.cancel();
    };
  }, [enabled, sync]);

  return { error, busy, retry: () => { if (enabled) void sync.run(); } };
}
