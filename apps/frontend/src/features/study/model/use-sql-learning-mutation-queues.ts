"use client";

import { useState } from "react";
import type { ExamType } from "@shared/study/study-domain";
import { createLatestValueQueue } from "@shared/runtime/latest-value-queue.mjs";
import { requestStudyMutation } from "./study-mutation-api-client";
import { withSaveTimeout } from "../persistence/guest-learning-store";
import type { SaveStatusValue } from "./study-save-status";

type LatestValueQueue<K, V> = {
  enqueue(key: K, value: V): Promise<void>;
  retry(key: K): Promise<void>;
  hasPending(key: K): boolean;
  clear(key: K): void;
};
type BookmarkValue = { questionId: number; bookmarked: boolean };

export default function useSqlLearningMutationQueues({
  setSaveStatus,
}: {
  setSaveStatus: (status: SaveStatusValue) => void;
}) {
  const [state] = useState(() => {
    const retryQueue = new Map<string, () => Promise<void>>();
    const bookmarkDesired = new Map<number, boolean>();
    const bookmarkConfirmed = new Map<number, boolean>();
    const bookmarkRequested = new Map<number, boolean>();

    const queues = {} as {
      selectedExam: LatestValueQueue<string, ExamType>;
      bookmark: LatestValueQueue<number, BookmarkValue>;
    };
    queues.selectedExam = createLatestValueQueue(async (_key: string, next: ExamType) => {
      setSaveStatus("saving");
      try {
        await withSaveTimeout((signal) => requestStudyMutation("settings", { selectedExam: next }, signal));
        retryQueue.delete("selected-exam");
        setSaveStatus("account-saved");
      } catch (error) {
        setSaveStatus("error");
        retryQueue.set("selected-exam", async () => {
          await queues.selectedExam.retry("selected-exam");
        });
        throw error;
      }
    });

    queues.bookmark = createLatestValueQueue(async (questionId: number, value: BookmarkValue) => {
      const retryKey = `bookmark:${questionId}`;
      setSaveStatus("saving");
      try {
        await withSaveTimeout((signal) => requestStudyMutation("bookmark", value, signal));
        bookmarkConfirmed.set(questionId, value.bookmarked);
        retryQueue.delete(retryKey);
        setSaveStatus("account-saved");
      } catch (error) {
        setSaveStatus("error");
        retryQueue.set(retryKey, async () => {
          await queues.bookmark.retry(questionId);
        });
        throw error;
      }
    });

    return {
      retrySaveQueue: retryQueue,
      selectedExamSaveQueue: queues.selectedExam,
      bookmarkSaveQueue: queues.bookmark,
      bookmarkDesired,
      bookmarkConfirmed,
      bookmarkRequested,
    };
  });
  return state;
}
