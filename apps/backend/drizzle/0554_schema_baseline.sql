-- Schema baseline 0554.
-- This migration is intentionally idempotent: it is applied once to the existing
-- production database, then becomes the only bootstrap migration for new databases.
-- Learning content is delivered by the versioned content bootstrap/release path.

CREATE TABLE IF NOT EXISTS `app_schema_state` (
  `id` integer PRIMARY KEY NOT NULL CHECK (`id` = 1),
  `migration_version` text NOT NULL,
  `applied_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `admin_audit_logs` (
  `id` text PRIMARY KEY NOT NULL,
  `admin_user_hash` text NOT NULL,
  `action` text NOT NULL,
  `target_type` text DEFAULT 'system' NOT NULL,
  `target_id` text,
  `before_summary` text DEFAULT '{}' NOT NULL,
  `after_summary` text DEFAULT '{}' NOT NULL,
  `success` integer DEFAULT 1 NOT NULL,
  `failure_reason` text DEFAULT '' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `admin_quality_cache` (
  `cache_key` text NOT NULL,
  `chunk_index` integer NOT NULL,
  `payload` text NOT NULL,
  `generated_at` text NOT NULL,
  `expires_at` integer NOT NULL,
  PRIMARY KEY (`cache_key`, `chunk_index`)
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `ai_evaluations` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_key` text DEFAULT 'owner' NOT NULL,
  `question_id` integer NOT NULL,
  `answer_hash` text NOT NULL,
  `rubric_version` text DEFAULT 'v1' NOT NULL,
  `model_version` text DEFAULT 'rubric-v1' NOT NULL,
  `result` text NOT NULL,
  `score` integer NOT NULL,
  `strengths` text DEFAULT '[]' NOT NULL,
  `missing_points` text DEFAULT '[]' NOT NULL,
  `errors` text DEFAULT '[]' NOT NULL,
  `feedback` text DEFAULT '' NOT NULL,
  `improved_answer` text DEFAULT '' NOT NULL,
  `model_answer` text DEFAULT '' NOT NULL,
  `detailed_explanation` text DEFAULT '' NOT NULL,
  `provider` text DEFAULT 'rubric' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `analytics_events` (
  `id` text PRIMARY KEY NOT NULL,
  `event_type` text NOT NULL,
  `occurred_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `anonymous_session_id` text NOT NULL,
  `user_key_hash` text,
  `is_admin` integer DEFAULT 0 NOT NULL,
  `exam_scope` text,
  `subject` text,
  `question_id` integer,
  `duration_ms` integer,
  `page_path` text DEFAULT '' NOT NULL,
  `referrer_host` text DEFAULT '' NOT NULL,
  `device_category` text DEFAULT 'unknown' NOT NULL,
  `viewport_bucket` text DEFAULT 'unknown' NOT NULL,
  `browser_family` text DEFAULT 'unknown' NOT NULL,
  `dedupe_key` text NOT NULL, content_id TEXT, answer_result TEXT, `metric_name` text, `metric_value` real, `api_route` text, `http_status` integer, `retry_count` integer, `cache_source` text, `build_sha` text,
  FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`question_id` integer NOT NULL,
	`selected_answers` text NOT NULL,
	`correct` integer NOT NULL,
	`mode` text DEFAULT 'practice' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL, `user_key` text DEFAULT 'owner' NOT NULL, `exam_type` text DEFAULT 'SQLP' NOT NULL, `result` text DEFAULT 'incorrect' NOT NULL, `score` integer DEFAULT 0 NOT NULL, `answer_text` text DEFAULT '' NOT NULL, `evaluation_id` integer, `review_status` text DEFAULT 'pending' NOT NULL, `is_admin` integer DEFAULT 0 NOT NULL, `client_operation_id` text,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `backup_chunks` (
  `snapshot_id` text NOT NULL,
  `chunk_index` integer NOT NULL,
  `payload` text NOT NULL,
  PRIMARY KEY (`snapshot_id`, `chunk_index`),
  FOREIGN KEY (`snapshot_id`) REFERENCES `backup_snapshots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `backup_snapshots` (
  `id` text PRIMARY KEY NOT NULL,
  `backup_type` text NOT NULL,
  `status` text DEFAULT 'completed' NOT NULL,
  `schema_version` text NOT NULL,
  `app_version` text NOT NULL,
  `included_data` text DEFAULT '[]' NOT NULL,
  `counts` text DEFAULT '{}' NOT NULL,
  `checksum` text NOT NULL,
  `payload` text NOT NULL,
  `byte_size` integer DEFAULT 0 NOT NULL,
  `created_by_hash` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `error_message` text DEFAULT '' NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS content_releases (
  version TEXT PRIMARY KEY NOT NULL,
  schema_version TEXT NOT NULL,
  source_checksum TEXT NOT NULL,
  question_checksum TEXT NOT NULL,
  theory_checksum TEXT NOT NULL,
  expected_question_count INTEGER NOT NULL,
  imported_question_count INTEGER NOT NULL DEFAULT 0,
  expected_theory_count INTEGER NOT NULL,
  imported_theory_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  activated_at TEXT
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `course_content_scopes` (
  `exam_type` text NOT NULL,
  `content_scope` text NOT NULL,
  PRIMARY KEY (`exam_type`, `content_scope`)
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `course_subjects` (
  `exam_type` text NOT NULL,
  `subject` text NOT NULL,
  PRIMARY KEY (`exam_type`, `subject`)
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `exam_active_sessions` (
  `user_key` text NOT NULL,
  `exam_type` text NOT NULL,
  `session_id` text NOT NULL REFERENCES `exam_sessions` (`id`) ON DELETE CASCADE,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_key`, `exam_type`)
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `exam_session_items` (
  `session_id` text NOT NULL REFERENCES `exam_sessions` (`id`) ON DELETE CASCADE,
  `question_id` integer NOT NULL REFERENCES `questions` (`id`) ON DELETE RESTRICT,
  `position` integer NOT NULL,
  `selected_answers` text NOT NULL DEFAULT '[]',
  `descriptive_answer` text NOT NULL DEFAULT '',
  `descriptive_score` integer,
  `descriptive_snapshot` text NOT NULL DEFAULT '',
  `flagged` integer NOT NULL DEFAULT 0,
  `revision` integer NOT NULL DEFAULT 0,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`session_id`, `question_id`)
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `exam_sessions` (
  `id` text PRIMARY KEY NOT NULL,
  `user_key` text DEFAULT 'owner' NOT NULL,
  `exam_type` text NOT NULL,
  `status` text DEFAULT 'active' NOT NULL,
  `question_ids` text DEFAULT '[]' NOT NULL,
  `answers` text DEFAULT '{}' NOT NULL,
  `descriptive_answers` text DEFAULT '{}' NOT NULL,
  `flagged` text DEFAULT '[]' NOT NULL,
  `current_index` integer DEFAULT 0 NOT NULL,
  `started_at` text NOT NULL,
  `ends_at` text NOT NULL,
  `submitted_at` text,
  `result` text DEFAULT '{}' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
, `is_admin` integer DEFAULT 0 NOT NULL, descriptive_scores text DEFAULT '{}' NOT NULL, `descriptive_snapshots` text DEFAULT '{}' NOT NULL, `revision` integer NOT NULL DEFAULT 0, `policy_version` text NOT NULL DEFAULT 'legacy', `policy_snapshot` text NOT NULL DEFAULT '{}');
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `guest_import_batches` (
  `user_key` text NOT NULL,
  `import_id` text NOT NULL,
  `imported_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY(`user_key`, `import_id`)
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `maintenance_runs` (
  `task` text PRIMARY KEY NOT NULL,
  `lease_owner` text NOT NULL DEFAULT '',
  `lease_until` text,
  `last_started_at` text,
  `last_succeeded_at` text,
  `last_failed_at` text,
  `consecutive_failures` integer NOT NULL DEFAULT 0 CHECK (`consecutive_failures` >= 0),
  `last_error` text NOT NULL DEFAULT '',
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `questions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category` text NOT NULL,
	`topic` text DEFAULT '' NOT NULL,
	`difficulty` text DEFAULT '중' NOT NULL,
	`kind` text DEFAULT 'single' NOT NULL,
	`prompt` text NOT NULL,
	`choices` text NOT NULL,
	`correct_answers` text NOT NULL,
	`explanation` text DEFAULT '' NOT NULL,
	`theory_id` integer,
	`bookmarked` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL, `display_order` integer DEFAULT 0 NOT NULL, `exam_scope` text DEFAULT 'both' NOT NULL, `difficulty_rationale` text DEFAULT '' NOT NULL, `tags` text DEFAULT '[]' NOT NULL, `scoring_criteria` text DEFAULT '[]' NOT NULL, `required_concepts` text DEFAULT '[]' NOT NULL, `acceptable_alternatives` text DEFAULT '[]' NOT NULL, `deduction_conditions` text DEFAULT '[]' NOT NULL, `error_conditions` text DEFAULT '[]' NOT NULL, `active` integer DEFAULT 1 NOT NULL, `updated_at` text DEFAULT '' NOT NULL, `practice_scope` TEXT NOT NULL DEFAULT 'general'
CHECK (`practice_scope` IN ('general', 'theory_only')), variant_group_id TEXT,
	FOREIGN KEY (`theory_id`) REFERENCES `theories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `site_settings` (
  `key` text PRIMARY KEY NOT NULL,
  `value` text NOT NULL,
  `value_type` text DEFAULT 'string' NOT NULL,
  `updated_by_hash` text DEFAULT 'system' NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `sw_attempts` (
  `id` integer PRIMARY KEY AUTOINCREMENT,
  `user_key` text NOT NULL,
  `question_id` text NOT NULL REFERENCES `sw_questions` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  `selected_answers` text NOT NULL DEFAULT '[]',
  `correct` integer NOT NULL,
  `mode` text NOT NULL DEFAULT 'practice',
  `client_operation_id` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `sw_learning_sessions` (
  `id` text PRIMARY KEY,
  `user_key` text NOT NULL,
  `mode` text NOT NULL CHECK (`mode` IN ('practice', 'mock')),
  `status` text NOT NULL DEFAULT 'active' CHECK (`status` IN ('active', 'submitted')),
  `subject_ids` text NOT NULL DEFAULT '[]',
  `question_ids` text NOT NULL DEFAULT '[]',
  `answers` text NOT NULL DEFAULT '{}',
  `revealed_question_ids` text NOT NULL DEFAULT '[]',
  `current_index` integer NOT NULL DEFAULT 0,
  `result` text NOT NULL DEFAULT '{}',
  `revision` integer NOT NULL DEFAULT 0,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `sw_question_tags` (
  `question_id` text NOT NULL,
  `tag` text NOT NULL,
  PRIMARY KEY (`question_id`, `tag`),
  FOREIGN KEY (`question_id`) REFERENCES `sw_questions`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `sw_questions` (
  `id` text PRIMARY KEY NOT NULL,
  `theory_id` integer NOT NULL REFERENCES `sw_theories`(`id`) ON DELETE cascade,
  `subject_group_id` text NOT NULL,
  `subject_id` text NOT NULL,
  `category` text NOT NULL,
  `topic` text NOT NULL,
  `display_order` integer DEFAULT 0 NOT NULL,
  `difficulty` text DEFAULT '중' NOT NULL,
  `difficulty_rationale` text DEFAULT '' NOT NULL,
  `kind` text DEFAULT 'single' NOT NULL,
  `prompt` text NOT NULL,
  `choices` text DEFAULT '[]' NOT NULL,
  `correct_answers` text DEFAULT '[]' NOT NULL,
  `explanation` text DEFAULT '' NOT NULL,
  `tags` text DEFAULT '[]' NOT NULL,
  `required_concepts` text DEFAULT '[]' NOT NULL,
  `active` integer DEFAULT 1 NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `sw_theories` (
  `id` integer PRIMARY KEY NOT NULL,
  `subject_group_id` text NOT NULL,
  `subject_id` text NOT NULL,
  `category` text NOT NULL,
  `topic` text NOT NULL,
  `title` text NOT NULL,
  `summary` text DEFAULT '' NOT NULL,
  `content` text DEFAULT '' NOT NULL,
  `review_answers` text DEFAULT '' NOT NULL,
  `keywords` text DEFAULT '[]' NOT NULL,
  `sort_order` integer DEFAULT 999 NOT NULL,
  `active` integer DEFAULT 1 NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `sw_theory_progress` (
  `user_key` text NOT NULL,
  `theory_id` integer NOT NULL REFERENCES `sw_theories` (`id`) ON DELETE CASCADE,
  `completed` integer NOT NULL DEFAULT 1,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_key`, `theory_id`)
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `system_errors` (
  `id` text PRIMARY KEY NOT NULL,
  `error_type` text NOT NULL,
  `page_path` text DEFAULT '' NOT NULL,
  `question_id` integer,
  `impact` text DEFAULT 'operation_failed' NOT NULL,
  `status` text DEFAULT 'open' NOT NULL,
  `message` text DEFAULT '' NOT NULL,
  `fingerprint` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL, `first_seen_at` text, `last_seen_at` text, `occurrence_count` integer NOT NULL DEFAULT 1,
  FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `theories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`category` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`keywords` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
, `topic` text DEFAULT '' NOT NULL, `sort_order` integer DEFAULT 999 NOT NULL, `exam_scope` text DEFAULT 'both' NOT NULL, `difficulty` text DEFAULT 'foundation' NOT NULL, `active` integer DEFAULT 1 NOT NULL, `updated_at` text DEFAULT '' NOT NULL, `review_answers` TEXT NOT NULL DEFAULT '');
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `theory_progress` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_key` text DEFAULT 'owner' NOT NULL,
  `theory_id` integer NOT NULL,
  `exam_type` text NOT NULL,
  `completed` integer DEFAULT 1 NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`theory_id`) REFERENCES `theories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `user_accounts` (
  `user_key` text PRIMARY KEY NOT NULL,
  `email` text DEFAULT '' NOT NULL,
  `display_name` text DEFAULT '' NOT NULL,
  `status` text DEFAULT 'active' NOT NULL CHECK (`status` IN ('active', 'blocked')),
  `blocked_reason` text DEFAULT '' NOT NULL,
  `blocked_at` text,
  `blocked_by_hash` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `last_login_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `user_bookmarks` (
  `user_key` text NOT NULL,
  `question_id` integer NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY (`user_key`, `question_id`),
  FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `user_reports` (
  `id` text PRIMARY KEY NOT NULL,
  `user_key` text NOT NULL,
  `category` text NOT NULL,
  `title` text NOT NULL,
  `description` text NOT NULL,
  `page_path` text DEFAULT '/' NOT NULL,
  `question_id` integer,
  `status` text DEFAULT 'new' NOT NULL,
  `admin_note` text DEFAULT '' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `user_settings` (
  `user_key` text PRIMARY KEY NOT NULL,
  `selected_exam` text DEFAULT 'SQLP' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `admin_audit_logs_action_idx` ON `admin_audit_logs` (`action`, `created_at`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `admin_audit_logs_created_at_idx` ON `admin_audit_logs` (`created_at`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `admin_quality_cache_expiry_idx`
ON `admin_quality_cache` (`expires_at`);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS `ai_evaluations_cache_idx`
ON `ai_evaluations` (`user_key`, `question_id`, `answer_hash`, `rubric_version`, `model_version`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `ai_evaluations_question_idx`
ON `ai_evaluations` (`question_id`, `created_at`, `id`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `ai_evaluations_user_time_idx`
ON `ai_evaluations` (`user_key`, `created_at`, `id`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `analytics_events_admin_time_idx` ON `analytics_events` (`is_admin`, `occurred_at`);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS `analytics_events_dedupe_key_unique` ON `analytics_events` (`dedupe_key`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `analytics_events_occurred_at_idx` ON `analytics_events` (`occurred_at`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `analytics_events_question_time_idx` ON `analytics_events` (`question_id`, `occurred_at`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `analytics_events_rum_metric_time_idx`
  ON `analytics_events` (`event_type`, `metric_name`, `occurred_at`, `is_admin`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `analytics_events_session_time_idx` ON `analytics_events` (`anonymous_session_id`, `occurred_at`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS analytics_events_sw_result_idx
  ON analytics_events (exam_scope, content_id, answer_result, occurred_at);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `analytics_events_theory_lookup_idx`
ON `analytics_events` (`event_type`, `page_path`, `subject`, `question_id`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `analytics_events_type_admin_time_session_idx`
ON `analytics_events` (`event_type`, `is_admin`, `occurred_at`, `anonymous_session_id`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `analytics_events_type_time_idx` ON `analytics_events` (`event_type`, `occurred_at`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `attempts_question_result_time_idx`
ON `attempts` (`question_id`, `result`, `review_status`, `created_at`, `id`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `attempts_time_admin_question_idx`
ON `attempts` (`created_at`, `is_admin`, `question_id`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `attempts_user_exam_question_time_idx`
ON `attempts` (`user_key`, `exam_type`, `question_id`, `created_at` DESC, `id` DESC);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `attempts_user_exam_time_idx`
ON `attempts` (`user_key`, `exam_type`, `created_at`, `id`);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS `attempts_user_operation_uidx`
ON `attempts` (`user_key`, `client_operation_id`)
WHERE `client_operation_id` IS NOT NULL AND length(`client_operation_id`) > 0;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `backup_snapshots_created_at_idx` ON `backup_snapshots` (`created_at`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `backup_snapshots_type_status_time_idx`
ON `backup_snapshots` (`backup_type`, `status`, `created_at`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS content_releases_status_created_idx
  ON content_releases (status, created_at);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `course_content_scopes_scope_idx`
ON `course_content_scopes` (`content_scope`, `exam_type`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `course_subjects_subject_idx`
ON `course_subjects` (`subject`, `exam_type`);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS `exam_active_sessions_session_uidx`
ON `exam_active_sessions` (`session_id`);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS `exam_session_items_position_uidx`
ON `exam_session_items` (`session_id`, `position`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `exam_session_items_question_idx`
ON `exam_session_items` (`question_id`, `session_id`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `exam_sessions_status_expiry_idx`
  ON `exam_sessions` (`status`, `ends_at`, `id`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `exam_sessions_user_exam_idx`
ON `exam_sessions` (`user_key`, `exam_type`, `status`, `updated_at`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `exam_sessions_user_exam_updated_idx`
ON `exam_sessions` (`user_key`, `exam_type`, `updated_at`, `id`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `exam_sessions_user_status_updated_idx`
  ON `exam_sessions` (`user_key`, `status`, `updated_at` DESC, `id`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `maintenance_runs_lease_idx`
  ON `maintenance_runs` (`lease_until`, `task`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `questions_active_display_idx`
ON `questions` (`active`, `display_order`, `id`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `questions_active_practice_scope_exam_category_kind_idx`
ON `questions` (`active`, `practice_scope`, `exam_scope`, `category`, `kind`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `questions_active_scope_category_kind_idx`
ON `questions` (`active`, `exam_scope`, `category`, `kind`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `questions_active_theory_kind_order_idx`
ON `questions` (`active`, `theory_id`, `kind`, `display_order`, `id`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `questions_mock_candidate_order_idx`
ON `questions` (`active`, `practice_scope`, `display_order`, `id`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `questions_practice_candidate_order_idx`
ON `questions` (
  `active`,
  `practice_scope`,
  `exam_scope`,
  `category`,
  `kind`,
  `display_order`,
  `id`
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `questions_recent_idx`
ON `questions` (`created_at`, `id`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS questions_variant_group_idx
  ON questions (variant_group_id, active, id);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `sw_attempts_question_time_idx`
ON `sw_attempts` (`question_id`, `created_at`, `id`);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS `sw_attempts_user_operation_uidx`
ON `sw_attempts` (`user_key`, `client_operation_id`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `sw_attempts_user_time_idx`
ON `sw_attempts` (`user_key`, `created_at`, `id`);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS `sw_learning_sessions_active_uidx`
ON `sw_learning_sessions` (`user_key`, `mode`)
WHERE `status` = 'active';
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `sw_learning_sessions_user_time_idx`
ON `sw_learning_sessions` (`user_key`, `updated_at`, `id`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `sw_question_tags_tag_question_idx`
  ON `sw_question_tags` (`tag`, `question_id`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `sw_questions_active_display_order_idx`
ON `sw_questions` (`active`, `display_order`, `id`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `sw_questions_active_subject_order_idx` ON `sw_questions` (`active`,`subject_group_id`,`subject_id`,`display_order`,`id`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `sw_questions_active_subject_order_v2_idx`
ON `sw_questions` (`active`, `subject_id`, `display_order`, `id`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `sw_questions_active_theory_order_idx` ON `sw_questions` (`active`,`theory_id`,`display_order`,`id`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `sw_theories_active_subject_order_idx` ON `sw_theories` (`active`,`subject_group_id`,`subject_id`,`sort_order`,`id`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `sw_theories_active_subject_order_v2_idx`
ON `sw_theories` (`active`, `subject_id`, `sort_order`, `id`);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS `sw_theories_category_topic_idx` ON `sw_theories` (`category`,`topic`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `sw_theory_progress_user_time_idx`
ON `sw_theory_progress` (`user_key`, `updated_at`, `theory_id`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `system_errors_created_at_idx` ON `system_errors` (`created_at`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `system_errors_fingerprint_idx` ON `system_errors` (`fingerprint`, `created_at`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `system_errors_fingerprint_status_seen_idx`
  ON `system_errors` (`fingerprint`, `status`, `last_seen_at`, `id`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `system_errors_question_type_idx`
ON `system_errors` (`question_id`, `error_type`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `system_errors_status_time_idx`
ON `system_errors` (`status`, `created_at`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `theories_active_category_order_idx`
ON `theories` (`active`, `category`, `sort_order`, `id`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `theories_recent_idx`
ON `theories` (`updated_at`, `id`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `theory_progress_user_exam_time_idx`
ON `theory_progress` (`user_key`, `exam_type`, `updated_at`, `id`);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS `theory_progress_user_idx`
ON `theory_progress` (`user_key`, `theory_id`, `exam_type`);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS `user_accounts_email_unique`
  ON `user_accounts` (`email`) WHERE `email` <> '';
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `user_accounts_login_time_idx`
ON `user_accounts` (`last_login_at`, `created_at`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `user_accounts_status_login_idx`
  ON `user_accounts` (`status`, `last_login_at`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `user_bookmarks_question_idx`
ON `user_bookmarks` (`question_id`, `user_key`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `user_bookmarks_user_idx` ON `user_bookmarks` (`user_key`, `created_at`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `user_reports_status_time_idx` ON `user_reports` (`status`, `created_at`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `user_reports_user_time_idx` ON `user_reports` (`user_key`, `created_at`);
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `attempts_integrity_before_insert`
BEFORE INSERT ON `attempts`
BEGIN
  SELECT RAISE(ABORT, 'attempts.selected_answers must be valid JSON')
  WHERE NOT json_valid(NEW.`selected_answers`);
  SELECT RAISE(ABORT, 'attempts.selected_answers must be an array')
  WHERE json_type(NEW.`selected_answers`) <> 'array';
  SELECT RAISE(ABORT, 'attempts.selected_answers contains an invalid choice')
  WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.`selected_answers`) answer
    JOIN `questions` question ON question.id = NEW.`question_id`
    WHERE answer.type <> 'integer' OR answer.value < 0
      OR answer.value >= json_array_length(question.choices)
  );
  SELECT RAISE(ABORT, 'attempts boolean fields must be 0 or 1')
  WHERE NEW.`correct` NOT IN (0, 1) OR NEW.`is_admin` NOT IN (0, 1);
  SELECT RAISE(ABORT, 'attempts.score must be between 0 and 100')
  WHERE NEW.`score` < 0 OR NEW.`score` > 100;
  SELECT RAISE(ABORT, 'attempts domain value is invalid')
  WHERE NEW.`result` NOT IN ('correct', 'partial', 'incorrect')
    OR NEW.`review_status` NOT IN ('mastered', 'pending', 'self-assessed')
    OR length(trim(NEW.`exam_type`)) = 0 OR length(trim(NEW.`mode`)) = 0;
  SELECT RAISE(ABORT, 'attempts correct and result values disagree')
  WHERE (NEW.`correct` = 1 AND NEW.`result` <> 'correct')
    OR (NEW.`correct` = 0 AND NEW.`result` = 'correct');
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `attempts_integrity_before_update`
BEFORE UPDATE ON `attempts`
BEGIN
  SELECT RAISE(ABORT, 'attempts.selected_answers must be valid JSON')
  WHERE NOT json_valid(NEW.`selected_answers`);
  SELECT RAISE(ABORT, 'attempts.selected_answers must be an array')
  WHERE json_type(NEW.`selected_answers`) <> 'array';
  SELECT RAISE(ABORT, 'attempts.selected_answers contains an invalid choice')
  WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.`selected_answers`) answer
    JOIN `questions` question ON question.id = NEW.`question_id`
    WHERE answer.type <> 'integer' OR answer.value < 0
      OR answer.value >= json_array_length(question.choices)
  );
  SELECT RAISE(ABORT, 'attempts scalar value is invalid')
  WHERE NEW.`correct` NOT IN (0, 1) OR NEW.`is_admin` NOT IN (0, 1)
    OR NEW.`score` < 0 OR NEW.`score` > 100;
  SELECT RAISE(ABORT, 'attempts domain value is invalid')
  WHERE NEW.`result` NOT IN ('correct', 'partial', 'incorrect')
    OR NEW.`review_status` NOT IN ('mastered', 'pending', 'self-assessed')
    OR length(trim(NEW.`exam_type`)) = 0 OR length(trim(NEW.`mode`)) = 0;
  SELECT RAISE(ABORT, 'attempts correct and result values disagree')
  WHERE (NEW.`correct` = 1 AND NEW.`result` <> 'correct')
    OR (NEW.`correct` = 0 AND NEW.`result` = 'correct');
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `exam_active_sessions_integrity_before_insert`
BEFORE INSERT ON `exam_active_sessions`
BEGIN
  SELECT RAISE(ABORT, 'exam_active_sessions pointer is inconsistent')
  WHERE NOT EXISTS (
    SELECT 1 FROM `exam_sessions` session
    WHERE session.id = NEW.`session_id` AND session.user_key = NEW.`user_key`
      AND session.exam_type = NEW.`exam_type` AND session.status IN ('active', 'grading')
  );
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `exam_active_sessions_integrity_before_update`
BEFORE UPDATE ON `exam_active_sessions`
BEGIN
  SELECT RAISE(ABORT, 'exam_active_sessions pointer is inconsistent')
  WHERE NOT EXISTS (
    SELECT 1 FROM `exam_sessions` session
    WHERE session.id = NEW.`session_id` AND session.user_key = NEW.`user_key`
      AND session.exam_type = NEW.`exam_type` AND session.status IN ('active', 'grading')
  );
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `exam_session_items_integrity_before_insert`
BEFORE INSERT ON `exam_session_items`
BEGIN
  SELECT RAISE(ABORT, 'exam_session_items.selected_answers must be valid JSON')
  WHERE NOT json_valid(NEW.`selected_answers`);
  SELECT RAISE(ABORT, 'exam_session_items.selected_answers must be an array')
  WHERE json_type(NEW.`selected_answers`) <> 'array';
  SELECT RAISE(ABORT, 'exam_session_items scalar value is invalid')
  WHERE NEW.`position` < 0 OR NEW.`revision` < 0
    OR NEW.`flagged` NOT IN (0, 1)
    OR NEW.`descriptive_score` < 0 OR NEW.`descriptive_score` > 100;
  SELECT RAISE(ABORT, 'exam_session_items contains an invalid choice')
  WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.`selected_answers`) answer
    JOIN `questions` question ON question.id = NEW.`question_id`
    WHERE answer.type <> 'integer' OR answer.value < 0
      OR answer.value >= json_array_length(question.choices)
  );
  SELECT RAISE(ABORT, 'exam_session_items position does not match its session')
  WHERE NOT EXISTS (
    SELECT 1 FROM `exam_sessions` session
    WHERE session.id = NEW.`session_id` AND json_valid(session.question_ids)
      AND json_type(session.question_ids) = 'array'
      AND json_extract(session.question_ids, '$[' || NEW.`position` || ']') = NEW.`question_id`
  );
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `exam_session_items_integrity_before_update`
BEFORE UPDATE ON `exam_session_items`
BEGIN
  SELECT RAISE(ABORT, 'exam_session_items.selected_answers must be valid JSON')
  WHERE NOT json_valid(NEW.`selected_answers`);
  SELECT RAISE(ABORT, 'exam_session_items.selected_answers must be an array')
  WHERE json_type(NEW.`selected_answers`) <> 'array';
  SELECT RAISE(ABORT, 'exam_session_items scalar value is invalid')
  WHERE NEW.`position` < 0 OR NEW.`revision` < 0
    OR NEW.`flagged` NOT IN (0, 1)
    OR NEW.`descriptive_score` < 0 OR NEW.`descriptive_score` > 100;
  SELECT RAISE(ABORT, 'exam_session_items contains an invalid choice')
  WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.`selected_answers`) answer
    JOIN `questions` question ON question.id = NEW.`question_id`
    WHERE answer.type <> 'integer' OR answer.value < 0
      OR answer.value >= json_array_length(question.choices)
  );
  SELECT RAISE(ABORT, 'exam_session_items position does not match its session')
  WHERE NOT EXISTS (
    SELECT 1 FROM `exam_sessions` session
    WHERE session.id = NEW.`session_id`
      AND json_extract(session.question_ids, '$[' || NEW.`position` || ']') = NEW.`question_id`
  );
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `exam_session_items_revision_transition_before_update`
BEFORE UPDATE OF `revision` ON `exam_session_items`
WHEN NEW.`revision` < OLD.`revision`
BEGIN
  SELECT RAISE(ABORT, 'exam session item revision cannot decrease');
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `exam_session_maps_integrity_before_insert`
BEFORE INSERT ON `exam_sessions`
WHEN json_valid(NEW.`question_ids`) AND json_type(NEW.`question_ids`) = 'array'
  AND json_valid(NEW.`answers`) AND json_type(NEW.`answers`) = 'object'
  AND json_valid(NEW.`descriptive_answers`) AND json_type(NEW.`descriptive_answers`) = 'object'
  AND json_valid(NEW.`descriptive_scores`) AND json_type(NEW.`descriptive_scores`) = 'object'
  AND json_valid(NEW.`descriptive_snapshots`) AND json_type(NEW.`descriptive_snapshots`) = 'object'
  AND json_valid(NEW.`flagged`) AND json_type(NEW.`flagged`) = 'array'
BEGIN
  SELECT RAISE(ABORT, 'exam_sessions.answers is inconsistent')
  WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.`answers`) entry
    WHERE NOT EXISTS (SELECT 1 FROM json_each(NEW.`question_ids`) item
        WHERE CAST(item.value AS text) = entry.key)
      OR entry.type <> 'array' OR EXISTS (
        SELECT 1 FROM json_each(entry.value) answer
        JOIN `questions` question ON question.id = CAST(entry.key AS integer)
        WHERE answer.type <> 'integer' OR answer.value < 0
          OR answer.value >= json_array_length(question.choices)
      )
  );
  SELECT RAISE(ABORT, 'exam_sessions descriptive state is inconsistent')
  WHERE EXISTS (SELECT 1 FROM json_each(NEW.`descriptive_answers`) entry
    WHERE entry.type <> 'text' OR NOT EXISTS (
      SELECT 1 FROM json_each(NEW.`question_ids`) item
      WHERE CAST(item.value AS text) = entry.key))
    OR EXISTS (SELECT 1 FROM json_each(NEW.`descriptive_scores`) entry
      WHERE entry.type NOT IN ('integer', 'real', 'null')
        OR (entry.type <> 'null' AND (entry.value < 0 OR entry.value > 100))
        OR NOT EXISTS (SELECT 1 FROM json_each(NEW.`question_ids`) item
          WHERE CAST(item.value AS text) = entry.key))
    OR EXISTS (SELECT 1 FROM json_each(NEW.`descriptive_snapshots`) entry
      WHERE entry.type <> 'text' OR NOT EXISTS (
        SELECT 1 FROM json_each(NEW.`question_ids`) item
        WHERE CAST(item.value AS text) = entry.key))
    OR EXISTS (SELECT 1 FROM json_each(NEW.`flagged`) entry
      WHERE entry.type <> 'integer' OR NOT EXISTS (
        SELECT 1 FROM json_each(NEW.`question_ids`) item WHERE item.value = entry.value));
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `exam_session_maps_integrity_before_update`
BEFORE UPDATE ON `exam_sessions`
WHEN json_valid(NEW.`question_ids`) AND json_type(NEW.`question_ids`) = 'array'
  AND json_valid(NEW.`answers`) AND json_type(NEW.`answers`) = 'object'
  AND json_valid(NEW.`descriptive_answers`) AND json_type(NEW.`descriptive_answers`) = 'object'
  AND json_valid(NEW.`descriptive_scores`) AND json_type(NEW.`descriptive_scores`) = 'object'
  AND json_valid(NEW.`descriptive_snapshots`) AND json_type(NEW.`descriptive_snapshots`) = 'object'
  AND json_valid(NEW.`flagged`) AND json_type(NEW.`flagged`) = 'array'
BEGIN
  SELECT RAISE(ABORT, 'exam_sessions.answers is inconsistent')
  WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.`answers`) entry
    WHERE NOT EXISTS (SELECT 1 FROM json_each(NEW.`question_ids`) item
        WHERE CAST(item.value AS text) = entry.key)
      OR entry.type <> 'array' OR EXISTS (
        SELECT 1 FROM json_each(entry.value) answer
        JOIN `questions` question ON question.id = CAST(entry.key AS integer)
        WHERE answer.type <> 'integer' OR answer.value < 0
          OR answer.value >= json_array_length(question.choices)
      )
  );
  SELECT RAISE(ABORT, 'exam_sessions descriptive state is inconsistent')
  WHERE EXISTS (SELECT 1 FROM json_each(NEW.`descriptive_answers`) entry
    WHERE entry.type <> 'text' OR NOT EXISTS (
      SELECT 1 FROM json_each(NEW.`question_ids`) item
      WHERE CAST(item.value AS text) = entry.key))
    OR EXISTS (SELECT 1 FROM json_each(NEW.`descriptive_scores`) entry
      WHERE entry.type NOT IN ('integer', 'real', 'null')
        OR (entry.type <> 'null' AND (entry.value < 0 OR entry.value > 100))
        OR NOT EXISTS (SELECT 1 FROM json_each(NEW.`question_ids`) item
          WHERE CAST(item.value AS text) = entry.key))
    OR EXISTS (SELECT 1 FROM json_each(NEW.`descriptive_snapshots`) entry
      WHERE entry.type <> 'text' OR NOT EXISTS (
        SELECT 1 FROM json_each(NEW.`question_ids`) item
        WHERE CAST(item.value AS text) = entry.key))
    OR EXISTS (SELECT 1 FROM json_each(NEW.`flagged`) entry
      WHERE entry.type <> 'integer' OR NOT EXISTS (
        SELECT 1 FROM json_each(NEW.`question_ids`) item WHERE item.value = entry.value));
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `exam_sessions_integrity_before_insert`
BEFORE INSERT ON `exam_sessions`
BEGIN
  SELECT RAISE(ABORT, 'exam_sessions contains invalid JSON')
  WHERE NOT json_valid(NEW.`question_ids`) OR NOT json_valid(NEW.`answers`)
    OR NOT json_valid(NEW.`descriptive_answers`) OR NOT json_valid(NEW.`descriptive_scores`)
    OR NOT json_valid(NEW.`descriptive_snapshots`) OR NOT json_valid(NEW.`flagged`)
    OR NOT json_valid(NEW.`result`) OR NOT json_valid(NEW.`policy_snapshot`);
  SELECT RAISE(ABORT, 'exam_sessions JSON shape is invalid')
  WHERE json_type(NEW.`question_ids`) <> 'array'
    OR json_type(NEW.`answers`) <> 'object'
    OR json_type(NEW.`descriptive_answers`) <> 'object'
    OR json_type(NEW.`descriptive_scores`) <> 'object'
    OR json_type(NEW.`descriptive_snapshots`) <> 'object'
    OR json_type(NEW.`flagged`) <> 'array' OR json_type(NEW.`result`) <> 'object'
    OR json_type(NEW.`policy_snapshot`) <> 'object';
  SELECT RAISE(ABORT, 'exam_sessions scalar value is invalid')
  WHERE NEW.`status` NOT IN ('active', 'grading', 'submitted')
    OR length(trim(NEW.`exam_type`)) = 0 OR length(trim(NEW.`policy_version`)) = 0
    OR NOT EXISTS (SELECT 1 FROM `course_content_scopes` scope
      WHERE scope.exam_type = NEW.`exam_type`)
    OR NEW.`revision` < 0 OR NEW.`is_admin` NOT IN (0, 1) OR NEW.`current_index` < 0
    OR (json_array_length(NEW.`question_ids`) = 0 AND NEW.`current_index` <> 0)
    OR (json_array_length(NEW.`question_ids`) > 0
      AND NEW.`current_index` >= json_array_length(NEW.`question_ids`));
  SELECT RAISE(ABORT, 'exam_sessions.question_ids is inconsistent')
  WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.`question_ids`) item
    LEFT JOIN `questions` question ON question.id = item.value
    WHERE item.type <> 'integer' OR question.id IS NULL
      OR (NEW.`status` <> 'submitted' AND question.active <> 1)
      OR NOT EXISTS (SELECT 1 FROM `course_subjects` subject
        WHERE subject.exam_type = NEW.`exam_type` AND subject.subject = question.category)
      OR NOT EXISTS (
        SELECT 1 FROM `course_content_scopes` scope
        WHERE scope.exam_type = NEW.`exam_type`
          AND scope.content_scope = question.exam_scope
      )
  ) OR (SELECT COUNT(*) FROM json_each(NEW.`question_ids`)) <>
    (SELECT COUNT(DISTINCT item.value) FROM json_each(NEW.`question_ids`) item);
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `exam_sessions_integrity_before_update`
BEFORE UPDATE ON `exam_sessions`
BEGIN
  SELECT RAISE(ABORT, 'exam_sessions contains invalid JSON')
  WHERE NOT json_valid(NEW.`question_ids`) OR NOT json_valid(NEW.`answers`)
    OR NOT json_valid(NEW.`descriptive_answers`) OR NOT json_valid(NEW.`descriptive_scores`)
    OR NOT json_valid(NEW.`descriptive_snapshots`) OR NOT json_valid(NEW.`flagged`)
    OR NOT json_valid(NEW.`result`) OR NOT json_valid(NEW.`policy_snapshot`);
  SELECT RAISE(ABORT, 'exam_sessions JSON shape is invalid')
  WHERE json_type(NEW.`question_ids`) <> 'array'
    OR json_type(NEW.`answers`) <> 'object'
    OR json_type(NEW.`descriptive_answers`) <> 'object'
    OR json_type(NEW.`descriptive_scores`) <> 'object'
    OR json_type(NEW.`descriptive_snapshots`) <> 'object'
    OR json_type(NEW.`flagged`) <> 'array' OR json_type(NEW.`result`) <> 'object'
    OR json_type(NEW.`policy_snapshot`) <> 'object';
  SELECT RAISE(ABORT, 'exam_sessions scalar value is invalid')
  WHERE NEW.`status` NOT IN ('active', 'grading', 'submitted')
    OR length(trim(NEW.`exam_type`)) = 0 OR length(trim(NEW.`policy_version`)) = 0
    OR NOT EXISTS (SELECT 1 FROM `course_content_scopes` scope
      WHERE scope.exam_type = NEW.`exam_type`)
    OR NEW.`revision` < 0 OR NEW.`is_admin` NOT IN (0, 1) OR NEW.`current_index` < 0
    OR (json_array_length(NEW.`question_ids`) = 0 AND NEW.`current_index` <> 0)
    OR (json_array_length(NEW.`question_ids`) > 0
      AND NEW.`current_index` >= json_array_length(NEW.`question_ids`));
  SELECT RAISE(ABORT, 'exam_sessions.question_ids is inconsistent')
  WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.`question_ids`) item
    LEFT JOIN `questions` question ON question.id = item.value
    WHERE item.type <> 'integer' OR question.id IS NULL
      OR (NEW.`status` <> 'submitted' AND question.active <> 1)
      OR NOT EXISTS (SELECT 1 FROM `course_subjects` subject
        WHERE subject.exam_type = NEW.`exam_type` AND subject.subject = question.category)
      OR NOT EXISTS (
        SELECT 1 FROM `course_content_scopes` scope
        WHERE scope.exam_type = NEW.`exam_type`
          AND scope.content_scope = question.exam_scope
      )
  ) OR (SELECT COUNT(*) FROM json_each(NEW.`question_ids`)) <>
    (SELECT COUNT(DISTINCT item.value) FROM json_each(NEW.`question_ids`) item);
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `exam_sessions_revision_transition_before_update`
BEFORE UPDATE OF `revision` ON `exam_sessions`
WHEN NEW.`revision` < OLD.`revision`
BEGIN
  SELECT RAISE(ABORT, 'exam session revision cannot decrease');
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `exam_sessions_status_transition_before_update`
BEFORE UPDATE OF `status` ON `exam_sessions`
WHEN OLD.`status` = 'submitted' AND NEW.`status` <> 'submitted'
BEGIN
  SELECT RAISE(ABORT, 'submitted exam session cannot be reopened');
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `questions_integrity_before_insert`
BEFORE INSERT ON `questions`
BEGIN
  SELECT RAISE(ABORT, 'questions contains invalid JSON')
  WHERE NOT json_valid(NEW.`choices`) OR NOT json_valid(NEW.`correct_answers`)
    OR NOT json_valid(NEW.`tags`) OR NOT json_valid(NEW.`scoring_criteria`)
    OR NOT json_valid(NEW.`required_concepts`) OR NOT json_valid(NEW.`acceptable_alternatives`)
    OR NOT json_valid(NEW.`deduction_conditions`) OR NOT json_valid(NEW.`error_conditions`);
  SELECT RAISE(ABORT, 'questions JSON shape is invalid')
  WHERE json_type(NEW.`choices`) <> 'array'
    OR json_type(NEW.`correct_answers`) <> 'array' OR json_type(NEW.`tags`) <> 'array'
    OR json_type(NEW.`scoring_criteria`) <> 'array'
    OR json_type(NEW.`required_concepts`) <> 'array'
    OR json_type(NEW.`acceptable_alternatives`) <> 'array'
    OR json_type(NEW.`deduction_conditions`) <> 'array'
    OR json_type(NEW.`error_conditions`) <> 'array';
  SELECT RAISE(ABORT, 'questions scalar value is invalid')
  WHERE NEW.`kind` NOT IN ('single', 'multiple', 'descriptive')
    OR NEW.`practice_scope` NOT IN ('general', 'theory_only')
    OR NEW.`active` NOT IN (0, 1) OR NEW.`bookmarked` NOT IN (0, 1)
    OR length(trim(NEW.`exam_scope`)) = 0
    OR NOT EXISTS (SELECT 1 FROM `course_content_scopes` scope
      WHERE scope.content_scope = NEW.`exam_scope`)
    OR EXISTS (SELECT 1 FROM `course_content_scopes` scope
      WHERE scope.content_scope = NEW.`exam_scope` AND NOT EXISTS (
        SELECT 1 FROM `course_subjects` subject
        WHERE subject.exam_type = scope.exam_type AND subject.subject = NEW.`category`
      ));
  SELECT RAISE(ABORT, 'questions correct answer contract is invalid')
  WHERE NEW.`kind` IN ('single', 'multiple') AND (
    json_array_length(NEW.`choices`) NOT IN (2, 4) OR json_array_length(NEW.`correct_answers`) = 0
    OR (NEW.`kind` = 'single' AND json_array_length(NEW.`correct_answers`) <> 1)
    OR EXISTS (SELECT 1 FROM json_each(NEW.`correct_answers`) answer
      WHERE answer.type <> 'integer' OR answer.value < 0
        OR answer.value >= json_array_length(NEW.`choices`))
  );
  SELECT RAISE(ABORT, 'questions theory relationship is inconsistent')
  WHERE NEW.`theory_id` IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM `theories` theory WHERE theory.id = NEW.`theory_id`
      AND theory.category = NEW.`category`
      AND (NEW.`active` <> 1 OR theory.active = 1)
      AND NOT EXISTS (
        SELECT 1 FROM `course_content_scopes` question_course
        WHERE question_course.content_scope = NEW.`exam_scope`
          AND NOT EXISTS (
            SELECT 1 FROM `course_content_scopes` theory_course
            WHERE theory_course.exam_type = question_course.exam_type
              AND theory_course.content_scope = theory.exam_scope
          )
      )
  );
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `questions_integrity_before_update`
BEFORE UPDATE ON `questions`
BEGIN
  SELECT RAISE(ABORT, 'questions contains invalid JSON')
  WHERE NOT json_valid(NEW.`choices`) OR NOT json_valid(NEW.`correct_answers`)
    OR NOT json_valid(NEW.`tags`) OR NOT json_valid(NEW.`scoring_criteria`)
    OR NOT json_valid(NEW.`required_concepts`) OR NOT json_valid(NEW.`acceptable_alternatives`)
    OR NOT json_valid(NEW.`deduction_conditions`) OR NOT json_valid(NEW.`error_conditions`);
  SELECT RAISE(ABORT, 'questions JSON shape is invalid')
  WHERE json_type(NEW.`choices`) <> 'array'
    OR json_type(NEW.`correct_answers`) <> 'array' OR json_type(NEW.`tags`) <> 'array'
    OR json_type(NEW.`scoring_criteria`) <> 'array'
    OR json_type(NEW.`required_concepts`) <> 'array'
    OR json_type(NEW.`acceptable_alternatives`) <> 'array'
    OR json_type(NEW.`deduction_conditions`) <> 'array'
    OR json_type(NEW.`error_conditions`) <> 'array';
  SELECT RAISE(ABORT, 'questions scalar value is invalid')
  WHERE NEW.`kind` NOT IN ('single', 'multiple', 'descriptive')
    OR NEW.`practice_scope` NOT IN ('general', 'theory_only')
    OR NEW.`active` NOT IN (0, 1) OR NEW.`bookmarked` NOT IN (0, 1)
    OR length(trim(NEW.`exam_scope`)) = 0
    OR NOT EXISTS (SELECT 1 FROM `course_content_scopes` scope
      WHERE scope.content_scope = NEW.`exam_scope`)
    OR EXISTS (SELECT 1 FROM `course_content_scopes` scope
      WHERE scope.content_scope = NEW.`exam_scope` AND NOT EXISTS (
        SELECT 1 FROM `course_subjects` subject
        WHERE subject.exam_type = scope.exam_type AND subject.subject = NEW.`category`
      ));
  SELECT RAISE(ABORT, 'questions correct answer contract is invalid')
  WHERE NEW.`kind` IN ('single', 'multiple') AND (
    json_array_length(NEW.`choices`) NOT IN (2, 4) OR json_array_length(NEW.`correct_answers`) = 0
    OR (NEW.`kind` = 'single' AND json_array_length(NEW.`correct_answers`) <> 1)
    OR EXISTS (SELECT 1 FROM json_each(NEW.`correct_answers`) answer
      WHERE answer.type <> 'integer' OR answer.value < 0
        OR answer.value >= json_array_length(NEW.`choices`))
  );
  SELECT RAISE(ABORT, 'questions theory relationship is inconsistent')
  WHERE NEW.`theory_id` IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM `theories` theory WHERE theory.id = NEW.`theory_id`
      AND theory.category = NEW.`category`
      AND (NEW.`active` <> 1 OR theory.active = 1)
      AND NOT EXISTS (
        SELECT 1 FROM `course_content_scopes` question_course
        WHERE question_course.content_scope = NEW.`exam_scope`
          AND NOT EXISTS (
            SELECT 1 FROM `course_content_scopes` theory_course
            WHERE theory_course.exam_type = question_course.exam_type
              AND theory_course.content_scope = theory.exam_scope
          )
      )
  );
  SELECT RAISE(ABORT, 'question is locked by an active exam session')
  WHERE (
    NEW.`active` <> OLD.`active` OR NEW.`exam_scope` <> OLD.`exam_scope`
      OR NEW.`kind` <> OLD.`kind` OR NEW.`choices` <> OLD.`choices`
      OR NEW.`correct_answers` <> OLD.`correct_answers`
  ) AND EXISTS (
    SELECT 1 FROM `exam_session_items` item
    JOIN `exam_sessions` session ON session.id = item.session_id
    WHERE item.question_id = OLD.`id` AND session.status IN ('active', 'grading')
  );
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `sw_attempts_integrity_before_insert`
BEFORE INSERT ON `sw_attempts`
BEGIN
  SELECT RAISE(ABORT, 'sw_attempts.selected_answers must be valid JSON')
  WHERE NOT json_valid(NEW.`selected_answers`);
  SELECT RAISE(ABORT, 'sw_attempts.selected_answers must be an array')
  WHERE json_type(NEW.`selected_answers`) <> 'array';
  SELECT RAISE(ABORT, 'sw_attempts contains an invalid choice')
  WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.`selected_answers`) answer
    JOIN `sw_questions` question ON question.id = NEW.`question_id`
    WHERE answer.type <> 'integer' OR answer.value < 0
      OR answer.value >= json_array_length(question.choices)
  );
  SELECT RAISE(ABORT, 'sw_attempts scalar value is invalid')
  WHERE NEW.`correct` NOT IN (0, 1) OR NEW.`mode` NOT IN ('practice', 'mock')
    OR length(trim(NEW.`client_operation_id`)) = 0;
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `sw_attempts_integrity_before_update`
BEFORE UPDATE ON `sw_attempts`
BEGIN
  SELECT RAISE(ABORT, 'sw_attempts.selected_answers must be valid JSON')
  WHERE NOT json_valid(NEW.`selected_answers`);
  SELECT RAISE(ABORT, 'sw_attempts.selected_answers must be an array')
  WHERE json_type(NEW.`selected_answers`) <> 'array';
  SELECT RAISE(ABORT, 'sw_attempts contains an invalid choice')
  WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.`selected_answers`) answer
    JOIN `sw_questions` question ON question.id = NEW.`question_id`
    WHERE answer.type <> 'integer' OR answer.value < 0
      OR answer.value >= json_array_length(question.choices)
  );
  SELECT RAISE(ABORT, 'sw_attempts scalar value is invalid')
  WHERE NEW.`correct` NOT IN (0, 1) OR NEW.`mode` NOT IN ('practice', 'mock')
    OR length(trim(NEW.`client_operation_id`)) = 0;
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `sw_learning_sessions_integrity_before_insert`
BEFORE INSERT ON `sw_learning_sessions`
BEGIN
  SELECT RAISE(ABORT, 'sw_learning_sessions contains invalid JSON')
  WHERE NOT json_valid(NEW.`subject_ids`) OR NOT json_valid(NEW.`question_ids`)
    OR NOT json_valid(NEW.`answers`) OR NOT json_valid(NEW.`revealed_question_ids`)
    OR NOT json_valid(NEW.`result`);
  SELECT RAISE(ABORT, 'sw_learning_sessions JSON shape is invalid')
  WHERE json_type(NEW.`subject_ids`) <> 'array'
    OR json_type(NEW.`question_ids`) <> 'array' OR json_type(NEW.`answers`) <> 'object'
    OR json_type(NEW.`revealed_question_ids`) <> 'array' OR json_type(NEW.`result`) <> 'object';
  SELECT RAISE(ABORT, 'sw_learning_sessions scalar value is invalid')
  WHERE NEW.`current_index` < 0 OR NEW.`revision` < 0
    OR (json_array_length(NEW.`question_ids`) = 0 AND NEW.`current_index` <> 0)
    OR (json_array_length(NEW.`question_ids`) > 0
      AND NEW.`current_index` >= json_array_length(NEW.`question_ids`));
  SELECT RAISE(ABORT, 'sw_learning_sessions.question_ids is inconsistent')
  WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.`question_ids`) item
    LEFT JOIN `sw_questions` question ON question.id = item.value
    WHERE item.type <> 'text' OR question.id IS NULL OR question.active <> 1
  );
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `sw_learning_sessions_integrity_before_update`
BEFORE UPDATE ON `sw_learning_sessions`
BEGIN
  SELECT RAISE(ABORT, 'sw_learning_sessions contains invalid JSON')
  WHERE NOT json_valid(NEW.`subject_ids`) OR NOT json_valid(NEW.`question_ids`)
    OR NOT json_valid(NEW.`answers`) OR NOT json_valid(NEW.`revealed_question_ids`)
    OR NOT json_valid(NEW.`result`);
  SELECT RAISE(ABORT, 'sw_learning_sessions JSON shape is invalid')
  WHERE json_type(NEW.`subject_ids`) <> 'array'
    OR json_type(NEW.`question_ids`) <> 'array' OR json_type(NEW.`answers`) <> 'object'
    OR json_type(NEW.`revealed_question_ids`) <> 'array' OR json_type(NEW.`result`) <> 'object';
  SELECT RAISE(ABORT, 'sw_learning_sessions scalar value is invalid')
  WHERE NEW.`current_index` < 0 OR NEW.`revision` < 0
    OR (json_array_length(NEW.`question_ids`) = 0 AND NEW.`current_index` <> 0)
    OR (json_array_length(NEW.`question_ids`) > 0
      AND NEW.`current_index` >= json_array_length(NEW.`question_ids`));
  SELECT RAISE(ABORT, 'sw_learning_sessions.question_ids is inconsistent')
  WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.`question_ids`) item
    LEFT JOIN `sw_questions` question ON question.id = item.value
    WHERE item.type <> 'text' OR question.id IS NULL OR question.active <> 1
  );
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `sw_learning_sessions_revision_transition_before_update`
BEFORE UPDATE OF `revision` ON `sw_learning_sessions`
WHEN NEW.`revision` < OLD.`revision`
BEGIN
  SELECT RAISE(ABORT, 'SW learning session revision cannot decrease');
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `sw_learning_sessions_status_transition_before_update`
BEFORE UPDATE OF `status` ON `sw_learning_sessions`
WHEN OLD.`status` = 'submitted' AND NEW.`status` <> 'submitted'
BEGIN
  SELECT RAISE(ABORT, 'submitted SW learning session cannot be reopened');
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `sw_question_tags_after_delete`
AFTER DELETE ON `sw_questions`
BEGIN
  DELETE FROM `sw_question_tags` WHERE `question_id` = OLD.id;
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `sw_question_tags_after_insert`
AFTER INSERT ON `sw_questions`
BEGIN
  INSERT OR IGNORE INTO `sw_question_tags` (`question_id`, `tag`)
  SELECT NEW.id, tags.value
  FROM json_each(NEW.tags) tags
  WHERE NEW.tags IS NOT NULL AND json_valid(NEW.tags) AND tags.type = 'text';
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `sw_question_tags_after_update`
AFTER UPDATE OF `id`, `tags` ON `sw_questions`
BEGIN
  DELETE FROM `sw_question_tags` WHERE `question_id` = OLD.id;
  INSERT OR IGNORE INTO `sw_question_tags` (`question_id`, `tag`)
  SELECT NEW.id, tags.value
  FROM json_each(NEW.tags) tags
  WHERE NEW.tags IS NOT NULL AND json_valid(NEW.tags) AND tags.type = 'text';
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `sw_questions_integrity_before_insert`
BEFORE INSERT ON `sw_questions`
BEGIN
  SELECT RAISE(ABORT, 'sw_questions contains invalid JSON')
  WHERE NOT json_valid(NEW.`choices`) OR NOT json_valid(NEW.`correct_answers`)
    OR NOT json_valid(NEW.`tags`) OR NOT json_valid(NEW.`required_concepts`);
  SELECT RAISE(ABORT, 'sw_questions JSON shape is invalid')
  WHERE json_type(NEW.`choices`) <> 'array'
    OR json_type(NEW.`correct_answers`) <> 'array' OR json_type(NEW.`tags`) <> 'array'
    OR json_type(NEW.`required_concepts`) <> 'array';
  SELECT RAISE(ABORT, 'sw_questions answer contract is invalid')
  WHERE NEW.`kind` NOT IN ('single', 'multiple') OR NEW.`active` NOT IN (0, 1)
    OR json_array_length(NEW.`choices`) <> 4 OR json_array_length(NEW.`correct_answers`) = 0
    OR (NEW.`kind` = 'single' AND json_array_length(NEW.`correct_answers`) <> 1)
    OR EXISTS (SELECT 1 FROM json_each(NEW.`correct_answers`) answer
      WHERE answer.type <> 'integer' OR answer.value < 0
        OR answer.value >= json_array_length(NEW.`choices`));
  SELECT RAISE(ABORT, 'sw_questions theory relationship is inconsistent')
  WHERE NOT EXISTS (
    SELECT 1 FROM `sw_theories` theory WHERE theory.id = NEW.`theory_id`
      AND (NEW.`active` <> 1 OR theory.active = 1)
      AND theory.subject_group_id = NEW.`subject_group_id`
      AND theory.subject_id = NEW.`subject_id` AND theory.category = NEW.`category`
      AND theory.topic = NEW.`topic`
  );
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `sw_questions_integrity_before_update`
BEFORE UPDATE ON `sw_questions`
BEGIN
  SELECT RAISE(ABORT, 'sw_questions contains invalid JSON')
  WHERE NOT json_valid(NEW.`choices`) OR NOT json_valid(NEW.`correct_answers`)
    OR NOT json_valid(NEW.`tags`) OR NOT json_valid(NEW.`required_concepts`);
  SELECT RAISE(ABORT, 'sw_questions JSON shape is invalid')
  WHERE json_type(NEW.`choices`) <> 'array'
    OR json_type(NEW.`correct_answers`) <> 'array' OR json_type(NEW.`tags`) <> 'array'
    OR json_type(NEW.`required_concepts`) <> 'array';
  SELECT RAISE(ABORT, 'sw_questions answer contract is invalid')
  WHERE NEW.`kind` NOT IN ('single', 'multiple') OR NEW.`active` NOT IN (0, 1)
    OR json_array_length(NEW.`choices`) <> 4 OR json_array_length(NEW.`correct_answers`) = 0
    OR (NEW.`kind` = 'single' AND json_array_length(NEW.`correct_answers`) <> 1)
    OR EXISTS (SELECT 1 FROM json_each(NEW.`correct_answers`) answer
      WHERE answer.type <> 'integer' OR answer.value < 0
        OR answer.value >= json_array_length(NEW.`choices`));
  SELECT RAISE(ABORT, 'sw_questions theory relationship is inconsistent')
  WHERE NOT EXISTS (
    SELECT 1 FROM `sw_theories` theory WHERE theory.id = NEW.`theory_id`
      AND (NEW.`active` <> 1 OR theory.active = 1)
      AND theory.subject_group_id = NEW.`subject_group_id`
      AND theory.subject_id = NEW.`subject_id` AND theory.category = NEW.`category`
      AND theory.topic = NEW.`topic`
  );
  SELECT RAISE(ABORT, 'SW question is locked by an active learning session')
  WHERE (
    NEW.`id` <> OLD.`id` OR NEW.`active` <> OLD.`active` OR NEW.`kind` <> OLD.`kind`
      OR NEW.`choices` <> OLD.`choices` OR NEW.`correct_answers` <> OLD.`correct_answers`
  ) AND EXISTS (
    SELECT 1 FROM `sw_learning_sessions` session, json_each(session.question_ids) item
    WHERE session.status = 'active' AND json_valid(session.question_ids)
      AND item.value = OLD.`id`
  );
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `sw_session_maps_integrity_before_insert`
BEFORE INSERT ON `sw_learning_sessions`
WHEN json_valid(NEW.`question_ids`) AND json_type(NEW.`question_ids`) = 'array'
  AND json_valid(NEW.`answers`) AND json_type(NEW.`answers`) = 'object'
  AND json_valid(NEW.`revealed_question_ids`) AND json_type(NEW.`revealed_question_ids`) = 'array'
BEGIN
  SELECT RAISE(ABORT, 'sw_learning_sessions answer state is inconsistent')
  WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.`answers`) entry
    WHERE NOT EXISTS (SELECT 1 FROM json_each(NEW.`question_ids`) item
        WHERE item.value = entry.key)
      OR entry.type <> 'array' OR EXISTS (
        SELECT 1 FROM json_each(entry.value) answer
        JOIN `sw_questions` question ON question.id = entry.key
        WHERE answer.type <> 'integer' OR answer.value < 0
          OR answer.value >= json_array_length(question.choices)
      )
  ) OR EXISTS (SELECT 1 FROM json_each(NEW.`revealed_question_ids`) entry
    WHERE entry.type <> 'text' OR NOT EXISTS (
      SELECT 1 FROM json_each(NEW.`question_ids`) item WHERE item.value = entry.value));
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `sw_session_maps_integrity_before_update`
BEFORE UPDATE ON `sw_learning_sessions`
WHEN json_valid(NEW.`question_ids`) AND json_type(NEW.`question_ids`) = 'array'
  AND json_valid(NEW.`answers`) AND json_type(NEW.`answers`) = 'object'
  AND json_valid(NEW.`revealed_question_ids`) AND json_type(NEW.`revealed_question_ids`) = 'array'
BEGIN
  SELECT RAISE(ABORT, 'sw_learning_sessions answer state is inconsistent')
  WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.`answers`) entry
    WHERE NOT EXISTS (SELECT 1 FROM json_each(NEW.`question_ids`) item
        WHERE item.value = entry.key)
      OR entry.type <> 'array' OR EXISTS (
        SELECT 1 FROM json_each(entry.value) answer
        JOIN `sw_questions` question ON question.id = entry.key
        WHERE answer.type <> 'integer' OR answer.value < 0
          OR answer.value >= json_array_length(question.choices)
      )
  ) OR EXISTS (SELECT 1 FROM json_each(NEW.`revealed_question_ids`) entry
    WHERE entry.type <> 'text' OR NOT EXISTS (
      SELECT 1 FROM json_each(NEW.`question_ids`) item WHERE item.value = entry.value));
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `sw_theories_integrity_before_insert`
BEFORE INSERT ON `sw_theories`
BEGIN
  SELECT RAISE(ABORT, 'sw_theories.keywords must be an array')
  WHERE NOT json_valid(NEW.`keywords`) OR json_type(NEW.`keywords`) <> 'array';
  SELECT RAISE(ABORT, 'sw_theories.active must be 0 or 1')
  WHERE NEW.`active` NOT IN (0, 1);
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `sw_theories_integrity_before_update`
BEFORE UPDATE ON `sw_theories`
BEGIN
  SELECT RAISE(ABORT, 'sw_theories.keywords must be an array')
  WHERE NOT json_valid(NEW.`keywords`) OR json_type(NEW.`keywords`) <> 'array';
  SELECT RAISE(ABORT, 'sw_theories.active must be 0 or 1')
  WHERE NEW.`active` NOT IN (0, 1);
  SELECT RAISE(ABORT, 'active SW questions must be disabled before their theory')
  WHERE OLD.`active` = 1 AND NEW.`active` = 0 AND EXISTS (
    SELECT 1 FROM `sw_questions` question WHERE question.theory_id = NEW.`id`
      AND question.active = 1
  );
  SELECT RAISE(ABORT, 'SW theory update would invalidate active questions')
  WHERE EXISTS (
    SELECT 1 FROM `sw_questions` question WHERE question.theory_id = NEW.`id`
      AND question.active = 1 AND (
        NEW.`active` <> 1 OR NEW.`subject_group_id` <> question.subject_group_id
        OR NEW.`subject_id` <> question.subject_id OR NEW.`category` <> question.category
        OR NEW.`topic` <> question.topic
      )
  );
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `theories_integrity_before_insert`
BEFORE INSERT ON `theories`
BEGIN
  SELECT RAISE(ABORT, 'theories.keywords must be an array')
  WHERE NOT json_valid(NEW.`keywords`) OR json_type(NEW.`keywords`) <> 'array';
  SELECT RAISE(ABORT, 'theories scalar value is invalid')
  WHERE NEW.`active` NOT IN (0, 1) OR length(trim(NEW.`exam_scope`)) = 0
    OR NOT EXISTS (SELECT 1 FROM `course_content_scopes` scope
      WHERE scope.content_scope = NEW.`exam_scope`)
    OR EXISTS (SELECT 1 FROM `course_content_scopes` scope
      WHERE scope.content_scope = NEW.`exam_scope` AND NOT EXISTS (
        SELECT 1 FROM `course_subjects` subject
        WHERE subject.exam_type = scope.exam_type AND subject.subject = NEW.`category`
      ));
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `theories_integrity_before_update`
BEFORE UPDATE ON `theories`
BEGIN
  SELECT RAISE(ABORT, 'theories.keywords must be an array')
  WHERE NOT json_valid(NEW.`keywords`) OR json_type(NEW.`keywords`) <> 'array';
  SELECT RAISE(ABORT, 'theories scalar value is invalid')
  WHERE NEW.`active` NOT IN (0, 1) OR length(trim(NEW.`exam_scope`)) = 0
    OR NOT EXISTS (SELECT 1 FROM `course_content_scopes` scope
      WHERE scope.content_scope = NEW.`exam_scope`)
    OR EXISTS (SELECT 1 FROM `course_content_scopes` scope
      WHERE scope.content_scope = NEW.`exam_scope` AND NOT EXISTS (
        SELECT 1 FROM `course_subjects` subject
        WHERE subject.exam_type = scope.exam_type AND subject.subject = NEW.`category`
      ));
  SELECT RAISE(ABORT, 'active questions must be disabled before their theory')
  WHERE OLD.`active` = 1 AND NEW.`active` = 0 AND EXISTS (
    SELECT 1 FROM `questions` question WHERE question.theory_id = NEW.`id`
      AND question.active = 1
  );
  SELECT RAISE(ABORT, 'theory update would invalidate active questions')
  WHERE EXISTS (
    SELECT 1 FROM `questions` question WHERE question.theory_id = NEW.`id`
      AND question.active = 1 AND (
        NEW.`active` <> 1 OR NEW.`category` <> question.category OR EXISTS (
          SELECT 1 FROM `course_content_scopes` question_course
          WHERE question_course.content_scope = question.exam_scope
            AND NOT EXISTS (
              SELECT 1 FROM `course_content_scopes` theory_course
              WHERE theory_course.exam_type = question_course.exam_type
                AND theory_course.content_scope = NEW.`exam_scope`
            )
        )
      )
  );
END;
--> statement-breakpoint

INSERT INTO `app_schema_state` (`id`, `migration_version`, `applied_at`)
VALUES (1, '0554', CURRENT_TIMESTAMP)
ON CONFLICT (`id`) DO UPDATE SET
  `migration_version` = excluded.`migration_version`,
  `applied_at` = excluded.`applied_at`;
--> statement-breakpoint

