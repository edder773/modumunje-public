import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";
import { buildStudyPracticeQuery } from "../apps/backend/src/modules/study/study-practice-query.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function freshDatabase() {
  return openCanonicalTestDatabase(root);
}

function explain(database, sql, parameters = []) {
  return database.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...parameters)
    .map((row) => String(row.detail))
    .join("\n");
}

function assertIndexed(plan, expected, label) {
  assert.match(plan, /(?:USING (?:COVERING )?INDEX|USING INTEGER PRIMARY KEY)/u, `${label}\n${plan}`);
  assert.match(plan, expected, `${label}\n${plan}`);
}

test("high-frequency learner and admin reads keep indexed query plans", () => {
  const database = freshDatabase();

  assertIndexed(explain(database, `
    SELECT * FROM attempts
    WHERE user_key = ? AND exam_type = ?
    ORDER BY created_at, id
  `, ["plan-user", "SQLP"]), /attempts_user_exam_time_idx/u, "learner attempts");

  const recentQuestionPlan = explain(database, `
    WITH course_types AS (
      SELECT DISTINCT exam_type FROM course_content_scopes
    ), latest AS (
      SELECT course_types.exam_type, (
        SELECT a.id FROM attempts AS a
        JOIN questions AS q ON q.id = a.question_id
        WHERE a.user_key = ? AND a.exam_type = course_types.exam_type
          AND q.active = 1 AND q.kind IN ('single', 'multiple')
        ORDER BY a.created_at DESC, a.id DESC LIMIT 1
      ) AS attempt_id
      FROM course_types
    )
    SELECT latest.exam_type, q.category, q.topic, a.created_at
    FROM latest
    JOIN attempts AS a ON a.id = latest.attempt_id
    JOIN questions AS q ON q.id = a.question_id
  `, ["plan-user"]);
  assertIndexed(recentQuestionPlan, /attempts_user_exam_time_idx/u, "recent question activity");
  assert.doesNotMatch(recentQuestionPlan, /TEMP B-TREE/u, recentQuestionPlan);

  const incorrectSummaryPlan = explain(database, `
    SELECT COUNT(*)
    FROM (
      SELECT a.question_id, a.result,
        ROW_NUMBER() OVER (
          PARTITION BY a.question_id ORDER BY a.created_at DESC, a.id DESC
        ) AS attempt_rank
      FROM attempts AS a
      JOIN questions AS q ON q.id = a.question_id
      WHERE a.user_key = ? AND a.exam_type = ?
        AND q.active = 1 AND q.kind IN ('single', 'multiple')
    ) AS latest
    WHERE attempt_rank = 1 AND result != 'correct'
  `, ["plan-user", "SQLP"]);
  assertIndexed(
    incorrectSummaryPlan,
    /attempts_user_exam_question_time_idx/u,
    "latest incorrect-attempt summary",
  );
  assert.doesNotMatch(incorrectSummaryPlan, /TEMP B-TREE/u, incorrectSummaryPlan);

  assertIndexed(explain(database, `
    SELECT id FROM questions
    WHERE active = 1 AND practice_scope = 'general'
      AND exam_scope = 'SQLP' AND category = ? AND kind = 'single'
    ORDER BY display_order, id LIMIT 12
  `, ["SQL 고급 활용 및 튜닝"]), /questions_practice_candidate_order_idx/u, "practice candidates");

  assertIndexed(explain(database, `
    SELECT id, category, exam_scope, kind, practice_scope, variant_group_id,
      choices, correct_answers
    FROM questions
    WHERE active = 1 AND practice_scope = 'general'
      AND exam_scope IN ('both', 'SQLP')
    ORDER BY display_order, id
  `), /questions_mock_candidate_order_idx/u, "mock candidates");

  const practiceQuery = buildStudyPracticeQuery({
    selectedExam: "SQLP",
    eligibility: {
      sql: "q.exam_scope IN (?, ?) AND (q.kind IN ('single', 'multiple') OR (q.kind = 'descriptive' AND q.category = ?))",
      values: ["SQLP", "both", "SQL 고급 활용 및 튜닝"],
    },
    category: "전체 과목",
    difficulty: "전체",
    kind: "objective",
    theoryId: Number.NaN,
    excludedIds: [],
    excludedVariantGroupIds: [],
    limit: 5,
  });
  const practicePlan = explain(database, practiceQuery.sql, practiceQuery.values);
  assert.match(practicePlan, /questions_practice_candidate_order_idx/u, practicePlan);
  assert.match(practicePlan, /SEARCH q USING INTEGER PRIMARY KEY/u, practicePlan);
  assert.ok(database.prepare(practiceQuery.sql).all(...practiceQuery.values).length <= 5);

  assertIndexed(explain(database, `
    SELECT id, kind, choices, correct_answers FROM questions
    WHERE active = 1 AND id IN (?, ?, ?)
  `, [1, 2, 3]), /INTEGER PRIMARY KEY/u, "guest question validation");

  assertIndexed(explain(database, `
    SELECT id, display_order, prompt FROM questions
    WHERE active = 1 ORDER BY display_order, id LIMIT 75 OFFSET 0
  `), /questions_active_display_idx/u, "admin question list");

  assertIndexed(explain(database, `
    SELECT user_key, last_login_at FROM user_accounts
    ORDER BY last_login_at DESC, created_at DESC LIMIT 20 OFFSET 0
  `), /user_accounts_login_time_idx/u, "admin user list");

  const swProfilePlan = explain(database, `
    SELECT id FROM sw_questions
    WHERE active = 1 AND subject_id = ?
      AND EXISTS (
        SELECT 1 FROM sw_question_tags
        WHERE sw_question_tags.question_id = sw_questions.id
          AND sw_question_tags.tag = ?
      )
    ORDER BY display_order, id LIMIT 20
  `, ["operating-systems", "정보처리기사"]);
  assert.match(swProfilePlan, /sw_questions_active_subject_order_v2_idx/u, swProfilePlan);
  assert.match(
    swProfilePlan,
    /(?:sqlite_autoindex_sw_question_tags_1|sw_question_tags_tag_question_idx)/u,
    swProfilePlan,
  );

  assertIndexed(explain(database, `
    SELECT id FROM exam_sessions
    WHERE user_key = ? AND status = 'active'
    ORDER BY updated_at DESC, id LIMIT 20
  `, ["plan-user"]), /exam_sessions_user_status_updated_idx/u, "active exam sessions");

  const recordSessionPlan = explain(database, `
    SELECT id FROM exam_sessions
    WHERE user_key = ? AND exam_type = ?
    ORDER BY updated_at DESC, id DESC LIMIT 21
  `, ["plan-user", "SQLP"]);
  assertIndexed(recordSessionPlan, /exam_sessions_user_exam_updated_idx/u, "learning record sessions");
  assert.doesNotMatch(recordSessionPlan, /TEMP B-TREE/u, recordSessionPlan);

  assertIndexed(explain(database, `
    SELECT id FROM analytics_events
    WHERE occurred_at < datetime('now', '-90 days')
    ORDER BY occurred_at, id LIMIT 500
  `), /analytics_events_occurred_at_idx/u, "analytics retention cleanup");

  assertIndexed(explain(database, `
    SELECT COUNT(*) AS count
    FROM (
      SELECT 1 FROM analytics_events
      WHERE anonymous_session_id = ? AND occurred_at >= ?
      LIMIT ?
    )
  `, ["plan-session", "2026-08-24T00:00:00.000Z", 120]),
  /analytics_events_session_time_idx/u, "distributed event rate limit");

  assertIndexed(explain(database, `
    SELECT id FROM admin_audit_logs
    WHERE created_at < datetime('now', '-365 days')
    ORDER BY created_at, id LIMIT 500
  `), /admin_audit_logs_created_at_idx/u, "audit retention cleanup");

  assertIndexed(explain(database, `
    SELECT id FROM system_errors
    WHERE fingerprint = ? AND status = 'open'
      AND last_seen_at >= datetime('now', '-5 minutes')
    ORDER BY last_seen_at DESC, id DESC LIMIT 1
  `, ["fingerprint"]), /system_errors_fingerprint_status_seen_idx/u, "error aggregation");

  database.close();
});
