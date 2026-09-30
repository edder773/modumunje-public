import { submissionQuery, subjectSubmissionCounts, type SubmissionRow } from "./admin-submission-query";
import { adminRepository } from "./admin.repository";
import { certificationAdminField } from "@shared/admin/content-domains";
import {
  type D1Row,
  MAX_PAGE_SIZE,
  SETTING_DEFAULTS,
  SETTING_RULES,
  allRows,
  analyticsAdminClause,
  boundedInteger,
  compactText,
  firstRow,
  integer,
  jsonList,
  numberList,
  parseQuestionRow,
  parseTheoryRow,
  readAdminOperationalStatus,
  readRange,
  safeJson,
  searchTokens,
  sqlLike,
  startOfKoreanDay,
  uniqueStrings,
} from "./admin-use-case-runtime";
import { backupStorageStatus } from "./backup-storage";
import { readAuditSummary } from "@backend/common/observability";
import { contentScopesForField } from "@shared/study/study-domain";
import { COURSE_FIELD_DEFINITIONS } from "@shared/study/course-contract.mjs";
import {
  adminActivityTrendBindings,
  adminActivityTrendQuery,
} from "./admin-activity-trend-query";

function appendContentDomainFilter(
  url: URL,
  column: string,
  where: string[],
  values: unknown[],
) {
  const domain = url.searchParams.get("contentDomain");
  const fieldId = certificationAdminField(domain);
  if (!fieldId) return;
  const scopes = contentScopesForField(fieldId);
  where.push(`${column} IN (${scopes.map(() => "?").join(",")})`);
  values.push(...scopes);
}

type DashboardContentBreakdown = {
  field: string;
  totalQuestions: number;
  activeQuestions: number;
  totalTheories: number;
  activeTheories: number;
  questionAttempts: number;
  totalQuestionAttempts: number;
};

const CERTIFICATION_DASHBOARD_FIELDS = COURSE_FIELD_DEFINITIONS
  .filter((field) => field.engineId === "certification" && field.status === "available")
  .map((field) => ({
    field: field.cardTitle,
    contentScopes: contentScopesForField(field.id),
  }));

async function readCertificationDashboardFields(
  period: { start: string; end: string },
  excludeAdmin: boolean,
): Promise<DashboardContentBreakdown[]> {
  const attemptAdminClause = excludeAdmin ? "AND a.is_admin = 0" : "";
  const [questionsResult, theoriesResult, periodAttemptsResult, totalAttemptsResult] = await adminRepository.readBatch([
    { sql: `
      SELECT exam_scope, COUNT(*) AS total, SUM(active = 1) AS active
      FROM questions
      GROUP BY exam_scope
    ` },
    { sql: `
      SELECT exam_scope, COUNT(*) AS total, SUM(active = 1) AS active
      FROM theories
      GROUP BY exam_scope
    ` },
    { sql: `
      SELECT q.exam_scope, COUNT(*) AS count
      FROM attempts a
      JOIN questions q ON q.id = a.question_id
      WHERE q.kind != 'descriptive'
        AND a.created_at BETWEEN ? AND ?
        ${attemptAdminClause}
      GROUP BY q.exam_scope
    `, values: [period.start, period.end] },
    { sql: `
      SELECT q.exam_scope, COUNT(*) AS count
      FROM attempts a
      JOIN questions q ON q.id = a.question_id
      WHERE q.kind != 'descriptive'
        ${attemptAdminClause}
      GROUP BY q.exam_scope
    ` },
  ]);
  const questions = (questionsResult?.results ?? []) as D1Row[];
  const theories = (theoriesResult?.results ?? []) as D1Row[];
  const periodAttempts = (periodAttemptsResult?.results ?? []) as D1Row[];
  const totalAttempts = (totalAttemptsResult?.results ?? []) as D1Row[];
  const sumForScopes = (rows: D1Row[], scopes: Set<string>, key: string) => rows.reduce(
    (sum, row) => scopes.has(String(row.exam_scope)) ? sum + Number(row[key] ?? 0) : sum,
    0,
  );
  return CERTIFICATION_DASHBOARD_FIELDS.map((definition) => {
    const scopes = new Set<string>(definition.contentScopes);
    return {
      field: definition.field,
      totalQuestions: sumForScopes(questions, scopes, "total"),
      activeQuestions: sumForScopes(questions, scopes, "active"),
      totalTheories: sumForScopes(theories, scopes, "total"),
      activeTheories: sumForScopes(theories, scopes, "active"),
      questionAttempts: sumForScopes(periodAttempts, scopes, "count"),
      totalQuestionAttempts: sumForScopes(totalAttempts, scopes, "count"),
    };
  });
}

export async function readQuestionList(url: URL) {
  const page = boundedInteger(url.searchParams.get("page"), 1, 999999, 1);
  const pageSize = boundedInteger(
    url.searchParams.get("pageSize"),
    10,
    MAX_PAGE_SIZE,
    25,
  );
  const where = ["1 = 1"];
  const values: unknown[] = [];
  appendContentDomainFilter(url, "q.exam_scope", where, values);
  const focusId = integer(url.searchParams.get("id"));
  if (focusId) {
    where.push("q.id = ?");
    values.push(focusId);
  }
  const search = (url.searchParams.get("search") ?? "").trim();
  const filters = {
    examScope: url.searchParams.get("examScope") ?? "",
    category: url.searchParams.get("category") ?? "",
    topic: url.searchParams.get("topic") ?? "",
    kind: url.searchParams.get("kind") ?? "",
    difficulty: url.searchParams.get("difficulty") ?? "",
    active: url.searchParams.get("active") ?? "",
  };
  for (const token of searchTokens(search)) {
    where.push(`(
      q.prompt LIKE ? ESCAPE '\\'
      OR q.topic LIKE ? ESCAPE '\\'
      OR q.tags LIKE ? ESCAPE '\\'
      OR CAST(q.id AS TEXT) LIKE ? ESCAPE '\\'
      OR CAST(q.display_order AS TEXT) LIKE ? ESCAPE '\\'
    )`);
    const term = sqlLike(token);
    values.push(term, term, term, term, term);
  }
  for (const [column, value] of [
    ["q.exam_scope", filters.examScope],
    ["q.category", filters.category],
    ["q.topic", filters.topic],
    ["q.kind", filters.kind],
    ["q.difficulty", filters.difficulty],
  ]) {
    if (value) {
      where.push(`${column} = ?`);
      values.push(value);
    }
  }
  if (filters.active === "active" || filters.active === "inactive") {
    where.push("q.active = ?");
    values.push(filters.active === "active" ? 1 : 0);
  }

  const clause = where.join(" AND ");
  const [count, rows] = await Promise.all([
    firstRow<{ total: number }>(
      `SELECT COUNT(*) AS total FROM questions q WHERE ${clause}`,
      values,
    ),
    allRows(`
      WITH page_questions AS (
        SELECT q.*
        FROM questions q
        WHERE ${clause}
        ORDER BY q.active DESC, q.display_order ASC, q.id ASC
        LIMIT ? OFFSET ?
      ), attempt_stats AS (
        SELECT
          a.question_id,
          COUNT(*) AS total_attempts,
          SUM(a.result = 'correct') AS correct_attempts,
          SUM(a.result IN ('incorrect', 'partial')) AS incorrect_attempts,
          SUM(a.review_status != 'mastered') AS wrong_note_count,
          MAX(a.created_at) AS last_attempt_at
        FROM attempts a
        INNER JOIN page_questions page ON page.id = a.question_id
        GROUP BY a.question_id
      ), duration_stats AS (
        SELECT e.question_id, ROUND(AVG(e.duration_ms) / 1000.0, 1) AS average_duration_seconds
        FROM analytics_events e
        INNER JOIN page_questions page ON page.id = e.question_id
        WHERE e.event_type = 'question_answer_submitted'
          AND e.duration_ms IS NOT NULL
        GROUP BY e.question_id
      ), evaluation_error_stats AS (
        SELECT se.question_id, COUNT(*) AS ai_evaluation_errors
        FROM system_errors se
        INNER JOIN page_questions page ON page.id = se.question_id
        WHERE se.error_type LIKE '%evaluation%'
        GROUP BY se.question_id
      )
      SELECT
        q.*,
        t.title AS theory_title,
        COALESCE(a.total_attempts, 0) AS total_attempts,
        COALESCE(a.correct_attempts, 0) AS correct_attempts,
        COALESCE(a.incorrect_attempts, 0) AS incorrect_attempts,
        ROUND(
          100.0 * a.correct_attempts / NULLIF(a.total_attempts, 0),
          1
        ) AS correctness_rate,
        COALESCE(a.wrong_note_count, 0) AS wrong_note_count,
        a.last_attempt_at,
        d.average_duration_seconds,
        COALESCE(se.ai_evaluation_errors, 0) AS ai_evaluation_errors
      FROM page_questions q
      LEFT JOIN theories t ON t.id = q.theory_id
      LEFT JOIN attempt_stats a ON a.question_id = q.id
      LEFT JOIN duration_stats d ON d.question_id = q.id
      LEFT JOIN evaluation_error_stats se ON se.question_id = q.id
      ORDER BY q.active DESC, q.display_order ASC, q.id ASC
    `, [...values, pageSize, (page - 1) * pageSize]),
  ]);

  return {
    items: rows.map(parseQuestionRow),
    pagination: {
      page,
      pageSize,
      total: Number(count?.total ?? 0),
      pages: Math.max(1, Math.ceil(Number(count?.total ?? 0) / pageSize)),
    },
  };
}

export async function readTheoryList(url: URL) {
  const page = boundedInteger(url.searchParams.get("page"), 1, 999999, 1);
  const summaryOnly = url.searchParams.get("view") === "summary";
  const pageSize = boundedInteger(
    url.searchParams.get("pageSize"),
    10,
    summaryOnly ? 20 : MAX_PAGE_SIZE,
    summaryOnly ? 20 : 25,
  );
  const columns = summaryOnly
    ? "t.id, t.title, t.category, t.topic, t.sort_order, t.exam_scope, t.active, t.summary"
    : "t.*";
  const where = ["1 = 1"];
  const values: unknown[] = [];
  appendContentDomainFilter(url, "t.exam_scope", where, values);
  const focusId = integer(url.searchParams.get("id"));
  if (focusId) {
    where.push("t.id = ?");
    values.push(focusId);
  }
  const search = (url.searchParams.get("search") ?? "").trim();
  for (const token of searchTokens(search)) {
    where.push("(t.title LIKE ? ESCAPE '\\' OR t.summary LIKE ? ESCAPE '\\' OR t.keywords LIKE ? ESCAPE '\\')");
    const term = sqlLike(token);
    values.push(term, term, term);
  }
  for (const [column, value] of [
    ["t.exam_scope", url.searchParams.get("examScope") ?? ""],
    ["t.category", url.searchParams.get("category") ?? ""],
    ["t.topic", url.searchParams.get("topic") ?? ""],
  ]) {
    if (value) {
      where.push(`${column} = ?`);
      values.push(value);
    }
  }
  const active = url.searchParams.get("active");
  if (active === "active" || active === "inactive") {
    where.push("t.active = ?");
    values.push(active === "active" ? 1 : 0);
  }
  const linked = url.searchParams.get("linked");
  if (linked === "none") {
    where.push("NOT EXISTS (SELECT 1 FROM questions q WHERE q.theory_id = t.id AND q.active = 1)");
  } else if (linked === "available") {
    where.push("EXISTS (SELECT 1 FROM questions q WHERE q.theory_id = t.id AND q.active = 1)");
  }
  const clause = where.join(" AND ");
  const [count, rows] = await Promise.all([
    firstRow<{ total: number }>(
      `SELECT COUNT(*) AS total FROM theories t WHERE ${clause}`,
      values,
    ),
    allRows(`
      WITH page_theories AS (
        SELECT ${columns}
        FROM theories t
        WHERE ${clause}
        ORDER BY t.active DESC, t.category ASC, t.sort_order ASC, t.id ASC
        LIMIT ? OFFSET ?
      ), question_stats AS (
        SELECT q.theory_id, COUNT(*) AS linked_questions
        FROM questions q
        INNER JOIN page_theories page ON page.id = q.theory_id
        WHERE q.active = 1
        GROUP BY q.theory_id
      ), activity_stats AS (
        SELECT
          CAST(SUBSTR(e.page_path, LENGTH('/theory/') + 1) AS INTEGER) AS theory_id,
          SUM(e.event_type = 'theory_viewed') AS view_count,
          SUM(e.event_type = 'related_questions_started') AS related_starts
        FROM analytics_events e
        INNER JOIN page_theories page
          ON e.page_path = '/theory/' || page.id AND e.subject = page.category
        WHERE e.question_id IS NULL
          AND e.event_type IN ('theory_viewed', 'related_questions_started')
        GROUP BY e.page_path
      )
      SELECT
        t.*,
        COALESCE(q.linked_questions, 0) AS linked_questions,
        COALESCE(a.view_count, 0) AS view_count,
        COALESCE(a.related_starts, 0) AS related_starts
      FROM page_theories t
      LEFT JOIN question_stats q ON q.theory_id = t.id
      LEFT JOIN activity_stats a ON a.theory_id = t.id
      ORDER BY t.active DESC, t.category ASC, t.sort_order ASC, t.id ASC
    `, [...values, pageSize, (page - 1) * pageSize]),
  ]);
  return {
    items: summaryOnly ? rows.map((row) => ({
      id: Number(row.id),
      title: String(row.title),
      category: String(row.category),
      topic: String(row.topic),
      sortOrder: Number(row.sort_order),
      examScope: String(row.exam_scope),
      active: Boolean(row.active),
      summary: String(row.summary),
      linkedQuestions: Number(row.linked_questions ?? 0),
      viewCount: Number(row.view_count ?? 0),
    })) : rows.map(parseTheoryRow),
    pagination: {
      page,
      pageSize,
      total: Number(count?.total ?? 0),
      pages: Math.max(1, Math.ceil(Number(count?.total ?? 0) / pageSize)),
    },
  };
}

export async function readSwQuestionList(url: URL) {
  const page = boundedInteger(url.searchParams.get("page"), 1, 999999, 1);
  const pageSize = boundedInteger(url.searchParams.get("pageSize"), 10, MAX_PAGE_SIZE, 20);
  const offset = (page - 1) * pageSize;
  const where = ["1 = 1"];
  const values: unknown[] = [];
  const focusId = (url.searchParams.get("id") ?? "").trim();
  if (focusId) { where.push("q.id = ?"); values.push(focusId); }
  const search = (url.searchParams.get("search") ?? "").trim();
  for (const token of searchTokens(search)) {
    where.push("(q.id LIKE ? ESCAPE '\\' OR q.prompt LIKE ? ESCAPE '\\' OR q.category LIKE ? ESCAPE '\\' OR q.topic LIKE ? ESCAPE '\\')");
    const pattern = sqlLike(token);
    values.push(pattern, pattern, pattern, pattern);
  }
  for (const [column, value] of [
    ["q.subject_group_id", url.searchParams.get("subjectGroupId") ?? ""],
    ["q.subject_id", url.searchParams.get("subjectId") ?? ""],
    ["q.difficulty", url.searchParams.get("difficulty") ?? ""],
  ] as const) {
    if (value) { where.push(`${column} = ?`); values.push(value); }
  }
  const active = url.searchParams.get("active");
  if (active === "active") where.push("q.active = 1");
  if (active === "inactive") where.push("q.active = 0");
  const clause = where.join(" AND ");
  const [count, rows] = await Promise.all([
    firstRow<{ total: number }>(`SELECT COUNT(*) AS total FROM sw_questions q WHERE ${clause}`, values),
    allRows(`
      SELECT q.*, t.title AS theory_title
      FROM sw_questions q
      LEFT JOIN sw_theories t ON t.id = q.theory_id
      WHERE ${clause}
      ORDER BY q.display_order, q.id
      LIMIT ? OFFSET ?
    `, [...values, pageSize, offset]),
  ]);
  const total = Number(count?.total ?? 0);
  return {
    items: rows.map((row) => ({
      ...row,
      theoryId: Number(row.theory_id),
      subjectGroupId: String(row.subject_group_id),
      subjectId: String(row.subject_id),
      displayOrder: Number(row.display_order),
      difficultyRationale: String(row.difficulty_rationale ?? ""),
      choices: jsonList(row.choices).map(String),
      correctAnswers: numberList(row.correct_answers),
      tags: uniqueStrings(row.tags),
      requiredConcepts: uniqueStrings(row.required_concepts),
      active: Boolean(row.active),
    })),
    pagination: { page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}

export async function readSwTheoryAdminList(url: URL) {
  const page = boundedInteger(url.searchParams.get("page"), 1, 999999, 1);
  const summaryOnly = url.searchParams.get("view") === "summary";
  const pageSize = boundedInteger(url.searchParams.get("pageSize"), 10, summaryOnly ? 20 : MAX_PAGE_SIZE, 20);
  const offset = (page - 1) * pageSize;
  const columns = summaryOnly
    ? "t.id, t.title, t.category, t.topic, t.sort_order, t.subject_group_id, t.subject_id, t.active, t.summary"
    : "t.*";
  const where = ["1 = 1"];
  const values: unknown[] = [];
  const focusId = integer(url.searchParams.get("id"));
  if (focusId) { where.push("t.id = ?"); values.push(focusId); }
  const search = (url.searchParams.get("search") ?? "").trim();
  for (const token of searchTokens(search)) {
    where.push("(CAST(t.id AS TEXT) LIKE ? ESCAPE '\\' OR t.title LIKE ? ESCAPE '\\' OR t.summary LIKE ? ESCAPE '\\' OR t.category LIKE ? ESCAPE '\\' OR t.topic LIKE ? ESCAPE '\\')");
    const pattern = sqlLike(token);
    values.push(pattern, pattern, pattern, pattern, pattern);
  }
  for (const [column, value] of [
    ["t.subject_group_id", url.searchParams.get("subjectGroupId") ?? ""],
    ["t.subject_id", url.searchParams.get("subjectId") ?? ""],
  ] as const) {
    if (value) { where.push(`${column} = ?`); values.push(value); }
  }
  const active = url.searchParams.get("active");
  if (active === "active") where.push("t.active = 1");
  if (active === "inactive") where.push("t.active = 0");
  const clause = where.join(" AND ");
  const [count, rows] = await Promise.all([
    firstRow<{ total: number }>(`SELECT COUNT(*) AS total FROM sw_theories t WHERE ${clause}`, values),
    allRows(`
      SELECT ${columns}, (
        SELECT COUNT(*) FROM sw_questions q WHERE q.theory_id = t.id AND q.active = 1
      ) AS linked_questions
      FROM sw_theories t
      WHERE ${clause}
      ORDER BY t.sort_order, t.id
      LIMIT ? OFFSET ?
    `, [...values, pageSize, offset]),
  ]);
  const total = Number(count?.total ?? 0);
  return {
    items: rows.map((row) => summaryOnly ? {
      id: Number(row.id),
      subjectGroupId: String(row.subject_group_id),
      subjectId: String(row.subject_id),
      category: String(row.category),
      topic: String(row.topic),
      title: String(row.title),
      summary: String(row.summary),
      sortOrder: Number(row.sort_order),
      active: Boolean(row.active),
      linkedQuestions: Number(row.linked_questions ?? 0),
    } : {
      ...row,
      id: Number(row.id),
      subjectGroupId: String(row.subject_group_id),
      subjectId: String(row.subject_id),
      sortOrder: Number(row.sort_order),
      reviewAnswers: String(row.review_answers ?? ""),
      keywords: uniqueStrings(row.keywords),
      active: Boolean(row.active),
      linkedQuestions: Number(row.linked_questions ?? 0),
    }),
    pagination: { page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}

export async function readDashboard(url: URL, adminLearnerKey: string) {
  const period = readRange(url);
  const excludeAdmin = url.searchParams.get("excludeAdmin") !== "false";
  const adminClause = analyticsAdminClause(excludeAdmin);
  const swAttemptAdminClause = excludeAdmin ? "AND sa.user_key != ?" : "";
  const swPeriodBindings = excludeAdmin
    ? [period.start, period.end, adminLearnerKey]
    : [period.start, period.end];
  const swTotalBindings = excludeAdmin ? [adminLearnerKey] : [];
  const now = new Date();
  const dailyStart = startOfKoreanDay(now).toISOString();
  const monthlyStart = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const [mainResults, certificationContentBreakdown, operationalStatus] = await Promise.all([
    adminRepository.readBatch([
    { sql: `
      SELECT COUNT(DISTINCT e.anonymous_session_id) AS count
      FROM analytics_events e
      WHERE e.event_type = 'page_view'
        AND e.occurred_at BETWEEN ? AND ?${adminClause}
    `, values: [dailyStart, now.toISOString()] },
    { sql: `
      SELECT COUNT(DISTINCT e.anonymous_session_id) AS count
      FROM analytics_events e
      WHERE e.event_type = 'page_view'
        AND e.occurred_at BETWEEN ? AND ?${adminClause}
    `, values: [monthlyStart, now.toISOString()] },
    { sql: `
      SELECT COUNT(DISTINCT e.anonymous_session_id) AS count
      FROM analytics_events e
      WHERE e.event_type = 'page_view'
        AND e.occurred_at BETWEEN ? AND ?${adminClause}
    `, values: [period.start, period.end] },
    { sql: `
      SELECT COUNT(*) AS total, SUM(active = 1) AS active FROM sw_questions
    ` },
    { sql: `
      SELECT COUNT(*) AS total, SUM(active = 1) AS active FROM sw_theories
    ` },
    { sql: `
      SELECT COUNT(*) AS count
      FROM sw_attempts sa
      WHERE sa.created_at BETWEEN ? AND ?
        ${swAttemptAdminClause}
    `, values: swPeriodBindings },
    { sql: `
      SELECT COUNT(*) AS count
      FROM sw_attempts sa
      WHERE 1 = 1 ${swAttemptAdminClause}
    `, values: swTotalBindings },
    { sql: `
      SELECT COUNT(*) AS count FROM system_errors
      WHERE status = 'open' AND created_at BETWEEN ? AND ?
    `, values: [period.start, period.end] },
    { sql: `
      SELECT created_at FROM backup_snapshots
      WHERE status = 'completed'
      ORDER BY created_at DESC LIMIT 1
    ` },
    { sql: `
      SELECT * FROM (
        SELECT CAST(id AS TEXT) AS id, prompt, category, created_at,
          CASE WHEN exam_scope IN ('DASP', 'DAP', 'DA') THEN 'DA' WHEN exam_scope = 'BAE' THEN '빅분기' WHEN exam_scope IN ('IPEW', 'IPEP') THEN '정보처리' WHEN exam_scope IN ('ISEW', 'ISEP') THEN '정보보안' ELSE 'SQL' END AS field
        FROM questions
        UNION ALL
        SELECT id, prompt, category, created_at, 'SW' AS field
        FROM sw_questions
      ) ORDER BY created_at DESC, id DESC LIMIT 6
    ` },
    { sql: `
      SELECT * FROM (
        SELECT CAST(id AS TEXT) AS id, title, category, updated_at,
          CASE WHEN exam_scope IN ('DASP', 'DAP', 'DA') THEN 'DA' WHEN exam_scope = 'BAE' THEN '빅분기' WHEN exam_scope IN ('IPEW', 'IPEP') THEN '정보처리' WHEN exam_scope IN ('ISEW', 'ISEP') THEN '정보보안' ELSE 'SQL' END AS field
        FROM theories
        UNION ALL
        SELECT CAST(id AS TEXT) AS id, title, category, updated_at, 'SW' AS field
        FROM sw_theories
      ) ORDER BY updated_at DESC, id DESC LIMIT 6
    ` },
    { sql: `
      SELECT id, action, target_type, target_id, success, created_at
      FROM admin_audit_logs ORDER BY created_at DESC LIMIT 6
    ` },
    { sql: `
      SELECT error_type, page_path, impact, status, message, created_at
      FROM system_errors ORDER BY created_at DESC LIMIT 5
    ` },
    { sql: `
      SELECT id, backup_type, status, byte_size, created_at
      FROM backup_snapshots ORDER BY created_at DESC LIMIT 4
    ` },
    { sql: adminActivityTrendQuery(excludeAdmin),
      values: adminActivityTrendBindings(now, excludeAdmin, adminLearnerKey) },
    ]),
    readCertificationDashboardFields(period, excludeAdmin),
    readAdminOperationalStatus(period, excludeAdmin),
  ]);
  const first = (index: number) => (mainResults[index]?.results ?? [])[0] as D1Row | undefined;
  const all = (index: number) => (mainResults[index]?.results ?? []) as D1Row[];
  const dailyActiveUsers = first(0);
  const monthlyActiveUsers = first(1);
  const visitors = first(2);
  const swQuestionCounts = first(3);
  const swTheoryCounts = first(4);
  const swAttemptsPeriod = first(5);
  const swAttemptsTotal = first(6);
  const errorCount = first(7);
  const lastBackup = first(8);
  const recentQuestions = all(9);
  const recentTheories = all(10);
  const recentAudits = all(11);
  const recentErrors = all(12);
  const recentBackups = all(13);
  const activityTrend = all(14);
  const swContentBreakdown: DashboardContentBreakdown = {
    field: "SW 전공",
    totalQuestions: Number(swQuestionCounts?.total ?? 0),
    activeQuestions: Number(swQuestionCounts?.active ?? 0),
    totalTheories: Number(swTheoryCounts?.total ?? 0),
    activeTheories: Number(swTheoryCounts?.active ?? 0),
    questionAttempts: Number(swAttemptsPeriod?.count ?? 0),
    totalQuestionAttempts: Number(swAttemptsTotal?.count ?? 0),
  };
  const contentBreakdown = [
    ...certificationContentBreakdown,
    swContentBreakdown,
  ];

  return {
    period,
    excludeAdmin,
    ...operationalStatus,
    metrics: {
      dailyActiveUsers: Number(dailyActiveUsers?.count ?? 0),
      monthlyActiveUsers: Number(monthlyActiveUsers?.count ?? 0),
      visitors: Number(visitors?.count ?? 0),
      totalQuestions: contentBreakdown.reduce((sum, item) => sum + item.totalQuestions, 0),
      activeQuestions: contentBreakdown.reduce((sum, item) => sum + item.activeQuestions, 0),
      totalTheories: contentBreakdown.reduce((sum, item) => sum + item.totalTheories, 0),
      questionAttempts: contentBreakdown.reduce((sum, item) => sum + item.questionAttempts, 0),
      totalQuestionAttempts: contentBreakdown.reduce(
        (sum, item) => sum + item.totalQuestionAttempts,
        0,
      ),
      recentErrors: Number(errorCount?.count ?? 0),
      lastBackupAt: lastBackup?.created_at ?? null,
    },
    contentBreakdown,
    recent: {
      questions: recentQuestions.map((row: D1Row) => ({
        ...row,
        prompt: compactText(String(row.prompt ?? "").replace(/<!--[\s\S]*?(?:-->|$)/gu, " "), 100),
      })),
      theories: recentTheories,
      audits: recentAudits,
      errors: recentErrors,
      backups: recentBackups,
    },
    activityTrend: activityTrend.map((row: D1Row) => ({
      day: String(row.day),
      dau: Number(row.dau ?? 0),
      mau: Number(row.mau ?? 0),
      questionAttempts: Number(row.question_attempts ?? 0),
    })),
  };
}

export async function readReportNotification() {
  const row = await firstRow<{ count: number }>(
    "SELECT COUNT(*) AS count FROM user_reports WHERE status = 'new'",
  );
  return { newCount: Number(row?.count ?? 0) };
}

export async function readReports(url: URL) {
  const status = url.searchParams.get("status") ?? "";
  const search = (url.searchParams.get("search") ?? "").trim();
  const where = ["1 = 1"];
  const values: unknown[] = [];
  if (["new", "reviewing", "resolved"].includes(status)) {
    where.push("status = ?");
    values.push(status);
  }
  for (const token of searchTokens(search)) {
    where.push("(title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')");
    const term = sqlLike(token);
    values.push(term, term);
  }
  const items = await allRows(`
    SELECT id, category, title, description, page_path, question_id,
           status, admin_note, created_at, updated_at,
           substr(user_key, 1, 10) AS anonymous_user
    FROM user_reports
    WHERE ${where.join(" AND ")}
    ORDER BY
      CASE status WHEN 'new' THEN 0 WHEN 'reviewing' THEN 1 ELSE 2 END,
      created_at DESC
    LIMIT 200
  `, values);
  return {
    items,
    summary: {
      new: items.filter((item) => item.status === "new").length,
      reviewing: items.filter((item) => item.status === "reviewing").length,
      resolved: items.filter((item) => item.status === "resolved").length,
    },
  };
}

export async function readMembers(url: URL) {
  const page = Math.max(1, integer(url.searchParams.get("page"), 1));
  const pageSize = boundedInteger(
    url.searchParams.get("pageSize"),
    10,
    MAX_PAGE_SIZE,
    30,
  );
  const status = url.searchParams.get("status") ?? "";
  const search = (url.searchParams.get("search") ?? "").trim();
  const where = ["1 = 1"];
  const values: unknown[] = [];
  if (status === "active" || status === "blocked") {
    where.push("u.status = ?");
    values.push(status);
  }
  for (const token of searchTokens(search)) {
    const term = sqlLike(token);
    where.push(`(
      u.email LIKE ? ESCAPE '\\'
      OR u.display_name LIKE ? ESCAPE '\\'
      OR u.user_key LIKE ? ESCAPE '\\'
    )`);
    values.push(term, term, term);
  }
  const clause = where.join(" AND ");
  const [count, summary, items] = await Promise.all([
    firstRow<{ total: number }>(
      `SELECT COUNT(*) AS total FROM user_accounts u WHERE ${clause}`,
      values,
    ),
    firstRow<{ total: number; active: number; blocked: number }>(`
      SELECT
        COUNT(*) AS total,
        SUM(status = 'active') AS active,
        SUM(status = 'blocked') AS blocked
      FROM user_accounts
    `),
    allRows(`
      SELECT
        u.user_key,
        u.email,
        u.display_name,
        u.status,
        u.blocked_reason,
        u.blocked_at,
        u.created_at,
        u.last_login_at,
        COALESCE(a.attempts, 0) AS attempts,
        COALESCE(a.correct, 0) AS correct,
        COALESCE(a.incorrect, 0) AS incorrect,
        COALESCE(b.bookmarks, 0) AS bookmarks,
        COALESCE(e.mock_exams, 0) AS mock_exams
      FROM user_accounts u
      LEFT JOIN (
        SELECT user_key, COUNT(*) AS attempts,
               SUM(result = 'correct') AS correct,
               SUM(result IN ('incorrect', 'partial')) AS incorrect
        FROM attempts GROUP BY user_key
      ) a ON a.user_key = u.user_key
      LEFT JOIN (
        SELECT user_key, COUNT(*) AS bookmarks
        FROM user_bookmarks GROUP BY user_key
      ) b ON b.user_key = u.user_key
      LEFT JOIN (
        SELECT user_key, COUNT(*) AS mock_exams
        FROM exam_sessions WHERE status = 'submitted' GROUP BY user_key
      ) e ON e.user_key = u.user_key
      WHERE ${clause}
      ORDER BY u.last_login_at DESC, u.created_at DESC
      LIMIT ? OFFSET ?
    `, [...values, pageSize, (page - 1) * pageSize]),
  ]);
  const total = Number(count?.total ?? 0);
  return {
    items: items.map((item) => ({
      ...item,
      user_key_short: `${String(item.user_key).slice(0, 10)}…`,
    })),
    summary: {
      total: Number(summary?.total ?? 0),
      active: Number(summary?.active ?? 0),
      blocked: Number(summary?.blocked ?? 0),
    },
    pagination: {
      page,
      pageSize,
      total,
      pages: Math.max(1, Math.ceil(total / pageSize)),
    },
  };
}

export async function readAnalytics(url: URL, adminLearnerKey: string) {
  const period = readRange(url);
  const excludeAdmin = url.searchParams.get("excludeAdmin") !== "false";
  const adminClause = analyticsAdminClause(excludeAdmin);
  const [summary, dailyTraffic, submissionRows] = await Promise.all([
    firstRow<{ page_views: number; visitors: number; returning_visitors: number }>(`
      WITH visitors AS (
        SELECT e.anonymous_session_id,
          SUM(e.event_type = 'page_view') AS page_views,
          COUNT(DISTINCT CASE WHEN e.event_type = 'page_view'
            THEN date(datetime(e.occurred_at, '+9 hours')) END) AS visit_days
        FROM analytics_events e
        WHERE e.event_type = 'page_view' AND e.occurred_at BETWEEN ? AND ?${adminClause}
        GROUP BY e.anonymous_session_id
      )
      SELECT SUM(page_views) AS page_views, SUM(visit_days > 0) AS visitors,
        SUM(visit_days > 1) AS returning_visitors
      FROM visitors
    `, [period.start, period.end]),
    allRows(`
      WITH visits AS MATERIALIZED (
        SELECT date(datetime(e.occurred_at, '+9 hours')) AS day,
          e.anonymous_session_id AS visitor, COUNT(*) AS views
        FROM analytics_events e
        WHERE e.event_type = 'page_view' AND e.occurred_at BETWEEN ? AND ?${adminClause}
        GROUP BY day, e.anonymous_session_id
      ), first_visits AS (
        SELECT visitor, MIN(day) AS first_day FROM visits GROUP BY visitor
      )
      SELECT v.day AS label, SUM(v.views) AS page_views, COUNT(*) AS visitors,
        SUM(f.first_day < v.day) AS returning_visitors
      FROM visits v JOIN first_visits f ON f.visitor = v.visitor
      GROUP BY v.day ORDER BY v.day
    `, [period.start, period.end]),
    allRows<SubmissionRow>(submissionQuery(excludeAdmin), [period.start, period.end, adminLearnerKey]),
  ]);
  const dailyMap = new Map<string, { label: string; pageViews: number; visitors: number; returningVisitors: number; submissions: number }>();
  const dailyValue = (label: unknown) => {
    const key = String(label ?? "");
    const value = dailyMap.get(key) ?? { label: key, pageViews: 0, visitors: 0, returningVisitors: 0, submissions: 0 };
    dailyMap.set(key, value);
    return value;
  };
  for (const row of dailyTraffic) {
    const value = dailyValue(row.label);
    value.pageViews = Number(row.page_views ?? 0);
    value.visitors = Number(row.visitors ?? 0);
    value.returningVisitors = Number(row.returning_visitors ?? 0);
  }
  let memberSubmissions = 0;
  let guestSubmissions = 0;
  for (const row of submissionRows) {
    dailyValue(row.day).submissions += Number(row.count);
    memberSubmissions += Number(row.member_count);
    guestSubmissions += Number(row.guest_count);
  }
  return {
    period,
    excludeAdmin,
    summary: {
      pageViews: Number(summary?.page_views ?? 0),
      visitors: Number(summary?.visitors ?? 0),
      returningVisitors: Number(summary?.returning_visitors ?? 0),
      returningRate: Number(summary?.visitors ?? 0) > 0
        ? Math.round(1000 * Number(summary?.returning_visitors ?? 0) / Number(summary?.visitors)) / 10 : null,
      guestSubmissions,
      memberSubmissions,
      submissions: memberSubmissions + guestSubmissions,
    },
    daily: [...dailyMap.values()].filter(item => item.label).sort((a, b) => a.label.localeCompare(b.label)),
    bySubject: subjectSubmissionCounts(submissionRows),
    byDate: Object.fromEntries(
      [...new Set(submissionRows.map(row => row.day))]
        .sort((a, b) => a.localeCompare(b))
        .map(day => [day, subjectSubmissionCounts(submissionRows.filter(row => row.day === day))]),
    ),
  };
}

export async function readBackupList() {
  const items = await allRows(`
    SELECT id, backup_type, status, schema_version, app_version,
           included_data, counts, checksum, byte_size, created_at, error_message,
           CASE WHEN payload LIKE '{"kind":"external"%'
              OR payload LIKE '{"kind":"external-progress"%'
             THEN 'external' ELSE 'database' END AS storage_mode,
           CASE WHEN payload LIKE '{"kind":"external-progress"%'
             THEN 1 ELSE 0 END AS resumable
    FROM backup_snapshots
    ORDER BY created_at DESC
    LIMIT 100
  `);
  return {
    items: items.map((row: D1Row) => ({
      ...row,
      includedData: safeJson(row.included_data, []),
      counts: safeJson(row.counts, {}),
      byteSize: Number(row.byte_size ?? 0),
      storageMode: row.storage_mode === "external" ? "external" : "database",
      resumable: row.resumable === 1,
    })),
    storage: backupStorageStatus(),
  };
}

export async function readLogs(url: URL) {
  const limit = boundedInteger(url.searchParams.get("limit"), 10, 200, 80);
  const search = (url.searchParams.get("search") ?? "").trim();
  const searchWhere: string[] = [];
  const values: unknown[] = [];
  for (const token of searchTokens(search)) {
    searchWhere.push("(action LIKE ? ESCAPE '\\' OR target_type LIKE ? ESCAPE '\\' OR failure_reason LIKE ? ESCAPE '\\')");
    const term = sqlLike(token);
    values.push(term, term, term);
  }
  const searchClause = searchWhere.length ? `WHERE ${searchWhere.join(" AND ")}` : "";
  const [audits, groupedErrors, recentErrors] = await Promise.all([
    allRows(`
      SELECT id, action, target_type, target_id, before_summary,
             after_summary, success, failure_reason, created_at
      FROM admin_audit_logs
      ${searchClause}
      ORDER BY created_at DESC
      LIMIT ?
    `, [...values, limit]),
    allRows(`
      SELECT fingerprint, error_type, page_path, impact, status,
             COUNT(*) AS occurrences, MAX(created_at) AS last_seen
      FROM system_errors
      GROUP BY fingerprint, error_type, page_path, impact, status
      ORDER BY last_seen DESC LIMIT ?
    `, [limit]),
    allRows(`
      SELECT id, error_type, page_path, question_id, impact, status,
             message, created_at
      FROM system_errors
      ORDER BY created_at DESC LIMIT ?
    `, [limit]),
  ]);
  return {
    audits: audits.map((row: D1Row) => ({
      ...row,
      before: readAuditSummary(row.before_summary),
      after: readAuditSummary(row.after_summary),
      success: Boolean(row.success),
    })),
    groupedErrors,
    recentErrors,
  };
}

export async function readSettings() {
  const items = await allRows(`
    SELECT key, value, value_type, updated_at
    FROM site_settings ORDER BY key
  `);
  const editableItems = items.filter(
    (item: D1Row) => typeof item.key === "string" && item.key in SETTING_RULES,
  );
  const storedValues = Object.fromEntries(editableItems.map((item: D1Row) => [
    item.key,
    item.value_type === "boolean"
      ? item.value === "true"
      : item.value_type === "number"
        ? Number(item.value)
        : item.value,
  ]));
  return {
    values: { ...SETTING_DEFAULTS, ...storedValues },
    items: editableItems,
  };
}
