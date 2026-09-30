-- Additive, feature-disabled-by-default infrastructure for synchronized SKCT group exams.
-- No SKCT source content is imported by this schema migration.

CREATE TABLE IF NOT EXISTS `skct_content_releases` (
  `id` text PRIMARY KEY NOT NULL,
  `status` text NOT NULL DEFAULT 'validated',
  `dataset` text NOT NULL,
  `schema_version` text NOT NULL,
  `completed_folder_id` text NOT NULL,
  `json_file_id` text NOT NULL,
  `json_sha256` text NOT NULL,
  `md_file_id` text NOT NULL,
  `md_sha256` text NOT NULL,
  `license_note` text NOT NULL DEFAULT '',
  `manifest_json` text NOT NULL DEFAULT '{}',
  `normalized_count` integer NOT NULL DEFAULT 0,
  `eligible_count` integer NOT NULL DEFAULT 0,
  `quarantine_count` integer NOT NULL DEFAULT 0,
  `release_sha256` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (`status` IN ('validated', 'active', 'retired')),
  CHECK (`normalized_count` >= 0 AND `eligible_count` >= 0 AND `quarantine_count` >= 0),
  CHECK (`eligible_count` + `quarantine_count` <= `normalized_count`)
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS `skct_content_releases_release_sha_uidx`
ON `skct_content_releases` (`release_sha256`);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `skct_question_public` (
  `release_id` text NOT NULL REFERENCES `skct_content_releases` (`id`) ON DELETE CASCADE,
  `question_uid` text NOT NULL,
  `content_set` text NOT NULL,
  `area_code` text NOT NULL,
  `question_no` integer NOT NULL,
  `kind` text NOT NULL DEFAULT 'single',
  `prompt_md` text NOT NULL,
  `choices_json` text NOT NULL,
  `dependency_group_id` text,
  `asset_refs_json` text NOT NULL DEFAULT '[]',
  `question_source_refs_json` text NOT NULL DEFAULT '[]',
  `question_hash` text NOT NULL,
  `eligibility` text NOT NULL DEFAULT 'quarantined',
  `quarantine_reasons_json` text NOT NULL DEFAULT '[]',
  PRIMARY KEY (`release_id`, `question_uid`),
  CHECK (`question_no` > 0),
  CHECK (`kind` = 'single'),
  CHECK (`area_code` IN ('언어이해', '자료해석', '창의수리', '언어추리', '수열추리')),
  CHECK (`eligibility` IN ('eligible', 'quarantined', 'excluded'))
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `skct_question_public_selection_idx`
ON `skct_question_public` (`release_id`, `eligibility`, `area_code`, `question_uid`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `skct_question_public_dependency_idx`
ON `skct_question_public` (`release_id`, `dependency_group_id`, `question_uid`);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `skct_question_secret` (
  `release_id` text NOT NULL,
  `question_uid` text NOT NULL,
  `correct_answers_json` text NOT NULL,
  `explanation_md` text NOT NULL,
  `answer_source_refs_json` text NOT NULL DEFAULT '[]',
  `secret_hash` text NOT NULL,
  PRIMARY KEY (`release_id`, `question_uid`),
  FOREIGN KEY (`release_id`, `question_uid`)
    REFERENCES `skct_question_public` (`release_id`, `question_uid`) ON DELETE CASCADE
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `study_groups` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `owner_user_key` text NOT NULL,
  `member_limit` integer NOT NULL DEFAULT 50,
  `admin_question_count_override` integer,
  `settings_json` text NOT NULL DEFAULT '{}',
  `status` text NOT NULL DEFAULT 'active',
  `revision` integer NOT NULL DEFAULT 0,
  `last_mutation_execution_id` text,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (`member_limit` BETWEEN 2 AND 50),
  CHECK (`admin_question_count_override` IS NULL OR `admin_question_count_override` BETWEEN 1 AND 500),
  CHECK (`status` IN ('active', 'archived')),
  CHECK (`revision` >= 0)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `study_groups_owner_status_idx`
ON `study_groups` (`owner_user_key`, `status`, `updated_at`);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `study_group_members` (
  `group_id` text NOT NULL REFERENCES `study_groups` (`id`) ON DELETE CASCADE,
  `user_key` text NOT NULL,
  `public_id` text NOT NULL,
  `public_name` text NOT NULL,
  `status` text NOT NULL DEFAULT 'active',
  `membership_epoch` integer NOT NULL DEFAULT 1,
  `last_mutation_execution_id` text,
  `joined_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `left_at` text,
  PRIMARY KEY (`group_id`, `user_key`),
  CHECK (`status` IN ('active', 'left', 'kicked')),
  CHECK (`membership_epoch` > 0)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `study_group_members_group_status_idx`
ON `study_group_members` (`group_id`, `status`, `user_key`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `study_group_members_user_status_idx`
ON `study_group_members` (`user_key`, `status`, `group_id`);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS `study_group_members_public_id_uidx`
ON `study_group_members` (`group_id`, `public_id`);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `study_group_membership_events` (
  `id` text PRIMARY KEY NOT NULL,
  `group_id` text NOT NULL REFERENCES `study_groups` (`id`) ON DELETE CASCADE,
  `user_key` text NOT NULL,
  `membership_epoch` integer NOT NULL,
  `event_type` text NOT NULL,
  `actor_user_key` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (`event_type` IN ('joined', 'left', 'kicked', 'rejoined', 'owner_transferred'))
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `study_group_membership_events_group_time_idx`
ON `study_group_membership_events` (`group_id`, `created_at`, `id`);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `study_group_invites` (
  `id` text PRIMARY KEY NOT NULL,
  `group_id` text NOT NULL REFERENCES `study_groups` (`id`) ON DELETE CASCADE,
  `token_digest` text NOT NULL,
  `status` text NOT NULL DEFAULT 'active',
  `expires_at` text NOT NULL,
  `created_by_user_key` text NOT NULL,
  `consumed_by_user_key` text,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `consumed_at` text,
  `revoked_at` text,
  `revision` integer NOT NULL DEFAULT 0,
  `last_mutation_execution_id` text,
  CHECK (`status` IN ('active', 'accepted', 'revoked', 'expired')),
  CHECK (`revision` >= 0)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `study_group_invites_group_status_expiry_idx`
ON `study_group_invites` (`group_id`, `status`, `expires_at`);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS `study_group_invites_token_digest_uidx`
ON `study_group_invites` (`token_digest`);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `study_group_quota_slots` (
  `group_id` text NOT NULL REFERENCES `study_groups` (`id`) ON DELETE CASCADE,
  `date_key` text NOT NULL,
  `slot_no` integer NOT NULL,
  `source` text NOT NULL DEFAULT 'base',
  `status` text NOT NULL DEFAULT 'available',
  `reserved_run_id` text,
  `revision` integer NOT NULL DEFAULT 0,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`group_id`, `date_key`, `slot_no`),
  CHECK (`slot_no` > 0),
  CHECK (`source` IN ('base', 'admin_grant')),
  CHECK (`status` IN ('available', 'reserved', 'consumed')),
  CHECK (`revision` >= 0)
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS `study_group_quota_slots_run_uidx`
ON `study_group_quota_slots` (`reserved_run_id`) WHERE `reserved_run_id` IS NOT NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `study_group_quota_slots_available_idx`
ON `study_group_quota_slots` (`group_id`, `date_key`, `status`, `slot_no`);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `study_group_exam_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `group_id` text NOT NULL REFERENCES `study_groups` (`id`) ON DELETE RESTRICT,
  `start_request_id` text NOT NULL,
  `mode` text NOT NULL,
  `status` text NOT NULL,
  `scheduled_at_utc` text,
  `actual_started_at_utc` text,
  `quota_date_key` text NOT NULL,
  `quota_slot_no` integer NOT NULL,
  `question_count_snapshot` integer NOT NULL,
  `settings_snapshot_json` text NOT NULL,
  `source_release_id` text NOT NULL REFERENCES `skct_content_releases` (`id`) ON DELETE RESTRICT,
  `source_release_sha256` text NOT NULL,
  `participant_count_snapshot` integer NOT NULL DEFAULT 0,
  `final_deadline_at_utc` text,
  `lease_owner` text,
  `lease_until` text,
  `revision` integer NOT NULL DEFAULT 0,
  `created_by_user_key` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `completed_at` text,
  `canceled_at` text,
  `failure_code` text,
  `last_mutation_execution_id` text,
  CHECK (`mode` IN ('immediate', 'scheduled')),
  CHECK (`status` IN ('scheduled', 'starting', 'running', 'finalizing', 'completed', 'canceled', 'failed_prestart')),
  CHECK (`question_count_snapshot` BETWEEN 1 AND 500),
  CHECK (`participant_count_snapshot` >= 0),
  CHECK (`quota_slot_no` > 0),
  CHECK (`revision` >= 0)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `study_group_exam_runs_group_status_time_idx`
ON `study_group_exam_runs` (`group_id`, `status`, `scheduled_at_utc`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `study_group_exam_runs_due_idx`
ON `study_group_exam_runs` (`status`, `scheduled_at_utc`, `lease_until`);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS `study_group_exam_runs_start_request_uidx`
ON `study_group_exam_runs` (`start_request_id`);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS `study_group_exam_runs_one_scheduled_uidx`
ON `study_group_exam_runs` (`group_id`) WHERE `status` = 'scheduled';
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `study_group_active_runs` (
  `group_id` text PRIMARY KEY NOT NULL REFERENCES `study_groups` (`id`) ON DELETE CASCADE,
  `run_id` text NOT NULL REFERENCES `study_group_exam_runs` (`id`) ON DELETE CASCADE,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS `study_group_active_runs_run_uidx`
ON `study_group_active_runs` (`run_id`);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `study_group_quota_events` (
  `id` text PRIMARY KEY NOT NULL,
  `idempotency_key` text NOT NULL,
  `group_id` text NOT NULL REFERENCES `study_groups` (`id`) ON DELETE CASCADE,
  `date_key` text NOT NULL,
  `slot_no` integer NOT NULL,
  `run_id` text,
  `event_type` text NOT NULL,
  `actor_user_key` text,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (`event_type` IN ('reserve', 'consume', 'refund', 'admin_grant'))
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `study_group_quota_events_group_time_idx`
ON `study_group_quota_events` (`group_id`, `date_key`, `created_at`);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS `study_group_quota_events_idempotency_uidx`
ON `study_group_quota_events` (`idempotency_key`);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `study_group_exam_participants` (
  `run_id` text NOT NULL REFERENCES `study_group_exam_runs` (`id`) ON DELETE CASCADE,
  `user_key` text NOT NULL,
  `public_name_snapshot` text NOT NULL,
  `membership_epoch_snapshot` integer NOT NULL,
  `status` text NOT NULL DEFAULT 'rostered',
  `submitted_at` text,
  `last_mutation_execution_id` text,
  `score` integer,
  `wrong_count` integer,
  `wrong_positions_json` text NOT NULL DEFAULT '[]',
  PRIMARY KEY (`run_id`, `user_key`),
  CHECK (`status` IN ('rostered', 'in_progress', 'submitted', 'auto_submitted', 'no_show')),
  CHECK (`membership_epoch_snapshot` > 0),
  CHECK (`score` IS NULL OR `score` >= 0),
  CHECK (`wrong_count` IS NULL OR `wrong_count` >= 0)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `study_group_exam_participants_run_status_idx`
ON `study_group_exam_participants` (`run_id`, `status`, `user_key`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `study_group_exam_participants_rank_idx`
ON `study_group_exam_participants` (`run_id`, `score` DESC, `public_name_snapshot`);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `study_group_exam_question_public` (
  `run_id` text NOT NULL REFERENCES `study_group_exam_runs` (`id`) ON DELETE CASCADE,
  `position` integer NOT NULL,
  `source_question_uid` text NOT NULL,
  `area_code_snapshot` text NOT NULL,
  `prompt_snapshot` text NOT NULL,
  `choices_snapshot_json` text NOT NULL,
  `asset_refs_snapshot_json` text NOT NULL DEFAULT '[]',
  `dependency_group_id_snapshot` text,
  `time_limit_seconds` integer NOT NULL,
  `opens_at_utc` text,
  `deadline_at_utc` text,
  `snapshot_hash` text NOT NULL,
  PRIMARY KEY (`run_id`, `position`),
  CHECK (`position` >= 0),
  CHECK (`time_limit_seconds` BETWEEN 1 AND 3600),
  CHECK (`area_code_snapshot` IN ('언어이해', '자료해석', '창의수리', '언어추리', '수열추리'))
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `study_group_exam_question_secret` (
  `run_id` text NOT NULL,
  `position` integer NOT NULL,
  `correct_answers_snapshot_json` text NOT NULL,
  `explanation_snapshot` text NOT NULL,
  `secret_hash` text NOT NULL,
  PRIMARY KEY (`run_id`, `position`),
  FOREIGN KEY (`run_id`, `position`)
    REFERENCES `study_group_exam_question_public` (`run_id`, `position`) ON DELETE CASCADE
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `study_group_exam_answers` (
  `run_id` text NOT NULL,
  `user_key` text NOT NULL,
  `position` integer NOT NULL,
  `answer_json` text NOT NULL DEFAULT '[]',
  `revision` integer NOT NULL DEFAULT 0,
  `last_client_operation_id` text NOT NULL,
  `server_received_at_utc` text NOT NULL,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`run_id`, `user_key`, `position`),
  FOREIGN KEY (`run_id`, `user_key`)
    REFERENCES `study_group_exam_participants` (`run_id`, `user_key`) ON DELETE CASCADE,
  CHECK (`position` >= 0),
  CHECK (`revision` >= 0)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `study_group_exam_answers_participant_idx`
ON `study_group_exam_answers` (`run_id`, `user_key`, `position`);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `study_group_answer_operations` (
  `operation_id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `user_key` text NOT NULL,
  `position` integer NOT NULL,
  `answer_hash` text NOT NULL,
  `result_revision` integer NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`run_id`, `user_key`, `position`)
    REFERENCES `study_group_exam_answers` (`run_id`, `user_key`, `position`) ON DELETE CASCADE
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `study_group_idempotency` (
  `actor_user_key` text NOT NULL,
  `action` text NOT NULL,
  `idempotency_key` text NOT NULL,
  `request_digest` text NOT NULL,
  `execution_id` text NOT NULL,
  `response_status` integer NOT NULL,
  `response_json` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`actor_user_key`, `action`, `idempotency_key`)
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `study_group_audit_events` (
  `id` text PRIMARY KEY NOT NULL,
  `group_id` text NOT NULL REFERENCES `study_groups` (`id`) ON DELETE CASCADE,
  `actor_user_key` text NOT NULL,
  `action` text NOT NULL,
  `target_id` text,
  `before_summary` text NOT NULL DEFAULT '{}',
  `after_summary` text NOT NULL DEFAULT '{}',
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `study_group_audit_events_group_time_idx`
ON `study_group_audit_events` (`group_id`, `created_at`, `id`);
--> statement-breakpoint

INSERT INTO `app_schema_state` (`id`, `migration_version`, `applied_at`)
VALUES (1, '0558', CURRENT_TIMESTAMP)
ON CONFLICT (`id`) DO UPDATE SET
  `migration_version` = excluded.`migration_version`,
  `applied_at` = excluded.`applied_at`;
--> statement-breakpoint
