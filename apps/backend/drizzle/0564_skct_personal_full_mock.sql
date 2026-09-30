-- Existing attempts and answer rows remain intact. Fresh starts use unique request IDs.
ALTER TABLE skct_personal_attempts ADD COLUMN start_request_id text;
--> statement-breakpoint
ALTER TABLE skct_personal_attempts ADD COLUMN full_mock_json text;
--> statement-breakpoint
DROP INDEX IF EXISTS skct_personal_one_open_attempt;
--> statement-breakpoint
CREATE UNIQUE INDEX skct_personal_one_open_legacy_attempt
  ON skct_personal_attempts(user_key,unit_id,mode)
  WHERE status='in_progress' AND start_request_id IS NULL;
--> statement-breakpoint
INSERT INTO app_schema_state (id,migration_version,applied_at) VALUES (1,'0564',CURRENT_TIMESTAMP)
ON CONFLICT(id) DO UPDATE SET migration_version=excluded.migration_version, applied_at=excluded.applied_at;
