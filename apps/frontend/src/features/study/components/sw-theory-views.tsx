import type { RefObject } from "react";
import {
  learningPath,
  type LearningField,
  type PlannedLearningSubject,
} from "@shared/study/learning-catalog";
import RoutedLink from "./routed-link";
import {
  EmptyState,
  TheoryLearningContent,
  matchesSearchQuery,
  theoryTocItems,
} from "./study-screen-shared";

export type SwTheoryItem = {
  id: number;
  subjectGroupId: string;
  subjectId: string;
  category: string;
  topic: string;
  title: string;
  summary: string;
  content?: string;
  reviewAnswers?: string;
  keywords: string[];
  sortOrder: number;
};

function SwContentLoadingIndicator() {
  return (
    <div className="partial-loading sw-content-loading" role="status" aria-live="polite">
      <span className="loading-indicator" aria-hidden="true" />
      <span>SW 학습 콘텐츠를 불러오고 있습니다.</span>
    </div>
  );
}

function InlineLearningError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="inline-learning-error" role="alert">
      <div><strong>콘텐츠를 불러오지 못했습니다.</strong><p>{message}</p></div>
      {onRetry && <button className="outline-button" type="button" onClick={onRetry}>다시 시도</button>}
    </div>
  );
}

export function SwTheoryListView({
  field,
  contentLoading,
  contentError,
  contentRetry,
  theoryItems,
  theoryCategory,
  onTheoryCategoryChange,
  theorySearch,
  onTheorySearchChange,
  selectedSubjects,
  onBack,
  onOpenTheory,
  onStartPractice,
}: {
  field: LearningField;
  contentLoading: boolean;
  contentError: string;
  contentRetry: (() => void) | null;
  theoryItems: SwTheoryItem[];
  theoryCategory: string;
  onTheoryCategoryChange: (category: string) => void;
  theorySearch: string;
  onTheorySearchChange: (search: string) => void;
  selectedSubjects: PlannedLearningSubject[];
  onBack: () => void;
  onOpenTheory: (theoryId: number) => void;
  onStartPractice: () => void;
}) {
  const theoryCategories = ["전체 분류", ...new Set(theoryItems.map((article) => article.category))];
  const filteredTheories = theoryItems.filter((article) => (
    (theoryCategory === "전체 분류" || article.category === theoryCategory)
    && matchesSearchQuery(theorySearch, article.title, article.summary, article.category, article.topic, article.keywords.join(" "))
  ));
  return (
    <div className="page-stack sw-curriculum-page sw-content-page" aria-busy={contentLoading}>
      {contentLoading && <SwContentLoadingIndicator />}
      <RoutedLink
        className="field-back-button"
        href={learningPath({ fieldId: field.id, page: "field" })}
        onNavigate={onBack}
      >
        학습 범위로 돌아가기
      </RoutedLink>
      <section className="sw-content-heading" aria-labelledby="sw-theory-list-title">
        <div>
          <span className="section-kicker">선택 범위 이론</span>
          <h2 id="sw-theory-list-title">소주제별 핵심 이론을 확인하세요.</h2>
          <p>{selectedSubjects.map((subject) => subject.name).join(" · ")}</p>
        </div>
        <button className="primary-button" type="button" onClick={onStartPractice}>
          선택 범위 문제 풀기 →
        </button>
      </section>
      <section className="theory-controls sw-theory-controls" aria-label="SW 이론 검색과 분류">
        <label className="search-box">
          <span aria-hidden="true">⌕</span>
          <input value={theorySearch} onChange={(event) => onTheorySearchChange(event.target.value)} placeholder="제목·요약·키워드 검색" aria-label="SW 이론 검색" />
        </label>
        <label className="theory-topic-filter">
          <span>대분류</span>
          <select value={theoryCategory} onChange={(event) => onTheoryCategoryChange(event.target.value)}>
            {theoryCategories.map((category) => <option key={category}>{category}</option>)}
          </select>
        </label>
        <span className="theory-filter-count" aria-live="polite">{filteredTheories.length}개 이론</span>
      </section>
      {contentError && <InlineLearningError message={contentError} onRetry={contentRetry ?? undefined} />}
      <div className="theory-grid sw-theory-grid">
        {filteredTheories.map((article, index) => (
          <RoutedLink
            className="card theory-card sw-theory-list-card"
            key={article.id}
            href={learningPath({ fieldId: field.id, page: "field", section: "theories", theoryId: article.id })}
            onNavigate={() => onOpenTheory(article.id)}
            title={article.title}
          >
            <span className="theory-index">{String(index + 1).padStart(2, "0")}</span>
            <div className="theory-card-path">
              <span className="category-label">{article.category}</span>
              <strong>{article.topic}</strong>
            </div>
            <h3>{article.title}</h3>
            <p>{article.summary}</p>
            <div className="keyword-row" aria-label={`${article.title} 핵심어`}>
              {article.keywords.slice(0, 4).map((keyword) => <span key={keyword}>#{keyword}</span>)}
            </div>
            <strong>이론 읽기 →</strong>
          </RoutedLink>
        ))}
      </div>
      {!contentLoading && !filteredTheories.length && (
        <EmptyState title="조건에 맞는 이론이 없습니다." description="검색어나 대분류를 변경해 보세요." />
      )}
    </div>
  );
}

export function SwTheoryReaderView({
  field,
  contentLoading,
  contentError,
  contentRetry,
  selectedTheory,
  theoryItems,
  readingProgress,
  readerRef,
  onBackToFields,
  onBackToTheories,
  onOpenTheory,
  onStartPractice,
}: {
  field: LearningField;
  contentLoading: boolean;
  contentError: string;
  contentRetry: (() => void) | null;
  selectedTheory: SwTheoryItem;
  theoryItems: SwTheoryItem[];
  readingProgress: number;
  readerRef: RefObject<HTMLElement | null>;
  onBackToFields: () => void;
  onBackToTheories: () => void;
  onOpenTheory: (theoryId: number) => void;
  onStartPractice: () => void;
}) {
  const orderedTheories = [...theoryItems].sort((first, second) => (
    first.sortOrder - second.sortOrder || first.id - second.id
  ));
  const theoryIndex = orderedTheories.findIndex((article) => article.id === selectedTheory.id);
  const previousTheory = theoryIndex > 0 ? orderedTheories[theoryIndex - 1] : null;
  const nextTheory = theoryIndex >= 0 ? orderedTheories[theoryIndex + 1] ?? null : null;
  const breadcrumbLocation = selectedTheory.topic && selectedTheory.topic !== selectedTheory.category
    ? `${selectedTheory.category} · ${selectedTheory.topic}`
    : selectedTheory.category;
  const tocItems = theoryTocItems(selectedTheory.content ?? "");
  const readingMinutes = Math.max(1, Math.ceil((selectedTheory.content ?? "").replace(/\s+/gu, " ").length / 650));
  return (
    <div className="page-stack sw-curriculum-page sw-content-page" aria-busy={contentLoading}>
      {contentLoading && <SwContentLoadingIndicator />}
      <article className="card theory-reader sw-theory-article" ref={readerRef}>
        <div className="theory-reading-progress" role="progressbar" aria-label="현재 단원 읽기 진행률" aria-valuemin={0} aria-valuemax={100} aria-valuenow={readingProgress}>
          <span style={{ transform: `scaleX(${readingProgress / 100})` }} />
        </div>
        <RoutedLink
          className="back-button theory-list-back"
          href={learningPath({ fieldId: field.id, page: "field", section: "theories" })}
          onNavigate={onBackToTheories}
          aria-label="이론 목록으로 돌아가기"
        >
          <span className="theory-list-back-icon" aria-hidden="true">←</span>
          <span>이론 목록으로 돌아가기</span>
        </RoutedLink>
        <nav className="theory-breadcrumb" aria-label="현재 이론 위치">
          <RoutedLink href="/" onNavigate={onBackToFields}>학습 분야</RoutedLink><span aria-hidden="true">›</span>
          <a href={learningPath({ fieldId: field.id, page: "field" })}>SW 전공</a><span aria-hidden="true">›</span>
          <a href={learningPath({ fieldId: field.id, page: "field", section: "theories" })}>이론</a><span aria-hidden="true">›</span>
          <span aria-current="page">{breadcrumbLocation}</span>
        </nav>
        <h1 className="theory-title">{selectedTheory.title}</h1>
        <p className="theory-lead">{selectedTheory.summary}</p>
        <div className="theory-detail-meta"><span>예상 읽기 {readingMinutes}분</span></div>
        {tocItems.length > 1 && (
          <nav className="theory-toc" aria-label="이 단원의 목차">
            <strong>이 단원에서 다루는 내용</strong>
            <ol>{tocItems.map((item) => <li key={item.id}><a href={`#${item.id}`}>{item.label}</a></li>)}</ol>
          </nav>
        )}
        <div className="keyword-row">
          {selectedTheory.keywords.map((keyword) => <span key={keyword}>#{keyword}</span>)}
        </div>
        <TheoryLearningContent article={{
          id: selectedTheory.id,
          category: selectedTheory.category,
          content: selectedTheory.content ?? "",
          reviewAnswers: selectedTheory.reviewAnswers ?? "",
        }} />
        <div className="reader-foot sw-reader-foot">
          <div><strong>문제로 이해도를 확인해 보세요.</strong></div>
          <div className="reader-foot-actions">
            {previousTheory && (
              <RoutedLink
                className="outline-button"
                href={learningPath({ fieldId: field.id, page: "field", section: "theories", theoryId: previousTheory.id })}
                onNavigate={() => onOpenTheory(previousTheory.id)}
              >← 이전 단원</RoutedLink>
            )}
            <button className="outline-button" type="button" onClick={onStartPractice}>연결 문제 풀기</button>
            {nextTheory && (
              <RoutedLink
                className="primary-button"
                href={learningPath({ fieldId: field.id, page: "field", section: "theories", theoryId: nextTheory.id })}
                onNavigate={() => onOpenTheory(nextTheory.id)}
              >다음 단원 →</RoutedLink>
            )}
          </div>
        </div>
      </article>
      {contentError && <InlineLearningError message={contentError} onRetry={contentRetry ?? undefined} />}
    </div>
  );
}
