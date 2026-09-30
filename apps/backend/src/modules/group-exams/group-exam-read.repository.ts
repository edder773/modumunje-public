import { personalGroupRelease, personalGroupQuestions, PERSONAL_GROUP_PREFIX } from "./group-exam-personal-bank";
import { DatabaseRepository } from "@backend/infrastructure/database/database.repository";

export type GroupRow = {
  id: string;
  name: string;
  owner_user_key: string;
  member_limit: number;
  admin_question_count_override: number | null;
  settings_json: string;
  status: "active" | "archived";
  revision: number;
  created_at: string;
  updated_at: string;
};

export type MemberRow = {
  group_id: string;
  user_key: string;
  public_id: string;
  public_name: string;
  status: "active" | "left" | "kicked";
  membership_epoch: number;
  joined_at: string;
  left_at: string | null;
};

export type InviteRow = {
  id: string;
  group_id: string;
  token_digest: string;
  status: "active" | "accepted" | "revoked" | "expired";
  expires_at: string;
  created_by_user_key: string;
  consumed_by_user_key: string | null;
  created_at: string;
  consumed_at: string | null;
  revoked_at: string | null;
  revision: number;
};

export type ContentQuestionRow = {
  release_id: string;
  question_uid: string;
  content_set?: string;
  question_no?: number;
  question_source_refs_json?: string;
  area_code: string;
  prompt_md: string;
  choices_json: string;
  dependency_group_id: string | null;
  asset_refs_json: string;
  question_hash: string;
  correct_answers_json: string;
  explanation_md: string;
  secret_hash: string;
};

export type RunRow = {
  id: string;
  group_id: string;
  start_request_id: string;
  mode: "immediate" | "scheduled";
  status: "scheduled" | "starting" | "running" | "finalizing" | "completed" | "canceled" | "failed_prestart";
  scheduled_at_utc: string | null;
  actual_started_at_utc: string | null;
  quota_date_key: string;
  quota_slot_no: number;
  question_count_snapshot: number;
  settings_snapshot_json: string;
  source_release_id: string;
  source_release_sha256: string;
  participant_count_snapshot: number;
  final_deadline_at_utc: string | null;
  lease_owner: string | null;
  lease_until: string | null;
  revision: number;
  created_by_user_key: string;
  created_at: string;
  completed_at: string | null;
  canceled_at: string | null;
  failure_code: string | null;
};

export type RunQuestionRow = {
  run_id: string;
  position: number;
  source_question_uid: string;
  area_code_snapshot: string;
  prompt_snapshot: string;
  choices_snapshot_json: string;
  asset_refs_snapshot_json: string;
  dependency_group_id_snapshot: string | null;
  time_limit_seconds: number;
  opens_at_utc: string | null;
  deadline_at_utc: string | null;
  snapshot_hash: string;
};

export type MutationIdempotency = {
  actorUserKey: string;
  action: string;
  key: string;
  requestDigest: string;
  executionId: string;
  responseStatus: number;
  response: unknown;
  timestamp: string;
  mutationAttempted?: boolean;
};

function results<T>(value: D1Result<T>) {
  return (value.results ?? []) as T[];
}

export class GroupExamReadRepository extends DatabaseRepository {
  async listGroupsWithOwnedCount(userKey: string) {
    const db = this.connection();
    const [groupRows, countRows] = await db.batch([
      db.prepare(`
        SELECT g.id, g.name, g.member_limit, g.admin_question_count_override,
          g.settings_json, g.status, g.revision, g.created_at, g.updated_at,
          m.public_name, m.membership_epoch, (g.owner_user_key = ?) AS is_owner,
          (SELECT COUNT(*) FROM study_group_members x WHERE x.group_id = g.id AND x.status = 'active') AS active_members,
          (SELECT COUNT(*) FROM study_group_invites i WHERE i.group_id = g.id AND i.status = 'active' AND i.expires_at > CURRENT_TIMESTAMP) AS reserved_invites,
          (SELECT r.id FROM study_group_exam_runs r WHERE r.group_id = g.id ORDER BY r.created_at DESC LIMIT 1) AS recent_run_id,
          (SELECT r.status FROM study_group_exam_runs r WHERE r.group_id = g.id ORDER BY r.created_at DESC LIMIT 1) AS recent_run_status
        FROM study_groups g
        JOIN study_group_members m ON m.group_id = g.id AND m.user_key = ? AND m.status = 'active'
        WHERE g.status = 'active'
        ORDER BY g.updated_at DESC, g.id
      `).bind(userKey, userKey),
      db.prepare("SELECT COUNT(*) AS count FROM study_groups WHERE owner_user_key=? AND status='active'").bind(userKey),
    ]);
    return {
      groups: results(groupRows as D1Result<Record<string, unknown>>),
      ownedActiveCount: Number((countRows.results?.[0] as { count?: number } | undefined)?.count ?? 0),
    };
  }
  async groupForMember(groupId: string, userKey: string) {
    return this.connection().prepare(`
      SELECT g.id, g.name, g.member_limit, g.admin_question_count_override,
        g.settings_json, g.status, g.revision, g.created_at, g.updated_at,
        m.public_name, m.membership_epoch, m.status AS member_status,
        (g.owner_user_key = ?) AS is_owner,
        (SELECT COUNT(*) FROM study_group_members x WHERE x.group_id = g.id AND x.status = 'active') AS active_members,
        (SELECT COUNT(*) FROM study_group_invites i WHERE i.group_id = g.id AND i.status = 'active' AND i.expires_at > CURRENT_TIMESTAMP) AS reserved_invites
      FROM study_groups g
      JOIN study_group_members m ON m.group_id = g.id AND m.user_key = ?
      WHERE g.id = ? AND g.status = 'active' AND m.status = 'active'
    `).bind(userKey, userKey, groupId).first<Record<string, unknown>>();
  }

  async groupForOwner(groupId: string, userKey: string) {
    return this.connection().prepare(`
      SELECT * FROM study_groups
      WHERE id = ? AND owner_user_key = ? AND status = 'active'
    `).bind(groupId, userKey).first<GroupRow>();
  }

  async groupById(groupId: string) {
    return this.connection().prepare("SELECT * FROM study_groups WHERE id = ?")
      .bind(groupId).first<GroupRow>();
  }

  async member(groupId: string, userKey: string) {
    return this.connection().prepare(`
      SELECT * FROM study_group_members WHERE group_id = ? AND user_key = ?
    `).bind(groupId, userKey).first<MemberRow>();
  }

  async activeMembers(groupId: string) {
    return results(await this.connection().prepare(`
      SELECT * FROM study_group_members
      WHERE group_id = ? AND status = 'active'
      ORDER BY joined_at, user_key
    `).bind(groupId).all<MemberRow>());
  }

  async membersForVisibleGroup(groupId: string, userKey: string) {
    return results(await this.connection().prepare(`
      SELECT m.public_id AS membership_id, m.public_name, m.status, m.membership_epoch,
             (m.user_key = g.owner_user_key) AS is_owner,
             CASE WHEN m.user_key = ? THEN 1 ELSE 0 END AS is_self
      FROM study_group_members m
      JOIN study_groups g ON g.id = m.group_id
      WHERE m.group_id = ? AND m.status = 'active'
        AND EXISTS (
          SELECT 1 FROM study_group_members viewer
          WHERE viewer.group_id = m.group_id AND viewer.user_key = ? AND viewer.status = 'active'
        )
      ORDER BY is_owner DESC, m.joined_at, m.user_key
    `).bind(userKey, groupId, userKey).all<Record<string, unknown>>());
  }

  async readIdempotent(actorUserKey: string, action: string, key: string) {
    return this.connection().prepare(`
      SELECT request_digest, execution_id, response_status, response_json FROM study_group_idempotency
      WHERE actor_user_key = ? AND action = ? AND idempotency_key = ?
    `).bind(actorUserKey, action, key).first<{
      request_digest: string;
      execution_id: string;
      response_status: number;
      response_json: string;
    }>();
  }

  async activeInviteCount(groupId: string, timestamp: string) {
    const row = await this.connection().prepare(`
      SELECT COUNT(*) AS count FROM study_group_invites
      WHERE group_id = ? AND status = 'active' AND expires_at > ?
    `).bind(groupId, timestamp).first<{ count: number }>();
    return Number(row?.count ?? 0);
  }

  async inviteById(inviteId: string) {
    return this.connection().prepare("SELECT * FROM study_group_invites WHERE id = ?")
      .bind(inviteId).first<InviteRow>();
  }

  async inviteByDigest(digest: string) {
    return this.connection().prepare("SELECT * FROM study_group_invites WHERE token_digest = ?")
      .bind(digest).first<InviteRow>();
  }

  async activeRelease() {
    const personal = await personalGroupRelease(this.connection());
    if (personal) return personal;
    return this.connection().prepare(`
      SELECT * FROM skct_content_releases
      WHERE status = 'active'
      ORDER BY created_at DESC, id DESC LIMIT 1
    `).first<Record<string, unknown>>();
  }

  async eligibleQuestions(releaseId: string) {
    if (releaseId.startsWith(PERSONAL_GROUP_PREFIX)) return personalGroupQuestions(this.connection(),releaseId);
    return results(await this.connection().prepare(`
      SELECT p.*, s.correct_answers_json, s.explanation_md, s.secret_hash
      FROM skct_question_public p
      JOIN skct_question_secret s
        ON s.release_id = p.release_id AND s.question_uid = p.question_uid
      WHERE p.release_id = ? AND p.eligibility = 'eligible'
      ORDER BY p.question_uid
    `).bind(releaseId).all<ContentQuestionRow>());
  }

  async usedQuestionUids(groupId: string, historyCutoffUtc: string) {
    const rows = results(await this.connection().prepare(`
      SELECT DISTINCT q.source_question_uid
      FROM study_group_exam_runs r
      JOIN study_group_exam_question_public q ON q.run_id = r.id
      WHERE r.group_id = ? AND r.status <> 'failed_prestart' AND r.created_at <= ?
      ORDER BY q.source_question_uid
    `).bind(groupId, historyCutoffUtc).all<{ source_question_uid: string }>());
    return new Set(rows.map((row) => row.source_question_uid));
  }

  async findRunByRequestId(requestId: string) {
    return this.connection().prepare("SELECT * FROM study_group_exam_runs WHERE start_request_id = ?")
      .bind(requestId).first<RunRow>();
  }

  async runById(runId: string) {
    return this.connection().prepare("SELECT * FROM study_group_exam_runs WHERE id = ?")
      .bind(runId).first<RunRow>();
  }

  async activeRunForGroup(groupId: string) {
    return this.connection().prepare(`
      SELECT r.* FROM study_group_active_runs active
      JOIN study_group_exam_runs r ON r.id = active.run_id
      WHERE active.group_id = ?
    `).bind(groupId).first<RunRow>();
  }

  async latestRunForGroup(groupId: string) {
    return this.connection().prepare(`
      SELECT * FROM study_group_exam_runs
      WHERE group_id = ?
      ORDER BY created_at DESC, id DESC LIMIT 1
    `).bind(groupId).first<RunRow>();
  }

  async syncRunForMember(groupId: string, userKey: string) {
    return this.connection().prepare(`
      SELECT r.* FROM study_group_exam_runs r
      JOIN study_group_exam_participants p ON p.run_id = r.id AND p.user_key = ?
      WHERE r.group_id = ? AND r.status IN ('running', 'finalizing', 'completed')
      ORDER BY CASE r.status WHEN 'running' THEN 0 WHEN 'finalizing' THEN 1 ELSE 2 END,
               r.created_at DESC, r.id DESC LIMIT 1
    `).bind(userKey, groupId).first<RunRow>();
  }

  async visiblePresence(groupId: string, userKey: string, onlineCutoff: string, recentCutoff: string) {
    return results(await this.connection().prepare(`
      SELECT m.public_id AS membership_id, m.public_name,
        CASE WHEN EXISTS (
          SELECT 1 FROM study_group_presence_sessions p
          WHERE p.group_id = m.group_id AND p.user_key = m.user_key
            AND p.visible = 1 AND p.last_seen_at >= ?
        ) THEN 1 ELSE 0 END AS online,
        CASE
          WHEN EXISTS (
            SELECT 1 FROM study_group_presence_sessions p
            WHERE p.group_id = m.group_id AND p.user_key = m.user_key
              AND p.visible = 1 AND p.last_seen_at >= ?
          ) THEN 'online'
          WHEN EXISTS (
            SELECT 1 FROM study_group_presence_sessions p
            WHERE p.group_id = m.group_id AND p.user_key = m.user_key
              AND p.last_seen_at >= ?
          ) THEN 'recent'
          ELSE 'offline'
        END AS presence_state
      FROM study_group_members m
      WHERE m.group_id = ? AND m.status = 'active'
        AND EXISTS (
          SELECT 1 FROM study_group_members viewer
          WHERE viewer.group_id = m.group_id AND viewer.user_key = ? AND viewer.status = 'active'
        )
      ORDER BY online DESC, m.joined_at, m.public_id
    `).bind(onlineCutoff, onlineCutoff, recentCutoff, groupId, userKey).all<Record<string, unknown>>());
  }

  async syncSnapshot(groupId: string, userKey: string, timestamp: string, onlineCutoff: string, recentCutoff: string) {
    const db = this.connection();
    const [groupResult, runResult, scheduledResult, dueResult, presenceResult] = await db.batch([
      db.prepare(`SELECT g.id, g.name, g.member_limit, g.admin_question_count_override,
        g.settings_json, g.status, g.revision, g.created_at, g.updated_at,
        m.public_name, m.membership_epoch, m.status AS member_status,
        (g.owner_user_key = ?) AS is_owner,
        (SELECT COUNT(*) FROM study_group_members x WHERE x.group_id = g.id AND x.status = 'active') AS active_members,
        (SELECT COUNT(*) FROM study_group_invites i WHERE i.group_id = g.id AND i.status = 'active' AND i.expires_at > CURRENT_TIMESTAMP) AS reserved_invites
        FROM study_groups g JOIN study_group_members m ON m.group_id = g.id AND m.user_key = ?
        WHERE g.id = ? AND g.status = 'active' AND m.status = 'active'`).bind(userKey, userKey, groupId),
      db.prepare(`SELECT r.*, CASE WHEN v.run_id IS NULL THEN 0 ELSE 1 END AS has_v2_contract
        FROM study_group_exam_runs r JOIN study_group_exam_participants p ON p.run_id = r.id AND p.user_key = ?
        LEFT JOIN study_group_exam_run_contract_v2 v ON v.run_id = r.id
        WHERE r.group_id = ? AND r.status IN ('running', 'finalizing', 'completed')
        ORDER BY CASE r.status WHEN 'running' THEN 0 WHEN 'finalizing' THEN 1 ELSE 2 END,
          r.created_at DESC, r.id DESC LIMIT 1`).bind(userKey, groupId),
      db.prepare(`SELECT * FROM study_group_exam_runs WHERE group_id = ? AND status = 'scheduled' AND scheduled_at_utc > ?
        ORDER BY scheduled_at_utc LIMIT 1`).bind(groupId, timestamp),
      db.prepare(`SELECT 1 AS due FROM study_group_exam_runs WHERE group_id = ? AND status = 'scheduled'
        AND scheduled_at_utc <= ? LIMIT 1`).bind(groupId, timestamp),
      db.prepare(`SELECT m.public_id AS membership_id, m.public_name,
        CASE WHEN EXISTS (SELECT 1 FROM study_group_presence_sessions p WHERE p.group_id = m.group_id
          AND p.user_key = m.user_key AND p.visible = 1 AND p.last_seen_at >= ?) THEN 1 ELSE 0 END AS online,
        CASE WHEN EXISTS (SELECT 1 FROM study_group_presence_sessions p WHERE p.group_id = m.group_id
          AND p.user_key = m.user_key AND p.visible = 1 AND p.last_seen_at >= ?) THEN 'online'
          WHEN EXISTS (SELECT 1 FROM study_group_presence_sessions p WHERE p.group_id = m.group_id
          AND p.user_key = m.user_key AND p.last_seen_at >= ?) THEN 'recent' ELSE 'offline' END AS presence_state
        FROM study_group_members m WHERE m.group_id = ? AND m.status = 'active'
        AND EXISTS (SELECT 1 FROM study_group_members viewer WHERE viewer.group_id = m.group_id
          AND viewer.user_key = ? AND viewer.status = 'active')
        ORDER BY online DESC, m.joined_at, m.public_id`).bind(onlineCutoff, onlineCutoff, recentCutoff, groupId, userKey),
    ]);
    return {
      group: results(groupResult as D1Result<Record<string, unknown>>)[0] ?? null,
      run: (results(runResult as D1Result<RunRow & { has_v2_contract: number }>)[0] ?? null),
      scheduled: results(scheduledResult as D1Result<RunRow>)[0] ?? null,
      dueScheduled: results(dueResult as D1Result<{ due: number }>).length > 0,
      presence: results(presenceResult as D1Result<Record<string, unknown>>),
    };
  }

  async adminGroupPage(offset: number, limit: number, dateKey: string) {
    return results(await this.connection().prepare(`
      SELECT g.id, g.name, g.status, g.member_limit, g.admin_question_count_override,
        COALESCE(g.admin_question_count_override, 15) AS effective_question_count,
        g.revision, g.created_at, g.updated_at,
        (SELECT m.public_name FROM study_group_members m
         WHERE m.group_id = g.id AND m.user_key = g.owner_user_key
         ORDER BY m.membership_epoch DESC LIMIT 1) AS owner_public_name,
        (SELECT COUNT(*) FROM study_group_members m WHERE m.group_id = g.id AND m.status = 'active') AS active_members,
        (SELECT COUNT(*) FROM study_group_exam_runs r WHERE r.group_id = g.id) AS run_count,
        (SELECT r.status FROM study_group_exam_runs r WHERE r.group_id = g.id ORDER BY r.created_at DESC, r.id DESC LIMIT 1) AS recent_run_status,
        (SELECT COALESCE(r.completed_at, r.actual_started_at_utc, r.scheduled_at_utc, r.created_at)
         FROM study_group_exam_runs r WHERE r.group_id = g.id ORDER BY r.created_at DESC, r.id DESC LIMIT 1) AS recent_run_at,
        (SELECT COUNT(*) FROM study_group_quota_slots q WHERE q.group_id = g.id AND q.date_key = ?) AS today_quota_total,
        (SELECT COUNT(*) FROM study_group_quota_slots q WHERE q.group_id = g.id AND q.date_key = ? AND q.status = 'available') AS today_quota_available,
        (SELECT COUNT(*) FROM study_group_quota_slots q WHERE q.group_id = g.id AND q.date_key = ? AND q.status = 'reserved') AS today_quota_reserved,
        (SELECT COUNT(*) FROM study_group_quota_slots q WHERE q.group_id = g.id AND q.date_key = ? AND q.status = 'consumed') AS today_quota_consumed
      FROM study_groups g
      WHERE g.status = 'active'
      ORDER BY g.updated_at DESC, g.id
      LIMIT ? OFFSET ?
    `).bind(dateKey, dateKey, dateKey, dateKey, limit, offset).all<Record<string, unknown>>());
  }

  async adminGroupCount() {
    const row = await this.connection().prepare("SELECT COUNT(*) AS count FROM study_groups WHERE status='active'")
      .first<{ count: number }>();
    return Number(row?.count ?? 0);
  }

  async quotaLedger(groupId: string, dateKey: string) {
    const row = await this.connection().prepare(`
      SELECT COUNT(*) AS total,
        SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) AS available,
        SUM(CASE WHEN status = 'reserved' THEN 1 ELSE 0 END) AS reserved,
        SUM(CASE WHEN status = 'consumed' THEN 1 ELSE 0 END) AS consumed
      FROM study_group_quota_slots WHERE group_id = ? AND date_key = ?
    `).bind(groupId, dateKey).first<Record<string, unknown>>();
    return {
      total: Number(row?.total ?? 0),
      available: Number(row?.available ?? 0),
      reserved: Number(row?.reserved ?? 0),
      consumed: Number(row?.consumed ?? 0),
    };
  }

  async activeReleaseAreaCounts() {
    return results(await this.connection().prepare(`
      SELECT p.area_code AS area, COUNT(*) AS eligible_count
      FROM skct_question_public p
      JOIN skct_content_releases r ON r.id = p.release_id AND r.status = 'active'
      WHERE p.eligibility = 'eligible'
      GROUP BY p.area_code ORDER BY p.area_code
    `).all<Record<string, unknown>>());
  }

  async futureScheduledRun(groupId: string, timestamp: string) {
    return this.connection().prepare(`
      SELECT * FROM study_group_exam_runs
      WHERE group_id = ? AND status = 'scheduled' AND scheduled_at_utc > ?
      ORDER BY scheduled_at_utc LIMIT 1
    `).bind(groupId, timestamp).first<RunRow>();
  }

  async availableQuotaSlot(groupId: string, dateKey: string) {
    return this.connection().prepare(`
      SELECT slot_no FROM study_group_quota_slots
      WHERE group_id = ? AND date_key = ? AND status = 'available'
      ORDER BY slot_no LIMIT 1
    `).bind(groupId, dateKey).first<{ slot_no: number }>();
  }

  async quotaSlots(groupId: string, dateKey: string) {
    return results(await this.connection().prepare(`
      SELECT slot_no, source, status, reserved_run_id
      FROM study_group_quota_slots
      WHERE group_id = ? AND date_key = ?
      ORDER BY slot_no
    `).bind(groupId, dateKey).all<Record<string, unknown>>());
  }

  async scheduledRunsForDeprecation(groupId?: string) {
    return results(await this.connection().prepare(`SELECT * FROM study_group_exam_runs
      WHERE status='scheduled' AND (? IS NULL OR group_id=?) ORDER BY scheduled_at_utc LIMIT 25`)
      .bind(groupId??null,groupId??null).all<RunRow>());
  }

  async questionsForRun(runId: string) {
    return results(await this.connection().prepare(`
      SELECT * FROM study_group_exam_question_public
      WHERE run_id = ? ORDER BY position
    `).bind(runId).all<RunQuestionRow>());
  }

  async participant(runId: string, userKey: string) {
    return this.connection().prepare(`
      SELECT * FROM study_group_exam_participants WHERE run_id = ? AND user_key = ?
    `).bind(runId, userKey).first<Record<string, unknown>>();
  }

  async currentPublicQuestion(runId: string, userKey: string, timestamp: string) {
    return this.connection().prepare(`
      SELECT q.position, q.source_question_uid, q.area_code_snapshot,
             q.prompt_snapshot, q.choices_snapshot_json, q.asset_refs_snapshot_json,
             q.time_limit_seconds, q.opens_at_utc, q.deadline_at_utc,
             a.answer_json, COALESCE(a.revision, 0) AS answer_revision
      FROM study_group_exam_question_public q
      JOIN study_group_exam_participants p ON p.run_id = q.run_id AND p.user_key = ?
      LEFT JOIN study_group_exam_answers a
        ON a.run_id = q.run_id AND a.user_key = p.user_key AND a.position = q.position
      WHERE q.run_id = ? AND p.status IN ('rostered', 'in_progress')
        AND q.opens_at_utc <= ? AND q.deadline_at_utc > ?
      ORDER BY q.position LIMIT 1
    `).bind(userKey, runId, timestamp, timestamp).first<Record<string, unknown>>();
  }

  async answerOperation(operationId: string) {
    return this.connection().prepare(`
      SELECT * FROM study_group_answer_operations WHERE operation_id = ?
    `).bind(operationId).first<Record<string, unknown>>();
  }

  async answerForParticipant(runId: string, userKey: string, position: number) {
    return this.connection().prepare(`
      SELECT * FROM study_group_exam_answers
      WHERE run_id = ? AND user_key = ? AND position = ?
    `).bind(runId, userKey, position).first<Record<string, unknown>>();
  }

  async runsReadyToFinalize(timestamp: string, groupId?: string) {
    return results(await this.connection().prepare(`
      SELECT * FROM study_group_exam_runs
      WHERE status IN ('running', 'finalizing') AND final_deadline_at_utc <= ?
        AND NOT EXISTS (SELECT 1 FROM study_group_exam_run_contract_v2 v WHERE v.run_id = study_group_exam_runs.id)
        AND (? IS NULL OR group_id = ?)
      ORDER BY final_deadline_at_utc LIMIT 25
    `).bind(timestamp, groupId ?? null, groupId ?? null).all<RunRow>());
  }

  async gradingRows(runId: string) {
    return results(await this.connection().prepare(`
      SELECT p.user_key, p.status AS participant_status, q.position,
             s.correct_answers_snapshot_json,
             COALESCE(a.answer_json, '[]') AS answer_json
      FROM study_group_exam_participants p
      CROSS JOIN study_group_exam_question_public q
      JOIN study_group_exam_question_secret s ON s.run_id = q.run_id AND s.position = q.position
      LEFT JOIN study_group_exam_answers a
        ON a.run_id = p.run_id AND a.user_key = p.user_key AND a.position = q.position
      WHERE p.run_id = ? AND q.run_id = p.run_id
      ORDER BY p.user_key, q.position
    `).bind(runId).all<Record<string, unknown>>());
  }

  async resultParticipants(runId: string) {
    return results(await this.connection().prepare(`
      SELECT user_key, public_name_snapshot, status, score, wrong_count, wrong_positions_json
      FROM study_group_exam_participants WHERE run_id = ?
      ORDER BY score DESC, public_name_snapshot, user_key
    `).bind(runId).all<Record<string, unknown>>());
  }

  async personalReview(runId: string, userKey: string) {
    return results(await this.connection().prepare(`
      SELECT q.position, q.area_code_snapshot, q.prompt_snapshot, q.choices_snapshot_json,
             COALESCE(a.answer_json, '[]') AS answer_json,
             s.correct_answers_snapshot_json, s.explanation_snapshot
      FROM study_group_exam_question_public q
      JOIN study_group_exam_question_secret s ON s.run_id = q.run_id AND s.position = q.position
      JOIN study_group_exam_participants p ON p.run_id = q.run_id AND p.user_key = ?
      LEFT JOIN study_group_exam_answers a
        ON a.run_id = q.run_id AND a.user_key = p.user_key AND a.position = q.position
      WHERE q.run_id = ?
      ORDER BY q.position
    `).bind(userKey, runId).all<Record<string, unknown>>());
  }

  async activeMembership(groupId: string, userKey: string) {
    return Boolean(await this.connection().prepare(`
      SELECT 1 FROM study_group_members WHERE group_id = ? AND user_key = ? AND status = 'active'
    `).bind(groupId, userKey).first());
  }

}
