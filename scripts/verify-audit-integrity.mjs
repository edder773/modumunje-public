import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationNames = fs.readdirSync(path.join(projectRoot, "apps/backend/drizzle"))
  .filter((name) => /^\d{4}.*[.]sql$/u.test(name))
  .sort();

function apply(database, predicate) {
  for (const name of migrationNames.filter(predicate)) {
    database.exec(fs.readFileSync(path.join(projectRoot, "apps/backend/drizzle", name), "utf8"));
  }
}

function scalar(database, sql) {
  return Number(database.prepare(sql).get().value);
}

function hashRows(database, sql) {
  return createHash("sha256")
    .update(JSON.stringify(database.prepare(sql).all()))
    .digest("hex");
}

function snapshot(database) {
  return {
    counts: {
      sqlQuestions: scalar(database, "SELECT COUNT(*) AS value FROM questions"),
      sqlTheories: scalar(database, "SELECT COUNT(*) AS value FROM theories"),
      swQuestions: scalar(database, "SELECT COUNT(*) AS value FROM sw_questions"),
      swTheories: scalar(database, "SELECT COUNT(*) AS value FROM sw_theories"),
      attempts: scalar(database, "SELECT COUNT(*) AS value FROM attempts"),
      bookmarks: scalar(database, "SELECT COUNT(*) AS value FROM user_bookmarks"),
      incorrectAttempts: scalar(database, "SELECT COUNT(*) AS value FROM attempts WHERE result != 'correct'"),
      mockResults: scalar(database, "SELECT COUNT(*) AS value FROM exam_sessions WHERE status = 'submitted'"),
      mockSessions: scalar(database, "SELECT COUNT(*) AS value FROM exam_sessions"),
      evaluations: scalar(database, "SELECT COUNT(*) AS value FROM ai_evaluations"),
    },
    hashes: {
      sqlQuestionIds: hashRows(database, "SELECT id FROM questions ORDER BY id"),
      sqlTheoryIds: hashRows(database, "SELECT id FROM theories ORDER BY id"),
      swQuestionIds: hashRows(database, "SELECT id FROM sw_questions ORDER BY id"),
      swTheoryIds: hashRows(database, "SELECT id FROM sw_theories ORDER BY id"),
      sqlLinks: hashRows(database, "SELECT id, theory_id FROM questions ORDER BY id"),
      swLinks: hashRows(database, "SELECT id, theory_id FROM sw_questions ORDER BY id"),
    },
  };
}

const database = new DatabaseSync(":memory:");
apply(database, (name) => name < "0269");
const before = snapshot(database);
apply(database, (name) => name >= "0269");
const after = snapshot(database);
const foreignKeyViolations = database.prepare("PRAGMA foreign_key_check").all();
const preserved = JSON.stringify(before) === JSON.stringify(after);

console.log(JSON.stringify({
  migrationRange: "0269-0272",
  before,
  after,
  foreignKeyViolations: foreignKeyViolations.length,
  preserved,
}, null, 2));

if (!preserved || foreignKeyViolations.length) process.exitCode = 1;
