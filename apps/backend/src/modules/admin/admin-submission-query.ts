import { examDisplayName, isExamType } from "@shared/study/course-registry";
import type { SubjectSubmissionCount } from "@shared/admin/submission-analytics";

// Do not add member telemetry to saved attempts: both describe the same
// submission. Imported guest practice is likewise already represented by its
// original anonymous event. Claimed mock attempts are a fallback for old exams.
export function submissionQuery(excludeAdmin: boolean) {
  // D1 has a much smaller compound-SELECT limit than node:sqlite. Materialize
  // each three-source group so query flattening cannot recreate a six-way UNION.
  return `WITH bounds AS (SELECT ? AS start_at, ? AS end_at, ? AS admin_key),
  guest_mocks AS MATERIALIZED (
    SELECT occurred_at, exam_scope, subject, content_id, is_admin
    FROM analytics_events
    WHERE event_type = 'guest_mock_answer_submitted'
  ), practice_submissions AS MATERIALIZED (
    SELECT a.created_at AS occurred_at, a.exam_type AS exam_type,
      COALESCE(NULLIF(q.category, ''), '미분류') AS subject,
      CASE WHEN a.client_operation_id LIKE 'guest-exam:%' THEN 1 ELSE 0 END AS guest
    FROM attempts a JOIN questions q ON q.id = a.question_id, bounds b
    WHERE a.created_at BETWEEN b.start_at AND b.end_at
      ${excludeAdmin ? "AND a.is_admin = 0" : ""}
      AND a.mode NOT LIKE 'guest-import:%'
      AND (json_array_length(a.selected_answers) > 0 OR length(trim(a.answer_text)) > 0)
      AND (a.client_operation_id IS NULL OR a.client_operation_id NOT LIKE 'guest-exam:%'
        OR NOT EXISTS (SELECT 1 FROM guest_mocks g
          WHERE g.content_id = 'sql:' || substr(a.client_operation_id, 12, instr(substr(a.client_operation_id, 12), ':') - 1)))
    UNION ALL
    SELECT sa.created_at, 'SW', COALESCE(NULLIF(q.category, ''), '미분류'), 0
    FROM sw_attempts sa JOIN sw_questions q ON q.id = sa.question_id, bounds b
    WHERE sa.created_at BETWEEN b.start_at AND b.end_at
      ${excludeAdmin ? "AND sa.user_key != b.admin_key" : ""}
      AND json_array_length(sa.selected_answers) > 0
      AND (sa.client_operation_id NOT LIKE 'guest-session:%' OR sa.client_operation_id IS NULL)
    UNION ALL
    SELECT e.occurred_at, COALESCE(NULLIF(e.exam_scope, ''), 'unknown'),
      COALESCE(NULLIF(q.category, ''), NULLIF(sq.category, ''), NULLIF(trim(e.subject), ''), '미분류'), 1
    FROM analytics_events e
    LEFT JOIN questions q ON q.id = e.question_id
    LEFT JOIN sw_questions sq ON e.exam_scope = 'SW' AND sq.id = e.content_id, bounds b
    WHERE e.event_type = 'question_answer_submitted' AND e.user_key_hash IS NULL
      AND e.occurred_at BETWEEN b.start_at AND b.end_at
      ${excludeAdmin ? "AND e.is_admin = 0" : ""}
  ), mock_submissions AS MATERIALIZED (
    SELECT g.occurred_at, g.exam_scope, COALESCE(NULLIF(g.subject, ''), '미분류'), 1
    FROM guest_mocks g, bounds b
    WHERE g.occurred_at BETWEEN b.start_at AND b.end_at
      ${excludeAdmin ? "AND g.is_admin = 0" : ""}
    UNION ALL
    SELECT s.submitted_at, s.exam_type,
      COALESCE(NULLIF(json_extract(item.value, '$.category'), ''), '미분류'), 1
    FROM exam_sessions s, json_each(s.result, '$.questionResults') item, bounds b
    WHERE s.user_key LIKE 'guest:%' AND s.status = 'submitted'
      AND s.submitted_at BETWEEN b.start_at AND b.end_at
      AND json_extract(item.value, '$.result') != 'unanswered'
      ${excludeAdmin ? "AND s.is_admin = 0" : ""}
      AND NOT EXISTS (SELECT 1 FROM guest_mocks g WHERE g.content_id = 'sql:' || s.id)
    UNION ALL
    SELECT s.updated_at, 'SW', COALESCE(NULLIF(q.category, ''), '미분류'),
      CASE WHEN s.user_key LIKE 'guest:%' OR EXISTS (
        SELECT 1 FROM sw_attempts claimed WHERE claimed.user_key = s.user_key
          AND claimed.client_operation_id LIKE 'guest-session:' || s.id || ':%'
      ) THEN 1 ELSE 0 END
    FROM sw_learning_sessions s, json_each(s.question_ids) item
    JOIN sw_questions q ON q.id = item.value, bounds b
    WHERE s.status = 'submitted' AND s.mode = 'mock'
      AND s.updated_at BETWEEN b.start_at AND b.end_at
      ${excludeAdmin ? "AND s.user_key != b.admin_key" : ""}
      AND json_array_length(json_extract(s.answers, '$."' || q.id || '"')) > 0
      AND NOT EXISTS (SELECT 1 FROM guest_mocks g WHERE g.content_id = 'sw:' || s.id)
  ), group_skct_submissions AS MATERIALIZED (
    SELECT r.completed_at AS occurred_at, 'GROUP_SKCT' AS exam_type,
      q.area_code_snapshot AS subject, 0 AS guest
    FROM study_group_exam_runs r
    JOIN study_group_exam_participant_progress p ON p.run_id=r.id
    JOIN study_group_exam_answers a ON a.run_id=r.id AND a.user_key=p.user_key
    JOIN study_group_exam_question_public q ON q.run_id=a.run_id AND q.position=a.position
    CROSS JOIN bounds b
    WHERE r.status='completed' AND r.completed_at BETWEEN b.start_at AND b.end_at
      AND p.finished_at_utc IS NOT NULL
      AND json_valid(a.answer_json) AND json_array_length(a.answer_json)>0
      ${excludeAdmin ? "AND p.user_key != b.admin_key" : ""}
  ), submissions AS (
    SELECT * FROM practice_submissions
    UNION ALL
    SELECT * FROM mock_submissions
    UNION ALL
    SELECT * FROM group_skct_submissions
  )
  SELECT date(datetime(occurred_at, '+9 hours')) AS day, exam_type, subject,
    SUM(guest = 0) AS member_count, SUM(guest = 1) AS guest_count, COUNT(*) AS count
  FROM submissions GROUP BY day, exam_type, subject ORDER BY day, exam_type, subject`;
}

export type SubmissionRow = {
  day: string;
  exam_type: string;
  subject: string;
  member_count: number;
  guest_count: number;
  count: number;
};

export function subjectSubmissionCounts(rows: SubmissionRow[]): SubjectSubmissionCount[] {
  const grouped = new Map<string, SubjectSubmissionCount>();
  for (const row of rows) {
    const key = JSON.stringify([row.exam_type, row.subject]);
    const value = grouped.get(key) ?? {
      examType: row.exam_type,
      courseName: isExamType(row.exam_type) ? examDisplayName(row.exam_type) : row.exam_type === 'SW' ? 'SW 전공' : row.exam_type === 'GROUP_SKCT' ? '그룹 SKCT' : '미분류 과정',
      subject: row.subject, memberCount: 0, guestCount: 0, count: 0,
    };
    value.memberCount += Number(row.member_count);
    value.guestCount += Number(row.guest_count);
    value.count += Number(row.count);
    grouped.set(key, value);
  }
  return [...grouped.values()].sort((a, b) => b.count - a.count
    || a.courseName.localeCompare(b.courseName, 'ko') || a.subject.localeCompare(b.subject, 'ko'));
}
