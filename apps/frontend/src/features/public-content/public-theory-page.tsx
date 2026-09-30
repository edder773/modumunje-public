import Link from "next/link";
import { parseLearningPath } from "@shared/study/learning-catalog";
import PublicTheoryDirectory, { type TheoryDirectoryFilters } from "./public-theory-directory";
import { notFound } from "next/navigation";
import MarkdownRenderer from "@frontend/features/content/components/markdown-renderer";
import { normalizeMarkdownProse, stripTheoryDifficultyMetadata } from "@shared/content/content-format.mjs";
import { splitTheoryReview } from "@shared/content/theory-review.mjs";
import { learnerFacingMarkdown, markdownHeadingEntries } from "@shared/content/markdown-heading.mjs";
import { publicTheoryPage } from "@frontend/server/public-theory";
import PublicTheoryShell from "./public-theory-shell";
import styles from "./public-theory.module.css";

function readingContents(value: string) {
  return markdownHeadingEntries(learnerFacingMarkdown(value))
    .filter(({ level }) => level >= 2).slice(0, 12);
}

function reviewLabel(value: string) {
  return normalizeMarkdownProse(value).replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1").replace(/[*_~`>#]/gu, "")
    .replace(/\s+/gu, " ").trim();
}

export default async function PublicTheoryPage({ pathname, filters }: { pathname: string; filters?: TheoryDirectoryFilters }) {
  const document = await publicTheoryPage(pathname);
  if (!document) notFound();
  const { selected, articles } = document;
  const route = parseLearningPath(pathname);
  const examType = route && "examType" in route ? route.examType : null;
  const commonGuide = examType === "SQLD" ? "sqld" : examType === "IPEP" ? "ipe-practical" : null;
  const parsed = selected ? splitTheoryReview(stripTheoryDifficultyMetadata(selected.content ?? ""), selected.reviewAnswers ?? "") : null;
  const position = selected ? articles.findIndex((article) => article.id === selected.id) : -1;
  const previous = position > 0 ? articles[position - 1] : undefined;
  const next = position < 0 ? undefined : articles[position + 1];
  const mainContent = parsed ? normalizeMarkdownProse(parsed.mainContent) : "";
  const tocItems = readingContents(mainContent);
  const breadcrumb = (
    <nav className="theory-breadcrumb" aria-label="현재 위치">
      <Link href="/">학습 분야</Link><span aria-hidden="true">›</span>
      <Link href={document.homePath}>{document.name}</Link><span aria-hidden="true">›</span>
      <Link href={document.listPath}>이론 목록</Link>
      {selected && <><span aria-hidden="true">›</span><span aria-current="page">{selected.topic || selected.category}</span></>}
    </nav>
  );
  return (
    <PublicTheoryShell name={document.name} listPath={document.listPath} practicePath={document.practicePath} selected={Boolean(selected)}>
        {selected && parsed ? (
          <>
            <article className="card theory-reader" aria-label={selected.title}>
              <Link className="back-button theory-list-back" href={document.listPath} aria-label="이론 목록으로 돌아가기">
                <span className="theory-list-back-icon" aria-hidden="true">←</span>
                <span>이론 목록으로 돌아가기</span>
              </Link>
              {breadcrumb}
              <h1 className="theory-title">{selected.title}</h1>
              <p className="theory-lead">{selected.summary}</p>
              <div className="theory-detail-meta"><span>예상 읽기 {Math.max(1, Math.ceil(mainContent.length / 650))}분</span></div>
              {tocItems.length > 1 && <nav className="theory-toc" aria-label="이 단원의 목차">
                <strong>이 단원에서 다루는 내용</strong>
                <ol>{tocItems.map((item) => <li key={item.id}><a href={`#${item.id}`}>{item.label}</a></li>)}</ol>
              </nav>}
              <div className="theory-content"><div className="rich-content"><div className="markdown-body">
                <MarkdownRenderer value={mainContent} />
              </div></div></div>
              {parsed.items.length > 0 && (
                <section className="theory-review" aria-labelledby="concept-review">
                  <div className="theory-review-heading">
                    <span className="eyebrow">스스로 확인하기</span>
                    <h3 id="concept-review">개념 확인 문제</h3>
                    <p>문제를 누르면 바로 아래에서 정답과 해설을 확인할 수 있습니다.</p>
                  </div>
                  <div className="theory-review-list">{parsed.items.map((item) => (
                    <details className="theory-review-item" key={item.number}>
                      <summary>
                        <span className="theory-review-number">{String(item.number).padStart(2, "0")}</span>
                        <span>{reviewLabel(item.question)}</span>
                        <span className="theory-review-toggle" aria-hidden="true">＋</span>
                      </summary>
                      <div className="theory-review-answer">
                        <strong>정답 및 해설</strong>
                        <div className="rich-content compact"><div className="markdown-body"><MarkdownRenderer value={item.answer} /></div></div>
                      </div>
                    </details>
                  ))}</div>
                </section>
              )}
            </article>
              <aside className={`card reader-foot ${styles.continuation}`} aria-label="다음 학습으로 이동">
                <div>{document.practicePath
                  ? <><strong>읽은 내용을 문제로 확인하세요.</strong><p>이론과 이 페이지의 개념 확인 정답·해설은 공개됩니다. 별도 문제 풀이와 개인 학습 기록은 로그인 후 이용하세요.</p></>
                  : <><strong>개념을 확인하고 다음 단원으로 이어가세요.</strong><p>위 개념 확인 문제를 풀고 정답과 해설을 펼쳐 보세요.</p></>}
                  {commonGuide && <p><Link href={`/guides/${commonGuide}#common-theory-checklist`}>과정 공통 점검 가이드</Link></p>}
                  <p className="theory-detail-meta"><Link href="/about#content-principles-title">콘텐츠 작성 방식·검증 한계·오류 제보</Link></p>
                </div>
                <nav className="reader-foot-actions" aria-label="이전·다음 이론">
                  {previous && <Link className="outline-button" href={previous.href}>← 이전 단원</Link>}
                  {document.practicePath && <a className="outline-button" href={document.practicePath}>문제 풀기 →</a>}
                  {next && <Link className="primary-button" href={next.href}>다음 단원 →</Link>}
                </nav>
              </aside>
          </>
        ) : (
          <PublicTheoryDirectory key={`${document.listPath}:${JSON.stringify(filters)}`} articles={articles} name={document.name} listPath={document.listPath} filters={filters} />
        )}
    </PublicTheoryShell>
  );
}
