import crypto from "node:crypto";
import { EXPECTED_SCHEMA_VERSION } from "../../packages/shared/src/database/schema-contract.mjs";

const FIXTURE_ID = 900000001;
const FIXTURE_SCOPE = "BAE-W";
const FIXTURE_SUBJECT = "Synthetic migration fixture";
const FIXTURE_VERSION = "public-synthetic-migration-v1";
const FIXTURE_TIME = "2026-01-01T00:00:00.000Z";
const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");

// One synthetic theory/question plus its scope and release metadata exercises
// the existing FK, integrity-trigger, learner-bookmark and release-preservation
// paths. It is never imported from or written to an operational database.
export function applySyntheticMigrationSeed(database) {
  const choices = JSON.stringify(["Incorrect synthetic option", "Correct synthetic option"]);
  const answer = "[1]";
  const theoryContent = "Synthetic migration theory; no learner content.";
  const questionPrompt = "Which synthetic option is marked correct?";
  database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare(`
      INSERT INTO course_content_scopes (exam_type, content_scope) VALUES (?, ?)
    `).run(FIXTURE_SCOPE, FIXTURE_SCOPE);
    database.prepare(`
      INSERT INTO course_subjects (exam_type, subject) VALUES (?, ?)
    `).run(FIXTURE_SCOPE, FIXTURE_SUBJECT);
    database.prepare(`
      INSERT INTO theories (id, title, category, summary, content, exam_scope, active)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `).run(FIXTURE_ID, "Synthetic theory", FIXTURE_SUBJECT,
      "Synthetic migration fixture", theoryContent, FIXTURE_SCOPE);
    database.prepare(`
      INSERT INTO questions (
        id, category, topic, kind, prompt, choices, correct_answers,
        explanation, theory_id, exam_scope, active
      ) VALUES (?, ?, ?, 'single', ?, ?, ?, ?, ?, ?, 1)
    `).run(FIXTURE_ID, FIXTURE_SUBJECT, "Synthetic topic", questionPrompt,
      choices, answer, "The second option is the synthetic answer.",
      FIXTURE_ID, FIXTURE_SCOPE);
    database.prepare(`
      INSERT INTO content_releases (
        version, schema_version, source_checksum, question_checksum,
        theory_checksum, expected_question_count, imported_question_count,
        expected_theory_count, imported_theory_count, status, created_at, activated_at
      ) VALUES (?, ?, ?, ?, ?, 1, 1, 1, 1, 'active', ?, ?)
    `).run(FIXTURE_VERSION, EXPECTED_SCHEMA_VERSION,
      digest(`${theoryContent}\n${questionPrompt}\n${choices}\n${answer}`),
      digest(`${questionPrompt}\n${choices}\n${answer}`), digest(theoryContent),
      FIXTURE_TIME, FIXTURE_TIME);
    if (database.prepare("PRAGMA foreign_key_check").all().length > 0) {
      throw new Error("synthetic migration seed has foreign-key violations");
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
