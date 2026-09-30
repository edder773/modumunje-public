-- Independent personal SKCT content and attempts. Existing study and group tables are untouched.
CREATE TABLE IF NOT EXISTS skct_personal_releases (
  id text PRIMARY KEY NOT NULL,
  status text NOT NULL CHECK (status IN ('STAGED', 'ACTIVE', 'RETIRED')),
  content_sha256 text NOT NULL,
  item_count integer NOT NULL CHECK (item_count = 300),
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  activated_at text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS skct_personal_one_active ON skct_personal_releases(status) WHERE status='ACTIVE';
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS skct_personal_public_items (
  release_id text NOT NULL REFERENCES skct_personal_releases(id) ON DELETE RESTRICT,
  source_item_id text NOT NULL,
  unit_id text NOT NULL CHECK (unit_id IN ('U01','U02','U03','U04','U05')),
  source_batch text NOT NULL,
  source_archive_sha256 text NOT NULL,
  source_file text NOT NULL,
  source_file_sha256 text NOT NULL,
  source_ordinal integer NOT NULL,
  source_schema_version text NOT NULL,
  public_json text NOT NULL,
  public_sha256 text NOT NULL,
  asset_refs_json text NOT NULL,
  PRIMARY KEY (release_id, source_item_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS skct_personal_items_unit ON skct_personal_public_items(release_id,unit_id,source_batch,source_ordinal);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS skct_personal_secret_items (
  release_id text NOT NULL,
  source_item_id text NOT NULL,
  answer_index integer NOT NULL CHECK (answer_index BETWEEN 1 AND 5),
  raw_answer_json text NOT NULL,
  explanation text NOT NULL,
  distractor_explanations_json text NOT NULL,
  source_raw_json text NOT NULL,
  normalization_version text NOT NULL,
  secret_sha256 text NOT NULL,
  PRIMARY KEY (release_id, source_item_id),
  FOREIGN KEY (release_id,source_item_id) REFERENCES skct_personal_public_items(release_id,source_item_id) ON DELETE RESTRICT
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS skct_personal_attempts (
  id text PRIMARY KEY NOT NULL,
  user_key text NOT NULL,
  release_id text NOT NULL REFERENCES skct_personal_releases(id) ON DELETE RESTRICT,
  unit_id text NOT NULL CHECK (unit_id IN ('U01','U02','U03','U04','U05')),
  mode text NOT NULL CHECK (mode IN ('practice','mock')),
  status text NOT NULL CHECK (status IN ('in_progress','submitted')),
  revision integer NOT NULL DEFAULT 0,
  active_position integer,
  active_since text,
  started_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  submitted_at text,
  last_operation_id text,
  last_operation_digest text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS skct_personal_attempts_owner ON skct_personal_attempts(user_key,started_at DESC,id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS skct_personal_attempts_started ON skct_personal_attempts(started_at DESC,id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS skct_personal_one_open_attempt ON skct_personal_attempts(user_key,unit_id,mode) WHERE status='in_progress';
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS skct_personal_attempt_items (
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
  UNIQUE (attempt_id,source_item_id),
  FOREIGN KEY (release_id,source_item_id) REFERENCES skct_personal_public_items(release_id,source_item_id) ON DELETE RESTRICT
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS skct_personal_release_audit (
  id text PRIMARY KEY NOT NULL,
  release_id text NOT NULL REFERENCES skct_personal_releases(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('import','validate','activate','rollback')),
  actor text NOT NULL,
  evidence_sha256 text,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS skct_personal_public_immutable_update BEFORE UPDATE ON skct_personal_public_items
BEGIN SELECT RAISE(ABORT,'SKCT personal public content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS skct_personal_public_immutable_delete BEFORE DELETE ON skct_personal_public_items
BEGIN SELECT RAISE(ABORT,'SKCT personal public content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS skct_personal_secret_immutable_update BEFORE UPDATE ON skct_personal_secret_items
BEGIN SELECT RAISE(ABORT,'SKCT personal secret content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS skct_personal_secret_immutable_delete BEFORE DELETE ON skct_personal_secret_items
BEGIN SELECT RAISE(ABORT,'SKCT personal secret content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS skct_personal_release_content_immutable BEFORE UPDATE OF id,content_sha256,item_count ON skct_personal_releases
BEGIN SELECT RAISE(ABORT,'SKCT personal release identity is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS skct_personal_release_transition BEFORE UPDATE OF status ON skct_personal_releases
WHEN NOT ((OLD.status='STAGED' AND NEW.status IN ('ACTIVE','RETIRED')) OR (OLD.status='ACTIVE' AND NEW.status='RETIRED'))
BEGIN SELECT RAISE(ABORT,'Invalid SKCT personal release transition'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS skct_personal_release_immutable_delete BEFORE DELETE ON skct_personal_releases
BEGIN SELECT RAISE(ABORT,'SKCT personal releases are immutable'); END;
--> statement-breakpoint
INSERT INTO app_schema_state (id,migration_version,applied_at) VALUES (1,'0561',CURRENT_TIMESTAMP)
ON CONFLICT(id) DO UPDATE SET migration_version=excluded.migration_version, applied_at=excluded.applied_at;
