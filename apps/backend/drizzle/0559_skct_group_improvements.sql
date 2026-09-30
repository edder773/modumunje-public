CREATE TABLE IF NOT EXISTS `study_group_presence_sessions` (
  `group_id` text NOT NULL,
  `user_key` text NOT NULL,
  `session_id` text NOT NULL,
  `page_context` text NOT NULL DEFAULT 'lobby',
  `visible` integer NOT NULL DEFAULT 1,
  `last_seen_at` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`group_id`, `user_key`, `session_id`),
  FOREIGN KEY (`group_id`, `user_key`)
    REFERENCES `study_group_members` (`group_id`, `user_key`) ON DELETE CASCADE,
  CHECK (`page_context` IN ('lobby', 'exam')),
  CHECK (`visible` IN (0, 1))
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `study_group_presence_sessions_group_seen_idx`
ON `study_group_presence_sessions` (`group_id`, `last_seen_at`, `user_key`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `study_group_presence_sessions_user_seen_idx`
ON `study_group_presence_sessions` (`user_key`, `last_seen_at`, `group_id`);
--> statement-breakpoint

CREATE TABLE `_migration_0559_run_question_duplicate_guard` (
  `duplicates_must_be_zero` integer NOT NULL CHECK (`duplicates_must_be_zero` = 0)
);
--> statement-breakpoint

INSERT INTO `_migration_0559_run_question_duplicate_guard` (`duplicates_must_be_zero`)
SELECT COUNT(*)
FROM (
  SELECT `run_id`, `source_question_uid`
  FROM `study_group_exam_question_public`
  GROUP BY `run_id`, `source_question_uid`
  HAVING COUNT(*) > 1
);
--> statement-breakpoint

DROP TABLE `_migration_0559_run_question_duplicate_guard`;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS `study_group_exam_question_public_source_uidx`
ON `study_group_exam_question_public` (`run_id`, `source_question_uid`);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `study_group_exam_runs_finalization_idx`
ON `study_group_exam_runs` (`status`, `final_deadline_at_utc`, `id`);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `study_group_exam_selection_metadata` (
  `run_id` text PRIMARY KEY NOT NULL REFERENCES `study_group_exam_runs` (`id`) ON DELETE CASCADE,
  `algorithm_version` text NOT NULL,
  `seed` text NOT NULL,
  `history_cutoff_utc` text NOT NULL,
  `history_digest_sha256` text NOT NULL,
  `snapshot_digest_sha256` text NOT NULL,
  `repeat_policy` text NOT NULL DEFAULT 'allow',
  `repeat_fallback` integer NOT NULL DEFAULT 0,
  `area_policy` text NOT NULL,
  `settings_schema_version` integer NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (`repeat_policy` = 'allow'),
  CHECK (`repeat_fallback` IN (0, 1)),
  CHECK (`settings_schema_version` > 0)
);
--> statement-breakpoint

INSERT INTO `app_schema_state` (`id`, `migration_version`, `applied_at`)
VALUES (1, '0559', CURRENT_TIMESTAMP)
ON CONFLICT (`id`) DO UPDATE SET
  `migration_version` = excluded.`migration_version`,
  `applied_at` = excluded.`applied_at`;
--> statement-breakpoint
