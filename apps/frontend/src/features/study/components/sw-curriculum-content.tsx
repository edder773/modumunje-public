import { lazy, Suspense, type RefObject } from "react";
import type {
  LearningField,
  PlannedLearningSubject,
} from "@shared/study/learning-catalog";
import type { SwPersistedSession } from "../persistence/sw-learning-store";
import RetryBoundary from "@frontend/features/errors/retry-boundary";
import RoutedLink from "./routed-link";
import { InlineLearningError } from "./learning-feedback";
import type { SwPlannerView } from "./study-navigation";
import SwMockSetup from "./sw-mock-setup";
import {
  SwTheoryListView,
  SwTheoryReaderView,
  type SwTheoryItem,
} from "./sw-theory-views";
import {
  SwContentLoadingIndicator,
  SwMockRunner,
  SwPracticeRunner,
  type SwQuestionItem,
} from "./sw-question-runners";

const LazySwCurriculumSelection = lazy(() => import("./sw-curriculum-selection"));

export default function SwCurriculumContent({
  field,
  contentView,
  contentLoading,
  contentError,
  contentRetry,
  theoryItems,
  selectedTheory,
  theoryCategory,
  onTheoryCategoryChange,
  theorySearch,
  onTheorySearchChange,
  selectedSubjects,
  readingProgress,
  readerRef,
  practiceQuestions,
  practiceIndex,
  practiceAnswers,
  revealedQuestions,
  practiceLoadingNext,
  questionCount,
  questionCountInput,
  activeSession,
  mockSubmitted,
  mockSubmitWarning,
  selectionHydrated,
  selectedSubjectIds,
  questionProfileSelectionMessage,
  busy,
  grading,
  answerIsCorrect,
  onBackToFields,
  onShowCurriculum,
  onShowMockSetup,
  onBackToTheories,
  onOpenTheory,
  onStartPractice,
  onRestoreSession,
  onQuestionCountInput,
  onStartMock,
  onPracticeIndex,
  onToggleAnswer,
  onMockSubmitWarning,
  onRequestMockSubmit,
  onSubmitMock,
  onStopPractice,
  onRevealPractice,
  onNextPractice,
  onSelectionChange,
}: {
  field: LearningField;
  contentView: SwPlannerView;
  contentLoading: boolean;
  contentError: string;
  contentRetry: (() => void) | null;
  theoryItems: SwTheoryItem[];
  selectedTheory: SwTheoryItem | null;
  theoryCategory: string;
  onTheoryCategoryChange: (value: string) => void;
  theorySearch: string;
  onTheorySearchChange: (value: string) => void;
  selectedSubjects: PlannedLearningSubject[];
  readingProgress: number;
  readerRef: RefObject<HTMLElement | null>;
  practiceQuestions: SwQuestionItem[];
  practiceIndex: number;
  practiceAnswers: Record<string, number[]>;
  revealedQuestions: Set<string>;
  practiceLoadingNext: boolean;
  questionCount: number;
  questionCountInput: string;
  activeSession?: SwPersistedSession;
  mockSubmitted: boolean;
  mockSubmitWarning: boolean;
  selectionHydrated: boolean;
  selectedSubjectIds: Set<string>;
  questionProfileSelectionMessage: string;
  busy: boolean;
  grading: boolean;
  answerIsCorrect: (question: SwQuestionItem) => boolean;
  onBackToFields: () => void;
  onShowCurriculum: () => void;
  onShowMockSetup: () => void;
  onBackToTheories: () => void;
  onOpenTheory: (theoryId: number) => void;
  onStartPractice: (theoryId?: number) => void;
  onRestoreSession: (session: SwPersistedSession) => void;
  onQuestionCountInput: (value: string) => void;
  onStartMock: () => void;
  onPracticeIndex: (index: number) => void;
  onToggleAnswer: (question: SwQuestionItem, index: number) => void;
  onMockSubmitWarning: (visible: boolean) => void;
  onRequestMockSubmit: () => void;
  onSubmitMock: () => void | Promise<void>;
  onStopPractice: () => void | Promise<void>;
  onRevealPractice: (question: SwQuestionItem) => void | Promise<void>;
  onNextPractice: () => void;
  onSelectionChange: (subjectIds: Set<string>) => void | Promise<void>;
}) {
  if (contentView === "theory" && !selectedTheory) {
    return (
      <div className="page-stack sw-curriculum-page sw-content-page" aria-busy={contentLoading}>
        {contentLoading && <SwContentLoadingIndicator />}
        {!contentLoading && contentError && (
          <InlineLearningError message={contentError} onRetry={contentRetry ?? undefined} />
        )}
      </div>
    );
  }

  if (contentView === "theories") {
    return (
      <SwTheoryListView
        field={field}
        contentLoading={contentLoading}
        contentError={contentError}
        contentRetry={contentRetry}
        theoryItems={theoryItems}
        theoryCategory={theoryCategory}
        onTheoryCategoryChange={onTheoryCategoryChange}
        theorySearch={theorySearch}
        onTheorySearchChange={onTheorySearchChange}
        selectedSubjects={selectedSubjects}
        onBack={onShowCurriculum}
        onOpenTheory={onOpenTheory}
        onStartPractice={() => onStartPractice()}
      />
    );
  }

  if (contentView === "theory" && selectedTheory) {
    return (
      <SwTheoryReaderView
        field={field}
        contentLoading={contentLoading}
        contentError={contentError}
        contentRetry={contentRetry}
        selectedTheory={selectedTheory}
        theoryItems={theoryItems}
        readingProgress={readingProgress}
        readerRef={readerRef}
        onBackToFields={onBackToFields}
        onBackToTheories={onBackToTheories}
        onOpenTheory={onOpenTheory}
        onStartPractice={() => onStartPractice(selectedTheory.id)}
      />
    );
  }

  if (contentView === "mock-setup") {
    return (
      <SwMockSetup
        field={field}
        contentLoading={contentLoading}
        contentError={contentError}
        contentRetry={contentRetry}
        selectedSubjects={selectedSubjects}
        questionCount={questionCount}
        questionCountInput={questionCountInput}
        activeSession={activeSession}
        onBack={onShowCurriculum}
        onQuestionCountInput={onQuestionCountInput}
        onRestore={onRestoreSession}
        onStart={onStartMock}
      />
    );
  }

  if (contentView === "mock") {
    return (
      <SwMockRunner
        questions={practiceQuestions}
        index={practiceIndex}
        answers={practiceAnswers}
        contentLoading={contentLoading}
        contentError={contentError}
        contentRetry={contentRetry}
        busy={busy}
        answerIsCorrect={answerIsCorrect}
        onIndexChange={onPracticeIndex}
        onToggleAnswer={onToggleAnswer}
        submitted={mockSubmitted}
        submitWarning={mockSubmitWarning}
        onSubmitWarningChange={onMockSubmitWarning}
        onRequestSubmit={onRequestMockSubmit}
        onSubmit={onSubmitMock}
        onShowSetup={onShowMockSetup}
      />
    );
  }

  if (contentView === "practice") {
    return (
      <SwPracticeRunner
        field={field}
        selectedTheoryId={selectedTheory?.id ?? null}
        questions={practiceQuestions}
        index={practiceIndex}
        answers={practiceAnswers}
        contentLoading={contentLoading}
        contentError={contentError}
        contentRetry={contentRetry}
        busy={busy}
        grading={grading}
        answerIsCorrect={answerIsCorrect}
        onToggleAnswer={onToggleAnswer}
        revealedQuestionIds={revealedQuestions}
        loadingNext={practiceLoadingNext}
        onStop={onStopPractice}
        onReveal={onRevealPractice}
        onNext={onNextPractice}
      />
    );
  }

  return (
    <div className="page-stack learning-field-home sw-curriculum-page" aria-busy={contentLoading}>
      {contentLoading && <SwContentLoadingIndicator />}
      <RoutedLink className="field-back-button" href="/" onNavigate={onBackToFields}>
        학습 분야로 돌아가기
      </RoutedLink>

      <RetryBoundary fallbackTitle="SW 학습 범위를 표시하지 못했습니다." resetKey={field.id}>
        <Suspense fallback={<SwContentLoadingIndicator />}>
          <LazySwCurriculumSelection
            field={field}
            selectionHydrated={selectionHydrated}
            selectedSubjectIds={selectedSubjectIds}
            questionProfileSelectionMessage={questionProfileSelectionMessage}
            errorSlot={contentError ? <InlineLearningError message={contentError} onRetry={contentRetry ?? undefined} /> : undefined}
            onSelectionChange={onSelectionChange}
          />
        </Suspense>
      </RetryBoundary>
    </div>
  );
}
