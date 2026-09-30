"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import {
  courseDefinition,
  examScopeLabel,
  type ExamType,
} from "@shared/study/study-domain";
import {
  learningPath,
} from "@shared/study/learning-catalog";
import RoutedLink from "../../routed-link";
import {
  CATEGORIES,
  EmptyState,
  TheoryLearningContent,
  compareTheories,
  directlyLinkedQuestions,
  matchesSearchQuery,
  theoryTocItems,
  type Question,
  type StudyData,
  type TheoryArticle,
} from "../../study-screen-shared";

export function TheoryView({
  examType,
  articles,
  questions,
  navigation,
  search,
  onSearch,
  selected,
  onSelect,
  onClose,
  onPractice,
  returnToQuestion,
  onReturnQuestion,
}: {
  examType: ExamType;
  articles: TheoryArticle[];
  questions: Question[];
  navigation?: StudyData["theoryNavigation"];
  search: string;
  onSearch: (value: string) => void;
  selected: TheoryArticle | null;
  onSelect: (id: number) => void;
  onClose: () => void;
  onPractice: (article: TheoryArticle) => void;
  returnToQuestion: boolean;
  onReturnQuestion: () => void;
}) {
  const course = courseDefinition(examType);
  const courseCategories = useMemo<string[]>(
    () => course.releasedSubjects.map((subject) => subject.name),
    [course],
  );
  const availableCategories = useMemo(() => courseCategories.filter((category) => (
    articles.some((article) => article.category === category)
  )), [articles, courseCategories]);
  const [categoryFilter, setCategoryFilter] = useState(courseCategories[0] ?? CATEGORIES[0]);
  const [topicFilter, setTopicFilter] = useState("전체 소분류");
  const readerRef = useRef<HTMLElement>(null);
  const [readingProgress, setReadingProgress] = useState(0);
  const readingProgressRef = useRef(0);
  useEffect(() => {
    if (!selected) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const element = readerRef.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      const readable = Math.max(1, element.offsetHeight - window.innerHeight * 0.55);
      const next = Math.max(0, Math.min(100, Math.round((-rect.top + 140) / readable * 100)));
      if (next === readingProgressRef.current) return;
      readingProgressRef.current = next;
      setReadingProgress(next);
    };
    const scheduleMeasure = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    scheduleMeasure();
    window.addEventListener("scroll", scheduleMeasure, { passive: true });
    window.addEventListener("resize", scheduleMeasure);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleMeasure);
    if (readerRef.current) observer?.observe(readerRef.current);
    return () => {
      window.removeEventListener("scroll", scheduleMeasure);
      window.removeEventListener("resize", scheduleMeasure);
      observer?.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [selected]);
  useEffect(() => {
    if (!selected) return;
    document.title = `${selected.title} | 모두의 문제집`;
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    description?.setAttribute("content", selected.summary || `${course.name} 이론을 학습하세요.`);
  }, [course.name, selected]);
  const effectiveCategory = availableCategories.includes(categoryFilter)
    ? categoryFilter
    : availableCategories[0] ?? courseCategories[0] ?? CATEGORIES[0];

  if (selected) {
    const linkedCount = navigation?.linkedCount ?? directlyLinkedQuestions(questions, selected).length;
    const ordered = [...articles].sort(compareTheories);
    const currentIndex = ordered.findIndex((article) => article.id === selected.id);
    const previousTheory = navigation?.previous ?? (currentIndex > 0 ? ordered[currentIndex - 1] : undefined);
    const nextTheory = navigation?.next ?? (currentIndex >= 0 ? ordered[currentIndex + 1] : undefined);
    const breadcrumbLocation = selected.topic && selected.topic !== selected.category
      ? `${selected.category} · ${selected.topic}`
      : selected.category;
    const tocItems = theoryTocItems(selected.content);
    const readingMinutes = Math.max(1, Math.ceil(selected.content.replace(/\s+/gu, " ").length / 650));
    return (
      <>
        <article className="card theory-reader" ref={readerRef}>
          <div className="theory-reading-progress" role="progressbar" aria-label="현재 단원 읽기 진행률" aria-valuemin={0} aria-valuemax={100} aria-valuenow={readingProgress}>
            <span style={{ transform: `scaleX(${readingProgress / 100})` }} />
          </div>
          {returnToQuestion ? (
            <button className="back-button" onClick={onReturnQuestion}>← 문제로 돌아가기</button>
          ) : (
            <RoutedLink
              className="back-button theory-list-back"
              href={learningPath({ examType, page: "theories" })}
              onNavigate={onClose}
              aria-label="이론 목록으로 돌아가기"
            >
              <span className="theory-list-back-icon" aria-hidden="true">←</span>
              <span>이론 목록으로 돌아가기</span>
            </RoutedLink>
          )}
          <nav className="theory-breadcrumb" aria-label="현재 이론 위치">
            <Link href="/">학습 분야</Link><span aria-hidden="true">›</span>
            <a href={learningPath({ examType, page: "home" })}>{course.name}</a><span aria-hidden="true">›</span>
            <a href={learningPath({ examType, page: "theories" })}>이론</a><span aria-hidden="true">›</span>
            <span aria-current="page">{breadcrumbLocation}</span>
            <span className="scope-badge">{examScopeLabel(selected.examScope)}</span>
          </nav>
          <h1 className="theory-title">{selected.title}</h1>
          <p className="theory-lead">{selected.summary}</p>
          <div className="theory-detail-meta">
            <span>{linkedCount ? "연결 문제 제공" : "연결 문제 없음"}</span>
            <span>예상 읽기 {readingMinutes}분</span>
          </div>
          {tocItems.length > 1 && (
            <nav className="theory-toc" aria-label="이 단원의 목차">
              <strong>이 단원에서 다루는 내용</strong>
              <ol>{tocItems.map((item) => <li key={item.id}><a href={`#${item.id}`}>{item.label}</a></li>)}</ol>
            </nav>
          )}
          <div className="keyword-row">
            {selected.keywords.map((item) => <span key={item}>#{item}</span>)}
          </div>
          <TheoryLearningContent article={selected} />
          {returnToQuestion ? (
            <div className="reader-foot return-question-foot">
              <div>
                <strong>확인하던 문제로 돌아갑니다.</strong>
                <p>작성 중인 답안과 현재 문제 위치는 그대로 유지됩니다.</p>
              </div>
              <button className="primary-button" onClick={onReturnQuestion}>문제로 돌아가기 →</button>
            </div>
          ) : (
            <div className="reader-foot">
              <div>
                <strong>{linkedCount
                  ? `${course.name} 문제로 이해도를 확인해 보세요.`
                  : "이 단원에 연결된 문제를 준비하고 있습니다."}</strong>
                {!linkedCount && <p>다른 이론을 계속 학습하거나 연결 문제가 있는 단원을 선택해 주세요.</p>}
              </div>
              <div className="reader-foot-actions">
                {previousTheory && (
                  <RoutedLink
                    className="outline-button"
                    href={learningPath({ examType, page: "theory", id: previousTheory.id })}
                    onNavigate={() => onSelect(previousTheory.id)}
                  >← 이전 단원</RoutedLink>
                )}
                <button className="outline-button" onClick={() => onPractice(selected)} disabled={!linkedCount}>
                  연결 문제 풀기
                </button>
                {nextTheory && (
                  <RoutedLink
                    className="primary-button"
                    href={learningPath({ examType, page: "theory", id: nextTheory.id })}
                    onNavigate={() => onSelect(nextTheory.id)}
                  >다음 단원 →</RoutedLink>
                )}
              </div>
            </div>
          )}
        </article>
      </>
    );
  }
  const categoryArticles = articles.filter((item) => item.category === effectiveCategory);
  const topics = ["전체 소분류", ...new Set(categoryArticles.map((item) => item.topic || "미분류"))];
  const filtered = categoryArticles.filter((item) => topicFilter === "전체 소분류" || item.topic === topicFilter)
    .filter((item) => matchesSearchQuery(
      search,
      item.title,
      item.category,
      item.topic,
      item.summary,
      item.keywords.join(" "),
    ))
    .sort(compareTheories);
  return (
    <div className="page-stack">
      <section className="theory-intro">
        <div>
          <span className="section-kicker">{course.name} 이론 학습</span>
          <h2>개념이 연결되는 이론 학습</h2>
          <p>현재 시험 범위의 이론만 표시하며, 상세 화면에서 목차와 핵심 개념을 따라 학습합니다.</p>
        </div>
        <label className="search-box">
          <span>⌕</span>
          <input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="제목·요약·키워드 검색"
            aria-label="이론 제목, 요약 또는 키워드 검색"
          />
        </label>
      </section>
      <section className="theory-controls">
        <div className="theory-category-tabs">
          {availableCategories.map((category) => (
            <button
              key={category}
              className={effectiveCategory === category ? "active" : ""}
              onClick={() => {
                setCategoryFilter(category);
                setTopicFilter("전체 소분류");
              }}
            >
              {examType === "IPEP" ? category : `${courseCategories.indexOf(category) + 1}과목`}
              <span>{articles.filter((item) => item.category === category).length}</span>
            </button>
          ))}
        </div>
        <label className="theory-topic-filter">
          <span>소분류</span>
          <select value={topics.includes(topicFilter) ? topicFilter : "전체 소분류"} onChange={(event) => setTopicFilter(event.target.value)}>
            {topics.map((topic) => <option key={topic}>{topic}</option>)}
          </select>
        </label>
      </section>
      <div className="theory-results-head" aria-live="polite">
        <div>
          <strong>{filtered.length}개 이론</strong>
          <span>
            {effectiveCategory}
            {topicFilter !== "전체 소분류" ? ` · ${topicFilter}` : ""}
          </span>
        </div>
        {search.trim() && (
          <button className="theory-search-reset" type="button" onClick={() => onSearch("")}>
            검색 지우기
          </button>
        )}
      </div>
      <div className="theory-grid">
        {filtered.map((article, index) => {
          return (
          <RoutedLink
            className="card theory-card"
            key={article.id}
            href={learningPath({ examType, page: "theory", id: article.id })}
            onNavigate={() => onSelect(article.id)}
            title={article.title}
          >
            <span className="theory-index">{String(index + 1).padStart(2, "0")}</span>
            <div className="theory-card-path">
              <span className="category-label">{examType === "IPEP" ? article.category : `${courseCategories.indexOf(article.category) + 1}과목`}</span>
              <strong>{article.topic || "미분류"}</strong>
            </div>
            <h3>{article.title}</h3>
            <p>{article.summary}</p>
            <div className="keyword-row">
              {article.keywords.slice(0, 3).map((item) => <span key={item}>#{item}</span>)}
            </div>
            <strong>이론 읽기 →</strong>
          </RoutedLink>
          );
        })}
      </div>
      {!filtered.length && <EmptyState title="검색 결과가 없습니다." description="과목·소분류 필터를 바꾸거나 다른 키워드로 찾아보세요." />}
    </div>
  );
}


export default TheoryView;
