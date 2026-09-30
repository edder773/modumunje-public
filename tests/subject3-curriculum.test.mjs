import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function materializeCurriculum() {
  return openCanonicalTestDatabase(projectRoot);
}

test("all subject 3 notes include a practical problem-solving framework", () => {
  const database = materializeCurriculum();
  const notes = database.prepare(`
    SELECT title, content, length(content) AS content_length
    FROM theories
    WHERE category = 'SQL 고급 활용 및 튜닝'
  `).all();

  assert.equal(notes.length, 122);
  assert.ok(notes.every((note) => note.content.includes("## 핵심 요약")));
  assert.ok(notes.every((note) => note.content.includes("## 복습 문제")));
  assert.ok(notes.every((note) => note.content_length >= 1700));
  assert.ok(notes.filter((note) => note.content.includes("```sql")).length >= 105);
});

test("attached tuning notes are consolidated into deep lessons without duplicate titles", () => {
  const database = materializeCurriculum();
  const duplicates = database.prepare(`
    SELECT title, COUNT(*) AS count
    FROM theories
    WHERE category = 'SQL 고급 활용 및 튜닝'
    GROUP BY title
    HAVING COUNT(*) > 1
  `).all();
  const representativeIds = [
    817, 715, 735, 751, 818, 909, 758, 759, 760, 778, 773, 768, 780,
  ];
  const added = database.prepare(`
    SELECT id, title, content
    FROM theories
    WHERE id IN (${representativeIds.map(() => "?").join(",")})
  `).all(...representativeIds);

  assert.deepEqual(duplicates, []);
  assert.equal(added.length, representativeIds.length);
  assert.ok(added.every((note) => note.content.includes("## 핵심 요약")));
  assert.ok(added.every((note) => note.content.includes("## 복습 문제")));
});

test("scan choice lesson explains SQL, plan operations, I/O and when each path wins", () => {
  const database = materializeCurriculum();
  const lesson = database.prepare(`
    SELECT content
    FROM theories
    WHERE id = 818
  `).get();

  assert.ok(lesson);
  assert.match(lesson.content, /INDEX RANGE SCAN/);
  assert.match(lesson.content, /TABLE ACCESS FULL/);
  assert.match(lesson.content, /Clustering Factor/);
  assert.match(lesson.content, /DBMS_XPLAN\.DISPLAY_CURSOR/);
});

test("integrated markdown keeps balanced code fences and clean section separators", () => {
  const database = materializeCurriculum();
  const notes = database.prepare(`
    SELECT title, content
    FROM theories
    WHERE category = 'SQL 고급 활용 및 튜닝'
  `).all();

  for (const note of notes) {
    const fences = note.content.match(/^```/gm) ?? [];
    assert.equal(fences.length % 2, 0, `${note.title}: unbalanced code fence`);
    assert.doesNotMatch(note.content, /\n---\s*\n\s*---\n/, `${note.title}: duplicate separator`);
  }
});

test("index scan lesson teaches full and fast full scans with SQL and plans", () => {
  const database = materializeCurriculum();
  const lesson = database.prepare(`
    SELECT content
    FROM theories
    WHERE id = 909
  `).get();

  assert.ok(lesson);
  assert.match(lesson.content, /index_ffs\(e emp_dept_empno_ix\)/i);
  assert.match(lesson.content, /INDEX FULL SCAN/);
  assert.match(lesson.content, /INDEX FAST FULL SCAN/);
  assert.match(lesson.content, /TABLE ACCESS FULL/);
  assert.match(lesson.content, /Single-Block/);
  assert.match(lesson.content, /Multiblock/);
  assert.match(lesson.content, /DBMS_XPLAN\.DISPLAY_CURSOR/);
  assert.match(lesson.content, /## 11\. 선택 예제/);
});
