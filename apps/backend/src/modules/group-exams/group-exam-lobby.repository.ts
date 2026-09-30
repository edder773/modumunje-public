import { DatabaseRepository } from "@backend/infrastructure/database/database.repository";
import type { RunRow } from "./group-exam.repository";

const rows = <T>(value: D1Result<T>) => value.results ?? [];

export class GroupExamLobbyRepository extends DatabaseRepository {
  async detail(groupId: string, userKey: string, dateKey: string, timestamp: string) {
    const db = this.connection();
    const [group, slots, scheduled, members] = await db.batch([
      db.prepare(`SELECT g.id, g.name, g.member_limit, g.admin_question_count_override,
        g.settings_json, g.status, g.revision, g.created_at, g.updated_at,
        m.public_name, m.membership_epoch, m.status AS member_status, (g.owner_user_key = ?) AS is_owner,
        (SELECT COUNT(*) FROM study_group_members x WHERE x.group_id = g.id AND x.status = 'active') AS active_members,
        (SELECT COUNT(*) FROM study_group_invites i WHERE i.group_id = g.id AND i.status = 'active' AND i.reusable = 0 AND i.expires_at > CURRENT_TIMESTAMP) AS reserved_invites
        FROM study_groups g JOIN study_group_members m ON m.group_id = g.id AND m.user_key = ?
        WHERE g.id = ? AND g.status = 'active' AND m.status = 'active'`).bind(userKey, userKey, groupId),
      db.prepare(`SELECT slot_no, source, status, reserved_run_id FROM study_group_quota_slots
        WHERE group_id = ? AND date_key = ? ORDER BY slot_no`).bind(groupId, dateKey),
      db.prepare(`SELECT * FROM study_group_exam_runs WHERE group_id = ? AND status = 'scheduled'
        AND scheduled_at_utc > ? ORDER BY scheduled_at_utc LIMIT 1`).bind(groupId, timestamp),
      db.prepare(`SELECT m.public_id AS membership_id, m.public_name, m.status, m.membership_epoch,
        (m.user_key = g.owner_user_key) AS is_owner, CASE WHEN m.user_key = ? THEN 1 ELSE 0 END AS is_self
        FROM study_group_members m JOIN study_groups g ON g.id = m.group_id
        WHERE m.group_id = ? AND m.status = 'active'
        AND EXISTS(SELECT 1 FROM study_group_members viewer WHERE viewer.group_id = m.group_id
          AND viewer.user_key = ? AND viewer.status = 'active')
        ORDER BY is_owner DESC, m.joined_at, m.user_key`).bind(userKey, groupId, userKey),
    ]);
    return {
      group: rows(group as D1Result<Record<string, unknown>>)[0] ?? null,
      slots: rows(slots as D1Result<Record<string, unknown>>),
      scheduled: rows(scheduled as D1Result<RunRow>)[0] ?? null,
      members: rows(members as D1Result<Record<string, unknown>>),
    };
  }

  async initial(userKey: string, dateKey: string, timestamp: string, onlineCutoff: string, recentCutoff: string) {
    const db = this.connection();
    const selected = `WITH selected AS (SELECT g.id FROM study_groups g
      JOIN study_group_members m ON m.group_id=g.id AND m.user_key=? AND m.status='active'
      WHERE g.status='active' ORDER BY g.updated_at DESC,g.id LIMIT 1)`;
    const [groups, owned, group, slots, scheduled, members, run, presence] = await db.batch([
      db.prepare(`SELECT g.id,g.name,g.member_limit,g.admin_question_count_override,g.settings_json,g.status,g.revision,g.created_at,g.updated_at,
        m.public_name,m.membership_epoch,(g.owner_user_key=?) AS is_owner,
        (SELECT COUNT(*) FROM study_group_members x WHERE x.group_id=g.id AND x.status='active') AS active_members,
        (SELECT COUNT(*) FROM study_group_invites i WHERE i.group_id=g.id AND i.status='active' AND i.reusable=0 AND i.expires_at>CURRENT_TIMESTAMP) AS reserved_invites,
        (SELECT r.id FROM study_group_exam_runs r WHERE r.group_id=g.id ORDER BY r.created_at DESC LIMIT 1) AS recent_run_id,
        (SELECT r.status FROM study_group_exam_runs r WHERE r.group_id=g.id ORDER BY r.created_at DESC LIMIT 1) AS recent_run_status
        FROM study_groups g JOIN study_group_members m ON m.group_id=g.id AND m.user_key=? AND m.status='active'
        WHERE g.status='active' ORDER BY g.updated_at DESC,g.id`).bind(userKey,userKey),
      db.prepare(`SELECT COUNT(*) AS count FROM study_groups WHERE owner_user_key=? AND status='active'`).bind(userKey),
      db.prepare(`${selected} SELECT g.id,g.name,g.member_limit,g.admin_question_count_override,g.settings_json,g.status,g.revision,g.created_at,g.updated_at,
        m.public_name,m.membership_epoch,m.status AS member_status,(g.owner_user_key=?) AS is_owner,
        (SELECT COUNT(*) FROM study_group_members x WHERE x.group_id=g.id AND x.status='active') AS active_members,
        (SELECT COUNT(*) FROM study_group_invites i WHERE i.group_id=g.id AND i.status='active' AND i.reusable=0 AND i.expires_at>CURRENT_TIMESTAMP) AS reserved_invites
        FROM selected s JOIN study_groups g ON g.id=s.id JOIN study_group_members m ON m.group_id=g.id AND m.user_key=?`).bind(userKey,userKey,userKey),
      db.prepare(`${selected} SELECT slot_no,source,status,reserved_run_id FROM study_group_quota_slots
        WHERE group_id=(SELECT id FROM selected) AND date_key=? ORDER BY slot_no`).bind(userKey,dateKey),
      db.prepare(`${selected} SELECT * FROM study_group_exam_runs WHERE group_id=(SELECT id FROM selected)
        AND status='scheduled' AND scheduled_at_utc>? ORDER BY scheduled_at_utc LIMIT 1`).bind(userKey,timestamp),
      db.prepare(`${selected} SELECT m.public_id AS membership_id,m.public_name,m.status,m.membership_epoch,
        (m.user_key=g.owner_user_key) AS is_owner,CASE WHEN m.user_key=? THEN 1 ELSE 0 END AS is_self
        FROM study_group_members m JOIN study_groups g ON g.id=m.group_id
        WHERE m.group_id=(SELECT id FROM selected) AND m.status='active'
        ORDER BY is_owner DESC,m.joined_at,m.user_key`).bind(userKey,userKey),
      db.prepare(`${selected} SELECT r.*,CASE WHEN v.run_id IS NULL THEN 0 ELSE 1 END AS has_v2_contract
        FROM study_group_exam_runs r JOIN study_group_exam_participants p ON p.run_id=r.id AND p.user_key=?
        LEFT JOIN study_group_exam_run_contract_v2 v ON v.run_id=r.id
        WHERE r.group_id=(SELECT id FROM selected) AND r.status IN ('running','finalizing','completed')
        ORDER BY CASE r.status WHEN 'running' THEN 0 WHEN 'finalizing' THEN 1 ELSE 2 END,r.created_at DESC,r.id DESC LIMIT 1`).bind(userKey,userKey),
      db.prepare(`${selected} SELECT m.public_id AS membership_id,m.public_name,
        CASE WHEN EXISTS(SELECT 1 FROM study_group_presence_sessions p WHERE p.group_id=m.group_id AND p.user_key=m.user_key
          AND p.visible=1 AND p.last_seen_at>=?) THEN 1 ELSE 0 END AS online,
        CASE WHEN EXISTS(SELECT 1 FROM study_group_presence_sessions p WHERE p.group_id=m.group_id AND p.user_key=m.user_key
          AND p.visible=1 AND p.last_seen_at>=?) THEN 'online'
          WHEN EXISTS(SELECT 1 FROM study_group_presence_sessions p WHERE p.group_id=m.group_id AND p.user_key=m.user_key
          AND p.last_seen_at>=?) THEN 'recent' ELSE 'offline' END AS presence_state
        FROM study_group_members m WHERE m.group_id=(SELECT id FROM selected) AND m.status='active'
        ORDER BY online DESC,m.joined_at,m.public_id`).bind(userKey,onlineCutoff,onlineCutoff,recentCutoff),
    ]);
    return {
      groups: rows(groups as D1Result<Record<string, unknown>>),
      ownedActiveCount: Number(rows(owned as D1Result<{ count: number }>)[0]?.count ?? 0),
      group: rows(group as D1Result<Record<string, unknown>>)[0] ?? null,
      slots: rows(slots as D1Result<Record<string, unknown>>),
      scheduled: rows(scheduled as D1Result<RunRow>)[0] ?? null,
      members: rows(members as D1Result<Record<string, unknown>>),
      run: rows(run as D1Result<RunRow & { has_v2_contract: number }>)[0] ?? null,
      presence: rows(presence as D1Result<Record<string, unknown>>),
    };
  }
}
