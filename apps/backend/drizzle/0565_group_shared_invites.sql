ALTER TABLE study_group_invites ADD COLUMN reusable INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE app_schema_state SET migration_version = '0565', applied_at = CURRENT_TIMESTAMP WHERE id = 1;
