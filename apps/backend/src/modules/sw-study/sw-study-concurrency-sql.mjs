export const SW_SESSION_INSERT_SQL = `
  INSERT OR IGNORE INTO sw_learning_sessions (
    id, user_key, mode, status, subject_ids, question_ids, answers,
    revealed_question_ids, current_index, result, revision, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
`;

export const SW_SESSION_UPDATE_SQL = `
  UPDATE sw_learning_sessions SET
    status = ?, subject_ids = ?, question_ids = ?, answers = ?,
    revealed_question_ids = ?, current_index = ?, result = ?,
    revision = revision + 1, updated_at = ?
  WHERE id = ? AND user_key = ? AND status = 'active' AND revision = ?
`;
