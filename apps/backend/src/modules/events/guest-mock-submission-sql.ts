// Server-only events: /api/events does not accept this event type. Keep the
// question count after the temporary guest session expires, without answers.
const columns = `(id, event_type, occurred_at, anonymous_session_id, is_admin,
  exam_scope, subject, content_id, dedupe_key)`;
const enabled = `COALESCE((SELECT value FROM site_settings WHERE key = 'analytics_enabled'), 'true') != 'false'`;

export function allowSubmissionAnalytics(request: Request) {
  return request.headers.get("dnt") !== "1" && request.headers.get("sec-gpc") !== "1";
}

export const GUEST_SQL_MOCK_EVENTS_SQL = `
  INSERT OR IGNORE INTO analytics_events ${columns}
  SELECT 'guest-mock:sql:' || s.id || ':' || json_extract(item.value, '$.questionId'),
    'guest_mock_answer_submitted', s.submitted_at, ?, s.is_admin, s.exam_type,
    COALESCE(NULLIF(json_extract(item.value, '$.category'), ''), '미분류'),
    'sql:' || s.id,
    'guest-mock:sql:' || s.id || ':' || json_extract(item.value, '$.questionId')
  FROM exam_sessions s, json_each(s.result, '$.questionResults') item
  WHERE s.id = ? AND s.user_key = ? AND s.status = 'submitted' AND s.submitted_at = ?
    AND json_extract(item.value, '$.result') != 'unanswered'
    AND ${enabled}
`;

export const GUEST_SW_MOCK_EVENTS_SQL = `
  INSERT OR IGNORE INTO analytics_events ${columns}
  SELECT 'guest-mock:sw:' || s.id || ':' || q.id,
    'guest_mock_answer_submitted', s.updated_at, ?, 0, 'SW',
    COALESCE(NULLIF(q.category, ''), '미분류'), 'sw:' || s.id,
    'guest-mock:sw:' || s.id || ':' || q.id
  FROM sw_learning_sessions s, json_each(s.question_ids) item
  JOIN sw_questions q ON q.id = item.value
  WHERE s.id = ? AND s.user_key = ? AND s.status = 'submitted' AND s.mode = 'mock'
    AND s.updated_at = ? AND s.revision = ? AND s.answers = ?
    AND json_array_length(json_extract(s.answers, '$."' || q.id || '"')) > 0
    AND ${enabled}
`;
