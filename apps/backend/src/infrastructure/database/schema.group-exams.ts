import { desc, sql } from "drizzle-orm";
import { check, foreignKey, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const skctContentReleases = sqliteTable("skct_content_releases", {
  id: text("id").primaryKey(),
  status: text("status").notNull().default("validated"),
  dataset: text("dataset").notNull(),
  schemaVersion: text("schema_version").notNull(),
  completedFolderId: text("completed_folder_id").notNull(),
  jsonFileId: text("json_file_id").notNull(),
  jsonSha256: text("json_sha256").notNull(),
  mdFileId: text("md_file_id").notNull(),
  mdSha256: text("md_sha256").notNull(),
  licenseNote: text("license_note").notNull().default(""),
  manifestJson: text("manifest_json").notNull().default("{}"),
  normalizedCount: integer("normalized_count").notNull().default(0),
  eligibleCount: integer("eligible_count").notNull().default(0),
  quarantineCount: integer("quarantine_count").notNull().default(0),
  releaseSha256: text("release_sha256").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("skct_content_releases_release_sha_uidx").on(table.releaseSha256),
  check("skct_content_releases_status_check", sql`${table.status} IN ('validated', 'active', 'retired')`),
  check("skct_content_releases_counts_check", sql`${table.normalizedCount} >= 0 AND ${table.eligibleCount} >= 0 AND ${table.quarantineCount} >= 0`),
  check("skct_content_releases_partition_check", sql`${table.eligibleCount} + ${table.quarantineCount} <= ${table.normalizedCount}`),
]);

export const skctQuestionPublic = sqliteTable("skct_question_public", {
  releaseId: text("release_id").notNull().references(() => skctContentReleases.id, { onDelete: "cascade" }),
  questionUid: text("question_uid").notNull(),
  contentSet: text("content_set").notNull(),
  areaCode: text("area_code").notNull(),
  questionNo: integer("question_no").notNull(),
  kind: text("kind").notNull().default("single"),
  promptMd: text("prompt_md").notNull(),
  choicesJson: text("choices_json").notNull(),
  dependencyGroupId: text("dependency_group_id"),
  assetRefsJson: text("asset_refs_json").notNull().default("[]"),
  questionSourceRefsJson: text("question_source_refs_json").notNull().default("[]"),
  questionHash: text("question_hash").notNull(),
  eligibility: text("eligibility").notNull().default("quarantined"),
  quarantineReasonsJson: text("quarantine_reasons_json").notNull().default("[]"),
}, (table) => [
  primaryKey({ columns: [table.releaseId, table.questionUid] }),
  index("skct_question_public_selection_idx").on(table.releaseId, table.eligibility, table.areaCode, table.questionUid),
  index("skct_question_public_dependency_idx").on(table.releaseId, table.dependencyGroupId, table.questionUid),
  check("skct_question_public_number_check", sql`${table.questionNo} > 0`),
  check("skct_question_public_kind_check", sql`${table.kind} = 'single'`),
  check("skct_question_public_area_check", sql`${table.areaCode} IN ('언어이해', '자료해석', '창의수리', '언어추리', '수열추리')`),
  check("skct_question_public_eligibility_check", sql`${table.eligibility} IN ('eligible', 'quarantined', 'excluded')`),
]);

export const skctQuestionSecret = sqliteTable("skct_question_secret", {
  releaseId: text("release_id").notNull(),
  questionUid: text("question_uid").notNull(),
  correctAnswersJson: text("correct_answers_json").notNull(),
  explanationMd: text("explanation_md").notNull(),
  answerSourceRefsJson: text("answer_source_refs_json").notNull().default("[]"),
  secretHash: text("secret_hash").notNull(),
}, (table) => [
  primaryKey({ columns: [table.releaseId, table.questionUid] }),
  foreignKey({
    columns: [table.releaseId, table.questionUid],
    foreignColumns: [skctQuestionPublic.releaseId, skctQuestionPublic.questionUid],
  }).onDelete("cascade"),
]);

export const studyGroups = sqliteTable("study_groups", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  ownerUserKey: text("owner_user_key").notNull(),
  memberLimit: integer("member_limit").notNull().default(50),
  adminQuestionCountOverride: integer("admin_question_count_override"),
  settingsJson: text("settings_json").notNull().default("{}"),
  status: text("status").notNull().default("active"),
  revision: integer("revision").notNull().default(0),
  lastMutationExecutionId: text("last_mutation_execution_id"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("study_groups_owner_status_idx").on(table.ownerUserKey, table.status, table.updatedAt),
  check("study_groups_member_limit_check", sql`${table.memberLimit} BETWEEN 2 AND 50`),
  check("study_groups_question_count_check", sql`${table.adminQuestionCountOverride} IS NULL OR ${table.adminQuestionCountOverride} BETWEEN 1 AND 500`),
  check("study_groups_status_check", sql`${table.status} IN ('active', 'archived')`),
  check("study_groups_revision_check", sql`${table.revision} >= 0`),
]);

export const studyGroupMembers = sqliteTable("study_group_members", {
  groupId: text("group_id").notNull().references(() => studyGroups.id, { onDelete: "cascade" }),
  userKey: text("user_key").notNull(),
  publicId: text("public_id").notNull(),
  publicName: text("public_name").notNull(),
  status: text("status").notNull().default("active"),
  membershipEpoch: integer("membership_epoch").notNull().default(1),
  lastMutationExecutionId: text("last_mutation_execution_id"),
  joinedAt: text("joined_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  leftAt: text("left_at"),
}, (table) => [
  primaryKey({ columns: [table.groupId, table.userKey] }),
  index("study_group_members_group_status_idx").on(table.groupId, table.status, table.userKey),
  index("study_group_members_user_status_idx").on(table.userKey, table.status, table.groupId),
  uniqueIndex("study_group_members_public_id_uidx").on(table.groupId, table.publicId),
  check("study_group_members_status_check", sql`${table.status} IN ('active', 'left', 'kicked')`),
  check("study_group_membership_epoch_check", sql`${table.membershipEpoch} > 0`),
]);

export const studyGroupMembershipEvents = sqliteTable("study_group_membership_events", {
  id: text("id").primaryKey(),
  groupId: text("group_id").notNull().references(() => studyGroups.id, { onDelete: "cascade" }),
  userKey: text("user_key").notNull(),
  membershipEpoch: integer("membership_epoch").notNull(),
  eventType: text("event_type").notNull(),
  actorUserKey: text("actor_user_key").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("study_group_membership_events_group_time_idx").on(table.groupId, table.createdAt, table.id),
  check("study_group_membership_events_type_check", sql`${table.eventType} IN ('joined', 'left', 'kicked', 'rejoined', 'owner_transferred')`),
]);

export const studyGroupInvites = sqliteTable("study_group_invites", {
  reusable: integer("reusable").notNull().default(0),
  id: text("id").primaryKey(),
  groupId: text("group_id").notNull().references(() => studyGroups.id, { onDelete: "cascade" }),
  tokenDigest: text("token_digest").notNull(),
  status: text("status").notNull().default("active"),
  expiresAt: text("expires_at").notNull(),
  createdByUserKey: text("created_by_user_key").notNull(),
  consumedByUserKey: text("consumed_by_user_key"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  consumedAt: text("consumed_at"),
  revokedAt: text("revoked_at"),
  revision: integer("revision").notNull().default(0),
  lastMutationExecutionId: text("last_mutation_execution_id"),
}, (table) => [
  index("study_group_invites_group_status_expiry_idx").on(table.groupId, table.status, table.expiresAt),
  uniqueIndex("study_group_invites_token_digest_uidx").on(table.tokenDigest),
  check("study_group_invites_status_check", sql`${table.status} IN ('active', 'accepted', 'revoked', 'expired')`),
  check("study_group_invites_revision_check", sql`${table.revision} >= 0`),
]);

export const studyGroupQuotaSlots = sqliteTable("study_group_quota_slots", {
  groupId: text("group_id").notNull().references(() => studyGroups.id, { onDelete: "cascade" }),
  dateKey: text("date_key").notNull(),
  slotNo: integer("slot_no").notNull(),
  source: text("source").notNull().default("base"),
  status: text("status").notNull().default("available"),
  reservedRunId: text("reserved_run_id"),
  revision: integer("revision").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  primaryKey({ columns: [table.groupId, table.dateKey, table.slotNo] }),
  uniqueIndex("study_group_quota_slots_run_uidx").on(table.reservedRunId).where(sql`${table.reservedRunId} IS NOT NULL`),
  index("study_group_quota_slots_available_idx").on(table.groupId, table.dateKey, table.status, table.slotNo),
  check("study_group_quota_slots_number_check", sql`${table.slotNo} > 0`),
  check("study_group_quota_slots_source_check", sql`${table.source} IN ('base', 'admin_grant')`),
  check("study_group_quota_slots_status_check", sql`${table.status} IN ('available', 'reserved', 'consumed')`),
  check("study_group_quota_slots_revision_check", sql`${table.revision} >= 0`),
]);

export const studyGroupExamRuns = sqliteTable("study_group_exam_runs", {
  id: text("id").primaryKey(),
  groupId: text("group_id").notNull().references(() => studyGroups.id, { onDelete: "restrict" }),
  startRequestId: text("start_request_id").notNull(),
  mode: text("mode").notNull(),
  status: text("status").notNull(),
  scheduledAtUtc: text("scheduled_at_utc"),
  actualStartedAtUtc: text("actual_started_at_utc"),
  quotaDateKey: text("quota_date_key").notNull(),
  quotaSlotNo: integer("quota_slot_no").notNull(),
  questionCountSnapshot: integer("question_count_snapshot").notNull(),
  settingsSnapshotJson: text("settings_snapshot_json").notNull(),
  sourceReleaseId: text("source_release_id").notNull().references(() => skctContentReleases.id, { onDelete: "restrict" }),
  sourceReleaseSha256: text("source_release_sha256").notNull(),
  participantCountSnapshot: integer("participant_count_snapshot").notNull().default(0),
  finalDeadlineAtUtc: text("final_deadline_at_utc"),
  leaseOwner: text("lease_owner"),
  leaseUntil: text("lease_until"),
  revision: integer("revision").notNull().default(0),
  createdByUserKey: text("created_by_user_key").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  completedAt: text("completed_at"),
  canceledAt: text("canceled_at"),
  failureCode: text("failure_code"),
  lastMutationExecutionId: text("last_mutation_execution_id"),
}, (table) => [
  index("study_group_exam_runs_group_status_time_idx").on(table.groupId, table.status, table.scheduledAtUtc),
  index("study_group_exam_runs_due_idx").on(table.status, table.scheduledAtUtc, table.leaseUntil),
  index("study_group_exam_runs_finalization_idx").on(table.status, table.finalDeadlineAtUtc, table.id),
  uniqueIndex("study_group_exam_runs_start_request_uidx").on(table.startRequestId),
  uniqueIndex("study_group_exam_runs_one_scheduled_uidx").on(table.groupId).where(sql`${table.status} = 'scheduled'`),
  check("study_group_exam_runs_mode_check", sql`${table.mode} IN ('immediate', 'scheduled')`),
  check("study_group_exam_runs_status_check", sql`${table.status} IN ('scheduled', 'starting', 'running', 'finalizing', 'completed', 'canceled', 'failed_prestart')`),
  check("study_group_exam_runs_question_count_check", sql`${table.questionCountSnapshot} BETWEEN 1 AND 500`),
  check("study_group_exam_runs_participant_count_check", sql`${table.participantCountSnapshot} >= 0`),
  check("study_group_exam_runs_slot_check", sql`${table.quotaSlotNo} > 0`),
  check("study_group_exam_runs_revision_check", sql`${table.revision} >= 0`),
]);

export const studyGroupExamSelectionMetadata = sqliteTable("study_group_exam_selection_metadata", {
  runId: text("run_id").primaryKey().references(() => studyGroupExamRuns.id, { onDelete: "cascade" }),
  algorithmVersion: text("algorithm_version").notNull(),
  seed: text("seed").notNull(),
  historyCutoffUtc: text("history_cutoff_utc").notNull(),
  historyDigestSha256: text("history_digest_sha256").notNull(),
  snapshotDigestSha256: text("snapshot_digest_sha256").notNull(),
  repeatPolicy: text("repeat_policy").notNull().default("allow"),
  repeatFallback: integer("repeat_fallback", { mode: "boolean" }).notNull().default(false),
  areaPolicy: text("area_policy").notNull(),
  settingsSchemaVersion: integer("settings_schema_version").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  check("study_group_exam_selection_metadata_repeat_policy_check", sql`${table.repeatPolicy} = 'allow'`),
  check("study_group_exam_selection_metadata_repeat_fallback_check", sql`${table.repeatFallback} IN (0, 1)`),
  check("study_group_exam_selection_metadata_schema_check", sql`${table.settingsSchemaVersion} > 0`),
]);

export const studyGroupActiveRuns = sqliteTable("study_group_active_runs", {
  groupId: text("group_id").primaryKey().references(() => studyGroups.id, { onDelete: "cascade" }),
  runId: text("run_id").notNull().references(() => studyGroupExamRuns.id, { onDelete: "cascade" }),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("study_group_active_runs_run_uidx").on(table.runId),
]);

export const studyGroupQuotaEvents = sqliteTable("study_group_quota_events", {
  id: text("id").primaryKey(),
  idempotencyKey: text("idempotency_key").notNull(),
  groupId: text("group_id").notNull().references(() => studyGroups.id, { onDelete: "cascade" }),
  dateKey: text("date_key").notNull(),
  slotNo: integer("slot_no").notNull(),
  runId: text("run_id"),
  eventType: text("event_type").notNull(),
  actorUserKey: text("actor_user_key"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("study_group_quota_events_group_time_idx").on(table.groupId, table.dateKey, table.createdAt),
  uniqueIndex("study_group_quota_events_idempotency_uidx").on(table.idempotencyKey),
  check("study_group_quota_events_type_check", sql`${table.eventType} IN ('reserve', 'consume', 'refund', 'admin_grant')`),
]);

export const studyGroupExamParticipants = sqliteTable("study_group_exam_participants", {
  runId: text("run_id").notNull().references(() => studyGroupExamRuns.id, { onDelete: "cascade" }),
  userKey: text("user_key").notNull(),
  publicNameSnapshot: text("public_name_snapshot").notNull(),
  membershipEpochSnapshot: integer("membership_epoch_snapshot").notNull(),
  status: text("status").notNull().default("rostered"),
  submittedAt: text("submitted_at"),
  lastMutationExecutionId: text("last_mutation_execution_id"),
  score: integer("score"),
  wrongCount: integer("wrong_count"),
  wrongPositionsJson: text("wrong_positions_json").notNull().default("[]"),
}, (table) => [
  primaryKey({ columns: [table.runId, table.userKey] }),
  index("study_group_exam_participants_run_status_idx").on(table.runId, table.status, table.userKey),
  index("study_group_exam_participants_rank_idx").on(table.runId, desc(table.score), table.publicNameSnapshot),
  check("study_group_exam_participants_status_check", sql`${table.status} IN ('rostered', 'in_progress', 'submitted', 'auto_submitted', 'no_show')`),
  check("study_group_exam_participants_epoch_check", sql`${table.membershipEpochSnapshot} > 0`),
  check("study_group_exam_participants_score_check", sql`${table.score} IS NULL OR ${table.score} >= 0`),
  check("study_group_exam_participants_wrong_check", sql`${table.wrongCount} IS NULL OR ${table.wrongCount} >= 0`),
]);

export const studyGroupExamQuestionPublic = sqliteTable("study_group_exam_question_public", {
  runId: text("run_id").notNull().references(() => studyGroupExamRuns.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  sourceQuestionUid: text("source_question_uid").notNull(),
  areaCodeSnapshot: text("area_code_snapshot").notNull(),
  promptSnapshot: text("prompt_snapshot").notNull(),
  choicesSnapshotJson: text("choices_snapshot_json").notNull(),
  assetRefsSnapshotJson: text("asset_refs_snapshot_json").notNull().default("[]"),
  dependencyGroupIdSnapshot: text("dependency_group_id_snapshot"),
  timeLimitSeconds: integer("time_limit_seconds").notNull(),
  opensAtUtc: text("opens_at_utc"),
  deadlineAtUtc: text("deadline_at_utc"),
  snapshotHash: text("snapshot_hash").notNull(),
}, (table) => [
  primaryKey({ columns: [table.runId, table.position] }),
  uniqueIndex("study_group_exam_question_public_source_uidx").on(table.runId, table.sourceQuestionUid),
  check("study_group_exam_question_public_position_check", sql`${table.position} >= 0`),
  check("study_group_exam_question_public_time_check", sql`${table.timeLimitSeconds} BETWEEN 1 AND 3600`),
  check("study_group_exam_question_public_area_check", sql`${table.areaCodeSnapshot} IN ('언어이해', '자료해석', '창의수리', '언어추리', '수열추리')`),
]);

// Presence is ephemeral and intentionally excluded from the durable admin-6
// backup contract. Restoring a backup must never restore an online indicator.
export const studyGroupPresenceSessions = sqliteTable("study_group_presence_sessions", {
  groupId: text("group_id").notNull(),
  userKey: text("user_key").notNull(),
  sessionId: text("session_id").notNull(),
  pageContext: text("page_context").notNull().default("lobby"),
  visible: integer("visible", { mode: "boolean" }).notNull().default(true),
  lastSeenAt: text("last_seen_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  primaryKey({ columns: [table.groupId, table.userKey, table.sessionId] }),
  foreignKey({
    columns: [table.groupId, table.userKey],
    foreignColumns: [studyGroupMembers.groupId, studyGroupMembers.userKey],
  }).onDelete("cascade"),
  index("study_group_presence_sessions_group_seen_idx").on(table.groupId, table.lastSeenAt, table.userKey),
  index("study_group_presence_sessions_user_seen_idx").on(table.userKey, table.lastSeenAt, table.groupId),
  check("study_group_presence_sessions_context_check", sql`${table.pageContext} IN ('lobby', 'exam')`),
  check("study_group_presence_sessions_visible_check", sql`${table.visible} IN (0, 1)`),
]);

export const studyGroupExamQuestionSecret = sqliteTable("study_group_exam_question_secret", {
  runId: text("run_id").notNull(),
  position: integer("position").notNull(),
  correctAnswersSnapshotJson: text("correct_answers_snapshot_json").notNull(),
  explanationSnapshot: text("explanation_snapshot").notNull(),
  secretHash: text("secret_hash").notNull(),
}, (table) => [
  primaryKey({ columns: [table.runId, table.position] }),
  foreignKey({
    columns: [table.runId, table.position],
    foreignColumns: [studyGroupExamQuestionPublic.runId, studyGroupExamQuestionPublic.position],
  }).onDelete("cascade"),
]);

export const studyGroupExamAnswers = sqliteTable("study_group_exam_answers", {
  runId: text("run_id").notNull(),
  userKey: text("user_key").notNull(),
  position: integer("position").notNull(),
  answerJson: text("answer_json").notNull().default("[]"),
  revision: integer("revision").notNull().default(0),
  lastClientOperationId: text("last_client_operation_id").notNull(),
  serverReceivedAtUtc: text("server_received_at_utc").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  primaryKey({ columns: [table.runId, table.userKey, table.position] }),
  foreignKey({
    columns: [table.runId, table.userKey],
    foreignColumns: [studyGroupExamParticipants.runId, studyGroupExamParticipants.userKey],
  }).onDelete("cascade"),
  index("study_group_exam_answers_participant_idx").on(table.runId, table.userKey, table.position),
  check("study_group_exam_answers_position_check", sql`${table.position} >= 0`),
  check("study_group_exam_answers_revision_check", sql`${table.revision} >= 0`),
]);

export const studyGroupAnswerOperations = sqliteTable("study_group_answer_operations", {
  operationId: text("operation_id").primaryKey(),
  runId: text("run_id").notNull(),
  userKey: text("user_key").notNull(),
  position: integer("position").notNull(),
  answerHash: text("answer_hash").notNull(),
  resultRevision: integer("result_revision").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  foreignKey({
    columns: [table.runId, table.userKey, table.position],
    foreignColumns: [studyGroupExamAnswers.runId, studyGroupExamAnswers.userKey, studyGroupExamAnswers.position],
  }).onDelete("cascade"),
]);

export const studyGroupIdempotency = sqliteTable("study_group_idempotency", {
  actorUserKey: text("actor_user_key").notNull(),
  action: text("action").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  requestDigest: text("request_digest").notNull(),
  executionId: text("execution_id").notNull(),
  responseStatus: integer("response_status").notNull(),
  responseJson: text("response_json").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  primaryKey({ columns: [table.actorUserKey, table.action, table.idempotencyKey] }),
]);

export const studyGroupAuditEvents = sqliteTable("study_group_audit_events", {
  id: text("id").primaryKey(),
  groupId: text("group_id").notNull().references(() => studyGroups.id, { onDelete: "cascade" }),
  actorUserKey: text("actor_user_key").notNull(),
  action: text("action").notNull(),
  targetId: text("target_id"),
  beforeSummary: text("before_summary").notNull().default("{}"),
  afterSummary: text("after_summary").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("study_group_audit_events_group_time_idx").on(table.groupId, table.createdAt, table.id),
]);

// Contract v2 is additive; the absence of its row preserves the v1 timeline.
export const studyGroupOwnerSlots = sqliteTable("study_group_owner_slots", {
  groupId: text("group_id").primaryKey().notNull().references(() => studyGroups.id, { onDelete: "cascade" }),
  ownerUserKey: text("owner_user_key").notNull(), slot: integer("slot").notNull(),
}, t => [uniqueIndex("study_group_owner_slots_owner_slot_uidx").on(t.ownerUserKey,t.slot),check("owner_slot_range",sql`${t.slot} BETWEEN 1 AND 3`)]);
export const studyGroupExamRunContractV2 = sqliteTable("study_group_exam_run_contract_v2", {
  runId: text("run_id").primaryKey().notNull().references(() => studyGroupExamRuns.id,{onDelete:"cascade"}),
  advanceTimePolicy: text("advance_time_policy").notNull(),repeatPolicy:text("repeat_policy").notNull(),
  selectionJson:text("selection_json").notNull().default("{}"),createdAt:text("created_at").notNull(),
},t=>[check("v2_time_policy",sql`${t.advanceTimePolicy} IN ('carry_remaining','reset_to_base')`),check("v2_repeat_policy",sql`${t.repeatPolicy} IN ('allow','forbid')`)]);
export const skctQuestionIdentity = sqliteTable("skct_question_identity", {
  releaseId:text("release_id").notNull(),questionUid:text("question_uid").notNull(),questionIdentity:text("question_identity").notNull(),
  bundleIdentity:text("bundle_identity").notNull(),identityMaterialJson:text("identity_material_json").notNull(),identityVersion:integer("identity_version").notNull().default(1),
},t=>[primaryKey({columns:[t.releaseId,t.questionUid]}),foreignKey({columns:[t.releaseId,t.questionUid],foreignColumns:[skctQuestionPublic.releaseId,skctQuestionPublic.questionUid]}).onDelete("cascade"),check("identity_v1",sql`${t.identityVersion} = 1`)]);
export const studyGroupExamQuestionIdentitySnapshot = sqliteTable("study_group_exam_question_identity_snapshot", {
  runId:text("run_id").notNull(),position:integer("position").notNull(),questionIdentity:text("question_identity").notNull(),
  bundleIdentity:text("bundle_identity").notNull(),contentSet:text("content_set").notNull(),
},t=>[primaryKey({columns:[t.runId,t.position]}),foreignKey({columns:[t.runId,t.position],foreignColumns:[studyGroupExamQuestionPublic.runId,studyGroupExamQuestionPublic.position]}).onDelete("cascade")]);
export const studyGroupExamRepeatClaims = sqliteTable("study_group_exam_repeat_claims", {
  groupId:text("group_id").notNull().references(()=>studyGroups.id,{onDelete:"cascade"}),questionIdentity:text("question_identity").notNull(),
  runId:text("run_id").notNull().references(()=>studyGroupExamRuns.id,{onDelete:"cascade"}),
},t=>[primaryKey({columns:[t.groupId,t.questionIdentity]})]);
export const studyGroupExamParticipantProgress = sqliteTable("study_group_exam_participant_progress", {
  runId:text("run_id").notNull(),userKey:text("user_key").notNull(),participantId:text("participant_id").notNull(),rosterPosition:integer("roster_position").notNull(),
  currentPosition:integer("current_position").notNull(),currentOpenedAtUtc:text("current_opened_at_utc").notNull(),currentDeadlineAtUtc:text("current_deadline_at_utc").notNull(),
  carriedMs:integer("carried_ms").notNull().default(0),startedAtUtc:text("started_at_utc").notNull(),connectedAtUtc:text("connected_at_utc"),finishedAtUtc:text("finished_at_utc"),
  terminalStatus:text("terminal_status"),correctCount:integer("correct_count"),incorrectCount:integer("incorrect_count"),unansweredCount:integer("unanswered_count"),
  revision:integer("revision").notNull().default(0),lastMutationExecutionId:text("last_mutation_execution_id"),
},t=>[primaryKey({columns:[t.runId,t.userKey]}),foreignKey({columns:[t.runId,t.userKey],foreignColumns:[studyGroupExamParticipants.runId,studyGroupExamParticipants.userKey]}).onDelete("cascade"),
  index("study_group_progress_due_idx").on(t.runId,t.finishedAtUtc,t.currentDeadlineAtUtc),uniqueIndex("study_group_progress_roster_idx").on(t.runId,t.rosterPosition),
  check("progress_position",sql`${t.currentPosition} >= 0`),check("progress_roster",sql`${t.rosterPosition} >= 0`),check("progress_carry",sql`${t.carriedMs} >= 0`),check("progress_revision",sql`${t.revision} >= 0`),
  check("progress_terminal",sql`${t.terminalStatus} IN ('submitted','auto_submitted','no_show')`)]);
