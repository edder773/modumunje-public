"use client";
import { useEffect, useRef } from "react";
import {
  hasGuestLearningData, readGuestLearningState, pendingGuestImportSnapshot,
  stageGuestImportSnapshot, reconcileGuestImportSnapshot,
} from "../persistence/guest-learning-store";
import type { StudyControllerContext } from "./study-controller-context";
import { guestImportCompletedForSnapshot, type GuestImportCompletion } from "./guest-import-completion";
import { requestStudyMutation } from "./study-mutation-api-client";

export default function useGuestLearningSync({ isAuthenticated, runTrackedAccountSave, onGuestImported, userKeyHash, setNotice }: Pick<StudyControllerContext, "isAuthenticated" | "runTrackedAccountSave" | "onGuestImported" | "userKeyHash" | "setNotice">) {
  const guestImportStarted = useRef(false);
  const onImported = useRef(onGuestImported);
  useEffect(() => { onImported.current = onGuestImported; }, [onGuestImported]);

  async function importGuestLearning() {
    if (!isAuthenticated || guestImportStarted.current) return false;
    guestImportStarted.current = true;
    let importedAny = false;
    try {
      for (let batch = 0; batch < 4; batch += 1) {
        const current = readGuestLearningState();
        if (current.recoveryError) {
          setNotice(current.recoveryError);
          return importedAny;
        }
        if (!pendingGuestImportSnapshot(userKeyHash) && !hasGuestLearningData(current)) return importedAny;
        const submitted = stageGuestImportSnapshot(current, userKeyHash);
        let retrying = false;
        const result = await runTrackedAccountSave(async signal => {
          const retry = retrying;
          retrying = true;
          const response = await requestStudyMutation<GuestImportCompletion>("guest-import", {
            importId: submitted.importId,
            selectedExam: submitted.selectedExam,
            bookmarks: submitted.bookmarks,
            attempts: submitted.attempts.map(attempt => ({
              questionId: attempt.questionId, selectedAnswers: attempt.selectedAnswers,
              result: attempt.result, score: attempt.score, answerText: attempt.answerText,
              mode: attempt.mode, examType: attempt.examType, createdAt: attempt.createdAt,
            })),
          }, signal);
          if (guestImportCompletedForSnapshot(submitted, response)) {
            // Manual retry runs this saved operation after the original caller
            // has returned, so receipt reconciliation belongs in the operation.
            if (!reconcileGuestImportSnapshot(submitted, userKeyHash)) {
              return { ...response, verified: false };
            }
            if (retry) await onImported.current();
          }
          return response;
        }, { operationId: `guest-import:${submitted.importId}` });
        if (!guestImportCompletedForSnapshot(submitted, result)) return importedAny;
        importedAny = true;
      }
      return importedAny;
    } catch (error) {
      if (error instanceof Error && /guest import (receipt|snapshot)/iu.test(error.message)) {
        setNotice("게스트 이관 저장값 오류가 있습니다. 이 브라우저의 원본 기록은 보존했습니다. 지원팀에 복구를 요청해 주세요.");
      }
      return importedAny;
    } finally {
      guestImportStarted.current = false;
    }
  }

  return { importGuestLearning };
}
