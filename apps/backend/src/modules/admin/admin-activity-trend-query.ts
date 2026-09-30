export function adminActivityTrendQuery(excludeAdmin: boolean) {
  const analyticsAdmin = excludeAdmin ? "AND e.is_admin = 0" : "";
  const sqlAdmin = excludeAdmin ? "AND a.is_admin = 0" : "";
  const swAdmin = excludeAdmin ? "AND sa.user_key != ?" : "";
  return `
    WITH RECURSIVE
    bounds(end_day, first_day, visitor_start) AS (
      SELECT date(datetime(?, '+9 hours')),
        date(datetime(?, '+9 hours'), '-29 days'),
        date(datetime(?, '+9 hours'), '-58 days')
    ),
    days(day) AS (
      SELECT first_day FROM bounds
      UNION ALL
      SELECT date(day, '+1 day') FROM days, bounds WHERE day < end_day
    ),
    visitor_days AS MATERIALIZED (
      SELECT date(datetime(e.occurred_at, '+9 hours')) AS day,
        e.anonymous_session_id AS session_id
      FROM analytics_events e, bounds
      WHERE e.event_type = 'page_view'
        AND date(datetime(e.occurred_at, '+9 hours')) BETWEEN visitor_start AND end_day
        ${analyticsAdmin}
      GROUP BY day, e.anonymous_session_id
    ),
    daily_visitors AS MATERIALIZED (
      SELECT day, COUNT(DISTINCT session_id) AS dau
      FROM visitor_days GROUP BY day
    ),
    attempt_sources AS MATERIALIZED (
      SELECT date(datetime(a.created_at, '+9 hours')) AS day, COUNT(*) AS item_count
      FROM attempts a
      JOIN questions q ON q.id = a.question_id
      JOIN bounds
      WHERE q.kind != 'descriptive'
        AND date(datetime(a.created_at, '+9 hours')) BETWEEN first_day AND end_day
        ${sqlAdmin}
      GROUP BY day
      UNION ALL
      SELECT date(datetime(sa.created_at, '+9 hours')) AS day, COUNT(*) AS item_count
      FROM sw_attempts sa
      JOIN bounds
      WHERE date(datetime(sa.created_at, '+9 hours')) BETWEEN first_day AND end_day
        ${swAdmin}
      GROUP BY day
    ),
    daily_attempts AS MATERIALIZED (
      SELECT day, SUM(item_count) AS question_attempts
      FROM attempt_sources GROUP BY day
    )
    SELECT days.day,
      COALESCE(daily_visitors.dau, 0) AS dau,
      (
        SELECT COUNT(DISTINCT visitor_days.session_id)
        FROM visitor_days
        WHERE visitor_days.day BETWEEN date(days.day, '-29 days') AND days.day
      ) AS mau,
      COALESCE(daily_attempts.question_attempts, 0) AS question_attempts
    FROM days
    LEFT JOIN daily_visitors ON daily_visitors.day = days.day
    LEFT JOIN daily_attempts ON daily_attempts.day = days.day
    ORDER BY days.day
  `;
}

export function adminActivityTrendBindings(
  now: Date,
  excludeAdmin: boolean,
  adminLearnerKey: string,
) {
  const timestamp = now.toISOString();
  return [timestamp, timestamp, timestamp, ...(excludeAdmin ? [adminLearnerKey] : [])];
}
