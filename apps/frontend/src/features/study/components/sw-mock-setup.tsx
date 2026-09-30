import { learningPath, type LearningField, type PlannedLearningSubject } from "@shared/study/learning-catalog";
import type { SwPersistedSession } from "../persistence/sw-learning-store";
import RoutedLink from "./routed-link";

function LoadingIndicator() {
  return (
    <div className="partial-loading sw-content-loading" role="status" aria-live="polite">
      <span className="loading-indicator" aria-hidden="true" />
      <span>SW 학습 콘텐츠를 불러오고 있습니다.</span>
    </div>
  );
}

function LoadError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="inline-learning-error" role="alert">
      <div><strong>콘텐츠를 불러오지 못했습니다.</strong><p>{message}</p></div>
      {onRetry && <button className="outline-button" type="button" onClick={onRetry}>다시 시도</button>}
    </div>
  );
}

export default function SwMockSetup({
  field,
  contentLoading,
  contentError,
  contentRetry,
  selectedSubjects,
  questionCount,
  questionCountInput,
  activeSession,
  onBack,
  onQuestionCountInput,
  onRestore,
  onStart,
}: {
  field: LearningField;
  contentLoading: boolean;
  contentError: string;
  contentRetry: (() => void) | null;
  selectedSubjects: PlannedLearningSubject[];
  questionCount: number;
  questionCountInput: string;
  activeSession?: SwPersistedSession;
  onBack: () => void;
  onQuestionCountInput: (value: string) => void;
  onRestore: (session: SwPersistedSession) => void;
  onStart: () => void;
}) {
  return (
    <div className="page-stack mock-home sw-curriculum-page sw-content-page" aria-busy={contentLoading}>
      {contentLoading && <LoadingIndicator />}
      <RoutedLink
        className="field-back-button"
        href={learningPath({ fieldId: field.id, page: "field" })}
        onNavigate={onBack}
      >
        학습 범위로 돌아가기
      </RoutedLink>
      <section className="mock-intro" aria-labelledby="sw-mock-setup-title">
        <div>
          <span className="section-kicker">SW 전공 모의고사</span>
          <h2 id="sw-mock-setup-title">원하는 문항 수로 모의고사를 구성하세요.</h2>
          <p>현재 선택한 소주제 안에서 문제가 무작위로 출제되며, 제출 후 정답과 해설을 확인할 수 있습니다.</p>
        </div>
      </section>
      <section className="practice-setup mock-setup sw-mock-setup-layout">
        <div className="exam-card-grid">
          <article className="card exam-select-card sw-mock-exam-card">
            <div className="exam-card-head">
              <span>SW 전공</span>
              <strong>선택 범위 모의고사</strong>
            </div>
            <dl>
              <div><dt>문제 유형</dt><dd>객관식</dd></div>
              <div><dt>선택 범위</dt><dd>{selectedSubjects.length}개 소주제</dd></div>
            </dl>
            <label className="sw-mock-count-field">
              <span>출제 문항 수</span>
              <input
                type="number"
                min={5}
                max={100}
                step={1}
                inputMode="numeric"
                value={questionCountInput}
                onChange={(event) => onQuestionCountInput(event.target.value.replace(/\D/gu, "").slice(0, 3))}
                onBlur={() => onQuestionCountInput(String(questionCount))}
                aria-describedby="sw-mock-count-help"
              />
            </label>
            <div className="sw-mock-count-presets" aria-label="빠른 문항 수 선택">
              {[10, 20, 50, 100].map((count) => (
                <button
                  key={count}
                  className={questionCount === count ? "active" : ""}
                  type="button"
                  aria-pressed={questionCount === count}
                  onClick={() => onQuestionCountInput(String(count))}
                >{count}문항</button>
              ))}
            </div>
            <p id="sw-mock-count-help" className="sw-content-status">5문항부터 100문항까지 지정할 수 있습니다.</p>
            <div className="exam-card-actions">
              {activeSession?.mode === "mock" && (
                <button className="outline-button" type="button" onClick={() => onRestore(activeSession)}>
                  진행 중 모의고사 이어서
                </button>
              )}
              <button
                className="primary-button"
                type="button"
                disabled={!selectedSubjects.length}
                onClick={onStart}
              >모의고사 시작 →</button>
            </div>
            {contentError && <LoadError message={contentError} onRetry={contentRetry ?? undefined} />}
          </article>
        </div>
        <aside className="study-tip sw-mock-scope-card" aria-label="모의고사 선택 범위">
          <span>선택 범위</span>
          <h3>{selectedSubjects.length}개 소주제</h3>
          {selectedSubjects.length > 0 ? (
            <ul>{selectedSubjects.map((subject) => <li key={subject.id}>{subject.name}</li>)}</ul>
          ) : (
            <p>학습 범위에서 소주제를 먼저 선택해 주세요.</p>
          )}
        </aside>
      </section>
    </div>
  );
}
