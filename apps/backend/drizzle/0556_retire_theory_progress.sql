-- Theory completion was retired in production before this migration.
-- Only obsolete theory progress is removed; practice and content remain intact.
DROP TABLE IF EXISTS `theory_progress`;
--> statement-breakpoint
DROP TABLE IF EXISTS `sw_theory_progress`;
--> statement-breakpoint
INSERT INTO `app_schema_state` (`id`, `migration_version`, `applied_at`)
VALUES (1, '0556', CURRENT_TIMESTAMP)
ON CONFLICT (`id`) DO UPDATE SET
  `migration_version` = excluded.`migration_version`,
  `applied_at` = excluded.`applied_at`;
--> statement-breakpoint
