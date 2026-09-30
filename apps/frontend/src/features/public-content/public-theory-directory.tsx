"use client";

import { useState } from "react";
import Link from "next/link";
import type { PublicTheoryArticle } from "@shared/study/public-theory";
import { courseDefinition } from "@shared/study/study-domain";
import { parseLearningPath } from "@shared/study/learning-catalog";
import readerStyles from "./public-theory.module.css";

export type TheoryDirectoryFilters = { category?: string; topic?: string; q?: string };

export default function PublicTheoryDirectory({ articles, name, listPath, filters = {} }: {
  articles: PublicTheoryArticle[]; name: string; listPath: string; filters?: TheoryDirectoryFilters;
}) {
  const route = parseLearningPath(listPath)!;
  const isSw = route.page === "field";
  const categories = [...new Set(articles.map((article) => article.category))];
  const courseCategories = isSw ? categories : courseDefinition(route.examType).releasedSubjects.map((subject) => subject.name);
  const [search, setSearch] = useState(filters.q ?? "");
  const [category, setCategory] = useState(categories.includes(filters.category ?? "") ? filters.category! : isSw ? "" : categories[0] ?? "");
  const [topic, setTopic] = useState(filters.topic ?? "");
  const categoryArticles = articles.filter((article) => !category || article.category === category);
  const topics = [...new Set(categoryArticles.map((article) => article.topic || "미분류"))];
  const activeTopic = topics.includes(topic) ? topic : "";
  const terms = search.toLocaleLowerCase("ko-KR").trim().split(/\s+/u).filter(Boolean);
  const filtered = categoryArticles.filter((article) => (!activeTopic || (article.topic || "미분류") === activeTopic)
    && terms.every((term) => `${article.title} ${article.category} ${article.topic} ${article.summary} ${article.keywords.join(" ")}`.toLocaleLowerCase("ko-KR").includes(term)));
  const label = (value: string) => isSw || route.examType === "IPEP" ? value : `${courseCategories.indexOf(value) + 1}과목`;
  const categoryHref = (value: string) => `${listPath}?${new URLSearchParams({ category: value, ...(search ? { q: search } : {}) })}`;
  const searchField = <label className="search-box"><span aria-hidden="true">⌕</span><input type="search" form="theory-filters" name="q" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="제목·요약·키워드 검색" aria-label="이론 제목, 요약 또는 키워드 검색" /></label>;
  return <div className={`page-stack ${isSw ? "sw-curriculum-page sw-content-page " : ""}${readerStyles.directory}`}>
    <section className={isSw ? "sw-content-heading" : "theory-intro"}>
      <div><span className="section-kicker">{name} 이론 학습</span><h2>{isSw ? "소주제별 핵심 이론을 확인하세요." : "개념이 연결되는 이론 학습"}</h2><p>{isSw ? "대분류를 선택하거나 검색으로 핵심 이론을 찾아보세요." : "과목과 소분류를 선택해 핵심 개념을 찾아보세요."} 모든 이론은 로그인 없이 읽을 수 있습니다.</p></div>
      {!isSw && searchField}
    </section>
    <form id="theory-filters" className={`theory-controls${isSw ? " sw-theory-controls" : ""}`} action={listPath} method="get">
      {isSw ? <>{searchField}<label className="theory-topic-filter"><span>대분류</span><select aria-label="대분류" name="category" value={category} onChange={(event) => { setCategory(event.target.value); setTopic(""); }}><option value="">전체 분류</option>{categories.map((value) => <option key={value} value={value}>{value}</option>)}</select></label><span className="theory-filter-count">{filtered.length}개 이론</span></> : <><input type="hidden" name="category" value={category} />
      <nav className="theory-category-tabs" aria-label="이론 과목">
        {categories.map((value) => <a key={value} href={categoryHref(value)} className={category === value ? "active" : ""} aria-current={category === value ? "page" : undefined}
          aria-label={value ? `${label(value)} · ${value}` : "전체 분류"}
          onClick={(event) => { if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); setCategory(value); setTopic(""); }}>
          {value ? label(value) : "전체 분류"}<span>{value ? articles.filter((article) => article.category === value).length : articles.length}</span>
        </a>)}
      </nav>
      <label className="theory-topic-filter"><span>소분류</span><select aria-label="소분류" name="topic" value={activeTopic} onChange={(event) => setTopic(event.target.value)}><option value="">전체 소분류</option>{topics.map((value) => <option key={value} value={value}>{value}</option>)}</select></label></>}
      <noscript><button className="outline-button" type="submit">검색·필터 적용</button></noscript>
    </form>
    {(!isSw || Boolean(search.trim())) && <div className="theory-results-head" role="status">{!isSw && <div><strong>{filtered.length}개 이론</strong><span>{category || "전체 분류"}{activeTopic ? ` · ${activeTopic}` : ""}</span></div>}
      {search.trim() && <a className="theory-search-reset" href={`${listPath}?${new URLSearchParams({ category, ...(activeTopic ? { topic: activeTopic } : {}) })}`} onClick={(event) => { event.preventDefault(); setSearch(""); }}>검색 지우기</a>}
    </div>}
    <div className={`theory-grid${isSw ? " sw-theory-grid" : ""}`}>
      {filtered.map((article, index) => <Link className="card theory-card" href={article.href} key={article.id} title={article.title}>
        <span className="theory-index">{String(index + 1).padStart(2, "0")}</span>
        <div className="theory-card-path"><span className="category-label">{label(article.category)}</span><strong>{article.topic || "미분류"}</strong></div>
        <h3>{article.title}</h3><p>{article.summary}</p>
        <div className="keyword-row">{article.keywords.slice(0, isSw ? 4 : 3).map((keyword) => <span key={keyword}>#{keyword}</span>)}</div>
        <strong>이론 읽기 →</strong>
      </Link>)}
    </div>
    {!filtered.length && <div className="card empty-state"><h2>검색 결과가 없습니다.</h2><p>과목·소분류 필터를 바꾸거나 다른 키워드로 찾아보세요.</p></div>}
  </div>;
}
