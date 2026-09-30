"use client";
import {
  isExpectedRequestCancellation
} from "@shared/runtime/latest-request-coordinator.mjs";
import { useCallback, useRef, useState } from "react";
import { TheoryView } from "../components/study-lazy-screens";
import { trackEvent } from "../telemetry/study-telemetry";
import type { StudyControllerContext } from "./study-controller-context";

import useSessionEpoch from "./use-session-epoch";

export default function useTheoryLearning({ data, selectedExam, setNotice, setPendingRequestCount, setActiveView, writeLearningUrl, refreshData }: Pick<StudyControllerContext, "data" | "selectedExam" | "setNotice" | "setPendingRequestCount" | "setActiveView" | "writeLearningUrl" | "refreshData">) {
  const epoch = useSessionEpoch();
  const [theorySearch, setTheorySearch] = useState("");

  const [selectedTheoryId, setSelectedTheoryId] = useState<number | null>(null);

  const [returnToQuestionFromTheory, setReturnToQuestionFromTheory] = useState<number | null>(null);

  const theoryOpeningRef = useRef(false);

  const selectedTheory = data.theories.find((item) => item.id === selectedTheoryId) ?? null;

  async function openSqlTheory(id: number, returnQuestionId: number | null = null) {
    const isCurrent = epoch.capture();
    if (theoryOpeningRef.current) return;
    theoryOpeningRef.current = true;
    setPendingRequestCount((count) => count + 1);
    setReturnToQuestionFromTheory(returnQuestionId);
    try {
      const existing = data.theories.find((item) => item.id === id && item.content.trim());
      let article = existing;
      if (!article) {
        const payload = await refreshData("theory", { id });
        article = payload.theories.find((item) => item.id === id);
      }
      if (!isCurrent()) return;
      if (!article) throw new Error("theory not found");
      setSelectedTheoryId(id);
      setActiveView("theory");
      writeLearningUrl({ examType: selectedExam, page: "theory", id });
      trackEvent({
        eventType: "theory_viewed",
        examScope: selectedExam,
        subject: article.category,
        pagePath: `/theory/${id}`,
      });
    } catch (error) {
      if (isCurrent() && !isExpectedRequestCancellation(error)) {
        setNotice("이론을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
      }
    } finally {
      theoryOpeningRef.current = false;
      setPendingRequestCount((count) => Math.max(0, count - 1));
    }
  }

  const theoryBindings = {
    navigation: data.theoryNavigation,
    search: theorySearch,
    onSearch: setTheorySearch,
    selected: selectedTheory,
    onSelect: (id) => {
      void openSqlTheory(id);
    },
    onClose: () => {
      setReturnToQuestionFromTheory(null);
      setSelectedTheoryId(null);
      writeLearningUrl({
        examType: selectedExam,
        page: "theories",
      }, "replace");
    },
    returnToQuestion: Boolean(returnToQuestionFromTheory),
    onReturnQuestion: () => {
      const questionId = returnToQuestionFromTheory;
      setSelectedTheoryId(null);
      setReturnToQuestionFromTheory(null);
      setActiveView("practice");
      if (questionId) {
        writeLearningUrl({
          examType: selectedExam,
          page: "question",
          id: questionId,
        });
      }
    }
  } satisfies Pick<import("react").ComponentProps<typeof TheoryView>, "navigation" | "search" | "onSearch" | "selected" | "onSelect" | "onClose" | "returnToQuestion" | "onReturnQuestion">;

  const clearTheorySelection = useCallback(() => {
    epoch.invalidate();
    setSelectedTheoryId(null);
    setReturnToQuestionFromTheory(null);
  }, [epoch]);
  function restoreTheorySelection(id: number) {
    setReturnToQuestionFromTheory(null);
    setSelectedTheoryId(id);
  }
  return {
    theoryBindings, selectedTheoryId, openSqlTheory, clearTheorySelection,
    restoreTheorySelection
  };
}
