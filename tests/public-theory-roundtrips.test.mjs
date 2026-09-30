import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { readPublicTheoryPage, readPublicTheorySitemapEntries } from "../apps/backend/src/modules/study/public-theory.service.ts";
import { withD1Metrics } from "../apps/backend/src/common/observability/d1-metrics.ts";
import { readPublicContentCache } from "../apps/backend/src/common/content/public-content-cache.ts";
import { learningPath, LEARNING_CATALOG } from "../packages/shared/src/study/learning-catalog.ts";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";
import { sqliteD1 } from "./helpers/sqlite-d1.mjs";

test("public theory detail uses one D1 batch on cold, warm, and revision change", async () => {
  const database = openCanonicalTestDatabase(process.cwd());
  const binding = sqliteD1(database);
  globalThis.__BAEUMZIP_ENV__ = { DB: binding };
  try {
    const courseId = database.prepare("SELECT id FROM theories WHERE active = 1 AND exam_scope IN ('SQLD', 'both') ORDER BY id LIMIT 1").get().id;
    const field = LEARNING_CATALOG.find((candidate) => candidate.subjectGroups?.length);
    assert.ok(field);
    const subject = field.subjectGroups[0].subjects[0].id;
    const swId = database.prepare("SELECT id FROM sw_theories WHERE active = 1 AND subject_id = ? ORDER BY id LIMIT 1").get(subject).id;
    const paths = [
      learningPath({ examType: "SQLD", page: "theory", id: courseId }),
      learningPath({ fieldId: field.id, page: "field", section: "theories", theoryId: swId }),
    ];
    const previous = new Map();
    for (const path of paths) {
      const coldBefore = binding.roundTrips;
      const first = await readPublicTheoryPage(path);
      assert.equal(binding.roundTrips - coldBefore, 1, `${path}: cold read`);
      assert.ok(first?.selected?.content, path);
      previous.set(path, first);
      const warmBefore = binding.roundTrips;
      const second = await readPublicTheoryPage(path);
      assert.equal(binding.roundTrips - warmBefore, 1, `${path}: warm read`);
      assert.deepEqual(second, first);
    }
    database.prepare("UPDATE theories SET title=?, content=?, updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .run("SQLD revised title", "SQLD revised body", courseId);
    database.prepare("UPDATE sw_theories SET title=?, content=?, updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .run("SW revised title", "SW revised body", swId);
    database.prepare(`INSERT INTO site_settings (key, value, value_type, updated_by_hash, updated_at)
      VALUES ('content_cache_revision', ?, 'string', 'local-test', CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(`p1-4-${Date.now()}`);
    for (const [index, path] of paths.entries()) {
      const before = binding.roundTrips;
      const refreshed = await readPublicTheoryPage(path);
      assert.equal(binding.roundTrips - before, 1, `${path}: revision-invalidated read`);
      assert.equal(refreshed?.selected?.title, index === 0 ? "SQLD revised title" : "SW revised title");
      assert.equal(refreshed?.selected?.content, index === 0 ? "SQLD revised body" : "SW revised body");
      assert.notDeepEqual(refreshed, previous.get(path));
    }
  } finally {
    globalThis.__BAEUMZIP_ENV__ = undefined;
    database.close();
  }
});

test("invalid theory paths and malformed cache revisions fail closed", async () => {
  const database = openCanonicalTestDatabase(process.cwd());
  const binding = sqliteD1(database);
  const previousEnv = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: binding };
  try {
    assert.equal(await readPublicTheoryPage("/learn/sql/sqld/theories/bad-id"), null);
    assert.equal(binding.roundTrips, 0);
    const id = database.prepare("SELECT id FROM theories WHERE active=1 AND exam_scope IN ('SQLD','both') LIMIT 1").get().id;
    const path = learningPath({ examType: "SQLD", page: "theory", id });
    await readPublicContentCache({ namespace: "public-theory-page", key: path, revision: "malformed-revision",
      loader: async () => ({ selected: { title: "wrong cache" } }) });
    const before = binding.roundTrips;
    const page = await readPublicTheoryPage(path);
    assert.equal(binding.roundTrips - before, 1);
    assert.notEqual(page?.selected?.title, "wrong cache");
    assert.ok(page?.selected?.content);
  } finally {
    globalThis.__BAEUMZIP_ENV__ = previousEnv;
    database.close();
  }
});

test("wrong-scope and inactive theory nulls stay null until a new revision activates them", async () => {
  const database = openCanonicalTestDatabase(process.cwd());
  const binding = sqliteD1(database);
  const previousEnv = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: binding };
  try {
    const revision = `p1-4-null-${crypto.randomUUID()}`;
    database.prepare(`INSERT INTO site_settings (key, value, value_type, updated_by_hash, updated_at)
      VALUES ('content_cache_revision', ?, 'string', 'local-test', CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(revision);
    const courseId = database.prepare("SELECT id FROM theories WHERE active=1 AND exam_scope='IPEP' ORDER BY id LIMIT 1").get().id;
    const coursePath = learningPath({ examType: "SQLD", page: "theory", id: courseId });
    const field = LEARNING_CATALOG.find((candidate) => candidate.subjectGroups?.length);
    assert.ok(field);
    const subject = field.subjectGroups[0].subjects[0].id;
    const swId = database.prepare("SELECT id FROM sw_theories WHERE active=1 AND subject_id=? ORDER BY id LIMIT 1").get(subject).id;
    const swPath = learningPath({ fieldId: field.id, page: "field", section: "theories", theoryId: swId });
    const missingCoursePath = learningPath({ examType: "SQLD", page: "theory", id: 99999999 });
    const missingSwPath = learningPath({ fieldId: field.id, page: "field", section: "theories", theoryId: 99999999 });
    database.prepare("UPDATE sw_questions SET active=0 WHERE theory_id=?").run(swId);
    database.prepare("UPDATE sw_theories SET active=0 WHERE id=?").run(swId);
    for (const path of [coursePath, swPath, missingCoursePath, missingSwPath]) {
      for (const phase of ["cold", "warm"]) {
        const before = binding.roundTrips;
        assert.equal(await readPublicTheoryPage(path), null, `${path}: ${phase}`);
        assert.equal(binding.roundTrips - before, 1, `${path}: ${phase} D1 batch`);
      }
    }
    database.prepare("UPDATE sw_theories SET active=1, title='SW newly active' WHERE id=?").run(swId);
    database.prepare("UPDATE site_settings SET value=? WHERE key='content_cache_revision'").run(`${revision}-next`);
    const before = binding.roundTrips;
    assert.equal(await readPublicTheoryPage(coursePath), null);
    assert.equal((await readPublicTheoryPage(swPath))?.selected?.title, "SW newly active");
    assert.equal(binding.roundTrips - before, 2);
  } finally {
    globalThis.__BAEUMZIP_ENV__ = previousEnv;
    database.close();
  }
});


test("one SSR request shares theory metadata and body reads, while the next request checks revision", async () => {
  const database = openCanonicalTestDatabase(process.cwd());
  const binding = sqliteD1(database);
  globalThis.__BAEUMZIP_ENV__ = { DB: binding };
  try {
    const id = database.prepare("SELECT id FROM theories WHERE active = 1 AND exam_scope IN ('SQLD', 'both') ORDER BY id LIMIT 1").get().id;
    const path = learningPath({ examType: "SQLD", page: "theory", id });
    const revision = `request-memo-${Date.now()}`;
    database.prepare(`INSERT INTO site_settings (key, value, value_type, updated_by_hash, updated_at)
      VALUES ('content_cache_revision', ?, 'string', 'local-test', CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(revision);
    const first = await withD1Metrics(async () => {
      const metadata = await readPublicTheoryPage(path);
      const page = await readPublicTheoryPage(path);
      assert.strictEqual(metadata, page);
      return new Response(null);
    });
    assert.equal(first.headers.get("X-DB-Ops"), "1");
    const warm = await withD1Metrics(async () => {
      await readPublicTheoryPage(path);
      return new Response(null);
    });
    assert.equal(warm.headers.get("X-DB-Ops"), "1");
    database.prepare("UPDATE theories SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run("Revision refresh test", id);
    database.prepare("UPDATE site_settings SET value = ? WHERE key = 'content_cache_revision'").run(`${revision}-next`);
    const refreshed = await withD1Metrics(async () => {
      const page = await readPublicTheoryPage(path);
      assert.equal(page.selected.title, "Revision refresh test");
      return new Response(null);
    });
    assert.equal(refreshed.headers.get("X-DB-Ops"), "1");
  } finally {
    globalThis.__BAEUMZIP_ENV__ = undefined;
    database.close();
  }
});

test("theory sitemap batch matches the existing canonical links and dates in one D1 round", async () => {
  const database = openCanonicalTestDatabase(process.cwd());
  const binding = sqliteD1(database);
  globalThis.__BAEUMZIP_ENV__ = { DB: binding };
  try {
    const paths = LEARNING_CATALOG.flatMap((field) => field.courses.length
      ? field.courses.map((course) => learningPath({ examType: course.examType, page: "theories" }))
      : [learningPath({ fieldId: field.id, page: "field", section: "theories" })]);
    const documents = await Promise.all(paths.map(readPublicTheoryPage));
    const expected = new Map();
    for (const document of documents) for (const article of document?.articles ?? []) {
      expected.set(article.canonical, { path: article.canonical, updatedAt: article.updatedAt });
    }
    const response = await withD1Metrics(async () => {
      const actual = await readPublicTheorySitemapEntries();
      assert.deepEqual(actual.sort((a, b) => a.path.localeCompare(b.path)),
        [...expected.values()].sort((a, b) => a.path.localeCompare(b.path)));
      return new Response(null);
    });
    assert.equal(response.headers.get("X-DB-Ops"), "1");
  } finally {
    globalThis.__BAEUMZIP_ENV__ = undefined;
    database.close();
  }
});

test('overlapping SSR requests keep an old memo local while the new revision loads independently', async () => {
  const database = openCanonicalTestDatabase(process.cwd());
  const previousEnv = globalThis.__BAEUMZIP_ENV__;
  const binding = sqliteD1(database);
  globalThis.__BAEUMZIP_ENV__ = { DB: binding };
  let resumeFirst;
  let olderRequest;
  try {
    const id = database.prepare("SELECT id FROM theories WHERE active=1 AND exam_scope IN ('SQLD','both') ORDER BY id LIMIT 1").get().id;
    const path = learningPath({ examType: 'SQLD', page: 'theory', id });
    const revision = `p1-4-overlap-${crypto.randomUUID()}`;
    database.prepare("INSERT INTO site_settings (key,value,value_type,updated_by_hash,updated_at) VALUES ('content_cache_revision',?,'string','local-test',CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(revision);
    let firstReady;
    let firstFailed;
    const ready = new Promise((resolve, reject) => { firstReady = resolve; firstFailed = reject; });
    const hold = new Promise(resolve => { resumeFirst = resolve; });
    olderRequest = withD1Metrics(async () => {
      try {
        const metadata = await readPublicTheoryPage(path);
        firstReady(metadata);
        await hold;
        const page = await readPublicTheoryPage(path);
        assert.strictEqual(page, metadata);
        return new Response(null);
      } catch (error) {
        firstFailed(error);
        throw error;
      }
    });
    void olderRequest.catch(() => {});
    const oldPage = await ready;
    assert.ok(oldPage?.selected?.content);
    const newTitle = 'Concurrent revision isolation probe';
    database.prepare('UPDATE theories SET title=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(newTitle, id);
    database.prepare("UPDATE site_settings SET value=? WHERE key='content_cache_revision'").run(`${revision}-next`);
    const newerRequest = await withD1Metrics(async () => {
      const page = await readPublicTheoryPage(path);
      assert.equal(page.selected.title, newTitle);
      assert.notStrictEqual(page, oldPage);
      return new Response(null);
    });
    resumeFirst();
    const olderResponse = await olderRequest;
    assert.equal(olderResponse.headers.get('X-DB-Ops'), '1');
    assert.equal(newerRequest.headers.get('X-DB-Ops'), '1');
    const warm = await withD1Metrics(async () => {
      const page = await readPublicTheoryPage(path);
      assert.equal(page.selected.title, newTitle);
      return new Response(null);
    });
    assert.equal(warm.headers.get('X-DB-Ops'), '1');
  } finally {
    resumeFirst?.();
    if (olderRequest) await Promise.allSettled([olderRequest]);
    globalThis.__BAEUMZIP_ENV__ = previousEnv;
    database.close();
  }
});
