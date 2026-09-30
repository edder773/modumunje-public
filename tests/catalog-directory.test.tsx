import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import LearningCatalogHome from "../apps/frontend/src/features/study/components/catalog/catalog-home";
import { CATALOG_FIELD_CARDS, searchCatalogFields } from "../apps/frontend/src/features/study/components/catalog/catalog-fields";
import { LEARNING_CATALOG, canonicalLearningEntry, learningPath, parseLearningPath } from "../packages/shared/src/study/learning-catalog";
import { PREPARING_COURSES, preparingCoursePath, parsePreparingLearningPath } from "../packages/shared/src/study/preparing-courses";
import { releasedLocalPracticeCourses, localPracticePath, parseLocalPracticePath } from "../packages/shared/src/study/local-practice";
import { getCatalogPage } from "../apps/frontend/src/features/study/components/catalog/catalog-search";

test("the directory links directly to every released course and keeps field discovery available in server HTML", () => {
  const html = renderToStaticMarkup(<LearningCatalogHome fields={CATALOG_FIELD_CARDS} />);
  const expected = [
    ...LEARNING_CATALOG.flatMap(field => field.courses.map(course => learningPath({ examType: course.examType, page: "home" }))),
    ...releasedLocalPracticeCourses().map(course => localPracticePath(course)),
    "/learn/software-major",
    "/learn/skct-personal",
    ...PREPARING_COURSES.map(preparingCoursePath),
  ];
  const links = CATALOG_FIELD_CARDS.flatMap(field => field.links);
  assert.deepEqual(links.map(link => link.href).sort(), expected.sort());
  assert.equal(new Set(links.map(link => link.href)).size, links.length);
  for (const link of links) {
    assert.ok(link.href === "/learn/skct-personal" || parseLearningPath(link.href) || parseLocalPracticePath(link.href) || parsePreparingLearningPath(link.href), link.href);
    assert.ok(html.includes(`href="${link.href}"`));
    assert.ok(html.includes(`aria-label="${link.name} 학습 홈"`));
  }
  for (const field of CATALOG_FIELD_CARDS) {
    assert.ok(html.includes(`href="${field.href}"`));
    assert.ok(html.includes(field.cardTitle));
  }
  assert.doesNotMatch(html, /catalog-field-card|catalog-field-summary|catalog-field-offerings/u);
  // Each link closes before another link starts; course actions are never nested anchors.
  for (const match of html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gu)) assert.doesNotMatch(match[1], /<a\b/u);
});

test("course search combines field and course terms, including Korean aliases and fullwidth input", () => {
  const paths = (query: string) => searchCatalogFields(CATALOG_FIELD_CARDS, query).flatMap(field => field.links.map(link => link.href));
  assert.deepEqual(paths("  ｓｑｌｄ  "), ["/learn/sql/sqld/home"]);
  assert.deepEqual(paths("빅데이터 실기"), ["/learn/big-data-analysis/bae-practical/home"]);
  assert.deepEqual(paths("정처기 실기"), ["/learn/information-processing/ipe-practical/home"]);
  assert.deepEqual(paths("정보처리기사필기"), ["/learn/information-processing/ipe-written/home"]);
  assert.deepEqual(paths("SW"), ["/learn/software-major"]);
  assert.deepEqual(paths("데이터 아키텍처"), ["/learn/data-architecture/dasp/home", "/learn/data-architecture/dap/home"]);
  assert.deepEqual(paths("없는자격증"), []);
  assert.equal(searchCatalogFields(CATALOG_FIELD_CARDS, "   "), CATALOG_FIELD_CARDS);
  assert.equal(CATALOG_FIELD_CARDS.find(field => field.id === "big-data-analysis")!.links.length, 2);
});

test("guest and signed-in catalog content stays identical and preserves the login-error message", () => {
  const guest = renderToStaticMarkup(<LearningCatalogHome fields={CATALOG_FIELD_CARDS} isAuthenticated={false} />);
  assert.equal(guest, renderToStaticMarkup(<LearningCatalogHome fields={CATALOG_FIELD_CARDS} isAuthenticated />));
  assert.match(guest, /role="search" aria-label="학습 과정 검색"/u);
  const error = renderToStaticMarkup(<LearningCatalogHome fields={CATALOG_FIELD_CARDS} authError />);
  assert.match(error, /role="alert"[\s\S]*로그인을 완료하지 못했습니다/u);
});

test("an expanded catalog remains bounded and every field is reachable across pages", () => {
  const fields = Array.from({ length: 19 }, (_, index) => ({ ...CATALOG_FIELD_CARDS[0], id: `field-${index}`, cardTitle: `과정 ${index}` }));
  const pages = [1, 2].map(page => getCatalogPage(fields, { page }));
  assert.deepEqual(pages.map(result => result.fields.length), [12, 7]);
  assert.deepEqual(pages.flatMap(result => result.fields.map(field => field.id)), fields.map(field => field.id));
  assert.equal(getCatalogPage(fields, { page: 99 }).currentPage, 2);
  assert.equal(getCatalogPage(fields, { page: -1 }).currentPage, 1);
  const html = renderToStaticMarkup(<LearningCatalogHome fields={fields} />);
  assert.equal((html.match(/class="catalog-directory-row"/gu) ?? []).length, 12);
  assert.match(html, /aria-label="학습 과정 페이지"/u);
  for (const field of fields) assert.ok(html.includes(`value="${field.id}"`));
});

test("field selection and course search run before pagination and empty results recover to page one", () => {
  const result = getCatalogPage(CATALOG_FIELD_CARDS, { fieldId: "information-processing", query: "실기", page: 8 });
  assert.equal(result.currentPage, 1);
  assert.equal(result.fieldCount, 1);
  assert.equal(result.courseCount, 1);
  assert.equal(result.fields[0].links[0].href, "/learn/information-processing/ipe-practical/home");
  const empty = getCatalogPage(CATALOG_FIELD_CARDS, { fieldId: "sql", query: "정보처리", page: 8 });
  assert.deepEqual(empty, { fields: [], fieldCount: 0, courseCount: 0, currentPage: 1, pageCount: 1 });
});


test("common entry aliases cover released courses and preserve unrelated routes", () => {
  const entries = LEARNING_CATALOG.flatMap(field => field.courses.map(course => `/learn/${field.id}/${course.id}`));
  assert.equal(entries.length, 8);
  for (const entry of entries) {
    assert.equal(canonicalLearningEntry(entry), `${entry}/home`);
    assert.ok(parseLearningPath(`${entry}/home`));
  }
  assert.equal(canonicalLearningEntry("/learn/software-major/home"), "/learn/software-major");
  for (const path of ["/learn/sql", "/learn/sql/unknown", "/learn/sql/sqld/theories", "/learn/skct-personal"]) {
    assert.equal(canonicalLearningEntry(path), null);
  }
});

test("seven current fields fit on one page while search keeps all fields reachable", () => {
  const fields = Array.from({ length: 7 }, (_, index) => ({ ...CATALOG_FIELD_CARDS[0], id: `field-${index}` }));
  assert.equal(getCatalogPage(fields).fields.length, 7);
  assert.equal(getCatalogPage(fields).pageCount, 1);
  const html = renderToStaticMarkup(<LearningCatalogHome fields={fields} />);
  assert.doesNotMatch(html, /aria-label="학습 과정 페이지"/u);
});
