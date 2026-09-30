import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test, { after } from 'node:test';
import worker from '../dist/server/index.js';
import { openCanonicalTestDatabase } from './helpers/canonical-database.mjs';
import { sqliteD1 } from './helpers/sqlite-d1.mjs';

const database = openCanonicalTestDatabase(process.cwd());
after(() => database.close());
const origin = 'https://modumunje.com';
const environment = { DB: sqliteD1(database), GOOGLE_AUTH_SESSION_SECRET: 'site-review-http-test-secret-with-32-characters', ASSETS: { fetch: async request => {
  const file = path.join(process.cwd(), 'dist/client', new URL(request.url).pathname);
  return fs.existsSync(file) && fs.statSync(file).isFile() ? new Response(fs.readFileSync(file)) : new Response(null, { status: 404 });
} } };
const context = { waitUntil() {}, passThroughOnException() {} };
const read = url => worker.fetch(new Request(new URL(url, origin), { headers: { accept: 'text/html', 'user-agent': 'Googlebot' } }), environment, context);
const slugs = ['sqld', 'sqlp', 'dasp', 'dap', 'big-data-analysis', 'big-data-practical', 'ipe-written', 'ipe-practical', 'software-major', 'ise-written', 'skct-personal'];

test('built public pages expose all eleven course guides, correct metadata and compact catalog styles', async () => {
  const root = await read('/'); assert.equal(root.status, 200);
  const html = await root.text();
  assert.equal((html.match(/class="catalog-directory-row"/gu) ?? []).length, 7);
  const guidePaths = [...new Set([...html.matchAll(/href="(\/guides\/[^"#]+)"/gu)].map(match => match[1]))];
  assert.deepEqual(guidePaths.sort(), slugs.map(slug => `/guides/${slug}`).sort());
  const cssLinks = [...html.matchAll(/<link\b[^>]*href="([^"]+\.css)"[^>]*>/gu)].map(match => match[1]);
  const css = (await Promise.all(cssLinks.map(async url => {
    const response = await environment.ASSETS.fetch(new Request(new URL(url, origin)));
    assert.equal(response.status, 200); return response.text();
  }))).join('\n');
  for (const selector of ['.catalog-directory-row', '.catalog-study-steps', '.catalog-guide-grid']) assert.ok(css.includes(selector));
  const index = await read('/guides'); assert.equal(index.status, 200);
  const indexHtml = await index.text();
  const sitemap = await (await read('/sitemap.xml')).text();
  for (const slug of slugs) {
    assert.ok(html.includes(`/guides/${slug}`) && indexHtml.includes(`/guides/${slug}`) && sitemap.includes(`/guides/${slug}`));
    const response = await read(`/guides/${slug}`); assert.equal(response.status, 200, slug);
    const guide = await response.text();
    const pageTitle = guide.match(/<title>([^<]+)<\/title>/u)?.[1];
    const heading = guide.match(/<h1\b[^>]*>([^<]+)<\/h1>/u)?.[1];
    assert.ok(heading, `${slug}: page heading`);
    assert.equal(pageTitle, `${heading} | 모두의 문제집`, `${slug}: title matches h1`);
    assert.ok(guide.includes(`rel="canonical" href="${origin}/guides/${slug}"`), slug);
    for (const section of ['과목별 학습 초점', '권장 학습 순서', '이해할 것.', '연습할 것.']) assert.ok(guide.includes(section), `${slug}: ${section}`);
    const main = guide.match(/<main\b[\s\S]*?<\/main>/u)?.[0];
    assert.ok(main, slug);
    assert.doesNotMatch(main, /undefined|Internal Server Error/u, slug);
  }
  assert.equal((await read('/guides/not-a-course')).status, 404);
});

test('expanded admin content and quality routes remain private', async () => {
  for (const domain of ['sql', 'da', 'bae', 'ipe', 'ise', 'sw']) {
    for (const section of ['questions', 'theories']) {
      const response = await read(`/admin/${section}?domain=${domain}`);
      assert.ok([302,303,307,308].includes(response.status));
    }
  }
  for (const resource of ['questions', 'theories', 'quality']) {
    const response = await read(`/api/admin?resource=${resource}&contentDomain=ipe`);
    assert.ok([401,403].includes(response.status), `${resource}: ${response.status}`);
    assert.doesNotMatch(await response.text(), /correctAnswers|scoringCriteria|coverage/u);
  }
});


test('released security written paths are public while practical exercises remain closed', async () => {
  for (const route of ['/learn/information-security', '/learn/information-security/ise-written/home']) {
    const response = await read(route);
    assert.equal(response.status, 200, route);
    const html = await response.text();
    assert.match(html, /정보보안기사/);
    assert.match(html, route === "/learn/information-security"
      ? /name="robots" content="noindex, follow"/
      : /name="robots" content="index, follow"/);
    assert.ok(html.includes(`rel="canonical" href="${origin}${route}"`));
  }
  assert.equal((await read('/learn/information-security/ise-written/practice')).status, 307);
  assert.equal((await read('/api/study?scope=overview&exam=ISEW')).status, 200);
  const practical = await read('/learn/information-security/ise-practical/home');
  assert.equal(practical.status, 200);
  const html = await practical.text();
  assert.match(html, /준비 중/);
  assert.match(html, /name="robots" content="noindex, follow"/);
  assert.doesNotMatch(html, /모의고사 시작|답안 제출|Internal Server Error/);
  assert.equal((await read('/learn/information-security/ise-practical/practice')).status, 404);
  assert.equal((await read('/api/study?scope=overview&exam=ISEP')).status, 400);
});
