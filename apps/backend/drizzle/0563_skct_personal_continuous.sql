-- Preserve existing personal attempts while allowing a source item to recur
-- after every item in the release has been practiced within one open attempt.
CREATE TABLE skct_personal_attempt_items_next (
  attempt_id text NOT NULL REFERENCES skct_personal_attempts(id) ON DELETE RESTRICT,
  release_id text NOT NULL,
  position integer NOT NULL,
  source_item_id text NOT NULL,
  selected_index integer CHECK (selected_index BETWEEN 1 AND 5),
  finalized_at text,
  elapsed_seconds integer NOT NULL DEFAULT 0 CHECK (elapsed_seconds >= 0),
  last_operation_id text,
  last_operation_digest text,
  PRIMARY KEY (attempt_id,position),
  FOREIGN KEY (release_id,source_item_id) REFERENCES skct_personal_public_items(release_id,source_item_id) ON DELETE RESTRICT
);
--> statement-breakpoint
INSERT INTO skct_personal_attempt_items_next (
  attempt_id,release_id,position,source_item_id,selected_index,finalized_at,
  elapsed_seconds,last_operation_id,last_operation_digest
) SELECT attempt_id,release_id,position,source_item_id,selected_index,finalized_at,
  elapsed_seconds,last_operation_id,last_operation_digest FROM skct_personal_attempt_items;
--> statement-breakpoint
DROP TABLE skct_personal_attempt_items;
--> statement-breakpoint
ALTER TABLE skct_personal_attempt_items_next RENAME TO skct_personal_attempt_items;
--> statement-breakpoint
CREATE INDEX skct_personal_attempt_items_source_idx
  ON skct_personal_attempt_items(attempt_id,source_item_id);
--> statement-breakpoint
INSERT INTO app_schema_state (id,migration_version,applied_at) VALUES (1,'0563',CURRENT_TIMESTAMP)
ON CONFLICT(id) DO UPDATE SET migration_version=excluded.migration_version, applied_at=excluded.applied_at;
