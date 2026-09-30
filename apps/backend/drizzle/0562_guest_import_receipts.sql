CREATE TABLE IF NOT EXISTS guest_import_receipts (
  user_key text NOT NULL,
  import_id text NOT NULL,
  payload_digest text NOT NULL,
  imported_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_key, import_id),
  FOREIGN KEY (user_key, import_id) REFERENCES guest_import_batches (user_key, import_id)
    ON DELETE CASCADE
    DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
INSERT INTO app_schema_state (id,migration_version,applied_at) VALUES (1,'0562',CURRENT_TIMESTAMP)
ON CONFLICT(id) DO UPDATE SET migration_version=excluded.migration_version, applied_at=excluded.applied_at;
