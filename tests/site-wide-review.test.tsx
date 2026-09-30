import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { openCanonicalTestDatabase } from './helpers/canonical-database.mjs';
import { sqliteD1 } from './helpers/sqlite-d1.mjs';
import { CONTENT_ADMIN_DOMAINS, contentDomainForScope, contentDomainOptions, contentDomainForLabel } from '../packages/shared/src/admin/content-domains';
import { ContentDomainTabs } from '../apps/frontend/src/features/admin/components/admin-content-shared';
import { PUBLIC_GUIDE_LINKS } from '../apps/frontend/src/features/public-content/public-guide-links';
import { publicCourseGuide, guideLearningCourse } from '../apps/frontend/src/features/public-content/public-guide-data';
import { CATALOG_FIELD_CARDS } from '../apps/frontend/src/features/study/components/catalog/catalog-fields';
import LearningCatalogHome from '../apps/frontend/src/features/study/components/catalog/catalog-home';

test('all released destinations have a complete public guide and compact catalog entry', async () => {
  const destinations = CATALOG_FIELD_CARDS.flatMap(field => field.links.filter(link => !link.preparing).map(link => link.href));
  const guides = PUBLIC_GUIDE_LINKS.map(link => publicCourseGuide(link.slug));
  assert.deepEqual(guides.map(guide => guideLearningCourse(guide).href).sort(), destinations.sort());
  const html = renderToStaticMarkup(<LearningCatalogHome fields={CATALOG_FIELD_CARDS} />);
  assert.equal((html.match(/class="catalog-directory-row"/gu) ?? []).length, CATALOG_FIELD_CARDS.length);
  assert.equal((html.match(/<svg /gu) ?? []).length, CATALOG_FIELD_CARDS.length);
  for (const guide of guides) {
    const course = guideLearningCourse(guide);
    assert.deepEqual(Object.keys(guide.subjectGuidance).sort(), course.subjects.map(subject => subject.id).sort());
    assert.ok(html.includes(`href="/guides/${guide.slug}"`));
    for (const subject of course.subjects) {
      const section = guide.subjectGuidance[subject.id];
      assert.ok(section.focus.length > 10 && section.practice.length > 10);
    }
    assert.equal(guide.learningSteps.length, 4);
    assert.ok(guide.checkpoints.length >= 3);
  }
  assert.match(html, /이론은 로그인 없이 읽을 수 있습니다\. 문제 풀이·모의고사·학습 기록은 로그인 후/u);
  assert.doesNotMatch(html, /이어갈 때만 로그인/u);
});

test('admin fields, live queries and recovery export filters agree for all certification domains', async () => {
  const database = openCanonicalTestDatabase(process.cwd());
  Object.defineProperty(globalThis, '__BAEUMZIP_APP_VERSION__', { value: 'site-wide-review-tests', configurable: true });
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(database) as unknown as D1Database, GOOGLE_AUTH_SESSION_SECRET: 'site-wide-review-test-secret-at-least-32-chars' };
  const { readQuestionList, readTheoryList } = await import('../apps/backend/src/modules/admin/admin-read-use-cases');
  const { readQuestionExportSource, readTheoryExportSource } = await import('../apps/backend/src/modules/admin/admin-export-use-cases');
  for (const domain of CONTENT_ADMIN_DOMAINS) {
    assert.equal(contentDomainForLabel(domain.shortLabel), domain.id);
    const html = renderToStaticMarkup(<ContentDomainTabs domain={domain.id} section="questions" />);
    assert.equal((html.match(/aria-current="page"/gu) ?? []).length, 1);
    for (const item of CONTENT_ADMIN_DOMAINS) assert.ok(html.includes(`domain=${item.id}`));
    if (domain.id === 'sw') continue;
    const config = contentDomainOptions(domain.id);
    assert.ok(config.scopeOptions.length && config.subjects.length);
    for (const option of config.scopeOptions) assert.equal(contentDomainForScope(option.value), domain.id);
    const url = new URL(`https://example.test/api/admin?contentDomain=${domain.id}&active=active&pageSize=10`);
    const questions = await readQuestionList(url), theories = await readTheoryList(url);
    if (domain.id === "ise") {
      assert.equal(questions.pagination.total, 50);
      assert.equal(theories.pagination.total, Number(database.prepare("SELECT COUNT(*) AS n FROM theories WHERE exam_scope='ISEW' AND active=1").get()!.n));
      assert.ok(theories.pagination.total > 0);
    } else assert.ok(questions.pagination.total > 0 && theories.pagination.total > 0);
    assert.ok(questions.items.every(row => contentDomainForScope(row.examScope) === domain.id));
    assert.ok(theories.items.every(row => contentDomainForScope(row.examScope) === domain.id));
    const exported = await readQuestionExportSource(url);
    assert.equal(exported.total, questions.pagination.total);
    assert.ok((await exported.loadPage(0, 10)).every(row => contentDomainForScope(String(row.exam_scope)) === domain.id));
  }
  // An empty DB requires a verified private restore, never an embedded old bank.
  database.exec('BEGIN; DELETE FROM questions; DELETE FROM theories;');
  for (const domain of ['sql','da','bae','ipe','ise'] as const) {
    const url = new URL(`https://example.test/api/admin?contentDomain=${domain}`);
    await assert.rejects(readQuestionExportSource(url), /검증된 비공개 콘텐츠 릴리스 또는 백업을 복원/u);
    await assert.rejects(readTheoryExportSource(url), /검증된 비공개 콘텐츠 릴리스 또는 백업을 복원/u);
  }
  database.exec('ROLLBACK'); database.close();
});

test('practical quality checks validate real answer keys and still detect genuine content defects', async () => {
  const database = openCanonicalTestDatabase(process.cwd());
  globalThis.__BAEUMZIP_ENV__ = { ...globalThis.__BAEUMZIP_ENV__, DB: sqliteD1(database) as unknown as D1Database };
  const { computeQuality } = await import('../apps/backend/src/modules/admin/admin-quality-use-cases');
  const baseline = await computeQuality();
  assert.equal(baseline.summary.error, 0); assert.equal(baseline.summary.warning, 0);
  assert.equal(baseline.summary.info, 0);
  assert.equal(baseline.coverage.find(row => row.domain === 'ipe')!.questions, 3347);
  assert.equal(baseline.coverage.length, CONTENT_ADMIN_DOMAINS.length);
  assert.equal(baseline.coverage.find(row => row.domain === "ise")!.questions, 50);
  database.exec('BEGIN');
  database.prepare('UPDATE questions SET prompt = prompt || ? WHERE id = ?').run('\n변경한 검정 조건',88100001);
  let result = await computeQuality();
  assert.ok(result.issues.some(issue => issue.targetId === 88100001 && issue.title === '실기 정답표 확인 필요' && issue.domain === 'ipe'));
  database.exec('ROLLBACK; BEGIN');
  database.prepare("UPDATE questions SET scoring_criteria='[]', required_concepts='[]', explanation='짧은 해설', tags='[]' WHERE id = (SELECT id FROM questions WHERE exam_scope='SQLP' AND kind='descriptive' AND active=1 LIMIT 1)").run();
  result = await computeQuality();
  assert.ok(result.issues.some(issue => issue.title === '서술형 채점 기준 누락' && issue.domain === 'sql'));
  database.exec('ROLLBACK; BEGIN');
  assert.throws(() => database.prepare("UPDATE questions SET correct_answers='[0,1]' WHERE id=(SELECT id FROM questions WHERE exam_scope='BAE' AND kind='single' AND active=1 LIMIT 1)").run(), /correct answer contract is invalid/u);
  database.exec('ROLLBACK'); database.close();
});
