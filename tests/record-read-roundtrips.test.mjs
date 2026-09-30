import assert from "node:assert/strict";
import test from "node:test";
import { createStudyReadUseCases } from "../apps/backend/src/modules/study/study-read-use-cases.ts";
import { StudyRepository } from "../apps/backend/src/modules/study/study.repository.ts";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";
import { sqliteD1 } from "./helpers/sqlite-d1.mjs";

test("record views keep pagination, bookmarks and active-exam feedback in one post-auth D1 batch", async () => {
  const database = openCanonicalTestDatabase(process.cwd());
  const binding = sqliteD1(database);
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: binding, GOOGLE_AUTH_SESSION_SECRET: "record-read-test-secret-with-sufficient-length" };
  try {
    const userKey = "p1-3-record-read-user";
    const questions = database.prepare(`
      SELECT id FROM questions WHERE active = 1 AND kind = 'single'
        AND exam_scope IN ('SQLP', 'both') ORDER BY id LIMIT 3
    `).all();
    assert.equal(questions.length, 3);
    for (const [index, question] of questions.entries()) {
      database.prepare(`INSERT INTO attempts
        (question_id, selected_answers, correct, mode, user_key, exam_type, result, score, created_at)
        VALUES (?, '[0]', 0, 'practice', ?, 'SQLP', 'incorrect', 0, ?)
      `).run(question.id, userKey, `2026-09-29T00:0${index}:00.000Z`);
    }
    for (const question of questions.slice(0, 2)) {
      database.prepare("INSERT INTO user_bookmarks (user_key, question_id) VALUES (?, ?)").run(userKey, question.id);
    }
    database.prepare(`INSERT INTO exam_sessions
      (id, user_key, exam_type, status, question_ids, started_at, ends_at)
      VALUES ('p1-3-active', ?, 'SQLP', 'active', ?, '2026-09-29T00:00:00Z', '2026-09-29T01:00:00Z')
    `).run(userKey, JSON.stringify([questions[0].id]));
    database.prepare("INSERT INTO exam_session_items (session_id, question_id, position) VALUES ('p1-3-active', ?, 0)").run(questions[0].id);
    const reads = createStudyReadUseCases(new StudyRepository());
    const read = async (view, extra = "") => {
      const before = binding.roundTrips;
      const result = await reads.readRecords(userKey, "SQLP", new URLSearchParams(`view=${view}&limit=1${extra}`));
      assert.equal(binding.roundTrips - before, 1, `${view}: post-auth D1 trips`);
      return result;
    };
    const stats = await read("stats");
    assert.equal(stats.recordStats.totalAttempts, 3);
    assert.equal(stats.attempts.length, 1);
    assert.equal(stats.questions.length, 1);
    assert.equal(stats.recordsPagination.attemptsNextCursor !== null, true);
    const older = await read("stats", `&attemptCursor=${stats.recordsPagination.attemptsNextCursor}`);
    assert.equal(older.attempts.length, 1);
    assert.notEqual(older.attempts[0].id, stats.attempts[0].id);
    const incorrect = await read("incorrect");
    assert.equal(incorrect.attempts.length, 1);
    assert.equal(incorrect.questions.length, 1);
    assert.equal(incorrect.recordsSummary.incorrectQuestionCount, 3);
    const bookmarks = await read("bookmarks");
    assert.equal(bookmarks.questions.length, 1);
    assert.equal(bookmarks.recordsSummary.bookmarkCount, 2);
    assert.ok(bookmarks.recordsPagination.bookmarksNextCursor);
    const bookmarkPage2 = await read("bookmarks", `&bookmarkCursor=${bookmarks.recordsPagination.bookmarksNextCursor}`);
    assert.equal(bookmarkPage2.questions.length, 1);
    const activeQuestion = [stats, older, incorrect, bookmarks, bookmarkPage2]
      .flatMap((result) => result.questions).find((question) => question.id === questions[0].id);
    assert.ok(activeQuestion);
    assert.equal(activeQuestion.feedbackAuthorization, undefined);
  } finally {
    globalThis.__BAEUMZIP_ENV__ = previous;
    database.close();
  }
});
