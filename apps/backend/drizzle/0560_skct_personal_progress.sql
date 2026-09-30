-- Forward-only. Preflight must return zero owners with >3 active groups.
CREATE TABLE `_migration_0560_owner_guard` (`violations` integer NOT NULL CHECK (`violations` = 0));
--> statement-breakpoint
INSERT INTO `_migration_0560_owner_guard` SELECT COUNT(*) FROM (
  SELECT owner_user_key FROM study_groups WHERE status = 'active' GROUP BY owner_user_key HAVING COUNT(*) > 3
);
--> statement-breakpoint
DROP TABLE `_migration_0560_owner_guard`;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS study_group_owner_slots (
 group_id text PRIMARY KEY NOT NULL REFERENCES study_groups(id) ON DELETE CASCADE,
 owner_user_key text NOT NULL,
 slot integer NOT NULL CHECK(slot BETWEEN 1 AND 3)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS study_group_owner_slots_owner_slot_uidx ON study_group_owner_slots(owner_user_key,slot);
--> statement-breakpoint
INSERT OR IGNORE INTO study_group_owner_slots(group_id,owner_user_key,slot)
SELECT id,owner_user_key,ROW_NUMBER() OVER(PARTITION BY owner_user_key ORDER BY created_at,id)
FROM study_groups WHERE status='active';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS study_group_exam_run_contract_v2 (
 run_id text PRIMARY KEY NOT NULL REFERENCES study_group_exam_runs(id) ON DELETE CASCADE,
 advance_time_policy text NOT NULL CHECK(advance_time_policy IN ('carry_remaining','reset_to_base')),
 repeat_policy text NOT NULL CHECK(repeat_policy IN ('allow','forbid')),
 selection_json text NOT NULL DEFAULT '{}',
 created_at text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS skct_question_identity (
 release_id text NOT NULL,
 question_uid text NOT NULL,
 question_identity text NOT NULL,
 bundle_identity text NOT NULL,
 identity_material_json text NOT NULL,
 identity_version integer NOT NULL DEFAULT 1 CHECK(identity_version = 1),
 PRIMARY KEY(release_id, question_uid),
 FOREIGN KEY(release_id, question_uid) REFERENCES skct_question_public(release_id, question_uid) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS study_group_exam_question_identity_snapshot (
 run_id text NOT NULL,
 position integer NOT NULL,
 question_identity text NOT NULL,
 bundle_identity text NOT NULL,
 content_set text NOT NULL,
 PRIMARY KEY(run_id, position),
 FOREIGN KEY(run_id, position) REFERENCES study_group_exam_question_public(run_id, position) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS study_group_exam_repeat_claims (
 group_id text NOT NULL REFERENCES study_groups(id) ON DELETE CASCADE,
 question_identity text NOT NULL,
 run_id text NOT NULL REFERENCES study_group_exam_runs(id) ON DELETE CASCADE,
 PRIMARY KEY(group_id, question_identity)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS study_group_exam_participant_progress (
 run_id text NOT NULL,
 user_key text NOT NULL,
 participant_id text NOT NULL,
 roster_position integer NOT NULL CHECK(roster_position >= 0),
 current_position integer NOT NULL CHECK(current_position >= 0),
 current_opened_at_utc text NOT NULL,
 current_deadline_at_utc text NOT NULL,
 carried_ms integer NOT NULL DEFAULT 0 CHECK(carried_ms >= 0),
 started_at_utc text NOT NULL,
 connected_at_utc text,
 finished_at_utc text,
 terminal_status text CHECK(terminal_status IN ('submitted','auto_submitted','no_show')),
 correct_count integer,
 incorrect_count integer,
 unanswered_count integer,
 revision integer NOT NULL DEFAULT 0 CHECK(revision >= 0),
 last_mutation_execution_id text,
 PRIMARY KEY(run_id,user_key),
 FOREIGN KEY(run_id,user_key) REFERENCES study_group_exam_participants(run_id,user_key) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS study_group_progress_due_idx ON study_group_exam_participant_progress(run_id, finished_at_utc, current_deadline_at_utc);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS study_group_progress_roster_idx ON study_group_exam_participant_progress(run_id, roster_position);
--> statement-breakpoint
INSERT INTO app_schema_state (id,migration_version,applied_at) VALUES (1,'0560',CURRENT_TIMESTAMP)
ON CONFLICT(id) DO UPDATE SET migration_version=excluded.migration_version, applied_at=excluded.applied_at;
