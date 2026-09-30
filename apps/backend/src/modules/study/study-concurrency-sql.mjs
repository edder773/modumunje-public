const GUEST_IMPORT_COMPLETENESS_SQL = `
  NOT EXISTS (
    SELECT 1 FROM exam_session_items item
    JOIN exam_sessions session ON session.id = item.session_id
    WHERE item.question_id IN (SELECT value FROM json_each(?))
      AND session.user_key = ? AND session.status != 'submitted'
  )
    AND NOT EXISTS (
      SELECT 1 FROM json_each(?) expected
      LEFT JOIN attempts saved ON saved.user_key = ?
        AND saved.client_operation_id = json_extract(expected.value, '$.operationId')
      WHERE saved.id IS NULL
        OR saved.question_id IS NOT json_extract(expected.value, '$.questionId')
        OR saved.selected_answers IS NOT json_extract(expected.value, '$.selectedAnswers')
        OR saved.correct IS NOT json_extract(expected.value, '$.correct')
        OR saved.mode IS NOT json_extract(expected.value, '$.mode')
        OR saved.exam_type IS NOT json_extract(expected.value, '$.examType')
        OR saved.result IS NOT json_extract(expected.value, '$.result')
        OR saved.score IS NOT json_extract(expected.value, '$.score')
        OR saved.answer_text IS NOT json_extract(expected.value, '$.answerText')
        OR saved.review_status IS NOT json_extract(expected.value, '$.reviewStatus')
        OR saved.is_admin IS NOT json_extract(expected.value, '$.isAdmin')
        OR (json_extract(expected.value, '$.compareCreatedAt') = 1
          AND saved.created_at IS NOT json_extract(expected.value, '$.createdAt'))
    )
    AND NOT EXISTS (
      SELECT 1 FROM attempts saved
      WHERE saved.user_key = ? AND saved.client_operation_id GLOB ?
        AND NOT EXISTS (
          SELECT 1 FROM json_each(?) expected
          WHERE json_extract(expected.value, '$.operationId') = saved.client_operation_id
        )
    )
`;

export const GUEST_IMPORT_ATTEMPT_SQL = `
  INSERT OR IGNORE INTO attempts (
    question_id, selected_answers, correct, mode, user_key, exam_type,
    result, score, answer_text, evaluation_id, review_status, is_admin,
    client_operation_id, created_at
  ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?
  WHERE NOT EXISTS (
    SELECT 1 FROM exam_session_items item
    JOIN exam_sessions session ON session.id = item.session_id
    WHERE item.question_id IN (SELECT value FROM json_each(?)) AND session.user_key = ?
      AND session.status != 'submitted'
  )
    AND NOT EXISTS (
      SELECT 1 FROM guest_import_batches WHERE user_key = ? AND import_id = ?
    )
`;

export const GUEST_IMPORT_RECEIPT_SQL = `
  INSERT OR IGNORE INTO guest_import_receipts (user_key, import_id, payload_digest)
  SELECT ?, ?, ? WHERE ${GUEST_IMPORT_COMPLETENESS_SQL}
    AND NOT EXISTS (
      SELECT 1 FROM guest_import_batches WHERE user_key = ? AND import_id = ?
    )
`;

export const GUEST_IMPORT_MARKER_SQL = `
  INSERT OR IGNORE INTO guest_import_batches (user_key, import_id, imported_at)
  SELECT ?, ?, CURRENT_TIMESTAMP WHERE ${GUEST_IMPORT_COMPLETENESS_SQL}
    AND EXISTS (
      SELECT 1 FROM guest_import_receipts
      WHERE user_key = ? AND import_id = ? AND payload_digest = ?
    )
`;

export const EXAM_SUBMISSION_UPDATE_SQL = `
  UPDATE exam_sessions
  SET status = 'submitted', answers = ?, descriptive_answers = ?,
      descriptive_scores = ?, descriptive_snapshots = ?, flagged = ?,
      current_index = ?, submitted_at = ?, result = ?, updated_at = ?
  WHERE id = ? AND user_key = ? AND status = 'grading'
`;

export const EXAM_SUBMISSION_ATTEMPT_SQL = `
  INSERT INTO attempts (
    question_id, selected_answers, correct, mode, user_key, exam_type,
    result, score, answer_text, evaluation_id, review_status, is_admin,
    client_operation_id
  )
  SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
  WHERE EXISTS (
    SELECT 1 FROM exam_sessions
    WHERE id = ? AND user_key = ? AND status = 'submitted' AND submitted_at = ?
  )
`;

export const EXAM_SUBMISSION_LEASE_DELETE_SQL = `
  DELETE FROM exam_active_sessions
  WHERE user_key = ? AND session_id = ?
    AND EXISTS (
      SELECT 1 FROM exam_sessions
      WHERE id = ? AND user_key = ? AND status = 'submitted' AND submitted_at = ?
    )
`;

export const EXAM_SUPERSEDE_UNLEASED_SQL = `
  UPDATE exam_sessions
  SET status = 'submitted', submitted_at = ?, result = ?, updated_at = ?
  WHERE id = ? AND user_key = ? AND status = 'active'
    AND NOT EXISTS (
      SELECT 1 FROM exam_active_sessions WHERE session_id = ?
    )
`;
