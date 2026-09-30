import { desc, sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { DEFAULT_EXAM_TYPE } from "@shared/study/study-domain";

export const theories = sqliteTable("theories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  category: text("category").notNull(),
  topic: text("topic").notNull().default(""),
  sortOrder: integer("sort_order").notNull().default(999),
  examScope: text("exam_scope").notNull().default("both"),
  difficulty: text("difficulty").notNull().default("foundation"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  summary: text("summary").notNull().default(""),
  content: text("content").notNull().default(""),
  reviewAnswers: text("review_answers").notNull().default(""),
  keywords: text("keywords").notNull().default("[]"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(""),
}, (table) => [
  index("theories_active_category_order_idx")
    .on(table.active, table.category, table.sortOrder, table.id),
  index("theories_recent_idx")
    .on(table.updatedAt, table.id),
]);

export const questions = sqliteTable("questions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  category: text("category").notNull(),
  topic: text("topic").notNull().default(""),
  displayOrder: integer("display_order").notNull().default(0),
  examScope: text("exam_scope").notNull().default("both"),
  difficulty: text("difficulty").notNull().default("중"),
  difficultyRationale: text("difficulty_rationale").notNull().default(""),
  kind: text("kind").notNull().default("single"),
  prompt: text("prompt").notNull(),
  choices: text("choices").notNull(),
  correctAnswers: text("correct_answers").notNull(),
  explanation: text("explanation").notNull().default(""),
  tags: text("tags").notNull().default("[]"),
  scoringCriteria: text("scoring_criteria").notNull().default("[]"),
  requiredConcepts: text("required_concepts").notNull().default("[]"),
  acceptableAlternatives: text("acceptable_alternatives").notNull().default("[]"),
  deductionConditions: text("deduction_conditions").notNull().default("[]"),
  errorConditions: text("error_conditions").notNull().default("[]"),
  theoryId: integer("theory_id").references(() => theories.id, {
    onDelete: "set null",
  }),
  practiceScope: text("practice_scope").notNull().default("general"),
  variantGroupId: text("variant_group_id"),
  bookmarked: integer("bookmarked", { mode: "boolean" }).notNull().default(false),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(""),
}, (table) => [
  index("questions_active_display_idx")
    .on(table.active, table.displayOrder, table.id),
  index("questions_active_scope_category_kind_idx")
    .on(table.active, table.examScope, table.category, table.kind),
  index("questions_active_practice_scope_exam_category_kind_idx")
    .on(table.active, table.practiceScope, table.examScope, table.category, table.kind),
  index("questions_practice_candidate_order_idx")
    .on(
      table.active,
      table.practiceScope,
      table.examScope,
      table.category,
      table.kind,
      table.displayOrder,
      table.id,
    ),
  index("questions_mock_candidate_order_idx")
    .on(table.active, table.practiceScope, table.displayOrder, table.id),
  index("questions_recent_idx")
    .on(table.createdAt, table.id),
  index("questions_variant_group_idx")
    .on(table.variantGroupId, table.active, table.id),
  index("questions_active_theory_kind_order_idx")
    .on(table.active, table.theoryId, table.kind, table.displayOrder, table.id),
  check(
    "questions_practice_scope_check",
    sql`${table.practiceScope} IN ('general', 'theory_only')`,
  ),
]);

export const courseContentScopes = sqliteTable("course_content_scopes", {
  examType: text("exam_type").notNull(),
  contentScope: text("content_scope").notNull(),
}, (table) => [
  primaryKey({ columns: [table.examType, table.contentScope] }),
  index("course_content_scopes_scope_idx").on(table.contentScope, table.examType),
]);

export const courseSubjects = sqliteTable("course_subjects", {
  examType: text("exam_type").notNull(),
  subject: text("subject").notNull(),
}, (table) => [
  primaryKey({ columns: [table.examType, table.subject] }),
  index("course_subjects_subject_idx").on(table.subject, table.examType),
]);

/**
 * SW 전공 콘텐츠는 SQLD·SQLP 문제은행과 식별자·분류 체계가 다르다.
 * 별도 테이블로 분리해 기존 SQL 출제/통계 쿼리에 섞이지 않게 한다.
 */
export const swTheories = sqliteTable("sw_theories", {
  id: integer("id").primaryKey(),
  subjectGroupId: text("subject_group_id").notNull(),
  subjectId: text("subject_id").notNull(),
  category: text("category").notNull(),
  topic: text("topic").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull().default(""),
  content: text("content").notNull().default(""),
  reviewAnswers: text("review_answers").notNull().default(""),
  keywords: text("keywords").notNull().default("[]"),
  sortOrder: integer("sort_order").notNull().default(999),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("sw_theories_category_topic_idx").on(table.category, table.topic),
  index("sw_theories_active_subject_order_idx")
    .on(table.active, table.subjectGroupId, table.subjectId, table.sortOrder, table.id),
  index("sw_theories_active_subject_order_v2_idx")
    .on(table.active, table.subjectId, table.sortOrder, table.id),
]);

export const swQuestions = sqliteTable("sw_questions", {
  id: text("id").primaryKey(),
  theoryId: integer("theory_id")
    .notNull()
    .references(() => swTheories.id, { onDelete: "cascade" }),
  subjectGroupId: text("subject_group_id").notNull(),
  subjectId: text("subject_id").notNull(),
  category: text("category").notNull(),
  topic: text("topic").notNull(),
  displayOrder: integer("display_order").notNull().default(0),
  difficulty: text("difficulty").notNull().default("중"),
  difficultyRationale: text("difficulty_rationale").notNull().default(""),
  kind: text("kind").notNull().default("single"),
  prompt: text("prompt").notNull(),
  choices: text("choices").notNull().default("[]"),
  correctAnswers: text("correct_answers").notNull().default("[]"),
  explanation: text("explanation").notNull().default(""),
  tags: text("tags").notNull().default("[]"),
  requiredConcepts: text("required_concepts").notNull().default("[]"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("sw_questions_active_subject_order_idx")
    .on(table.active, table.subjectGroupId, table.subjectId, table.displayOrder, table.id),
  index("sw_questions_active_subject_order_v2_idx")
    .on(table.active, table.subjectId, table.displayOrder, table.id),
  index("sw_questions_active_display_order_idx")
    .on(table.active, table.displayOrder, table.id),
  index("sw_questions_active_theory_order_idx")
    .on(table.active, table.theoryId, table.displayOrder, table.id),
]);

export const swQuestionTags = sqliteTable("sw_question_tags", {
  questionId: text("question_id")
    .notNull()
    .references(() => swQuestions.id, { onDelete: "cascade", onUpdate: "cascade" }),
  tag: text("tag").notNull(),
}, (table) => [
  primaryKey({ columns: [table.questionId, table.tag] }),
  index("sw_question_tags_tag_question_idx").on(table.tag, table.questionId),
]);

export const userBookmarks = sqliteTable("user_bookmarks", {
  userKey: text("user_key").notNull(),
  questionId: integer("question_id")
    .notNull()
    .references(() => questions.id, { onDelete: "cascade" }),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  primaryKey({ columns: [table.userKey, table.questionId] }),
  index("user_bookmarks_question_idx")
    .on(table.questionId, table.userKey),
  index("user_bookmarks_user_idx")
    .on(table.userKey, table.createdAt),
]);

export const attempts = sqliteTable("attempts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  questionId: integer("question_id")
    .notNull()
    .references(() => questions.id, { onDelete: "cascade" }),
  selectedAnswers: text("selected_answers").notNull(),
  correct: integer("correct", { mode: "boolean" }).notNull(),
  mode: text("mode").notNull().default("practice"),
  userKey: text("user_key").notNull().default("owner"),
  examType: text("exam_type").notNull().default(DEFAULT_EXAM_TYPE),
  result: text("result").notNull().default("incorrect"),
  score: integer("score").notNull().default(0),
  answerText: text("answer_text").notNull().default(""),
  evaluationId: integer("evaluation_id"),
  reviewStatus: text("review_status").notNull().default("pending"),
  isAdmin: integer("is_admin", { mode: "boolean" }).notNull().default(false),
  clientOperationId: text("client_operation_id"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("attempts_user_exam_time_idx")
    .on(table.userKey, table.examType, table.createdAt, table.id),
  index("attempts_user_exam_question_time_idx")
    .on(table.userKey, table.examType, table.questionId, desc(table.createdAt), desc(table.id)),
  index("attempts_question_result_time_idx")
    .on(table.questionId, table.result, table.reviewStatus, table.createdAt, table.id),
  index("attempts_time_admin_question_idx")
    .on(table.createdAt, table.isAdmin, table.questionId),
  uniqueIndex("attempts_user_operation_uidx")
    .on(table.userKey, table.clientOperationId)
    .where(sql`${table.clientOperationId} IS NOT NULL AND length(${table.clientOperationId}) > 0`),
]);

export const userSettings = sqliteTable("user_settings", {
  userKey: text("user_key").primaryKey(),
  selectedExam: text("selected_exam").notNull().default(DEFAULT_EXAM_TYPE),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const guestImportBatches = sqliteTable("guest_import_batches", {
  userKey: text("user_key").notNull(),
  importId: text("import_id").notNull(),
  importedAt: text("imported_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  primaryKey({ columns: [table.userKey, table.importId] }),
]);

export const guestImportReceipts = sqliteTable("guest_import_receipts", {
  userKey: text("user_key").notNull(),
  importId: text("import_id").notNull(),
  payloadDigest: text("payload_digest").notNull(),
  importedAt: text("imported_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  primaryKey({ columns: [table.userKey, table.importId] }),
  foreignKey({ columns: [table.userKey, table.importId],
    foreignColumns: [guestImportBatches.userKey, guestImportBatches.importId] }).onDelete("cascade"),
]);

export const userAccounts = sqliteTable("user_accounts", {
  userKey: text("user_key").primaryKey(),
  email: text("email").notNull().default(""),
  displayName: text("display_name").notNull().default(""),
  status: text("status").notNull().default("active"),
  blockedReason: text("blocked_reason").notNull().default(""),
  blockedAt: text("blocked_at"),
  blockedByHash: text("blocked_by_hash"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  lastLoginAt: text("last_login_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("user_accounts_login_time_idx")
    .on(table.lastLoginAt, table.createdAt),
  index("user_accounts_status_login_idx")
    .on(table.status, table.lastLoginAt),
  uniqueIndex("user_accounts_email_unique")
    .on(table.email)
    .where(sql`${table.email} <> ''`),
  check("user_accounts_status_check", sql`${table.status} IN ('active', 'blocked')`),
]);

export const aiEvaluations = sqliteTable("ai_evaluations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userKey: text("user_key").notNull().default("owner"),
  questionId: integer("question_id")
    .notNull()
    .references(() => questions.id, { onDelete: "cascade" }),
  answerHash: text("answer_hash").notNull(),
  rubricVersion: text("rubric_version").notNull().default("v1"),
  modelVersion: text("model_version").notNull().default("rubric-v1"),
  result: text("result").notNull(),
  score: integer("score").notNull(),
  strengths: text("strengths").notNull().default("[]"),
  missingPoints: text("missing_points").notNull().default("[]"),
  errors: text("errors").notNull().default("[]"),
  feedback: text("feedback").notNull().default(""),
  improvedAnswer: text("improved_answer").notNull().default(""),
  modelAnswer: text("model_answer").notNull().default(""),
  detailedExplanation: text("detailed_explanation").notNull().default(""),
  provider: text("provider").notNull().default("rubric"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("ai_evaluations_user_time_idx")
    .on(table.userKey, table.createdAt, table.id),
  index("ai_evaluations_question_idx")
    .on(table.questionId, table.createdAt, table.id),
  uniqueIndex("ai_evaluations_cache_idx")
    .on(table.userKey, table.questionId, table.answerHash, table.rubricVersion, table.modelVersion),
]);

export const examSessions = sqliteTable("exam_sessions", {
  id: text("id").primaryKey(),
  userKey: text("user_key").notNull().default("owner"),
  examType: text("exam_type").notNull(),
  status: text("status").notNull().default("active"),
  questionIds: text("question_ids").notNull().default("[]"),
  answers: text("answers").notNull().default("{}"),
  descriptiveAnswers: text("descriptive_answers").notNull().default("{}"),
  descriptiveScores: text("descriptive_scores").notNull().default("{}"),
  descriptiveSnapshots: text("descriptive_snapshots").notNull().default("{}"),
  flagged: text("flagged").notNull().default("[]"),
  currentIndex: integer("current_index").notNull().default(0),
  startedAt: text("started_at").notNull(),
  endsAt: text("ends_at").notNull(),
  submittedAt: text("submitted_at"),
  result: text("result").notNull().default("{}"),
  policyVersion: text("policy_version").notNull().default("legacy"),
  policySnapshot: text("policy_snapshot").notNull().default("{}"),
  revision: integer("revision").notNull().default(0),
  isAdmin: integer("is_admin", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("exam_sessions_user_exam_updated_idx")
    .on(table.userKey, table.examType, table.updatedAt, table.id),
  index("exam_sessions_user_status_updated_idx")
    .on(table.userKey, table.status, desc(table.updatedAt), table.id),
  index("exam_sessions_user_exam_idx")
    .on(table.userKey, table.examType, table.status, table.updatedAt),
  index("exam_sessions_status_expiry_idx")
    .on(table.status, table.endsAt, table.id),
]);

export const examSessionItems = sqliteTable("exam_session_items", {
  sessionId: text("session_id")
    .notNull()
    .references(() => examSessions.id, { onDelete: "cascade" }),
  questionId: integer("question_id")
    .notNull()
    .references(() => questions.id, { onDelete: "restrict" }),
  position: integer("position").notNull(),
  selectedAnswers: text("selected_answers").notNull().default("[]"),
  descriptiveAnswer: text("descriptive_answer").notNull().default(""),
  descriptiveScore: integer("descriptive_score"),
  descriptiveSnapshot: text("descriptive_snapshot").notNull().default(""),
  flagged: integer("flagged", { mode: "boolean" }).notNull().default(false),
  revision: integer("revision").notNull().default(0),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  primaryKey({ columns: [table.sessionId, table.questionId] }),
  uniqueIndex("exam_session_items_position_uidx").on(table.sessionId, table.position),
  index("exam_session_items_question_idx").on(table.questionId, table.sessionId),
]);

export const examActiveSessions = sqliteTable("exam_active_sessions", {
  userKey: text("user_key").notNull(),
  examType: text("exam_type").notNull(),
  sessionId: text("session_id")
    .notNull()
    .references(() => examSessions.id, { onDelete: "cascade" }),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  primaryKey({ columns: [table.userKey, table.examType] }),
  uniqueIndex("exam_active_sessions_session_uidx").on(table.sessionId),
]);

export const swAttempts = sqliteTable("sw_attempts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userKey: text("user_key").notNull(),
  questionId: text("question_id")
    .notNull()
    .references(() => swQuestions.id, { onDelete: "cascade", onUpdate: "cascade" }),
  selectedAnswers: text("selected_answers").notNull().default("[]"),
  correct: integer("correct", { mode: "boolean" }).notNull(),
  mode: text("mode").notNull().default("practice"),
  clientOperationId: text("client_operation_id").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("sw_attempts_user_operation_uidx").on(table.userKey, table.clientOperationId),
  index("sw_attempts_user_time_idx").on(table.userKey, table.createdAt, table.id),
  index("sw_attempts_question_time_idx").on(table.questionId, table.createdAt, table.id),
]);

export const swLearningSessions = sqliteTable("sw_learning_sessions", {
  id: text("id").primaryKey(),
  userKey: text("user_key").notNull(),
  mode: text("mode").notNull(),
  status: text("status").notNull().default("active"),
  subjectIds: text("subject_ids").notNull().default("[]"),
  questionIds: text("question_ids").notNull().default("[]"),
  answers: text("answers").notNull().default("{}"),
  revealedQuestionIds: text("revealed_question_ids").notNull().default("[]"),
  currentIndex: integer("current_index").notNull().default(0),
  result: text("result").notNull().default("{}"),
  revision: integer("revision").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("sw_learning_sessions_user_time_idx").on(table.userKey, table.updatedAt, table.id),
  uniqueIndex("sw_learning_sessions_active_uidx")
    .on(table.userKey, table.mode)
    .where(sql`${table.status} = 'active'`),
  check("sw_learning_sessions_mode_check", sql`${table.mode} IN ('practice', 'mock')`),
  check(
    "sw_learning_sessions_status_check",
    sql`${table.status} IN ('active', 'submitted')`,
  ),
]);

/**
 * Privacy-preserving product analytics. The table intentionally has no IP,
 * free-form answer, authentication token, or browser-fingerprint columns.
 */
export const analyticsEvents = sqliteTable("analytics_events", {
  id: text("id").primaryKey(),
  eventType: text("event_type").notNull(),
  occurredAt: text("occurred_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  anonymousSessionId: text("anonymous_session_id").notNull(),
  userKeyHash: text("user_key_hash"),
  isAdmin: integer("is_admin", { mode: "boolean" }).notNull().default(false),
  examScope: text("exam_scope"),
  subject: text("subject"),
  questionId: integer("question_id").references(() => questions.id, {
    onDelete: "set null",
  }),
  contentId: text("content_id"),
  answerResult: text("answer_result"),
  durationMs: integer("duration_ms"),
  pagePath: text("page_path").notNull().default(""),
  referrerHost: text("referrer_host").notNull().default(""),
  deviceCategory: text("device_category").notNull().default("unknown"),
  viewportBucket: text("viewport_bucket").notNull().default("unknown"),
  browserFamily: text("browser_family").notNull().default("unknown"),
  metricName: text("metric_name"),
  metricValue: real("metric_value"),
  apiRoute: text("api_route"),
  httpStatus: integer("http_status"),
  retryCount: integer("retry_count"),
  cacheSource: text("cache_source"),
  buildSha: text("build_sha"),
  dedupeKey: text("dedupe_key").notNull().unique(),
}, (table) => [
  index("analytics_events_theory_lookup_idx")
    .on(table.eventType, table.pagePath, table.subject, table.questionId),
  index("analytics_events_type_time_idx").on(table.eventType, table.occurredAt),
  index("analytics_events_session_time_idx")
    .on(table.anonymousSessionId, table.occurredAt),
  index("analytics_events_question_time_idx").on(table.questionId, table.occurredAt),
  index("analytics_events_admin_time_idx").on(table.isAdmin, table.occurredAt),
  index("analytics_events_type_admin_time_session_idx")
    .on(table.eventType, table.isAdmin, table.occurredAt, table.anonymousSessionId),
  index("analytics_events_sw_result_idx")
    .on(table.examScope, table.contentId, table.answerResult, table.occurredAt),
  index("analytics_events_occurred_at_idx").on(table.occurredAt),
  index("analytics_events_rum_metric_time_idx")
    .on(table.eventType, table.metricName, table.occurredAt, table.isAdmin),
]);

export const adminAuditLogs = sqliteTable("admin_audit_logs", {
  id: text("id").primaryKey(),
  adminUserHash: text("admin_user_hash").notNull(),
  action: text("action").notNull(),
  targetType: text("target_type").notNull().default("system"),
  targetId: text("target_id"),
  beforeSummary: text("before_summary").notNull().default("{}"),
  afterSummary: text("after_summary").notNull().default("{}"),
  success: integer("success", { mode: "boolean" }).notNull().default(true),
  failureReason: text("failure_reason").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("admin_audit_logs_created_at_idx").on(table.createdAt),
  index("admin_audit_logs_action_idx").on(table.action, table.createdAt),
]);

export const systemErrors = sqliteTable("system_errors", {
  id: text("id").primaryKey(),
  errorType: text("error_type").notNull(),
  pagePath: text("page_path").notNull().default(""),
  questionId: integer("question_id").references(() => questions.id, {
    onDelete: "set null",
  }),
  impact: text("impact").notNull().default("operation_failed"),
  status: text("status").notNull().default("open"),
  message: text("message").notNull().default(""),
  fingerprint: text("fingerprint").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  firstSeenAt: text("first_seen_at"),
  lastSeenAt: text("last_seen_at"),
  occurrenceCount: integer("occurrence_count").notNull().default(1),
}, (table) => [
  index("system_errors_question_type_idx")
    .on(table.questionId, table.errorType),
  index("system_errors_created_at_idx").on(table.createdAt),
  index("system_errors_fingerprint_idx").on(table.fingerprint, table.createdAt),
  index("system_errors_status_time_idx")
    .on(table.status, table.createdAt),
  index("system_errors_fingerprint_status_seen_idx")
    .on(table.fingerprint, table.status, table.lastSeenAt, table.id),
]);

export const appSchemaState = sqliteTable("app_schema_state", {
  id: integer("id").primaryKey(),
  migrationVersion: text("migration_version").notNull(),
  appliedAt: text("applied_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  check("app_schema_state_singleton_check", sql`${table.id} = 1`),
]);

export const maintenanceRuns = sqliteTable("maintenance_runs", {
  task: text("task").primaryKey(),
  leaseOwner: text("lease_owner").notNull().default(""),
  leaseUntil: text("lease_until"),
  lastStartedAt: text("last_started_at"),
  lastSucceededAt: text("last_succeeded_at"),
  lastFailedAt: text("last_failed_at"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  lastError: text("last_error").notNull().default(""),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("maintenance_runs_lease_idx").on(table.leaseUntil, table.task),
  check(
    "maintenance_runs_consecutive_failures_check",
    sql`${table.consecutiveFailures} >= 0`,
  ),
]);

export const userReports = sqliteTable("user_reports", {
  id: text("id").primaryKey(),
  userKey: text("user_key").notNull(),
  category: text("category").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  pagePath: text("page_path").notNull().default("/"),
  questionId: integer("question_id").references(() => questions.id, {
    onDelete: "set null",
  }),
  status: text("status").notNull().default("new"),
  adminNote: text("admin_note").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("user_reports_status_time_idx").on(table.status, table.createdAt),
  index("user_reports_user_time_idx").on(table.userKey, table.createdAt),
]);

export const backupSnapshots = sqliteTable("backup_snapshots", {
  id: text("id").primaryKey(),
  backupType: text("backup_type").notNull(),
  status: text("status").notNull().default("completed"),
  schemaVersion: text("schema_version").notNull(),
  appVersion: text("app_version").notNull(),
  includedData: text("included_data").notNull().default("[]"),
  counts: text("counts").notNull().default("{}"),
  checksum: text("checksum").notNull(),
  payload: text("payload").notNull(),
  byteSize: integer("byte_size").notNull().default(0),
  createdByHash: text("created_by_hash").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  errorMessage: text("error_message").notNull().default(""),
}, (table) => [
  index("backup_snapshots_type_status_time_idx")
    .on(table.backupType, table.status, table.createdAt),
  index("backup_snapshots_created_at_idx").on(table.createdAt),
]);

export const backupChunks = sqliteTable("backup_chunks", {
  snapshotId: text("snapshot_id")
    .notNull()
    .references(() => backupSnapshots.id, { onDelete: "cascade" }),
  chunkIndex: integer("chunk_index").notNull(),
  payload: text("payload").notNull(),
}, (table) => [
  primaryKey({ columns: [table.snapshotId, table.chunkIndex] }),
]);

export const siteSettings = sqliteTable("site_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  valueType: text("value_type").notNull().default("string"),
  updatedByHash: text("updated_by_hash").notNull().default("system"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const adminQualityCache = sqliteTable("admin_quality_cache", {
  cacheKey: text("cache_key").notNull(),
  chunkIndex: integer("chunk_index").notNull(),
  payload: text("payload").notNull(),
  generatedAt: text("generated_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.cacheKey, table.chunkIndex] }),
  index("admin_quality_cache_expiry_idx").on(table.expiresAt),
]);

export const contentReleases = sqliteTable("content_releases", {
  version: text("version").primaryKey(),
  schemaVersion: text("schema_version").notNull(),
  sourceChecksum: text("source_checksum").notNull(),
  questionChecksum: text("question_checksum").notNull(),
  theoryChecksum: text("theory_checksum").notNull(),
  expectedQuestionCount: integer("expected_question_count").notNull(),
  importedQuestionCount: integer("imported_question_count").notNull().default(0),
  expectedTheoryCount: integer("expected_theory_count").notNull(),
  importedTheoryCount: integer("imported_theory_count").notNull().default(0),
  status: text("status").notNull().default("pending"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  activatedAt: text("activated_at"),
}, (table) => [
  index("content_releases_status_created_idx").on(table.status, table.createdAt),
]);

export * from "./schema.group-exams";
