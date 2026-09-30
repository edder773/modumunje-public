-- Register the practical subject before importing its versioned learning content.
-- Existing written/common subject bindings remain valid for historical data.
INSERT OR IGNORE INTO `course_subjects` (`exam_type`, `subject`)
VALUES ('IPEP', '정보처리실무');
--> statement-breakpoint

INSERT INTO `app_schema_state` (`id`, `migration_version`, `applied_at`)
VALUES (1, '0555', CURRENT_TIMESTAMP)
ON CONFLICT (`id`) DO UPDATE SET
  `migration_version` = excluded.`migration_version`,
  `applied_at` = excluded.`applied_at`;
--> statement-breakpoint
