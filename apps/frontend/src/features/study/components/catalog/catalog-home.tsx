import { ReservedAdSlot } from "../../../advertising/reserved-ad-slot";
import { PUBLIC_GUIDE_LINKS } from "../../../public-content/public-guide-links";
import CatalogFieldIcon from "./catalog-field-icon";
import { getCatalogPage, type CatalogFieldCard } from "./catalog-search";

export default function LearningCatalogHome({
  authError = false,
  fields,
  filters = {},
}: {
  authError?: boolean;
  isAuthenticated?: boolean;
  fields: CatalogFieldCard[];
  filters?: { query?: string; fieldId?: string; page?: number };
}) {
  const query = (filters.query ?? "").slice(0, 100);
  const fieldId = fields.some(field => field.id === filters.fieldId) ? filters.fieldId ?? "" : "";
  const catalog = getCatalogPage(fields, { query, fieldId, page: filters.page ?? 1 });
  const visibleFields = catalog.fields;
  function pageHref(page: number) {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (fieldId) params.set("field", fieldId);
    if (page > 1) params.set("page", String(page));
    return `/?${params.toString()}#catalog-results`;
  }
  const capabilities = [
    {
      step: "01",
      title: "이론 학습",
      description: "로그인 없이 과목·단원 순서에 따라 핵심 개념과 예제를 읽습니다.",
    },
    {
      step: "02",
      title: "문제 풀이",
      description: "개념을 적용해 답을 작성하고 정답의 근거를 확인합니다.",
    },
    {
      step: "03",
      title: "오답 복습",
      description: "틀린 문제와 북마크한 문제를 다시 풀며 부족한 개념을 보완합니다.",
    },
    {
      step: "04",
      title: "모의고사",
      description: "선택한 과정과 범위의 시험 흐름으로 실전 감각을 점검합니다.",
    },
  ];
  return (
    <div className="page-stack learning-catalog-home">
      {authError && (
        <div className="google-auth-error" role="alert">
          로그인을 완료하지 못했습니다. 계정을 다시 선택해 주세요.
        </div>
      )}
      <section aria-labelledby="learning-fields-title">
        <div className="entry-section-heading catalog-directory-heading">
          <div>
            <span className="section-kicker">학습 분야</span>
            <h2 id="learning-fields-title">학습 과정</h2>
            <p>필기부터 실기까지, 필요한 과정으로 바로 시작하세요.</p>
          </div>
        </div>
        <form className="catalog-discovery-controls" action="/" method="get" role="search" aria-label="학습 과정 검색">
          <div className="catalog-field-filter">
            <label htmlFor="catalog-field-filter">학습 분야</label>
            <select id="catalog-field-filter" name="field" defaultValue={fieldId} aria-controls="catalog-results">
              <option value="">전체 분야</option>
              {fields.map(field => <option key={field.id} value={field.id}>{field.cardTitle}</option>)}
            </select>
          </div>
          <div className="catalog-course-search">
            <label htmlFor="catalog-course-search">과정 검색</label>
            <div>
              <input id="catalog-course-search" name="q" type="search" defaultValue={query} maxLength={100} placeholder="예: SQLD, 정보처리기사, 빅데이터 실기" aria-controls="catalog-results" />
              <button type="submit">검색</button>
            </div>
          </div>
        </form>
        <div className="catalog-results-heading">
          <p className="catalog-search-result" role="status">{query.trim() || fieldId ? "검색 결과" : "전체"} {catalog.fieldCount}개 분야 · {catalog.courseCount}개 과정{catalog.pageCount > 1 && ` · ${catalog.currentPage}/${catalog.pageCount}페이지`}</p>
          {(query || fieldId) && <a className="catalog-reset" href="/">전체 과정 보기</a>}
        </div>
        <div className="catalog-directory" id="catalog-results" aria-label="분야별 학습 과정">
          {visibleFields.map(field => (
            <article className="catalog-directory-row" data-field={field.id} key={field.id} aria-labelledby={`catalog-field-${field.id}`}>
              <a className="catalog-field-link" href={field.href}>
                <span className="catalog-field-mark" aria-hidden="true"><CatalogFieldIcon field={field.id} /></span>
                <div><h3 id={`catalog-field-${field.id}`}>{field.cardTitle}</h3><span className="catalog-field-caption">분야 둘러보기 <span aria-hidden="true">↗</span></span></div>
              </a>
              <ul className="catalog-course-links" aria-label={`${field.cardTitle} 과정 선택`}>
                {field.links.map(link => <li key={link.href}>
                  <a href={link.href} className="catalog-course-link" aria-label={`${link.name} 학습 홈`}>
                    <span>{link.label}{link.preparing && <small className="catalog-preparing-badge">준비 중</small>}</span><span aria-hidden="true">→</span>
                  </a>
                </li>)}
              </ul>
            </article>
          ))}
          {!visibleFields.length && <p className="catalog-search-empty">일치하는 과정이 없습니다. 검색어를 바꾸거나 전체 과정 보기를 선택해 주세요.</p>}
        </div>
        {catalog.pageCount > 1 && <nav className="catalog-pagination" aria-label="학습 과정 페이지">
          {catalog.currentPage > 1 && <a href={pageHref(catalog.currentPage - 1)}>이전</a>}
          {Array.from({ length: catalog.pageCount }, (_, index) => <a key={index + 1} href={pageHref(index + 1)} aria-current={index + 1 === catalog.currentPage ? "page" : undefined}>{index + 1}</a>)}
          {catalog.currentPage < catalog.pageCount && <a href={pageHref(catalog.currentPage + 1)}>다음</a>}
        </nav>}
      </section>

      <section aria-labelledby="public-reading-title">
        <div className="section-heading entry-section-heading"><div>
          <span className="section-kicker">로그인 없이 읽는 개념 해설</span>
          <h2 id="public-reading-title">작은 예제로 원리를 먼저 이해하세요.</h2>
          <p>입력·계산 과정·실행 결과와 흔한 오류를 함께 설명합니다. 문제 은행과 채점 기능은 로그인 후 이용할 수 있습니다.</p>
        </div></div>
        <div className="catalog-guide-grid">
          <article className="catalog-guide-link"><strong>SQL · 조인과 집계</strong><p>주문이 없는 회원을 남기는 방법과 COUNT의 차이를 결과 행으로 확인합니다.</p><a href="/guides/sqld#worked-example">LEFT JOIN 예제 읽기 →</a><p><a href="/learn/sql/sqld/theories">SQLD 공개 이론 전체 보기</a></p></article>
          <article className="catalog-guide-link"><strong>데이터 분석 · 검증의 경계</strong><p>결측값을 평균으로 대체할 때 검증 자료의 정보가 섞이는 과정을 추적합니다.</p><a href="/guides/big-data-analysis#worked-example">데이터 누수 예제 읽기 →</a><p><a href="/learn/big-data-analysis/bae-written/theories">빅데이터분석기사 공개 이론 전체 보기</a></p></article>
          <article className="catalog-guide-link"><strong>SW 전공 · 참조와 복사</strong><p>같은 리스트를 공유하는 경우와 독립적으로 복사한 경우의 출력을 비교합니다.</p><a href="/guides/software-major#worked-example">Python 복사 예제 읽기 →</a><p><a href="/learn/software-major/theories">SW 전공 공개 이론 전체 보기</a></p></article>
        </div>
      </section>

      <section aria-labelledby="learning-method-title">
        <div className="section-heading entry-section-heading">
          <div>
            <span className="section-kicker">학습 안내</span>
            <h2 id="learning-method-title">추천 학습 순서</h2>
            <p>모든 학습 메뉴는 필요에 따라 자유롭게 이동할 수 있습니다.</p>
          </div>
        </div>
        <div className="catalog-capability-grid catalog-study-steps" aria-label="모두의 문제집 학습 기능">
        {capabilities.map((capability) => (
          <article className="catalog-capability-card" key={capability.title}>
            <span>{capability.step}</span>
            <h3>{capability.title}</h3>
            <p>{capability.description}</p>
          </article>
        ))}
        </div>
        <p className="catalog-record-note">이론은 로그인 없이 읽을 수 있습니다. 문제 풀이·모의고사·학습 기록은 로그인 후 이용하세요.</p>
      </section>

      <section aria-labelledby="public-guides-title">
        <div className="section-heading entry-section-heading">
          <div>
            <span className="section-kicker">공개 학습 자료</span>
            <h2 id="public-guides-title">과정별 학습 방향</h2>
            <p>처음 시작하거나 학습 순서가 막힐 때 참고하세요.</p>
          </div>
        </div>
        <div className="catalog-guide-grid">
          {PUBLIC_GUIDE_LINKS.map((guide) => (
            <a className="catalog-guide-link" href={`/guides/${guide.slug}`} key={guide.slug}>
              <strong>{guide.name}</strong>
              <p>{guide.summary}</p>
              <span className="catalog-guide-arrow" aria-hidden="true">↗</span>
            </a>
          ))}
        </div>
      </section>

      <ReservedAdSlot placement="catalogFooter" suppressed={Boolean(query.trim() || fieldId || authError)} />

      <div className="catalog-footer-note">
        <p>새 과정은 콘텐츠와 학습 동선의 검수를 마친 뒤 공개합니다.</p>
        <p>
          <a href="/guides">학습 가이드</a>
          {" · "}<a href="/about">서비스 소개</a>
          {" · "}<a href="/privacy">개인정보처리방침</a>
        </p>
      </div>

    </div>
  );
}
