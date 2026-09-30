import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { buildStudyPracticeQuery } from "../apps/backend/src/modules/study/study-practice-query.mjs";

function fixture() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE questions (
      id INTEGER PRIMARY KEY,
      category TEXT NOT NULL,
      topic TEXT NOT NULL DEFAULT 'topic',
      display_order INTEGER NOT NULL,
      exam_scope TEXT NOT NULL,
      difficulty TEXT NOT NULL DEFAULT '중',
      difficulty_rationale TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'single',
      prompt TEXT NOT NULL DEFAULT 'prompt',
      choices TEXT NOT NULL DEFAULT '["a","b"]',
      tags TEXT NOT NULL DEFAULT '[]',
      theory_id INTEGER,
      practice_scope TEXT NOT NULL DEFAULT 'general',
      variant_group_id TEXT,
      bookmarked INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE user_bookmarks (
      user_key TEXT NOT NULL,
      question_id INTEGER NOT NULL,
      PRIMARY KEY (user_key, question_id)
    );
    CREATE INDEX questions_active_display_idx
      ON questions(active, display_order, id);
    CREATE INDEX questions_active_practice_scope_exam_category_kind_idx
      ON questions(active, practice_scope, exam_scope, category, kind);
  `);
  const insert = database.prepare(`
    INSERT INTO questions (
      id, category, display_order, exam_scope, difficulty, kind,
      practice_scope, variant_group_id, active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const rows = [
    [101, "target", 100, "SQLP", "중", "single", "general", "variant-a", 1],
    [102, "target", 100, "SQLP", "중", "single", "general", "variant-a", 1],
    [110, "target", 150, "SQLP", "중", "single", "general", "variant-b", 1],
    [120, "target", 199, "SQLP", "중", "single", "general", null, 1],
    [722, "target", 175, "SQLP", "중", "single", "general", null, 1],
    [130, "target", 160, "SQLP", "중", "single", "theory-only", null, 1],
    [140, "target", 170, "SQLP", "중", "descriptive", "general", null, 1],
    [150, "target", 180, "SQLP", "중", "single", "general", null, 0],
    [160, "target", 190, "OTHER", "중", "single", "general", null, 1],
    [999, "irrelevant", 1_000, "OTHER", "중", "single", "general", null, 1],
  ];
  for (const row of rows) insert.run(...row);
  database.prepare(
    "INSERT INTO user_bookmarks (user_key, question_id) VALUES (?, ?)",
  ).run("learner", 120);
  database.prepare(
    "INSERT INTO user_bookmarks (user_key, question_id) VALUES (?, ?)",
  ).run("learner", 160);
  return database;
}

function queryInput(overrides = {}) {
  return {
    selectedExam: "SQLP",
    eligibility: {
      sql: "q.exam_scope IN (?, ?) AND q.kind IN ('single', 'multiple')",
      values: ["SQLP", "both"],
    },
    // Kept during the red test so the previous builder reaches its old selection logic.
    acceptedScopes: ["SQLP", "both"],
    descriptiveSubjects: [],
    category: "target",
    difficulty: "중",
    kind: "objective",
    theoryId: Number.NaN,
    excludedIds: [],
    excludedVariantGroupIds: [],
    limit: 1,
    ...overrides,
  };
}

function select(database, input) {
  const query = buildStudyPracticeQuery(input);
  return database.prepare(query.sql).all(...query.values);
}

test("practice rotation enumerates the actual eligible groups independent of global display gaps", () => {
  const database = fixture();
  try {
    const firstIds = [0, 1, 2, 3].map((selectionOffset) => (
      select(database, queryInput({ selectionOffset }))[0]?.id
    ));
    assert.deepEqual(firstIds, [101, 110, 120, 722]);
  } finally {
    database.close();
  }
});

test("variant groups are one selection unit and unequal group sizes do not add weight", () => {
  const database = fixture();
  try {
    const firstCycle = [0, 1, 2, 3].map((selectionOffset) => (
      select(database, queryInput({ selectionOffset }))[0]
    ));
    assert.deepEqual(
      firstCycle.map((row) => row.variantGroupId ?? `question:${row.id}`),
      ["variant-a", "variant-b", "question:120", "question:722"],
    );
    assert.equal(select(database, queryInput({ selectionOffset: 0 }))[0]?.id, 101);
    assert.equal(select(database, queryInput({ selectionOffset: 4 }))[0]?.id, 102);
  } finally {
    database.close();
  }
});

test("fallback exclusions can suppress an already selected variant group", () => {
  const database = fixture();
  try {
    const rows = select(database, queryInput({
      excludedIds: [101],
      excludedVariantGroupIds: ["variant-a"],
      limit: 12,
      selectionOffset: 0,
    }));
    assert.equal(rows.some((row) => row.id === 101 || row.id === 102), false);
    assert.deepEqual(new Set(rows.map((row) => row.id)), new Set([110, 120, 722]));
  } finally {
    database.close();
  }
});

test("bookmark and eligibility filters hold for zero, one, and under-limit pools", () => {
  const database = fixture();
  try {
    const bookmarked = select(database, queryInput({
      bookmarkUserKey: "learner",
      limit: 12,
      selectionOffset: 0,
    }));
    assert.deepEqual(bookmarked.map((row) => row.id), [120]);

    assert.deepEqual(select(database, queryInput({ category: "missing", limit: 12 })), []);
    const underLimit = select(database, queryInput({
      category: "target",
      excludedVariantGroupIds: ["variant-a", "variant-b"],
      excludedIds: [722],
      limit: 12,
      selectionOffset: 0,
    }));
    // The one-query fallback keeps the unseen eligible item first, then fills
    // the under-limit page with a recent item as the old second read did.
    assert.deepEqual(underLimit.map((row) => row.id), [120, 722]);
  } finally {
    database.close();
  }
});
