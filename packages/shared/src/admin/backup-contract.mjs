export const BACKUP_VERSION = "1";
export const EXTERNAL_BACKUP_VERSION = "2";
export const EXTERNAL_BACKUP_FORMAT = "baeumzip-external-parts-v1";
export const BACKUP_SCHEMA_VERSION = "admin-9";
export const PREVIOUS_BACKUP_SCHEMA_VERSION = "admin-8";
export const BACKUP_CHUNK_LENGTH = 120_000;

const CONTENT_TABLES = [
  "theories",
  "questions",
  "sw_theories",
  "sw_questions",
  "content_releases",
  "skct_content_releases",
  "skct_question_public",
  "skct_question_secret",
  "skct_personal_releases",
  "skct_personal_public_items",
  "skct_personal_secret_items",
  "skct_personal_release_audit",
];

const ADMIN5_CONTENT_TABLES = CONTENT_TABLES.slice(0, 5);

const LEARNER_STATE_TABLES = [
  "user_accounts",
  "user_settings",
  "guest_import_batches",
  "guest_import_receipts",
  "user_bookmarks",
  "exam_sessions",
  "exam_session_items",
  "exam_active_sessions",
  "attempts",
  "ai_evaluations",
  "sw_attempts",
  "sw_learning_sessions",
  "study_groups",
  "study_group_members",
  "study_group_membership_events",
  "study_group_invites",
  "study_group_quota_slots",
  "study_group_exam_runs",
  "study_group_exam_selection_metadata",
  "study_group_active_runs",
  "study_group_quota_events",
  "study_group_exam_participants",
  "study_group_exam_question_public",
  "study_group_exam_question_secret",
  "study_group_exam_answers",
  "study_group_answer_operations",
  "study_group_idempotency",
  "study_group_audit_events",
  "study_group_owner_slots",
  "study_group_exam_run_contract_v2",
  "skct_question_identity",
  "study_group_exam_question_identity_snapshot",
  "study_group_exam_repeat_claims",
  "study_group_exam_participant_progress",
  "skct_personal_attempts",
  "skct_personal_attempt_items",
];

const ADMIN5_LEARNER_STATE_TABLES = LEARNER_STATE_TABLES.filter(table => table !== "guest_import_receipts").slice(0, 11);

export const BACKUP_TABLES = {
  content: [...CONTENT_TABLES],
  learning: [...CONTENT_TABLES, ...LEARNER_STATE_TABLES],
  settings: ["site_settings"],
  full: [
    ...CONTENT_TABLES,
    ...LEARNER_STATE_TABLES,
    "user_reports",
    "site_settings",
  ],
};

export const RESTORE_TABLES = {
  skct_personal_releases: { primaryKey: "id", columns: ["id", "status", "content_sha256", "item_count", "created_at", "activated_at"] },
  skct_personal_public_items: { primaryKey: ["release_id", "source_item_id"], columns: ["release_id", "source_item_id", "unit_id", "source_batch", "source_archive_sha256", "source_file", "source_file_sha256", "source_ordinal", "source_schema_version", "public_json", "public_sha256", "asset_refs_json"] },
  skct_personal_secret_items: { primaryKey: ["release_id", "source_item_id"], columns: ["release_id", "source_item_id", "answer_index", "raw_answer_json", "explanation", "distractor_explanations_json", "source_raw_json", "normalization_version", "secret_sha256"] },
  skct_personal_release_audit: { primaryKey: "id", columns: ["id", "release_id", "event_type", "actor", "evidence_sha256", "created_at"] },
  skct_personal_attempts: { primaryKey: "id", columns: ["id", "user_key", "release_id", "unit_id", "mode", "status", "revision", "active_position", "active_since", "started_at", "submitted_at", "last_operation_id", "last_operation_digest"] },
  skct_personal_attempt_items: { primaryKey: ["attempt_id", "position"], columns: ["attempt_id", "release_id", "position", "source_item_id", "selected_index", "finalized_at", "elapsed_seconds", "last_operation_id", "last_operation_digest"] },
  study_group_owner_slots: { primaryKey: "group_id", columns: ["group_id", "owner_user_key", "slot"] },
  study_group_exam_run_contract_v2: { primaryKey: "run_id", columns: ["run_id", "advance_time_policy", "repeat_policy", "selection_json", "created_at"] },
  skct_question_identity: { primaryKey: ["release_id", "question_uid"], columns: ["release_id", "question_uid", "question_identity", "bundle_identity", "identity_material_json", "identity_version"] },
  study_group_exam_question_identity_snapshot: { primaryKey: ["run_id", "position"], columns: ["run_id", "position", "question_identity", "bundle_identity", "content_set"] },
  study_group_exam_repeat_claims: { primaryKey: ["group_id", "question_identity"], columns: ["group_id", "question_identity", "run_id"] },
  study_group_exam_participant_progress: { primaryKey: ["run_id", "user_key"], columns: ["run_id", "user_key", "participant_id", "roster_position", "current_position", "current_opened_at_utc", "current_deadline_at_utc", "carried_ms", "started_at_utc", "connected_at_utc", "finished_at_utc", "terminal_status", "correct_count", "incorrect_count", "unanswered_count", "revision", "last_mutation_execution_id"] },

  user_accounts: {
    primaryKey: "user_key",
    columns: [
      "user_key", "email", "display_name", "status", "blocked_reason",
      "blocked_at", "blocked_by_hash", "created_at", "last_login_at",
      "updated_at",
    ],
  },
  theories: {
    primaryKey: "id",
    columns: [
      "id", "title", "category", "topic", "sort_order", "exam_scope",
      "difficulty", "active", "summary", "content", "keywords", "review_answers",
      "created_at", "updated_at",
    ],
  },
  questions: {
    primaryKey: "id",
    columns: [
      "id", "category", "topic", "display_order", "exam_scope", "difficulty",
      "difficulty_rationale", "kind", "prompt", "choices", "correct_answers",
      "explanation", "tags", "scoring_criteria", "required_concepts",
      "acceptable_alternatives", "deduction_conditions", "error_conditions",
      "theory_id", "practice_scope", "variant_group_id", "bookmarked", "active",
      "created_at", "updated_at",
    ],
  },
  sw_theories: {
    primaryKey: "id",
    columns: [
      "id", "subject_group_id", "subject_id", "category", "topic", "title",
      "summary", "content", "review_answers", "keywords", "sort_order", "active",
      "created_at", "updated_at",
    ],
  },
  sw_questions: {
    primaryKey: "id",
    columns: [
      "id", "theory_id", "subject_group_id", "subject_id", "category", "topic",
      "display_order", "difficulty", "difficulty_rationale", "kind", "prompt",
      "choices", "correct_answers", "explanation", "tags", "required_concepts",
      "active", "created_at", "updated_at",
    ],
  },
  content_releases: {
    primaryKey: "version",
    columns: [
      "version", "schema_version", "source_checksum", "question_checksum",
      "theory_checksum", "expected_question_count", "imported_question_count",
      "expected_theory_count", "imported_theory_count", "status", "created_at",
      "activated_at",
    ],
  },
  skct_content_releases: {
    primaryKey: "id",
    columns: ["id", "status", "dataset", "schema_version", "completed_folder_id", "json_file_id", "json_sha256", "md_file_id", "md_sha256", "license_note", "manifest_json", "normalized_count", "eligible_count", "quarantine_count", "release_sha256", "created_at"],
  },
  skct_question_public: {
    primaryKey: ["release_id", "question_uid"],
    columns: ["release_id", "question_uid", "content_set", "area_code", "question_no", "kind", "prompt_md", "choices_json", "dependency_group_id", "asset_refs_json", "question_source_refs_json", "question_hash", "eligibility", "quarantine_reasons_json"],
  },
  skct_question_secret: {
    primaryKey: ["release_id", "question_uid"],
    columns: ["release_id", "question_uid", "correct_answers_json", "explanation_md", "answer_source_refs_json", "secret_hash"],
  },
  user_settings: {
    primaryKey: "user_key",
    columns: ["user_key", "selected_exam", "created_at", "updated_at"],
  },
  guest_import_batches: {
    primaryKey: ["user_key", "import_id"],
    columns: ["user_key", "import_id", "imported_at"],
  },
  guest_import_receipts: {
    primaryKey: ["user_key", "import_id"],
    columns: ["user_key", "import_id", "payload_digest", "imported_at"],
  },
  user_bookmarks: {
    primaryKey: ["user_key", "question_id"],
    columns: ["user_key", "question_id", "created_at"],
  },
  exam_sessions: {
    primaryKey: "id",
    columns: [
      "id", "user_key", "exam_type", "status", "question_ids", "answers",
      "descriptive_answers", "descriptive_scores", "descriptive_snapshots",
      "flagged", "current_index", "started_at", "ends_at", "submitted_at",
      "result", "policy_version", "policy_snapshot", "revision", "is_admin",
      "created_at", "updated_at",
    ],
  },
  exam_session_items: {
    primaryKey: ["session_id", "question_id"],
    columns: [
      "session_id", "question_id", "position", "selected_answers",
      "descriptive_answer", "descriptive_score", "descriptive_snapshot",
      "flagged", "revision", "updated_at",
    ],
  },
  exam_active_sessions: {
    primaryKey: ["user_key", "exam_type"],
    columns: ["user_key", "exam_type", "session_id", "updated_at"],
  },
  attempts: {
    primaryKey: "id",
    columns: [
      "id", "question_id", "selected_answers", "correct", "mode", "user_key",
      "exam_type", "result", "score", "answer_text", "evaluation_id",
      "review_status", "is_admin", "client_operation_id", "created_at",
    ],
  },
  ai_evaluations: {
    primaryKey: "id",
    columns: [
      "id", "user_key", "question_id", "answer_hash", "rubric_version",
      "model_version", "result", "score", "strengths", "missing_points",
      "errors", "feedback", "improved_answer", "model_answer",
      "detailed_explanation", "provider", "created_at",
    ],
  },
  sw_attempts: {
    primaryKey: "id",
    columns: [
      "id", "user_key", "question_id", "selected_answers", "correct", "mode",
      "client_operation_id", "created_at",
    ],
  },
  sw_learning_sessions: {
    primaryKey: "id",
    columns: [
      "id", "user_key", "mode", "status", "subject_ids", "question_ids",
      "answers", "revealed_question_ids", "current_index", "result", "revision",
      "created_at", "updated_at",
    ],
  },
  study_groups: {
    primaryKey: "id",
    columns: ["id", "name", "owner_user_key", "member_limit", "admin_question_count_override", "settings_json", "status", "revision", "last_mutation_execution_id", "created_at", "updated_at"],
  },
  study_group_members: {
    primaryKey: ["group_id", "user_key"],
    columns: ["group_id", "user_key", "public_id", "public_name", "status", "membership_epoch", "last_mutation_execution_id", "joined_at", "left_at"],
  },
  study_group_membership_events: {
    primaryKey: "id",
    columns: ["id", "group_id", "user_key", "membership_epoch", "event_type", "actor_user_key", "created_at"],
  },
  study_group_invites: {
    primaryKey: "id",
    columns: ["id", "group_id", "token_digest", "status", "expires_at", "created_by_user_key", "consumed_by_user_key", "created_at", "consumed_at", "revoked_at", "revision", "last_mutation_execution_id"],
  },
  study_group_quota_slots: {
    primaryKey: ["group_id", "date_key", "slot_no"],
    columns: ["group_id", "date_key", "slot_no", "source", "status", "reserved_run_id", "revision", "created_at", "updated_at"],
  },
  study_group_exam_runs: {
    primaryKey: "id",
    columns: ["id", "group_id", "start_request_id", "mode", "status", "scheduled_at_utc", "actual_started_at_utc", "quota_date_key", "quota_slot_no", "question_count_snapshot", "settings_snapshot_json", "source_release_id", "source_release_sha256", "participant_count_snapshot", "final_deadline_at_utc", "lease_owner", "lease_until", "revision", "created_by_user_key", "created_at", "completed_at", "canceled_at", "failure_code", "last_mutation_execution_id"],
  },
  study_group_exam_selection_metadata: {
    primaryKey: "run_id",
    columns: ["run_id", "algorithm_version", "seed", "history_cutoff_utc", "history_digest_sha256", "snapshot_digest_sha256", "repeat_policy", "repeat_fallback", "area_policy", "settings_schema_version", "created_at"],
  },
  study_group_active_runs: {
    primaryKey: "group_id",
    columns: ["group_id", "run_id", "updated_at"],
  },
  study_group_quota_events: {
    primaryKey: "id",
    columns: ["id", "idempotency_key", "group_id", "date_key", "slot_no", "run_id", "event_type", "actor_user_key", "created_at"],
  },
  study_group_exam_participants: {
    primaryKey: ["run_id", "user_key"],
    columns: ["run_id", "user_key", "public_name_snapshot", "membership_epoch_snapshot", "status", "submitted_at", "last_mutation_execution_id", "score", "wrong_count", "wrong_positions_json"],
  },
  study_group_exam_question_public: {
    primaryKey: ["run_id", "position"],
    columns: ["run_id", "position", "source_question_uid", "area_code_snapshot", "prompt_snapshot", "choices_snapshot_json", "asset_refs_snapshot_json", "dependency_group_id_snapshot", "time_limit_seconds", "opens_at_utc", "deadline_at_utc", "snapshot_hash"],
  },
  study_group_exam_question_secret: {
    primaryKey: ["run_id", "position"],
    columns: ["run_id", "position", "correct_answers_snapshot_json", "explanation_snapshot", "secret_hash"],
  },
  study_group_exam_answers: {
    primaryKey: ["run_id", "user_key", "position"],
    columns: ["run_id", "user_key", "position", "answer_json", "revision", "last_client_operation_id", "server_received_at_utc", "updated_at"],
  },
  study_group_answer_operations: {
    primaryKey: "operation_id",
    columns: ["operation_id", "run_id", "user_key", "position", "answer_hash", "result_revision", "created_at"],
  },
  study_group_idempotency: {
    primaryKey: ["actor_user_key", "action", "idempotency_key"],
    columns: ["actor_user_key", "action", "idempotency_key", "request_digest", "execution_id", "response_status", "response_json", "created_at"],
  },
  study_group_audit_events: {
    primaryKey: "id",
    columns: ["id", "group_id", "actor_user_key", "action", "target_id", "before_summary", "after_summary", "created_at"],
  },
  site_settings: {
    primaryKey: "key",
    columns: ["key", "value", "value_type", "updated_by_hash", "updated_at"],
  },
  analytics_events: {
    primaryKey: "id",
    columns: [
      "id", "event_type", "occurred_at", "anonymous_session_id",
      "user_key_hash", "is_admin", "exam_scope", "subject", "question_id",
      "content_id", "answer_result", "duration_ms", "page_path", "referrer_host",
      "device_category", "viewport_bucket", "browser_family", "dedupe_key",
      "api_route", "http_status", "retry_count", "cache_source", "build_sha",
      "metric_name", "metric_value",
    ],
  },
  user_reports: {
    primaryKey: "id",
    columns: [
      "id", "user_key", "category", "title", "description", "page_path",
      "question_id", "status", "admin_note", "created_at", "updated_at",
    ],
  },
};

export const BACKUP_DELETE_ORDER = [
  "skct_personal_attempt_items",
  "skct_personal_attempts",
  "skct_personal_release_audit",
  "skct_personal_secret_items",
  "skct_personal_public_items",
  "skct_personal_releases",
  "study_group_owner_slots",
  "study_group_exam_run_contract_v2",
  "skct_question_identity",
  "study_group_exam_question_identity_snapshot",
  "study_group_exam_repeat_claims",
  "study_group_exam_participant_progress",

  "study_group_answer_operations",
  "study_group_exam_answers",
  "study_group_exam_question_secret",
  "study_group_exam_question_public",
  "study_group_exam_participants",
  "study_group_exam_selection_metadata",
  "study_group_active_runs",
  "study_group_quota_events",
  "study_group_exam_runs",
  "study_group_quota_slots",
  "study_group_invites",
  "study_group_membership_events",
  "study_group_audit_events",
  "study_group_idempotency",
  "study_group_members",
  "study_groups",
  "skct_question_secret",
  "skct_question_public",
  "skct_content_releases",
  "analytics_events",
  "exam_active_sessions",
  "exam_session_items",
  "user_reports",
  "user_bookmarks",
  "ai_evaluations",
  "attempts",
  "exam_sessions",
  "sw_attempts",
  "sw_learning_sessions",
  "guest_import_receipts",
  "guest_import_batches",
  "user_settings",
  "user_accounts",
  "content_releases",
  "sw_questions",
  "questions",
  "sw_theories",
  "theories",
  "site_settings",
];

export const BACKUP_INSERT_ORDER = [
  "user_accounts",
  "skct_personal_releases",
  "skct_personal_public_items",
  "skct_personal_secret_items",
  "skct_personal_release_audit",
  "skct_personal_attempts",
  "skct_personal_attempt_items",
  "theories",
  "questions",
  "sw_theories",
  "sw_questions",
  "content_releases",
  "skct_content_releases",
  "skct_question_public",
  "skct_question_secret",
  "user_settings",
  "guest_import_batches",
  "guest_import_receipts",
  "user_bookmarks",
  "exam_sessions",
  "exam_session_items",
  "exam_active_sessions",
  "attempts",
  "ai_evaluations",
  "sw_attempts",
  "sw_learning_sessions",
  "study_groups",
  "study_group_members",
  "study_group_membership_events",
  "study_group_invites",
  "study_group_quota_slots",
  "study_group_exam_runs",
  "study_group_exam_selection_metadata",
  "study_group_active_runs",
  "study_group_quota_events",
  "study_group_exam_participants",
  "study_group_exam_question_public",
  "study_group_exam_question_secret",
  "study_group_exam_answers",
  "study_group_answer_operations",
  "study_group_idempotency",
  "study_group_audit_events",
  "study_group_owner_slots",
  "study_group_exam_run_contract_v2",
  "skct_question_identity",
  "study_group_exam_question_identity_snapshot",
  "study_group_exam_repeat_claims",
  "study_group_exam_participant_progress",
  "site_settings",
  "analytics_events",
  "user_reports",
];

// Read-only contracts for validating old checksummed backups. Never SQL targets.
export const LEGACY_BACKUP_SCHEMA_VERSION = "admin-4";
export const RETIRED_BACKUP_TABLES = {
  theory_progress: {
    primaryKey: "id",
    columns: [
      "id", "user_key", "theory_id", "exam_type", "completed", "updated_at",
    ],
  },
  sw_theory_progress: {
    primaryKey: ["user_key", "theory_id"],
    columns: ["user_key", "theory_id", "completed", "updated_at"],
  },
};

export function supportedBackupSchema(version) {
  return version === BACKUP_SCHEMA_VERSION || version === PREVIOUS_BACKUP_SCHEMA_VERSION
    || version === "admin-7" || version === "admin-6"
    || version === LEGACY_BACKUP_SCHEMA_VERSION || version === "admin-5";
}

export function backupTableSpec(table, schemaVersion = BACKUP_SCHEMA_VERSION) {
  if (table === "guest_import_receipts" && schemaVersion !== BACKUP_SCHEMA_VERSION) return undefined;
  if (Object.hasOwn(RESTORE_TABLES, table)) return RESTORE_TABLES[table];
  return schemaVersion === LEGACY_BACKUP_SCHEMA_VERSION && Object.hasOwn(RETIRED_BACKUP_TABLES, table)
    ? RETIRED_BACKUP_TABLES[table] : undefined;
}

export function allowedBackupTables(type, includeAnalytics = false, schemaVersion = BACKUP_SCHEMA_VERSION) {
  if (!Object.hasOwn(BACKUP_TABLES, type)) return [];
  const previous = {
    content: [...ADMIN5_CONTENT_TABLES],
    learning: [...ADMIN5_CONTENT_TABLES, ...ADMIN5_LEARNER_STATE_TABLES],
    settings: ["site_settings"],
    full: [...ADMIN5_CONTENT_TABLES, ...ADMIN5_LEARNER_STATE_TABLES, "user_reports", "site_settings"],
  };
  const v2Tables = new Set(["study_group_owner_slots", "study_group_exam_run_contract_v2", "skct_question_identity", "study_group_exam_question_identity_snapshot", "study_group_exam_repeat_claims", "study_group_exam_participant_progress", "guest_import_receipts"]);
  const personalTables = new Set([...CONTENT_TABLES, ...LEARNER_STATE_TABLES].filter(table => table.startsWith("skct_personal_")));
  const tables = schemaVersion === BACKUP_SCHEMA_VERSION ? [...BACKUP_TABLES[type]]
    : schemaVersion === PREVIOUS_BACKUP_SCHEMA_VERSION ? BACKUP_TABLES[type].filter(table => table !== "guest_import_receipts")
    : schemaVersion === "admin-7" ? BACKUP_TABLES[type].filter(table => !personalTables.has(table) && table !== "guest_import_receipts")
    : schemaVersion === "admin-6" ? BACKUP_TABLES[type].filter(table => !personalTables.has(table) && !v2Tables.has(table)) : [...previous[type]];
  if (schemaVersion === LEGACY_BACKUP_SCHEMA_VERSION && ["learning", "full"].includes(type)) {
    tables.splice(tables.indexOf("sw_attempts"), 0, ...Object.keys(RETIRED_BACKUP_TABLES));
  }
  return includeAnalytics && type === "full"
    ? [...tables, "analytics_events"]
    : [...tables];
}

export function splitBackupPayload(value) {
  const chunks = [];
  for (let start = 0; start < value.length;) {
    let end = Math.min(value.length, start + BACKUP_CHUNK_LENGTH);
    const lastCode = value.charCodeAt(end - 1);
    if (end < value.length && lastCode >= 0xd800 && lastCode <= 0xdbff) end -= 1;
    chunks.push(value.slice(start, end));
    start = end;
  }
  return chunks;
}
