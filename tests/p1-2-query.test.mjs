import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { buildStudyPracticeQuery } from '../apps/backend/src/modules/study/study-practice-query.mjs';

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE questions (
    id INTEGER PRIMARY KEY, category TEXT, topic TEXT, display_order INTEGER,
    exam_scope TEXT, difficulty TEXT, difficulty_rationale TEXT, kind TEXT,
    prompt TEXT, choices TEXT, tags TEXT, theory_id INTEGER, practice_scope TEXT,
    variant_group_id TEXT, bookmarked INTEGER, active INTEGER, created_at TEXT, updated_at TEXT
  );`);
  const insert = db.prepare(`INSERT INTO questions VALUES (?, 'C', 'T', ?, 'SQLP', '중', '', 'single',
    'prompt', '["A","B"]', '[]', NULL, 'general', ?, 0, 1, '', '')`);
  insert.run(1, 1, 'variant-a');
  insert.run(2, 2, 'variant-a');
  insert.run(3, 3, null);
  insert.run(4, 4, null);
  return db;
}
function select(db, excludedIds, limit, selectionOffset) {
  const query = buildStudyPracticeQuery({
    eligibility: { sql: 'q.exam_scope = ?', values: ['SQLP'] },
    excludedIds, excludedVariantGroupIds: [], limit, selectionOffset,
  });
  return db.prepare(query.sql).all(...query.values).map(row => row.id);
}

test('one SQL statement prioritizes unseen groups, then fills from recent IDs', () => {
  const db = fixture();
  try {
    const selected = select(db, [1,2,4], 3);
    assert.equal(selected[0], 3);
    assert.ok(selected.includes(4));
    assert.equal(selected.filter(id => id === 1 || id === 2).length, 1);
    assert.equal(new Set(selected).size, 3);
  } finally { db.close(); }
});

test('variant member selection prefers unseen member and stays deterministic', () => {
  const db = fixture();
  try {
    const first = select(db, [1], 3, 0);
    assert.ok(first.includes(2));
    assert.ok(!first.includes(1));
    assert.deepEqual(select(db, [1], 3, 0), first);
  } finally { db.close(); }
});
