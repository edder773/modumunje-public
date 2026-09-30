-- Register isolated intake scopes; no learning content is published here.
INSERT OR IGNORE INTO `course_content_scopes` (`exam_type`, `content_scope`)
VALUES ('ISEW', 'ISEW'), ('ISEP', 'ISEP');
--> statement-breakpoint

INSERT OR IGNORE INTO `course_subjects` (`exam_type`, `subject`)
VALUES
  ('ISEW', '시스템보안'),
  ('ISEW', '네트워크보안'),
  ('ISEW', '어플리케이션보안'),
  ('ISEW', '정보보안일반'),
  ('ISEW', '정보보안관리 및 법규'),
  ('ISEP', '정보보안 실무');
--> statement-breakpoint

INSERT INTO `app_schema_state` (`id`, `migration_version`, `applied_at`)
VALUES (1, '0557', CURRENT_TIMESTAMP)
ON CONFLICT (`id`) DO UPDATE SET
  `migration_version` = excluded.`migration_version`,
  `applied_at` = excluded.`applied_at`;
--> statement-breakpoint
