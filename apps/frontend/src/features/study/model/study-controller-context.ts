import type { Dispatch, SetStateAction } from "react";
import type { ExamType } from "@shared/study/study-domain";
import type { Question, StudyData, View } from "../components/study-screen-shared";
import type { StudyScope } from "./study-api-client";
import type useStudySaveOperations from "./use-study-save-operations";
import type useSqlLearningMutationQueues from "./use-sql-learning-mutation-queues";
import type { useLearningRouter } from "../routing/use-learning-router";

/** Typed ports only. Each feature picks its inputs and owns its state/transitions. */
export type StudyControllerContext = ReturnType<typeof useStudySaveOperations>
  & ReturnType<typeof useSqlLearningMutationQueues> & {
    data: StudyData;
    setData: Dispatch<SetStateAction<StudyData>>;
    selectedExam: ExamType;
    isAuthenticated: boolean;
    userKeyHash: string;
    setNotice: (message: string) => void;
    setPendingRequestCount: Dispatch<SetStateAction<number>>;
    setActiveView: (view: View) => void;
    writeLearningUrl: ReturnType<typeof useLearningRouter>["writeLearningUrl"];
    fetchStudyData: (scope: StudyScope, params?: Record<string, string | number>) => Promise<StudyData>;
    refreshData: (scope?: StudyScope, params?: Record<string, string | number>) => Promise<StudyData>;
    changeExam: (exam: ExamType, routeMode?: "push" | "replace", destination?: View) => Promise<void>;
    availableQuestions: Question[];
    onGuestImported: () => Promise<void>;
  };
