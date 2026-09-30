import assert from "node:assert/strict";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import test from "node:test";
import {
  encodeD1IntegerList,
  encodeD1TextList,
} from "../apps/backend/src/common/database/d1-query-bindings.mjs";
import {
  readPracticeBatch,
  readPracticeMeta,
  readQuestionSelection,
} from "../apps/backend/src/modules/study/study-question-delivery";
import { StudyRepository } from "../apps/backend/src/modules/study/study.repository";
import { SwStudyRepository } from "../apps/backend/src/modules/sw-study/sw-study.repository";

const D1_MAX_BOUND_PARAMETERS = 100;

type BoundQuery = {
  sql: string;
  values: SQLInputValue[];
};

class SqliteD1Statement {
  private values: SQLInputValue[] = [];

  constructor(
    private readonly database: DatabaseSync,
    private readonly sql: string,
    private readonly boundQueries: BoundQuery[],
  ) {}

  bind(...values: SQLInputValue[]) {
    assert.ok(
      values.length <= D1_MAX_BOUND_PARAMETERS,
      `D1 binding limit exceeded: ${values.length}\n${this.sql}`,
    );
    this.values = values;
    this.boundQueries.push({ sql: this.sql, values: [...values] });
    return this;
  }

  private execute() {
    const statement = this.database.prepare(this.sql);
    const results = statement.all(...this.values);
    const changes = this.database.prepare("SELECT changes() AS value").get()?.value ?? 0;
    return { success: true, results, meta: { changes: Number(changes) } };
  }

  async all() {
    return this.execute();
  }

  async first(column?: string) {
    const row = this.database.prepare(this.sql).get(...this.values) as Record<string, unknown> | undefined;
    return column && row ? row[column] : row ?? null;
  }

  async raw() {
    return this.database.prepare(this.sql).all(...this.values)
      .map((row) => Object.values(row));
  }

  async run() {
    return this.execute();
  }
}

function sqliteD1(database: DatabaseSync, boundQueries: BoundQuery[]) {
  return {
    prepare(sql: string) {
      return new SqliteD1Statement(database, sql, boundQueries);
    },
    async batch(statements: SqliteD1Statement[]) {
      database.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.all());
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function createFixture() {
  const database = new DatabaseSync(":memory:");
  const boundQueries: BoundQuery[] = [];
  database.exec(`
    CREATE TABLE questions (
      id INTEGER PRIMARY KEY,
      category TEXT NOT NULL,
      topic TEXT NOT NULL,
      display_order INTEGER NOT NULL,
      exam_scope TEXT NOT NULL,
      difficulty TEXT NOT NULL,
      difficulty_rationale TEXT NOT NULL,
      kind TEXT NOT NULL,
      prompt TEXT NOT NULL,
      choices TEXT NOT NULL,
      correct_answers TEXT NOT NULL,
      explanation TEXT NOT NULL,
      tags TEXT NOT NULL,
      scoring_criteria TEXT NOT NULL,
      required_concepts TEXT NOT NULL,
      acceptable_alternatives TEXT NOT NULL,
      deduction_conditions TEXT NOT NULL,
      error_conditions TEXT NOT NULL,
      theory_id INTEGER,
      practice_scope TEXT NOT NULL,
      variant_group_id TEXT,
      bookmarked INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX questions_active_display_idx ON questions(active, display_order, id);
    CREATE TABLE theories (id INTEGER PRIMARY KEY, active INTEGER NOT NULL);
    CREATE TABLE user_bookmarks (
      user_key TEXT NOT NULL,
      question_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_key, question_id)
    );
    CREATE TABLE user_settings (
      user_key TEXT PRIMARY KEY,
      selected_exam TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE exam_sessions (
      id TEXT PRIMARY KEY,
      user_key TEXT NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE exam_session_items (
      session_id TEXT NOT NULL,
      question_id INTEGER NOT NULL
    );
    CREATE TABLE sw_questions (
      id TEXT PRIMARY KEY,
      theory_id INTEGER NOT NULL,
      subject_group_id TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      category TEXT NOT NULL,
      topic TEXT NOT NULL,
      display_order INTEGER NOT NULL,
      difficulty TEXT NOT NULL,
      difficulty_rationale TEXT NOT NULL,
      kind TEXT NOT NULL,
      prompt TEXT NOT NULL,
      choices TEXT NOT NULL,
      correct_answers TEXT NOT NULL,
      explanation TEXT NOT NULL,
      tags TEXT NOT NULL,
      active INTEGER NOT NULL
    );
    CREATE INDEX sw_questions_active_display_order_idx
      ON sw_questions(active, display_order, id);
    CREATE INDEX sw_questions_active_subject_order_v2_idx
      ON sw_questions(active, subject_id, display_order, id);
    CREATE TABLE sw_question_tags (
      question_id TEXT NOT NULL,
      tag TEXT NOT NULL,
      PRIMARY KEY (question_id, tag)
    );
    CREATE TABLE sw_learning_sessions (
      id TEXT PRIMARY KEY,
      user_key TEXT NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      question_ids TEXT NOT NULL
    );
  `);

  const insertQuestion = database.prepare(`
    INSERT INTO questions (
      id, category, topic, display_order, exam_scope, difficulty,
      difficulty_rationale, kind, prompt, choices, correct_answers,
      explanation, tags, scoring_criteria, required_concepts,
      acceptable_alternatives, deduction_conditions, error_conditions,
      theory_id, practice_scope, variant_group_id, bookmarked, active,
      created_at, updated_at
    ) VALUES (?, ?, 'topic', ?, ?, '중', 'fixture', 'single', ?,
      '["A","B"]', '[0]', 'feedback', '[]', '[]', '[]', '[]', '[]', '[]',
      ?, 'general', NULL, 0, ?, '2026-09-06T00:00:00.000Z',
      '2026-09-06T00:00:00.000Z')
  `);
  const insertTheory = database.prepare("INSERT INTO theories (id, active) VALUES (?, ?)");
  const insertBookmark = database.prepare(`
    INSERT INTO user_bookmarks (user_key, question_id) VALUES ('stage1-user', ?)
  `);
  const insertSwQuestion = database.prepare(`
    INSERT INTO sw_questions (
      id, theory_id, subject_group_id, subject_id, category, topic,
      display_order, difficulty, difficulty_rationale, kind, prompt, choices,
      correct_answers, explanation, tags, active
    ) VALUES (?, 1, 'software', 'algorithms', '알고리즘', '정렬', ?, '중',
      'fixture', 'single', ?, '["A","B"]', '[0]', 'feedback', '[]', 1)
  `);
  const insertSwTag = database.prepare(`
    INSERT INTO sw_question_tags (question_id, tag) VALUES (?, ?)
  `);

  database.exec("BEGIN");
  try {
    for (let id = 1; id <= 453; id += 1) {
      const category = id > 450 ? "부족 과목" : "기본 과목";
      insertQuestion.run(id, category, id, "SQLP", `question-${id}`, id, 1);
      insertTheory.run(id, 1);
      insertBookmark.run(id);
    }
    database.exec(`
      UPDATE questions
      SET variant_group_id = 'cross-difficulty-variant', difficulty = '하'
      WHERE id = 1;
      UPDATE questions
      SET variant_group_id = 'cross-difficulty-variant', difficulty = '상'
      WHERE id = 2;
    `);
    insertQuestion.run(700, "기본 과목", 700, "SQLP", "inactive", 700, 0);
    insertQuestion.run(701, "기본 과목", 701, "DASP", "other-course", 701, 1);
    database.prepare(`
      INSERT INTO user_settings (user_key, selected_exam, created_at, updated_at)
      VALUES ('stage1-user', 'SQLP', '2026-09-06T00:00:00.000Z',
        '2026-09-06T00:00:00.000Z')
    `).run();
    database.prepare(`
      INSERT INTO exam_sessions (id, user_key, status)
      VALUES ('stage1-active-exam', 'stage1-user', 'active')
    `).run();
    database.prepare(`
      INSERT INTO exam_session_items (session_id, question_id)
      VALUES ('stage1-active-exam', 1), ('stage1-active-exam', 400)
    `).run();

    for (let index = 1; index <= 401; index += 1) {
      const id = `SW-${String(index).padStart(4, "0")}`;
      insertSwQuestion.run(id, index, `sw-question-${index}`);
      insertSwTag.run(id, "profile-required");
      insertSwTag.run(id, index % 2 === 0 ? "phase-even" : "phase-odd");
    }
    database.prepare(`
      INSERT INTO sw_learning_sessions (id, user_key, mode, status, question_ids)
      VALUES ('stage1-sw-active', 'stage1-user', 'mock', 'active', ?)
    `).run(JSON.stringify(["SW-0001", "SW-0400"]));
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    database.close();
    throw error;
  }

  globalThis.__BAEUMZIP_ENV__ = {
    DB: sqliteD1(database, boundQueries) as never,
    GOOGLE_AUTH_SESSION_SECRET: "stage1-test-secret-with-at-least-32-characters",
  };
  return { database, boundQueries };
}

function numericIds(count: number) {
  return Array.from({ length: count }, (_, index) => index + 1);
}

function swIds(count: number) {
  return Array.from({ length: count }, (_, index) => `SW-${String(index + 1).padStart(4, "0")}`);
}

test("D1 list encoders reject malformed bound values", () => {
  assert.equal(encodeD1IntegerList([]), "[]");
  assert.equal(encodeD1TextList([]), "[]");
  assert.throws(() => encodeD1IntegerList([1, Number.NaN]), /positive safe integers/);
  assert.throws(() => encodeD1IntegerList([0]), /positive safe integers/);
  assert.throws(() => encodeD1TextList(["SW-0001", ""]), /non-empty strings/);
});

test("SQL Repository reads stay within D1's 100-binding limit", async () => {
  const { database, boundQueries } = createFixture();
  const repository = new StudyRepository();
  try {
    for (const count of [0, 1, 98, 99, 100]) {
      const ids = numericIds(count);
      const anonymous = await repository.findActiveQuestionsByIds(ids);
      assert.equal(anonymous.rows.length, count);
      assert.deepEqual(anonymous.bookmarkedIds, []);

      const authenticated = await repository.findActiveQuestionsByIds(
        ids,
        "stage1-user",
        { includeSetting: true },
      );
      assert.equal(authenticated.rows.length, count);
      assert.equal(authenticated.bookmarkedIds.length, count);
      assert.equal(authenticated.setting?.selectedExam, "SQLP");
    }

    for (const count of [101, 400, 401]) {
      const ids = numericIds(count);
      assert.equal((await repository.findValidationQuestions(ids)).length, count);
      assert.equal(new Set(await repository.findActiveTheoryIds(ids)).size, count);
      assert.equal((await repository.findFeedbackQuestionsByIds(ids)).length, count);
    }

    const blocked = await repository.findPracticeBlockedQuestionIds("stage1-user", numericIds(401));
    assert.deepEqual(new Set(blocked), new Set([1, 400]));
    assert.ok(boundQueries.every((query) => query.values.length <= D1_MAX_BOUND_PARAMETERS));
  } finally {
    database.close();
  }
});

test("SQL public selection and exclusion preserve normalization, order, fallback, and answer secrecy", async () => {
  const { database, boundQueries } = createFixture();
  const repository = new StudyRepository();
  try {
    const meta = await repository.findPracticeMeta("SQLP");
    assert.equal(meta.summary.item_count, 453);
    assert.equal(meta.summary.eligible_group_count, 452);
    assert.equal(meta.rows.reduce((sum, row) => sum + Number(row.item_count), 0), 453);
    assert.equal(
      meta.rows.reduce((sum, row) => sum + Number(row.eligible_group_count), 0),
      453,
      "bucket group counts overlap when one variant group spans difficulty buckets",
    );
    const metaPayload = await readPracticeMeta(repository, undefined, "SQLP");
    assert.deepEqual(metaPayload.practiceMeta.summary, {
      questionCount: 453,
      eligibleGroupCount: 452,
    });
    assert.equal(
      metaPayload.practiceMeta.counts.reduce((sum, row) => sum + row.count, 0),
      453,
    );

    const selection = await readQuestionSelection(
      repository,
      "stage1-user",
      "SQLP",
      new URLSearchParams({ ids: "5,3,5,99999,invalid,700,701,2" }),
    );
    assert.deepEqual(selection.questions.map((question) => question.id), [5, 3, 2]);
    assert.ok(selection.questions.every((question) => question.bookmarked));
    assert.ok(selection.questions.every((question) => !("correctAnswers" in question)));
    assert.ok(selection.questions.every((question) => !("explanation" in question)));

    const capped = await readQuestionSelection(
      repository,
      undefined,
      "SQLP",
      new URLSearchParams({ ids: numericIds(101).join(",") }),
    );
    assert.equal(capped.questions.length, 100);

    const practice = await readPracticeBatch(
      repository,
      "stage1-user",
      "SQLP",
      new URLSearchParams({
        category: "기본 과목",
        difficulty: "중",
        kind: "objective",
        bookmarks: "1",
        exclude: numericIds(100).join(","),
        limit: "5",
      }),
    );
    assert.equal(practice.questions.length, 5);
    assert.ok(practice.questions.every((question) => question.id > 100));
    assert.ok(practice.questions.every((question) => !("correctAnswers" in question)));
    assert.ok(practice.questions.every((question) => !("explanation" in question)));

    const fallback = await readPracticeBatch(
      repository,
      "stage1-user",
      "SQLP",
      new URLSearchParams({
        category: "부족 과목",
        difficulty: "중",
        kind: "objective",
        exclude: "451,452,453",
        limit: "3",
      }),
    );
    assert.deepEqual(
      new Set(fallback.questions.map((question) => question.id)),
      new Set([451, 452, 453]),
    );
    assert.ok(boundQueries.every((query) => query.values.length <= D1_MAX_BOUND_PARAMETERS));
  } finally {
    database.close();
  }
});

test("SQL practice fills from recent IDs in one selection call", async () => {
  const calls: number[][] = [];
  const row = (id: number) => ({
    id, category: "기본 과목", topic: "topic", displayOrder: id,
    examScope: "SQLP", difficulty: "중", difficultyRationale: "fixture",
    kind: "single", prompt: `question-${id}`, choices: "[\"A\",\"B\"]",
    tags: "[]", theoryId: null, practiceScope: "general",
    variantGroupId: id === 10 ? "variant-a" : "variant-b",
    bookmarked: 0, selectedBookmarked: 0, active: 1,
    createdAt: "2026-09-07T00:00:00.000Z", updatedAt: "2026-09-07T00:00:00.000Z",
  });
  const repository = {
    async findPracticeQuestions(input: { excludedIds: number[] }) {
      calls.push([...input.excludedIds]);
      return [row(10), row(20)];
    },
  };
  const result = await readPracticeBatch(
    repository as never, undefined, "SQLP",
    new URLSearchParams({ exclude: "1,2", limit: "2" }),
  );
  assert.deepEqual(result.questions.map((question) => question.id), [10, 20]);
  assert.deepEqual(calls, [[1, 2]]);
});

test("SW Repository include and exclusion reads share the same D1 binding protection", async () => {
  const { database, boundQueries } = createFixture();
  const repository = new SwStudyRepository();
  try {
    const ids = swIds(100);
    const restored = await repository.findSessionQuestions({
      ids,
      subjects: ["algorithms"],
      theoryId: 1,
      requiredTag: "profile-required",
    });
    assert.equal(restored.length, 100);
    assert.equal(restored[0]?.id, "SW-0001");

    assert.equal((await repository.findFeedbackQuestions(swIds(401))).length, 401);
    const blocked = await repository.findPracticeBlockedQuestionIds("stage1-user", swIds(401));
    assert.deepEqual(new Set(blocked), new Set(["SW-0001", "SW-0400"]));

    const practice = await repository.findPracticeQuestions({
      subjects: ["algorithms"],
      theoryId: 1,
      excludedIds: ids,
      requiredTag: "profile-required",
      profileOrder: true,
      profilePhases: ["phase-even", "phase-odd"],
      limit: 20,
    });
    assert.equal(practice.length, 20);
    assert.ok(practice.every((question) => !ids.includes(question.id)));
    assert.ok(boundQueries.every((query) => query.values.length <= D1_MAX_BOUND_PARAMETERS));
  } finally {
    database.close();
  }
});
