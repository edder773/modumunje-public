import { EXPECTED_SCHEMA_VERSION } from "../../packages/shared/src/database/schema-contract.mjs";
import {
  COURSE_CONTENT_SCOPE_ROWS,
  COURSE_SUBJECT_ROWS,
} from "../../packages/shared/src/study/course-contract.mjs";
import {
  canonicalRowsSha256,
  CONTENT_SCHEMA_VERSION,
  readCanonicalContent,
} from "./content-release.mjs";

const USER_OWNED_TABLES = Object.freeze({
  activeExamSessions: "exam_active_sessions",
  attempts: "attempts",
  bookmarks: "user_bookmarks",
  evaluations: "ai_evaluations",
  examSessions: "exam_sessions",
  guestImports: "guest_import_batches",
  reports: "user_reports",
  settings: "user_settings",
  swAttempts: "sw_attempts",
  swSessions: "sw_learning_sessions",
});
const LEGACY_GUEST_SESSION_TABLES = new Set(["exam_sessions", "sw_learning_sessions"]);
const LEGACY_GUEST_KEY = /^guest:(\d{10}):[A-Za-z0-9_-]{32}$/u;
const LEGACY_GUEST_MAX_AGE_SECONDS = 24 * 60 * 60;
const LEGACY_GUEST_CLOCK_SKEW_SECONDS = 60;

function scalar(database, sql, parameters = []) {
  return Number(database.prepare(sql).get(...parameters)?.count ?? 0);
}

function orphanedUserRows(database, table, nowEpochSeconds) {
  const orphanQuery = `
    FROM ${table} record
    LEFT JOIN user_accounts account ON account.user_key = record.user_key
    WHERE record.user_key <> 'owner' AND account.user_key IS NULL
  `;
  if (!LEGACY_GUEST_SESSION_TABLES.has(table)) {
    return { orphaned: scalar(database, `SELECT COUNT(*) AS count ${orphanQuery}`) };
  }

  // Only these two historical session tables accepted temporary guest owners.
  // A key's exact issued shape can be checked offline, but its HMAC cookie cannot
  // be reconstructed from a backup. Keep malformed guest-like keys as orphans.
  const keys = database.prepare(`
    SELECT record.user_key AS userKey, unixepoch(record.created_at) AS createdEpochSeconds
    ${orphanQuery}
  `).all();
  let orphaned = 0;
  let guestTotal = 0;
  let guestExpired = 0;
  for (const { userKey, createdEpochSeconds } of keys) {
    const match = LEGACY_GUEST_KEY.exec(userKey);
    const expiry = match ? Number(match[1]) : NaN;
    const secondsUntilExpiry = expiry - createdEpochSeconds;
    if (!match || !Number.isInteger(createdEpochSeconds) || createdEpochSeconds <= 0
      || createdEpochSeconds > nowEpochSeconds + LEGACY_GUEST_CLOCK_SKEW_SECONDS
      || secondsUntilExpiry <= 0
      || secondsUntilExpiry > LEGACY_GUEST_MAX_AGE_SECONDS + LEGACY_GUEST_CLOCK_SKEW_SECONDS
      || expiry > nowEpochSeconds + LEGACY_GUEST_MAX_AGE_SECONDS + LEGACY_GUEST_CLOCK_SKEW_SECONDS) {
      orphaned += 1;
    } else {
      guestTotal += 1;
      if (expiry <= nowEpochSeconds) guestExpired += 1;
    }
  }
  return { orphaned, guestTotal, guestExpired };
}

function invalidJsonShape(database, table, fields) {
  return scalar(database, `
    SELECT COUNT(*) AS count FROM ${table}
    WHERE ${fields.map(([field, shape]) => `
      CASE WHEN json_valid(${field})
        THEN json_type(${field}) <> '${shape}'
        ELSE 1
      END
    `).join(" OR ")}
  `);
}

function anyPositive(value) {
  if (typeof value === "number") return value > 0;
  return Object.values(value).some((item) => anyPositive(item));
}

function sortedRegistryRows(rows, keys) {
  return rows.map((row) => Object.fromEntries(keys.map((key) => [key, row[key]])))
    .sort((left, right) => keys
      .map((key) => String(left[key]).localeCompare(String(right[key])))
      .find((comparison) => comparison !== 0) ?? 0);
}

export function buildDataIntegrityReport(database, options = {}) {
  const questionCount = scalar(database, "SELECT COUNT(*) AS count FROM questions");
  const theoryCount = scalar(database, "SELECT COUNT(*) AS count FROM theories");
  const canonical = readCanonicalContent(database, CONTENT_SCHEMA_VERSION);
  const questionSha256 = canonicalRowsSha256(canonical.questions);
  const theorySha256 = canonicalRowsSha256(canonical.theories);
  const tagParity = database.prepare(`
    SELECT
      (SELECT COUNT(*) FROM sw_question_tags) AS indexed_count,
      (SELECT COUNT(*) FROM sw_questions q, json_each(q.tags) tags
        WHERE json_valid(q.tags) AND json_type(q.tags) = 'array' AND tags.type = 'text') AS expected_count,
      (SELECT COUNT(*) FROM sw_question_tags indexed_tag
        WHERE NOT EXISTS (
          SELECT 1 FROM sw_questions q, json_each(q.tags) tags
          WHERE q.id = indexed_tag.question_id
            AND json_valid(q.tags) AND json_type(q.tags) = 'array'
            AND tags.type = 'text' AND tags.value = indexed_tag.tag
        )) AS stale_count
  `).get();
  const activeRelease = database.prepare(`
    SELECT version, schema_version, question_checksum, theory_checksum,
      expected_question_count, imported_question_count,
      expected_theory_count, imported_theory_count
    FROM content_releases WHERE status = 'active'
    ORDER BY activated_at DESC, created_at DESC, version DESC LIMIT 1
  `).get() ?? null;
  const nowEpochSeconds = options.nowEpochSeconds ?? Math.floor(Date.now() / 1000);
  const orphanSummaries = Object.fromEntries(Object.entries(USER_OWNED_TABLES)
    .map(([label, table]) => [label, orphanedUserRows(database, table, nowEpochSeconds)]));
  const orphanedUserRowsByTable = Object.fromEntries(Object.entries(orphanSummaries)
    .map(([label, summary]) => [label, summary.orphaned]));
  const legacyGuestSessions = Object.fromEntries(["examSessions", "swSessions"]
    .map((label) => [label, {
      total: orphanSummaries[label].guestTotal,
      expired: orphanSummaries[label].guestExpired,
    }]));

  const invalidQuestionJson = invalidJsonShape(database, "questions", [
    ["choices", "array"], ["correct_answers", "array"], ["tags", "array"],
    ["scoring_criteria", "array"], ["required_concepts", "array"],
    ["acceptable_alternatives", "array"], ["deduction_conditions", "array"],
    ["error_conditions", "array"],
  ]);
  const invalidSwQuestionJson = invalidJsonShape(database, "sw_questions", [
    ["choices", "array"], ["correct_answers", "array"], ["tags", "array"],
    ["required_concepts", "array"],
  ]);
  const actualCourseContentScopes = sortedRegistryRows(database.prepare(`
    SELECT exam_type AS examType, content_scope AS contentScope
    FROM course_content_scopes
  `).all(), ["examType", "contentScope"]);
  const actualCourseSubjects = sortedRegistryRows(database.prepare(`
    SELECT exam_type AS examType, subject
    FROM course_subjects
  `).all(), ["examType", "subject"]);
  const expectedCourseContentScopes = sortedRegistryRows(
    COURSE_CONTENT_SCOPE_ROWS,
    ["examType", "contentScope"],
  );
  const expectedCourseSubjects = sortedRegistryRows(
    COURSE_SUBJECT_ROWS,
    ["examType", "subject"],
  );

  const integrity = {
    foreignKeyViolations: database.prepare("PRAGMA foreign_key_check").all().length,
    invalidQuestionJson,
    invalidSwQuestionJson,
    orphanedSwQuestions: scalar(database, `
      SELECT COUNT(*) AS count FROM sw_questions q
      LEFT JOIN sw_theories t ON t.id = q.theory_id WHERE t.id IS NULL
    `),
    swTagIndex: {
      indexedCount: Number(tagParity.indexed_count),
      expectedCount: Number(tagParity.expected_count),
      staleCount: Number(tagParity.stale_count),
    },
    informationProcessingEngineerQuestions: scalar(database, `
      SELECT COUNT(DISTINCT q.id) AS count
      FROM sw_questions q JOIN sw_question_tags tag ON tag.question_id = q.id
      WHERE q.active = 1 AND tag.tag = '정보처리기사'
    `),
    courseRegistry: {
      contentScopesMatch: JSON.stringify(actualCourseContentScopes)
        === JSON.stringify(expectedCourseContentScopes),
      subjectsMatch: JSON.stringify(actualCourseSubjects)
        === JSON.stringify(expectedCourseSubjects),
      contentScopeRows: actualCourseContentScopes.length,
      subjectRows: actualCourseSubjects.length,
    },
    userAccounts: scalar(database, "SELECT COUNT(*) AS count FROM user_accounts"),
    orphanedUserRows: orphanedUserRowsByTable,
    legacyGuestSessions,
    invalidDomainValues: {
      accounts: scalar(database, `SELECT COUNT(*) AS count FROM user_accounts
        WHERE status NOT IN ('active', 'blocked')`),
      activeExamSessions: scalar(database, `SELECT COUNT(*) AS count FROM exam_active_sessions
        WHERE length(trim(exam_type)) = 0 OR NOT EXISTS (
          SELECT 1 FROM course_content_scopes scope
          WHERE scope.exam_type = exam_active_sessions.exam_type)`),
      attempts: scalar(database, `SELECT COUNT(*) AS count FROM attempts
        WHERE length(trim(exam_type)) = 0 OR length(trim(mode)) = 0
          OR result NOT IN ('correct', 'partial', 'incorrect')
          OR review_status NOT IN ('mastered', 'pending', 'self-assessed')
          OR NOT EXISTS (SELECT 1 FROM course_content_scopes scope
            WHERE scope.exam_type = attempts.exam_type)`),
      examSessions: scalar(database, `SELECT COUNT(*) AS count FROM exam_sessions
        WHERE length(trim(exam_type)) = 0 OR status NOT IN ('active', 'grading', 'submitted')
          OR length(trim(policy_version)) = 0
          OR NOT json_valid(policy_snapshot) OR json_type(policy_snapshot) <> 'object'
          OR NOT EXISTS (SELECT 1 FROM course_content_scopes scope
            WHERE scope.exam_type = exam_sessions.exam_type)`),
      questions: scalar(database, `SELECT COUNT(*) AS count FROM questions
        WHERE length(trim(exam_scope)) = 0
          OR kind NOT IN ('single', 'multiple', 'descriptive')
          OR practice_scope NOT IN ('general', 'theory_only')
          OR NOT EXISTS (SELECT 1 FROM course_content_scopes scope
            WHERE scope.content_scope = questions.exam_scope)
          OR EXISTS (SELECT 1 FROM course_content_scopes scope
            WHERE scope.content_scope = questions.exam_scope AND NOT EXISTS (
              SELECT 1 FROM course_subjects subject
              WHERE subject.exam_type = scope.exam_type AND subject.subject = questions.category))`),
      settings: scalar(database, `SELECT COUNT(*) AS count FROM user_settings
        WHERE length(trim(selected_exam)) = 0 OR NOT EXISTS (
          SELECT 1 FROM course_content_scopes scope
          WHERE scope.exam_type = user_settings.selected_exam)`),
      swQuestions: scalar(database, `SELECT COUNT(*) AS count FROM sw_questions
        WHERE kind NOT IN ('single', 'multiple')`),
      swSessions: scalar(database, `SELECT COUNT(*) AS count FROM sw_learning_sessions
        WHERE mode NOT IN ('practice', 'mock') OR status NOT IN ('active', 'submitted')`),
      theories: scalar(database, `SELECT COUNT(*) AS count FROM theories
        WHERE length(trim(exam_scope)) = 0 OR NOT EXISTS (
          SELECT 1 FROM course_content_scopes scope
          WHERE scope.content_scope = theories.exam_scope)
          OR EXISTS (SELECT 1 FROM course_content_scopes scope
            WHERE scope.content_scope = theories.exam_scope AND NOT EXISTS (
              SELECT 1 FROM course_subjects subject
              WHERE subject.exam_type = scope.exam_type AND subject.subject = theories.category))`),
      courseScopes: scalar(database, `SELECT COUNT(*) AS count FROM course_content_scopes
        WHERE length(trim(exam_type)) = 0 OR length(trim(content_scope)) = 0`),
      courseSubjects: scalar(database, `SELECT COUNT(*) AS count FROM course_subjects
        WHERE length(trim(exam_type)) = 0 OR length(trim(subject)) = 0
          OR NOT EXISTS (SELECT 1 FROM course_content_scopes scope
            WHERE scope.exam_type = course_subjects.exam_type)`),
    },
    contentState: {
      invalidContentBooleans: scalar(database, `
        SELECT
          (SELECT COUNT(*) FROM theories WHERE active NOT IN (0, 1))
          + (SELECT COUNT(*) FROM questions WHERE active NOT IN (0, 1) OR bookmarked NOT IN (0, 1))
          + (SELECT COUNT(*) FROM sw_theories WHERE active NOT IN (0, 1))
          + (SELECT COUNT(*) FROM sw_questions WHERE active NOT IN (0, 1)) AS count
      `),
      invalidQuestionAnswers: scalar(database, `
        SELECT COUNT(*) AS count FROM questions
        WHERE json_valid(choices) AND json_type(choices) = 'array'
          AND json_valid(correct_answers) AND json_type(correct_answers) = 'array'
          AND kind IN ('single', 'multiple')
          AND (
            json_array_length(choices) NOT IN (2, 4) OR json_array_length(correct_answers) = 0
            OR EXISTS (
              SELECT 1 FROM json_each(correct_answers) answer
              WHERE answer.type <> 'integer' OR answer.value < 0
                OR answer.value >= json_array_length(choices)
            )
            OR (kind = 'single' AND json_array_length(correct_answers) <> 1)
          )
      `),
      invalidSwQuestionAnswers: scalar(database, `
        SELECT COUNT(*) AS count FROM sw_questions
        WHERE json_valid(choices) AND json_type(choices) = 'array'
          AND json_valid(correct_answers) AND json_type(correct_answers) = 'array'
          AND (
            json_array_length(choices) <> 4 OR json_array_length(correct_answers) = 0
            OR EXISTS (
              SELECT 1 FROM json_each(correct_answers) answer
              WHERE answer.type <> 'integer' OR answer.value < 0
                OR answer.value >= json_array_length(choices)
            )
            OR (kind = 'single' AND json_array_length(correct_answers) <> 1)
          )
      `),
      invalidTheoryJson: invalidJsonShape(database, "theories", [["keywords", "array"]]),
      invalidSwTheoryJson: invalidJsonShape(database, "sw_theories", [["keywords", "array"]]),
      incompatibleQuestionTheoryLinks: scalar(database, `
        SELECT COUNT(*) AS count FROM questions q JOIN theories t ON t.id = q.theory_id
        WHERE q.active = 1 AND (t.active <> 1 OR q.category <> t.category OR EXISTS (
          SELECT 1 FROM course_content_scopes question_course
          WHERE question_course.content_scope = q.exam_scope
            AND NOT EXISTS (
              SELECT 1 FROM course_content_scopes theory_course
              WHERE theory_course.exam_type = question_course.exam_type
                AND theory_course.content_scope = t.exam_scope
            )
        ))
      `),
      inconsistentSwQuestionTheoryLinks: scalar(database, `
        SELECT COUNT(*) AS count FROM sw_questions q JOIN sw_theories t ON t.id = q.theory_id
        WHERE q.subject_group_id <> t.subject_group_id OR q.subject_id <> t.subject_id
          OR q.category <> t.category OR q.topic <> t.topic
          OR (q.active = 1 AND t.active <> 1)
      `),
    },
    learnerState: {
      invalidAttemptState: scalar(database, `
        SELECT COUNT(*) AS count FROM attempts a JOIN questions q ON q.id = a.question_id
        WHERE CASE WHEN json_valid(a.selected_answers)
          THEN json_type(a.selected_answers) <> 'array'
            OR EXISTS (SELECT 1 FROM json_each(a.selected_answers) answer
              WHERE answer.type <> 'integer' OR answer.value < 0
                OR (json_valid(q.choices) AND json_type(q.choices) = 'array'
                  AND answer.value >= json_array_length(q.choices)))
          ELSE 1 END
          OR a.correct NOT IN (0, 1) OR a.is_admin NOT IN (0, 1)
          OR a.score < 0 OR a.score > 100
          OR (a.correct = 1 AND a.result <> 'correct')
          OR (a.correct = 0 AND a.result = 'correct')
      `),
      invalidEvaluationState: scalar(database, `
        SELECT COUNT(*) AS count FROM ai_evaluations
        WHERE score < 0 OR score > 100 OR result NOT IN ('correct', 'partial', 'incorrect')
          OR ${["strengths", "missing_points", "errors"].map((field) => `
            CASE WHEN json_valid(${field}) THEN json_type(${field}) <> 'array' ELSE 1 END
          `).join(" OR ")}
      `),
      invalidExamSessionState: invalidJsonShape(database, "exam_sessions", [
        ["question_ids", "array"], ["answers", "object"],
        ["descriptive_answers", "object"], ["descriptive_scores", "object"],
        ["descriptive_snapshots", "object"], ["flagged", "array"], ["result", "object"],
      ]) + scalar(database, `
        SELECT COUNT(*) AS count FROM exam_sessions
        WHERE current_index < 0 OR revision < 0 OR is_admin NOT IN (0, 1)
          OR (json_valid(question_ids) AND json_type(question_ids) = 'array'
            AND ((json_array_length(question_ids) = 0 AND current_index <> 0)
              OR (json_array_length(question_ids) > 0 AND current_index >= json_array_length(question_ids))))
      `),
      invalidExamSessionQuestionSet: scalar(database, `
        SELECT COUNT(*) AS count FROM exam_sessions session
        WHERE json_valid(session.question_ids) AND json_type(session.question_ids) = 'array'
          AND (
            EXISTS (SELECT 1 FROM json_each(session.question_ids) item
              LEFT JOIN questions q ON q.id = item.value
              WHERE item.type <> 'integer' OR q.id IS NULL
                OR (session.status <> 'submitted' AND q.active <> 1)
                OR NOT EXISTS (SELECT 1 FROM course_subjects subject
                  WHERE subject.exam_type = session.exam_type AND subject.subject = q.category)
                OR NOT EXISTS (
                  SELECT 1 FROM course_content_scopes scope
                  WHERE scope.exam_type = session.exam_type
                    AND scope.content_scope = q.exam_scope
                ))
            OR (SELECT COUNT(*) FROM json_each(session.question_ids))
              <> (SELECT COUNT(DISTINCT item.value) FROM json_each(session.question_ids) item)
          )
      `),
      invalidExamSessionMaps: scalar(database, `
        SELECT COUNT(*) AS count FROM exam_sessions session
        WHERE json_valid(session.question_ids) AND json_type(session.question_ids) = 'array'
          AND json_valid(session.answers) AND json_type(session.answers) = 'object'
          AND json_valid(session.descriptive_answers) AND json_type(session.descriptive_answers) = 'object'
          AND json_valid(session.descriptive_scores) AND json_type(session.descriptive_scores) = 'object'
          AND json_valid(session.descriptive_snapshots) AND json_type(session.descriptive_snapshots) = 'object'
          AND json_valid(session.flagged) AND json_type(session.flagged) = 'array'
          AND (
            EXISTS (SELECT 1 FROM json_each(session.answers) entry
              WHERE NOT EXISTS (SELECT 1 FROM json_each(session.question_ids) item
                  WHERE CAST(item.value AS text) = entry.key)
                OR CASE WHEN entry.type = 'array' THEN EXISTS (
                  SELECT 1 FROM json_each(entry.value) answer
                  JOIN questions question ON question.id = CAST(entry.key AS integer)
                  WHERE answer.type <> 'integer' OR answer.value < 0
                    OR answer.value >= json_array_length(question.choices)
                ) ELSE 1 END)
            OR EXISTS (SELECT 1 FROM json_each(session.descriptive_answers) entry
              WHERE entry.type <> 'text' OR NOT EXISTS (
                SELECT 1 FROM json_each(session.question_ids) item
                WHERE CAST(item.value AS text) = entry.key))
            OR EXISTS (SELECT 1 FROM json_each(session.descriptive_scores) entry
              WHERE entry.type NOT IN ('integer', 'real', 'null')
                OR (entry.type <> 'null' AND (entry.value < 0 OR entry.value > 100))
                OR NOT EXISTS (SELECT 1 FROM json_each(session.question_ids) item
                  WHERE CAST(item.value AS text) = entry.key))
            OR EXISTS (SELECT 1 FROM json_each(session.descriptive_snapshots) entry
              WHERE entry.type <> 'text' OR NOT EXISTS (
                SELECT 1 FROM json_each(session.question_ids) item
                WHERE CAST(item.value AS text) = entry.key))
            OR EXISTS (SELECT 1 FROM json_each(session.flagged) entry
              WHERE entry.type <> 'integer' OR NOT EXISTS (
                SELECT 1 FROM json_each(session.question_ids) item
                WHERE item.value = entry.value))
          )
      `),
      inconsistentExamSessionItems: scalar(database, `
        SELECT COUNT(*) AS count FROM exam_session_items item
        JOIN exam_sessions session ON session.id = item.session_id
        JOIN questions q ON q.id = item.question_id
        WHERE item.position < 0 OR item.revision < 0 OR item.flagged NOT IN (0, 1)
          OR item.descriptive_score < 0 OR item.descriptive_score > 100
          OR CASE WHEN json_valid(item.selected_answers)
            THEN json_type(item.selected_answers) <> 'array'
              OR EXISTS (SELECT 1 FROM json_each(item.selected_answers) answer
                WHERE answer.type <> 'integer' OR answer.value < 0
                  OR (json_valid(q.choices) AND json_type(q.choices) = 'array'
                    AND answer.value >= json_array_length(q.choices)))
            ELSE 1 END
          OR NOT (json_valid(session.question_ids) AND json_type(session.question_ids) = 'array')
          OR json_extract(session.question_ids, '$[' || item.position || ']') <> item.question_id
      `),
      incompleteExamSessionItems: scalar(database, `
        SELECT COUNT(*) AS count FROM exam_sessions session
        WHERE json_valid(session.question_ids) AND json_type(session.question_ids) = 'array'
          AND EXISTS (SELECT 1 FROM json_each(session.question_ids) expected
            WHERE NOT EXISTS (SELECT 1 FROM exam_session_items item
              WHERE item.session_id = session.id AND item.position = expected.key
                AND item.question_id = expected.value))
      `),
      invalidActiveExamPointers: scalar(database, `
        SELECT COUNT(*) AS count FROM exam_active_sessions active
        LEFT JOIN exam_sessions session ON session.id = active.session_id
        WHERE session.id IS NULL OR session.user_key <> active.user_key
          OR session.exam_type <> active.exam_type OR session.status NOT IN ('active', 'grading')
      `),
      unleasedActiveExamSessions: scalar(database, `
        SELECT COUNT(*) AS count FROM exam_sessions session
        LEFT JOIN exam_active_sessions active ON active.session_id = session.id
        WHERE session.status IN ('active', 'grading') AND active.session_id IS NULL
      `),
      invalidSwAttemptState: scalar(database, `
        SELECT COUNT(*) AS count FROM sw_attempts attempt
        JOIN sw_questions q ON q.id = attempt.question_id
        WHERE CASE WHEN json_valid(attempt.selected_answers)
          THEN json_type(attempt.selected_answers) <> 'array'
            OR EXISTS (SELECT 1 FROM json_each(attempt.selected_answers) answer
              WHERE answer.type <> 'integer' OR answer.value < 0
                OR (json_valid(q.choices) AND json_type(q.choices) = 'array'
                  AND answer.value >= json_array_length(q.choices)))
          ELSE 1 END
          OR attempt.correct NOT IN (0, 1) OR attempt.mode NOT IN ('practice', 'mock')
          OR length(trim(attempt.client_operation_id)) = 0
      `),
      invalidSwSessionState: invalidJsonShape(database, "sw_learning_sessions", [
        ["subject_ids", "array"], ["question_ids", "array"], ["answers", "object"],
        ["revealed_question_ids", "array"], ["result", "object"],
      ]) + scalar(database, `
        SELECT COUNT(*) AS count FROM sw_learning_sessions
        WHERE current_index < 0 OR revision < 0
          OR (json_valid(question_ids) AND json_type(question_ids) = 'array'
            AND ((json_array_length(question_ids) = 0 AND current_index <> 0)
              OR (json_array_length(question_ids) > 0 AND current_index >= json_array_length(question_ids))))
      `),
      invalidSwSessionQuestionSet: scalar(database, `
        SELECT COUNT(*) AS count FROM sw_learning_sessions session
        WHERE json_valid(session.question_ids) AND json_type(session.question_ids) = 'array'
          AND EXISTS (SELECT 1 FROM json_each(session.question_ids) item
            LEFT JOIN sw_questions q ON q.id = item.value
            WHERE item.type <> 'text' OR q.id IS NULL OR q.active <> 1)
      `),
      invalidSwSessionMaps: scalar(database, `
        SELECT COUNT(*) AS count FROM sw_learning_sessions session
        WHERE json_valid(session.question_ids) AND json_type(session.question_ids) = 'array'
          AND json_valid(session.answers) AND json_type(session.answers) = 'object'
          AND json_valid(session.revealed_question_ids)
          AND json_type(session.revealed_question_ids) = 'array'
          AND (
            EXISTS (SELECT 1 FROM json_each(session.answers) entry
              WHERE NOT EXISTS (SELECT 1 FROM json_each(session.question_ids) item
                  WHERE item.value = entry.key)
                OR CASE WHEN entry.type = 'array' THEN EXISTS (
                  SELECT 1 FROM json_each(entry.value) answer
                  JOIN sw_questions question ON question.id = entry.key
                  WHERE answer.type <> 'integer' OR answer.value < 0
                    OR answer.value >= json_array_length(question.choices)
                ) ELSE 1 END)
            OR EXISTS (SELECT 1 FROM json_each(session.revealed_question_ids) entry
              WHERE entry.type <> 'text' OR NOT EXISTS (
                SELECT 1 FROM json_each(session.question_ids) item
                WHERE item.value = entry.value))
          )
      `),
    },
    operationalState: {
      invalidBackupMetadata: scalar(database, `
        SELECT COUNT(*) AS count FROM backup_snapshots
        WHERE status NOT IN ('creating', 'completed', 'failed')
          OR backup_type NOT IN ('content', 'progress', 'settings', 'full', 'auto-full')
          OR byte_size < 0
          OR CASE WHEN json_valid(included_data) THEN json_type(included_data) <> 'array' ELSE 1 END
          OR CASE WHEN json_valid(counts) THEN json_type(counts) <> 'object' ELSE 1 END
          OR (status = 'completed' AND (length(checksum) <> 64 OR byte_size = 0))
      `),
      invalidBackupChunks: scalar(database, `
        SELECT COUNT(*) AS count FROM (
          SELECT snapshot_id FROM backup_chunks
          GROUP BY snapshot_id
          HAVING MIN(chunk_index) <> 0 OR MAX(chunk_index) + 1 <> COUNT(*)
        ) broken
      `),
      invalidContentReleaseRegistry: scalar(database, `
        SELECT COUNT(*) AS count FROM content_releases
        WHERE status NOT IN ('pending', 'verified', 'active', 'failed')
          OR expected_question_count < 0 OR imported_question_count < 0
          OR expected_theory_count < 0 OR imported_theory_count < 0
          OR (status = 'active' AND (
            expected_question_count <> imported_question_count
            OR expected_theory_count <> imported_theory_count
            OR length(source_checksum) <> 64 OR length(question_checksum) <> 64
            OR length(theory_checksum) <> 64))
      `),
      invalidAnalyticsEvents: scalar(database, `SELECT COUNT(*) AS count FROM analytics_events
        WHERE event_type NOT IN (
          'page_view', 'question_session_started', 'question_answer_submitted',
          'question_session_completed', 'theory_viewed', 'related_questions_started',
          'mock_exam_page_viewed', 'mock_exam_started', 'mock_exam_completed',
          'mock_exam_abandoned', 'mock_exam_paused', 'application_error',
          'web_vital', 'api_timing'
        ) OR is_admin NOT IN (0, 1)
          OR device_category NOT IN ('mobile', 'tablet', 'desktop', 'unknown')
          OR browser_family NOT IN ('Safari', 'Chrome', 'Edge', 'Firefox', 'Other', 'unknown')
          OR (answer_result IS NOT NULL AND answer_result NOT IN ('correct', 'partial', 'incorrect'))
          OR duration_ms < 0 OR retry_count < 0
          OR (http_status IS NOT NULL AND (http_status < 100 OR http_status > 599))`),
      invalidAdminAuditLogs: scalar(database, `SELECT COUNT(*) AS count FROM admin_audit_logs
        WHERE success NOT IN (0, 1)
          OR CASE WHEN json_valid(before_summary) THEN json_type(before_summary) <> 'object' ELSE 1 END
          OR CASE WHEN json_valid(after_summary) THEN json_type(after_summary) <> 'object' ELSE 1 END`),
      invalidMaintenanceRuns: scalar(database, `SELECT COUNT(*) AS count FROM maintenance_runs
        WHERE consecutive_failures < 0`),
      invalidReports: scalar(database, `SELECT COUNT(*) AS count FROM user_reports
        WHERE category NOT IN ('bug', 'improvement', 'content')
          OR status NOT IN ('new', 'reviewing', 'resolved')`),
      invalidSiteSettings: scalar(database, `SELECT COUNT(*) AS count FROM site_settings
        WHERE value_type NOT IN ('string', 'number', 'boolean')
          OR (value_type = 'number' AND CASE WHEN json_valid(value)
            THEN json_type(value) NOT IN ('integer', 'real') ELSE 1 END)
          OR (value_type = 'boolean' AND value NOT IN ('true', 'false'))`),
      invalidSystemErrors: scalar(database, `SELECT COUNT(*) AS count FROM system_errors
        WHERE status NOT IN ('open', 'resolved', 'ignored') OR occurrence_count < 1`),
    },
    completedBackups: scalar(database, "SELECT COUNT(*) AS count FROM backup_snapshots WHERE status = 'completed'"),
    activeContentReleases: scalar(database, "SELECT COUNT(*) AS count FROM content_releases WHERE status = 'active'"),
  };

  const report = {
    database: options.databaseLabel ?? ":memory:",
    schemaVersion: database.prepare(
      "SELECT migration_version FROM app_schema_state WHERE id = 1",
    ).get()?.migration_version ?? null,
    canonicalContent: {
      questionCount,
      questionSha256,
      theoryCount,
      theorySha256,
    },
    integrity,
  };
  const failures = [];
  if (report.schemaVersion !== EXPECTED_SCHEMA_VERSION) {
    failures.push(`schema version is not ${EXPECTED_SCHEMA_VERSION}`);
  }
  if (integrity.foreignKeyViolations > 0) failures.push("foreign-key violations exist");
  if (!integrity.courseRegistry.contentScopesMatch || !integrity.courseRegistry.subjectsMatch) {
    failures.push("database course registry differs from the canonical source");
  }
  if (invalidQuestionJson > 0 || invalidSwQuestionJson > 0) failures.push("invalid JSON exists");
  if (integrity.orphanedSwQuestions > 0) failures.push("orphaned SW questions exist");
  if (anyPositive(integrity.orphanedUserRows)) failures.push("orphaned user-owned rows exist");
  if (anyPositive(integrity.invalidDomainValues)) failures.push("invalid domain values exist");
  if (anyPositive(integrity.contentState)) failures.push("invalid content state exists");
  if (anyPositive(integrity.learnerState)) failures.push("invalid learner state exists");
  if (anyPositive(integrity.operationalState)) failures.push("invalid operational state exists");
  if (integrity.swTagIndex.indexedCount !== integrity.swTagIndex.expectedCount
    || integrity.swTagIndex.staleCount > 0) failures.push("SW tag index parity failed");
  if (integrity.informationProcessingEngineerQuestions === 0) {
    failures.push("IPE profile has no questions");
  }
  if (integrity.activeContentReleases !== 1 || !activeRelease) {
    failures.push("exactly one active content release is required");
  } else if (activeRelease.schema_version !== CONTENT_SCHEMA_VERSION
    || Number(activeRelease.imported_question_count) !== questionCount
    || Number(activeRelease.imported_theory_count) !== theoryCount
    || activeRelease.question_checksum !== questionSha256
    || activeRelease.theory_checksum !== theorySha256) {
    failures.push("active content release differs from canonical content");
  }
  return { failures, report };
}
