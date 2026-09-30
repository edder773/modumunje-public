import { GroupExamMutationRepository } from "./group-exam-mutation.repository";
import { GroupExamError } from "./domain/group-exam.domain";
import { getRuntimeEnv } from "@backend/infrastructure/database";
import {
  type ContentQuestionRow,
  type InviteRow,
  type MemberRow,
  type MutationIdempotency,
  type RunRow,
} from "./group-exam-read.repository";

export type {
  ContentQuestionRow, GroupRow, InviteRow, MemberRow, MutationIdempotency, RunQuestionRow, RunRow,
} from "./group-exam-read.repository";

export class GroupExamRepository extends GroupExamMutationRepository {
  serviceEnabled() {
    return getRuntimeEnv().SKCT_GROUP_SERVICE_ENABLED === "1";
  }

  private async ownerMutationBatch(statements: D1PreparedStatement[]) {
    try { return await this.connection().batch(statements); }
    catch (error) {
      if (error instanceof Error && error.message.includes("study_group_owner_slots")) {
        throw new GroupExamError(409,"그룹 소유 한도와 저장 상태를 확인해 주세요.","GROUP_OWNER_LIMIT");
      }
      throw error;
    }
  }
  private ownerSlotStatement(groupId: string, executionId: string) {
    return this.connection().prepare(`INSERT INTO study_group_owner_slots(group_id,owner_user_key,slot)
      SELECT g.id,g.owner_user_key,(SELECT MIN(slot) FROM (SELECT 1 AS slot UNION ALL SELECT 2 UNION ALL SELECT 3) slots
        WHERE NOT EXISTS(SELECT 1 FROM study_group_owner_slots occupied WHERE occupied.owner_user_key=g.owner_user_key AND occupied.slot=slots.slot))
      FROM study_groups g WHERE g.id=? AND g.status='active' AND g.last_mutation_execution_id=?`)
      .bind(groupId,executionId);
  }
  async createGroup(input: {
    id: string;
    name: string;
    ownerUserKey: string;
    ownerPublicId: string;
    publicName: string;
    memberLimit: number;
    settingsJson: string;
    timestamp: string;
    idempotency: MutationIdempotency;
  }) {
    input.idempotency.mutationAttempted = true;
    const statements = [
      this.connection().prepare(`
        INSERT INTO study_groups (
          id, name, owner_user_key, member_limit, settings_json, status, revision,
          last_mutation_execution_id, created_at, updated_at
        ) SELECT ?, ?, ?, ?, ?, 'active', 0, ?, ?, ?
        WHERE (SELECT COUNT(*) FROM study_groups WHERE owner_user_key = ? AND status = 'active') < 3
      `).bind(input.id, input.name, input.ownerUserKey, input.memberLimit, input.settingsJson,
        input.idempotency.executionId, input.timestamp, input.timestamp, input.ownerUserKey),
      this.connection().prepare(`
        INSERT INTO study_group_members (
          group_id, user_key, public_id, public_name, status, membership_epoch,
          last_mutation_execution_id, joined_at
        ) SELECT ?, ?, ?, ?, 'active', 1, ?, ? WHERE EXISTS (SELECT 1 FROM study_groups WHERE id = ?)
      `).bind(input.id, input.ownerUserKey, input.ownerPublicId, input.publicName,
        input.idempotency.executionId, input.timestamp, input.id),
      this.connection().prepare(`
        INSERT INTO study_group_membership_events (
          id, group_id, user_key, membership_epoch, event_type, actor_user_key, created_at
        ) SELECT ?, ?, ?, 1, 'joined', ?, ? WHERE EXISTS (SELECT 1 FROM study_groups WHERE id = ?)
      `).bind(crypto.randomUUID(), input.id, input.ownerUserKey, input.ownerUserKey, input.timestamp, input.id),
      this.idempotencyStatementWhen(input.idempotency, input.idempotency.response,
        "EXISTS (SELECT 1 FROM study_groups g WHERE g.id = ? AND g.last_mutation_execution_id = ?)",
        [input.id, input.idempotency.executionId]),
    ];
    statements.push(this.ownerSlotStatement(input.id, input.idempotency.executionId));
    const created = await this.ownerMutationBatch(statements);
    if (Number(created[0].meta.changes) === 0) throw new GroupExamError(409, "한 회원이 소유할 수 있는 활성 그룹은 최대 3개입니다.", "GROUP_OWNER_LIMIT");
    return this.groupForMember(input.id, input.ownerUserKey);
  }

  async createInvite(input: {
    id: string;
    groupId: string;
    digest: string;
    expiresAt: string;
    actorUserKey: string;
    timestamp: string;
    idempotency: MutationIdempotency;
  }) {
    input.idempotency.mutationAttempted = true;
    const batch = await this.connection().batch([this.connection().prepare(`
      INSERT INTO study_group_invites (
        id, group_id, token_digest, status, expires_at, created_by_user_key,
        last_mutation_execution_id, created_at
      ) SELECT ?, g.id, ?, 'active', ?, ?, ?, ?
        FROM study_groups g
        WHERE g.id = ? AND g.owner_user_key = ? AND g.status = 'active'
          AND (
            SELECT COUNT(*) FROM study_group_members m
            WHERE m.group_id = g.id AND m.status = 'active'
          ) + (
            SELECT COUNT(*) FROM study_group_invites i
            WHERE i.group_id = g.id AND i.status = 'active' AND i.expires_at > ?
          ) < g.member_limit
    `).bind(
      input.id, input.digest, input.expiresAt, input.actorUserKey,
      input.idempotency.executionId, input.timestamp,
      input.groupId, input.actorUserKey, input.timestamp,
    ), await this.writeGroupAudit({
      groupId: input.groupId, actorUserKey: input.actorUserKey, action: "invite-create",
      targetId: input.id, timestamp: input.timestamp,
    }, "EXISTS (SELECT 1 FROM study_group_invites i WHERE i.id = ? AND i.last_mutation_execution_id = ?)",
      [input.id, input.idempotency.executionId]),
    this.idempotencyStatementWhen(input.idempotency, input.idempotency.response,
      "EXISTS (SELECT 1 FROM study_group_invites i WHERE i.id = ? AND i.last_mutation_execution_id = ?)",
      [input.id, input.idempotency.executionId])]);
    const result = batch[0];
    if (Number(result.meta?.changes ?? 0) === 0) return null;
    return this.inviteById(input.id);
  }

  async rotateInvite(input: {
    previous: InviteRow;
    nextId: string;
    nextDigest: string;
    expiresAt: string;
    actorUserKey: string;
    timestamp: string;
    idempotency: MutationIdempotency;
  }) {
    input.idempotency.mutationAttempted = true;
    await this.connection().batch([
      this.connection().prepare(`
        UPDATE study_group_invites
        SET status = 'revoked', revoked_at = ?, revision = revision + 1,
            last_mutation_execution_id = ?
        WHERE id = ? AND group_id = ? AND status = 'active'
          AND EXISTS (
            SELECT 1 FROM study_groups g
            WHERE g.id = study_group_invites.group_id AND g.owner_user_key = ? AND g.status = 'active'
          )
      `).bind(input.timestamp, input.idempotency.executionId,
        input.previous.id, input.previous.group_id, input.actorUserKey),
      this.connection().prepare(`
        INSERT INTO study_group_invites (
          id, group_id, token_digest, status, expires_at, created_by_user_key,
          last_mutation_execution_id, created_at
        ) SELECT ?, group_id, ?, 'active', ?, ?, ?, ?
          FROM study_group_invites
          WHERE id = ? AND status = 'revoked' AND last_mutation_execution_id = ?
      `).bind(input.nextId, input.nextDigest, input.expiresAt, input.actorUserKey,
        input.idempotency.executionId, input.timestamp, input.previous.id,
        input.idempotency.executionId),
      await this.writeGroupAudit({
        groupId: input.previous.group_id, actorUserKey: input.actorUserKey, action: "invite-resend",
        targetId: input.nextId, before: { inviteId: input.previous.id }, after: { inviteId: input.nextId },
        timestamp: input.timestamp,
      }, "EXISTS (SELECT 1 FROM study_group_invites i WHERE i.id = ? AND i.last_mutation_execution_id = ?)",
        [input.nextId, input.idempotency.executionId]),
      this.idempotencyStatementWhen(input.idempotency, input.idempotency.response,
        "EXISTS (SELECT 1 FROM study_group_invites i WHERE i.id = ? AND i.last_mutation_execution_id = ?)",
        [input.nextId, input.idempotency.executionId]),
    ]);
    return this.inviteById(input.nextId);
  }

  async revokeInvite(inviteId: string, groupId: string, actorUserKey: string, timestamp: string, idempotency: MutationIdempotency) {
    idempotency.mutationAttempted = true;
    const batch = await this.connection().batch([this.connection().prepare(`
      UPDATE study_group_invites
      SET status = 'revoked', revoked_at = ?, revision = revision + 1,
          last_mutation_execution_id = ?
      WHERE id = ? AND group_id = ? AND status = 'active'
        AND EXISTS (
          SELECT 1 FROM study_groups g
          WHERE g.id = study_group_invites.group_id AND g.owner_user_key = ? AND g.status = 'active'
        )
    `).bind(timestamp, idempotency.executionId, inviteId, groupId, actorUserKey), await this.writeGroupAudit({
      groupId, actorUserKey, action: "invite-revoke", targetId: inviteId, timestamp,
    }, "EXISTS (SELECT 1 FROM study_group_invites i WHERE i.id = ? AND i.status = 'revoked' AND i.last_mutation_execution_id = ?)", [inviteId, idempotency.executionId]),
    this.idempotencyStatementWhen(idempotency, idempotency.response,
      "EXISTS (SELECT 1 FROM study_group_invites i WHERE i.id = ? AND i.status = 'revoked' AND i.last_mutation_execution_id = ?)",
      [inviteId, idempotency.executionId])]);
    const result = batch[0];
    return Number(result.meta?.changes ?? 0) > 0;
  }

  async acceptInvite(input: {
    invite: InviteRow;
    userKey: string;
    publicId: string;
    publicName: string;
    timestamp: string;
    idempotency: MutationIdempotency;
  }) {
    input.idempotency.mutationAttempted = true;
    const current = await this.member(input.invite.group_id, input.userKey);
    const epoch = (current?.membership_epoch ?? 0) + (current ? 1 : 1);
    const eventType = current ? "rejoined" : "joined";
    const statements = [
      this.connection().prepare(`
        UPDATE study_group_invites
        SET status = 'accepted', consumed_by_user_key = ?, consumed_at = ?,
            revision = revision + 1, last_mutation_execution_id = ?
        WHERE id = ? AND token_digest = ? AND status = 'active' AND expires_at > ?
          AND EXISTS (
            SELECT 1 FROM study_groups g
            WHERE g.id = study_group_invites.group_id AND g.status = 'active'
              AND (
                SELECT COUNT(*) FROM study_group_members m
                WHERE m.group_id = g.id AND m.status = 'active' AND m.user_key <> ?
              ) + (
                SELECT COUNT(*) FROM study_group_invites pending
                WHERE pending.group_id = g.id AND pending.status = 'active'
                  AND pending.expires_at > ? AND pending.id <> study_group_invites.id
              ) < g.member_limit
          )
          AND NOT EXISTS (
            SELECT 1 FROM study_group_members existing
            WHERE existing.group_id = study_group_invites.group_id
              AND existing.user_key = ? AND existing.status = 'active'
          )
      `).bind(input.userKey, input.timestamp, input.idempotency.executionId,
        input.invite.id, input.invite.token_digest, input.timestamp,
        input.userKey, input.timestamp, input.userKey),
      this.connection().prepare(`
        INSERT INTO study_group_members (
          group_id, user_key, public_id, public_name, status, membership_epoch,
          last_mutation_execution_id, joined_at, left_at
        )
        SELECT i.group_id, ?, ?, ?, 'active', ?, ?, ?, NULL
        FROM study_group_invites i
        WHERE i.id = ? AND i.status = 'accepted'
          AND i.consumed_by_user_key = ? AND i.last_mutation_execution_id = ?
        ON CONFLICT(group_id, user_key) DO UPDATE SET
          public_name = excluded.public_name,
          status = 'active',
          membership_epoch = excluded.membership_epoch,
          last_mutation_execution_id = excluded.last_mutation_execution_id,
          joined_at = excluded.joined_at,
          left_at = NULL
      `).bind(
        input.userKey,
        input.publicId,
        input.publicName,
        epoch,
        input.idempotency.executionId,
        input.timestamp,
        input.invite.id,
        input.userKey,
        input.idempotency.executionId,
      ),
      this.connection().prepare(`
        INSERT INTO study_group_membership_events (
          id, group_id, user_key, membership_epoch, event_type, actor_user_key, created_at
        )
        SELECT ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM study_group_invites i
          WHERE i.id = ? AND i.status = 'accepted' AND i.consumed_by_user_key = ?
            AND i.last_mutation_execution_id = ?
          AND EXISTS (
            SELECT 1 FROM study_group_members m
            WHERE m.group_id = i.group_id AND m.user_key = ?
              AND m.last_mutation_execution_id = ?
          )
        )
      `).bind(
        crypto.randomUUID(), input.invite.group_id, input.userKey, epoch, eventType,
        input.userKey, input.timestamp, input.invite.id, input.userKey,
        input.idempotency.executionId, input.userKey, input.idempotency.executionId,
      ),
      this.idempotencyStatementWhen(input.idempotency, input.idempotency.response,
        `EXISTS (
          SELECT 1 FROM study_group_invites i
          JOIN study_group_members m ON m.group_id = i.group_id AND m.user_key = ?
          WHERE i.id = ? AND i.last_mutation_execution_id = ?
            AND m.last_mutation_execution_id = ?
        )`, [input.userKey, input.invite.id, input.idempotency.executionId,
          input.idempotency.executionId]),
    ];
    const batch = await this.connection().batch(statements);
    return {
      accepted: Number(batch[0]?.meta?.changes ?? 0) > 0 && Number(batch[1]?.meta?.changes ?? 0) > 0,
      member: await this.member(input.invite.group_id, input.userKey),
    };
  }

  async updateGroupSettings(input: {
    groupId: string;
    actorUserKey: string;
    expectedRevision: number;
    memberLimit: number;
    settingsJson: string;
    timestamp: string;
    idempotency: MutationIdempotency;
  }) {
    input.idempotency.mutationAttempted = true;
    const batch = await this.connection().batch([this.connection().prepare(`
      UPDATE study_groups
      SET member_limit = ?, settings_json = ?, revision = revision + 1,
          last_mutation_execution_id = ?, updated_at = ?
      WHERE id = ? AND owner_user_key = ? AND status = 'active' AND revision = ?
        AND ? >= (
          SELECT COUNT(*) FROM study_group_members m
          WHERE m.group_id = study_groups.id AND m.status = 'active'
        ) + (
          SELECT COUNT(*) FROM study_group_invites i
          WHERE i.group_id = study_groups.id AND i.status = 'active' AND i.expires_at > ?
        )
    `).bind(
      input.memberLimit, input.settingsJson, input.idempotency.executionId,
      input.timestamp, input.groupId,
      input.actorUserKey, input.expectedRevision, input.memberLimit, input.timestamp,
    ), await this.writeGroupAudit({
      groupId: input.groupId, actorUserKey: input.actorUserKey, action: "settings-update",
      after: { memberLimit: input.memberLimit }, timestamp: input.timestamp,
    }, "EXISTS (SELECT 1 FROM study_groups g WHERE g.id = ? AND g.owner_user_key = ? AND g.last_mutation_execution_id = ?)", [input.groupId, input.actorUserKey, input.idempotency.executionId]),
    this.idempotencyStatementWhen(input.idempotency, input.idempotency.response,
      "EXISTS (SELECT 1 FROM study_groups g WHERE g.id = ? AND g.owner_user_key = ? AND g.last_mutation_execution_id = ?)",
      [input.groupId, input.actorUserKey, input.idempotency.executionId])]);
    const result = batch[0];
    return Number(result.meta?.changes ?? 0) > 0;
  }

  async kickMember(input: {
    groupId: string;
    actorUserKey: string;
    targetMembershipId: string;
    timestamp: string;
    idempotency: MutationIdempotency;
  }) {
    input.idempotency.mutationAttempted = true;
    const eventId = crypto.randomUUID();
    const batch = await this.connection().batch([
      this.connection().prepare(`
        UPDATE study_group_members
        SET status = 'kicked', left_at = ?, last_mutation_execution_id = ?
        WHERE group_id = ? AND public_id = ? AND status = 'active'
          AND user_key <> ?
          AND EXISTS (
            SELECT 1 FROM study_groups g
            WHERE g.id = study_group_members.group_id AND g.owner_user_key = ? AND g.status = 'active'
          )
      `).bind(input.timestamp, input.idempotency.executionId, input.groupId,
        input.targetMembershipId, input.actorUserKey, input.actorUserKey),
      this.connection().prepare(`
        INSERT INTO study_group_membership_events (
          id, group_id, user_key, membership_epoch, event_type, actor_user_key, created_at
        ) SELECT ?, m.group_id, m.user_key, m.membership_epoch, 'kicked', ?, ?
          FROM study_group_members m
          WHERE m.group_id = ? AND m.public_id = ? AND m.status = 'kicked'
            AND m.last_mutation_execution_id = ?
      `).bind(eventId, input.actorUserKey, input.timestamp, input.groupId,
        input.targetMembershipId, input.idempotency.executionId),
      await this.writeGroupAudit({
        groupId: input.groupId, actorUserKey: input.actorUserKey, action: "member-kick",
        targetId: input.targetMembershipId, timestamp: input.timestamp,
      }, "EXISTS (SELECT 1 FROM study_group_members m WHERE m.group_id = ? AND m.public_id = ? AND m.status = 'kicked' AND m.last_mutation_execution_id = ?)", [input.groupId, input.targetMembershipId, input.idempotency.executionId]),
      this.idempotencyStatementWhen(input.idempotency, input.idempotency.response,
        "EXISTS (SELECT 1 FROM study_group_members m WHERE m.group_id = ? AND m.public_id = ? AND m.status = 'kicked' AND m.last_mutation_execution_id = ?)",
        [input.groupId, input.targetMembershipId, input.idempotency.executionId]),
    ]);
    return Number(batch[0]?.meta?.changes ?? 0) > 0;
  }

  async transferOwner(input: {
    groupId: string;
    actorUserKey: string;
    targetMembershipId: string;
    timestamp: string;
    idempotency: MutationIdempotency;
  }) {
    input.idempotency.mutationAttempted = true;
    const batch = await this.ownerMutationBatch([
      this.connection().prepare(`
        UPDATE study_groups
        SET owner_user_key = (
          SELECT m.user_key FROM study_group_members m
          WHERE m.group_id = study_groups.id AND m.public_id = ? AND m.status = 'active'
        ), revision = revision + 1, last_mutation_execution_id = ?, updated_at = ?
        WHERE id = ? AND owner_user_key = ? AND status = 'active'
          AND EXISTS (
            SELECT 1 FROM study_group_members m
            WHERE m.group_id = study_groups.id AND m.public_id = ? AND m.status = 'active'
              AND m.user_key <> study_groups.owner_user_key
              AND (SELECT COUNT(*) FROM study_groups owned WHERE owned.owner_user_key=m.user_key AND owned.status='active') < 3
          )
      `).bind(input.targetMembershipId, input.idempotency.executionId, input.timestamp,
        input.groupId, input.actorUserKey, input.targetMembershipId),
      this.connection().prepare(`DELETE FROM study_group_owner_slots WHERE group_id=? AND EXISTS(
        SELECT 1 FROM study_groups WHERE id=? AND last_mutation_execution_id=?)`).bind(input.groupId,input.groupId,input.idempotency.executionId),
      this.ownerSlotStatement(input.groupId,input.idempotency.executionId),
      this.connection().prepare(`
        INSERT INTO study_group_membership_events (
          id, group_id, user_key, membership_epoch, event_type, actor_user_key, created_at
        ) SELECT ?, m.group_id, m.user_key, m.membership_epoch, 'owner_transferred', ?, ?
          FROM study_group_members m
          JOIN study_groups g ON g.id = m.group_id AND g.owner_user_key = m.user_key
          WHERE m.group_id = ? AND m.public_id = ? AND m.status = 'active'
            AND g.last_mutation_execution_id = ?
      `).bind(
        crypto.randomUUID(), input.actorUserKey, input.timestamp,
        input.groupId, input.targetMembershipId, input.idempotency.executionId,
      ),
      await this.writeGroupAudit({
        groupId: input.groupId, actorUserKey: input.actorUserKey, action: "owner-transfer",
        targetId: input.targetMembershipId, timestamp: input.timestamp,
      }, "EXISTS (SELECT 1 FROM study_groups g JOIN study_group_members m ON m.group_id = g.id AND m.user_key = g.owner_user_key WHERE g.id = ? AND m.public_id = ? AND g.last_mutation_execution_id = ?)", [input.groupId, input.targetMembershipId, input.idempotency.executionId]),
      this.idempotencyStatementWhen(input.idempotency, input.idempotency.response,
        "EXISTS (SELECT 1 FROM study_groups g JOIN study_group_members m ON m.group_id = g.id AND m.user_key = g.owner_user_key WHERE g.id = ? AND m.public_id = ? AND g.last_mutation_execution_id = ?)",
        [input.groupId, input.targetMembershipId, input.idempotency.executionId]),
    ]);
    if (Number(batch[0]?.meta?.changes ?? 0) === 0) {
      const cap = await this.connection().prepare(`SELECT 1 FROM study_groups g JOIN study_group_members m ON m.group_id=g.id
        WHERE g.id=? AND g.owner_user_key=? AND g.status='active' AND m.public_id=? AND m.status='active'
        AND (SELECT COUNT(*) FROM study_groups x WHERE x.owner_user_key=m.user_key AND x.status='active') >= 3`).bind(input.groupId,input.actorUserKey,input.targetMembershipId).first();
      if (cap) throw new GroupExamError(409, "새 대표가 소유할 수 있는 활성 그룹은 최대 3개입니다.", "GROUP_OWNER_LIMIT");
      return false;
    }
    return true;
  }

  async leaveGroup(input: { groupId: string; userKey: string; timestamp: string; idempotency: MutationIdempotency }) {
    input.idempotency.mutationAttempted = true;
    const batch = await this.connection().batch([
      this.connection().prepare(`
        UPDATE study_groups
        SET status = 'archived', revision = revision + 1,
            last_mutation_execution_id = ?, updated_at = ?
        WHERE id = ? AND owner_user_key = ? AND status = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM study_group_members m
            WHERE m.group_id = study_groups.id AND m.status = 'active' AND m.user_key <> ?
          )
      `).bind(input.idempotency.executionId, input.timestamp,
        input.groupId, input.userKey, input.userKey),
      this.connection().prepare(`
        UPDATE study_group_members
        SET status = 'left', left_at = ?, last_mutation_execution_id = ?
        WHERE group_id = ? AND user_key = ? AND status = 'active'
          AND (
            EXISTS (SELECT 1 FROM study_groups g WHERE g.id = ? AND g.status = 'archived' AND g.last_mutation_execution_id = ?)
            OR EXISTS (SELECT 1 FROM study_groups g WHERE g.id = ? AND g.status = 'active' AND g.owner_user_key <> ?)
          )
      `).bind(input.timestamp, input.idempotency.executionId, input.groupId,
        input.userKey, input.groupId, input.idempotency.executionId,
        input.groupId, input.userKey),
      this.connection().prepare(`
        UPDATE study_group_invites SET status = 'revoked', revoked_at = ?, revision = revision + 1
        WHERE group_id = ? AND status = 'active'
          AND EXISTS (SELECT 1 FROM study_groups g WHERE g.id = ? AND g.status = 'archived' AND g.last_mutation_execution_id = ?)
      `).bind(input.timestamp, input.groupId, input.groupId, input.idempotency.executionId),
      this.connection().prepare(`
        INSERT INTO study_group_membership_events (
          id, group_id, user_key, membership_epoch, event_type, actor_user_key, created_at
        ) SELECT ?, m.group_id, m.user_key, m.membership_epoch, 'left', ?, ?
          FROM study_group_members m
          WHERE m.group_id = ? AND m.user_key = ? AND m.status = 'left'
            AND m.last_mutation_execution_id = ?
      `).bind(crypto.randomUUID(), input.userKey, input.timestamp,
        input.groupId, input.userKey, input.idempotency.executionId),
      await this.writeGroupAudit({
        groupId: input.groupId, actorUserKey: input.userKey, action: "group-leave",
        after: { status: "archived" }, timestamp: input.timestamp,
      }, "EXISTS (SELECT 1 FROM study_groups g WHERE g.id = ? AND g.status = 'archived' AND g.last_mutation_execution_id = ?)", [input.groupId, input.idempotency.executionId]),
      await this.writeGroupAudit({
        groupId: input.groupId, actorUserKey: input.userKey, action: "group-leave",
        after: { status: "left" }, timestamp: input.timestamp,
      }, "EXISTS (SELECT 1 FROM study_groups g JOIN study_group_members m ON m.group_id = g.id WHERE g.id = ? AND g.status = 'active' AND g.owner_user_key <> ? AND m.user_key = ? AND m.status = 'left' AND m.last_mutation_execution_id = ?)", [input.groupId, input.userKey, input.userKey, input.idempotency.executionId]),
      this.idempotencyStatementWhen(input.idempotency, { status: "archived" },
        "EXISTS (SELECT 1 FROM study_groups g WHERE g.id = ? AND g.status = 'archived' AND g.last_mutation_execution_id = ?)", [input.groupId, input.idempotency.executionId]),
      this.idempotencyStatementWhen(input.idempotency, { status: "left" },
        "EXISTS (SELECT 1 FROM study_groups g JOIN study_group_members m ON m.group_id = g.id WHERE g.id = ? AND g.status = 'active' AND g.owner_user_key <> ? AND m.user_key = ? AND m.status = 'left' AND m.last_mutation_execution_id = ?)", [input.groupId, input.userKey, input.userKey, input.idempotency.executionId]),
      this.connection().prepare(`DELETE FROM study_group_owner_slots WHERE group_id=? AND EXISTS(
        SELECT 1 FROM study_groups WHERE id=? AND status='archived' AND last_mutation_execution_id=?)`).bind(input.groupId,input.groupId,input.idempotency.executionId),
    ]);
    if (Number(batch[0]?.meta?.changes ?? 0) > 0) return "archived" as const;
    if (Number(batch[1]?.meta?.changes ?? 0) > 0) return "left" as const;
    const group = await this.groupById(input.groupId);
    const member = await this.member(input.groupId, input.userKey);
    if (group?.status === "active" && group.owner_user_key === input.userKey && member?.status === "active") return "transfer_required" as const;
    return "missing" as const;
  }

  async archiveGroup(input: { groupId: string; actorUserKey: string; expectedRevision: number; confirmedName: string;
    timestamp: string; idempotency: MutationIdempotency }) {
    input.idempotency.mutationAttempted = true;
    const guard = `EXISTS (SELECT 1 FROM study_groups g WHERE g.id=? AND g.status='archived'
      AND g.last_mutation_execution_id=?)`;
    const guardValues = [input.groupId,input.idempotency.executionId];
    const batch = await this.connection().batch([
      this.connection().prepare(`UPDATE study_groups SET status='archived',revision=revision+1,
        last_mutation_execution_id=?,updated_at=? WHERE id=? AND owner_user_key=? AND status='active'
        AND revision=? AND name=?
        AND NOT EXISTS (SELECT 1 FROM study_group_active_runs active WHERE active.group_id=study_groups.id)`).bind(input.idempotency.executionId,input.timestamp,input.groupId,input.actorUserKey,
        input.expectedRevision,input.confirmedName),
      this.connection().prepare(`UPDATE study_group_members SET status='left',left_at=?,last_mutation_execution_id=?
        WHERE group_id=? AND status='active' AND ${guard}`).bind(input.timestamp,input.idempotency.executionId,input.groupId,...guardValues),
      this.connection().prepare(`INSERT INTO study_group_membership_events(id,group_id,user_key,membership_epoch,event_type,actor_user_key,created_at)
        SELECT group_id||':'||user_key||':'||membership_epoch||':'||?,group_id,user_key,membership_epoch,'left',?,?
        FROM study_group_members WHERE group_id=? AND status='left' AND last_mutation_execution_id=? AND ${guard}`)
        .bind(input.idempotency.executionId,input.actorUserKey,input.timestamp,input.groupId,input.idempotency.executionId,...guardValues),
      this.connection().prepare(`UPDATE study_group_invites SET status='revoked',revoked_at=?,revision=revision+1
        WHERE group_id=? AND status='active' AND ${guard}`).bind(input.timestamp,input.groupId,...guardValues),
      this.connection().prepare(`DELETE FROM study_group_owner_slots WHERE group_id=? AND ${guard}`).bind(input.groupId,...guardValues),
      await this.writeGroupAudit({groupId:input.groupId,actorUserKey:input.actorUserKey,action:"group-delete",
        before:{revision:input.expectedRevision},after:{status:"archived"},timestamp:input.timestamp},guard,guardValues),
      this.idempotencyStatementWhen(input.idempotency,input.idempotency.response,guard,guardValues),
    ]);
    return Number(batch[0]?.meta?.changes ?? 0)>0;
  }

  async ensureBaseQuotaSlot(groupId: string, dateKey: string, timestamp: string) {
    await this.connection().prepare(`
      INSERT OR IGNORE INTO study_group_quota_slots (
        group_id, date_key, slot_no, source, status, revision, created_at, updated_at
      ) VALUES (?, ?, 1, 'base', 'available', 0, ?, ?)
    `).bind(groupId, dateKey, timestamp, timestamp).run();
  }

  private insertChunks(
    table: string,
    columns: readonly string[],
    rows: readonly unknown[][],
  ) {
    const perChunk = Math.max(1, Math.floor(100 / columns.length));
    const statements: D1PreparedStatement[] = [];
    for (let offset = 0; offset < rows.length; offset += perChunk) {
      const chunk = rows.slice(offset, offset + perChunk);
      const placeholders = chunk.map(() => `(${columns.map(() => "?").join(",")})`).join(",");
      statements.push(this.connection().prepare(`
        INSERT INTO ${table} (${columns.join(",")}) VALUES ${placeholders}
      `).bind(...chunk.flat()));
    }
    return statements;
  }

  async createRun(input: {
    run: RunRow;
    selectionMetadata: {
      algorithmVersion: string;
      seed: string;
      historyCutoffUtc: string;
      historyDigestSha256: string;
      snapshotDigestSha256: string;
      repeatPolicy: "allow";
      repeatFallback: boolean;
      areaPolicy: string;
      settingsSchemaVersion: number;
    } | null;
    slotNo: number;
    questions: Array<ContentQuestionRow & { position: number; timeLimitSeconds: number; opensAt: string | null; deadlineAt: string | null }>;
    participants: MemberRow[];
    timestamp: string;
    finalDeadlineAt: string | null;
    additionalStatements?: D1PreparedStatement[];
    startGuard?: { sql: string; values: unknown[] };
  }) {
    const publicRows = input.questions.map((question) => [
      input.run.id, question.position, question.question_uid, question.area_code,
      question.prompt_md, question.choices_json, question.asset_refs_json,
      question.dependency_group_id, question.timeLimitSeconds, question.opensAt,
      question.deadlineAt, question.question_hash,
    ]);
    const secretRows = input.questions.map((question) => [
      input.run.id, question.position, question.correct_answers_json,
      question.explanation_md, question.secret_hash,
    ]);
    const participantRows = input.participants.map((member) => [
      input.run.id, member.user_key, member.public_name, member.membership_epoch,
      "rostered",
    ]);
    const runInsert = this.connection().prepare(`
      INSERT INTO study_group_exam_runs (
        id, group_id, start_request_id, mode, status, scheduled_at_utc,
        actual_started_at_utc, quota_date_key, quota_slot_no, question_count_snapshot,
        settings_snapshot_json, source_release_id, source_release_sha256,
        participant_count_snapshot, final_deadline_at_utc, revision,
        created_by_user_key, created_at
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM study_group_quota_slots slot
        WHERE slot.group_id = ? AND slot.date_key = ? AND slot.slot_no = ? AND slot.status = 'available'
      )
      AND EXISTS (
        SELECT 1 FROM study_groups g
        WHERE g.id = ? AND g.owner_user_key = ? AND g.status = 'active'
      )
      AND NOT EXISTS (
        SELECT 1 FROM study_group_active_runs active WHERE active.group_id = ?
      )
      AND NOT EXISTS (
        SELECT 1 FROM study_group_exam_runs duplicate WHERE duplicate.start_request_id = ?
      )
      AND (${input.startGuard?.sql ?? "1"})
    `).bind(
      input.run.id, input.run.group_id, input.run.start_request_id, input.run.mode,
      input.run.status, input.run.scheduled_at_utc, input.run.actual_started_at_utc,
      input.run.quota_date_key, input.slotNo, input.run.question_count_snapshot,
      input.run.settings_snapshot_json, input.run.source_release_id,
      input.run.source_release_sha256, participantRows.length,
      input.finalDeadlineAt, input.run.created_by_user_key, input.timestamp,
      input.run.group_id, input.run.quota_date_key, input.slotNo,
      input.run.group_id, input.run.created_by_user_key,
      input.run.group_id, input.run.start_request_id,
      ...(input.startGuard?.values ?? []),
    );
    const statements: D1PreparedStatement[] = [runInsert];
    // V2 selection is authoritative in contract_v2, never a fabricated v1 row.
    if (input.selectionMetadata) statements.push(this.connection().prepare(`
      INSERT INTO study_group_exam_selection_metadata (
        run_id, algorithm_version, seed, history_cutoff_utc,
        history_digest_sha256, snapshot_digest_sha256, repeat_policy,
        repeat_fallback, area_policy, settings_schema_version, created_at
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM study_group_exam_runs r WHERE r.id = ?)
    `).bind(
      input.run.id, input.selectionMetadata.algorithmVersion,
      input.selectionMetadata.seed, input.selectionMetadata.historyCutoffUtc,
      input.selectionMetadata.historyDigestSha256,
      input.selectionMetadata.snapshotDigestSha256,
      input.selectionMetadata.repeatPolicy,
      input.selectionMetadata.repeatFallback ? 1 : 0,
      input.selectionMetadata.areaPolicy,
      input.selectionMetadata.settingsSchemaVersion,
      input.timestamp, input.run.id,
    ));
    statements.push(this.connection().prepare(`
      UPDATE study_group_quota_slots
      SET status = ?, reserved_run_id = ?, revision = revision + 1, updated_at = ?
      WHERE group_id = ? AND date_key = ? AND slot_no = ? AND status = 'available'
        AND EXISTS (SELECT 1 FROM study_group_exam_runs r WHERE r.id = ?)
    `).bind(
      input.run.status === "running" ? "consumed" : "reserved",
      input.run.id, input.timestamp, input.run.group_id, input.run.quota_date_key,
      input.slotNo, input.run.id,
    ));
    statements.push(this.connection().prepare(`
      INSERT INTO study_group_quota_events (
        id, idempotency_key, group_id, date_key, slot_no, run_id, event_type, actor_user_key, created_at
      ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM study_group_exam_runs r WHERE r.id = ?)
    `).bind(
      crypto.randomUUID(), `${input.run.start_request_id}:reserve`, input.run.group_id,
      input.run.quota_date_key, input.slotNo, input.run.id,
      input.run.status === "running" ? "consume" : "reserve",
      input.run.created_by_user_key, input.timestamp, input.run.id,
    ));
    statements.push(...this.insertChunks(
      "study_group_exam_question_public",
      ["run_id", "position", "source_question_uid", "area_code_snapshot", "prompt_snapshot", "choices_snapshot_json", "asset_refs_snapshot_json", "dependency_group_id_snapshot", "time_limit_seconds", "opens_at_utc", "deadline_at_utc", "snapshot_hash"],
      publicRows,
    ));
    statements.push(...this.insertChunks(
      "study_group_exam_question_secret",
      ["run_id", "position", "correct_answers_snapshot_json", "explanation_snapshot", "secret_hash"],
      secretRows,
    ));
    if (participantRows.length) {
      statements.push(...this.insertChunks(
        "study_group_exam_participants",
        ["run_id", "user_key", "public_name_snapshot", "membership_epoch_snapshot", "status"],
        participantRows,
      ));
    }
    if (input.run.status === "running") {
      statements.push(this.connection().prepare(`
        INSERT INTO study_group_active_runs (group_id, run_id, updated_at)
        SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM study_group_exam_runs r WHERE r.id = ?)
      `).bind(input.run.group_id, input.run.id, input.timestamp, input.run.id));
    }
    statements.push(await this.writeGroupAudit({
      groupId: input.run.group_id, actorUserKey: input.run.created_by_user_key,
      action: `run_${input.run.mode}`, targetId: input.run.id, timestamp: input.timestamp,
    }, "EXISTS (SELECT 1 FROM study_group_exam_runs r WHERE r.id = ?)", [input.run.id]));
    statements.push(...(input.additionalStatements ?? []));
    const batch = await this.connection().batch(statements);
    return Number(batch[0]?.meta?.changes ?? 0) > 0;
  }

  async deprecateScheduledRun(run: RunRow, timestamp: string) {
    const batch = await this.connection().batch([
      this.connection().prepare(`
        UPDATE study_group_exam_runs
        SET status = 'canceled', canceled_at = ?, failure_code = 'SCHEDULE_FEATURE_REMOVED', revision = revision + 1
        WHERE id = ? AND status = 'scheduled'
      `).bind(timestamp, run.id),
      this.connection().prepare(`
        UPDATE study_group_quota_slots
        SET status = 'available', reserved_run_id = NULL, revision = revision + 1, updated_at = ?
        WHERE group_id = ? AND date_key = ? AND slot_no = ? AND status = 'reserved' AND reserved_run_id = ?
          AND EXISTS (SELECT 1 FROM study_group_exam_runs r WHERE r.id = ? AND r.status = 'canceled' AND r.failure_code = 'SCHEDULE_FEATURE_REMOVED')
      `).bind(timestamp, run.group_id, run.quota_date_key, run.quota_slot_no, run.id, run.id),
      this.connection().prepare(`
        INSERT OR IGNORE INTO study_group_quota_events (
          id, idempotency_key, group_id, date_key, slot_no, run_id, event_type, actor_user_key, created_at
        ) SELECT ?, ?, ?, ?, ?, ?, 'refund', ?, ?
        WHERE EXISTS (SELECT 1 FROM study_group_exam_runs r WHERE r.id = ? AND r.status = 'canceled' AND r.failure_code = 'SCHEDULE_FEATURE_REMOVED')
      `).bind(crypto.randomUUID(), `${run.start_request_id}:schedule-feature-removed-refund`, run.group_id,
        run.quota_date_key, run.quota_slot_no, run.id, run.created_by_user_key, timestamp, run.id),
    ]);
    return Number(batch[0]?.meta?.changes ?? 0) > 0;
  }

  async cancelScheduledRun(run: RunRow, actorUserKey: string, timestamp: string, idempotency: MutationIdempotency) {
    idempotency.mutationAttempted = true;
    const batch = await this.connection().batch([
      this.connection().prepare(`
        UPDATE study_group_exam_runs
        SET status = 'canceled', canceled_at = ?, revision = revision + 1,
            last_mutation_execution_id = ?
        WHERE id = ? AND group_id = ? AND status = 'scheduled' AND scheduled_at_utc > ?
          AND EXISTS (
            SELECT 1 FROM study_groups g
            WHERE g.id = ? AND g.owner_user_key = ? AND g.status = 'active'
          )
      `).bind(timestamp, idempotency.executionId, run.id, run.group_id,
        timestamp, run.group_id, actorUserKey),
      this.connection().prepare(`
        UPDATE study_group_quota_slots
        SET status = 'available', reserved_run_id = NULL, revision = revision + 1, updated_at = ?
        WHERE group_id = ? AND date_key = ? AND slot_no = ? AND status = 'reserved' AND reserved_run_id = ?
          AND EXISTS (SELECT 1 FROM study_group_exam_runs r WHERE r.id = ? AND r.status = 'canceled' AND r.last_mutation_execution_id = ?)
      `).bind(timestamp, run.group_id, run.quota_date_key, run.quota_slot_no,
        run.id, run.id, idempotency.executionId),
      this.connection().prepare(`
        INSERT OR IGNORE INTO study_group_quota_events (
          id, idempotency_key, group_id, date_key, slot_no, run_id, event_type, actor_user_key, created_at
        ) SELECT ?, ?, ?, ?, ?, ?, 'refund', ?, ?
        WHERE EXISTS (SELECT 1 FROM study_group_exam_runs r WHERE r.id = ? AND r.status = 'canceled' AND r.last_mutation_execution_id = ?)
      `).bind(crypto.randomUUID(), `${run.start_request_id}:cancel-refund`, run.group_id,
        run.quota_date_key, run.quota_slot_no, run.id, actorUserKey, timestamp,
        run.id, idempotency.executionId),
      await this.writeGroupAudit({
        groupId: run.group_id, actorUserKey, action: "run-cancel", targetId: run.id, timestamp,
      }, "EXISTS (SELECT 1 FROM study_group_exam_runs r WHERE r.id = ? AND r.status = 'canceled' AND r.last_mutation_execution_id = ?)", [run.id, idempotency.executionId]),
      this.idempotencyStatementWhen(idempotency, idempotency.response,
        "EXISTS (SELECT 1 FROM study_group_exam_runs r WHERE r.id = ? AND r.status = 'canceled' AND r.last_mutation_execution_id = ?)",
        [run.id, idempotency.executionId]),
    ]);
    return Number(batch[0]?.meta?.changes ?? 0) > 0;
  }

  async saveAnswer(input: {
    runId: string;
    userKey: string;
    position: number;
    answerJson: string;
    answerHash: string;
    expectedRevision: number;
    operationId: string;
    timestamp: string;
  }) {
    const nextRevision = input.expectedRevision + 1;
    const batch = await this.connection().batch([
      this.connection().prepare(`
        INSERT INTO study_group_exam_answers (
          run_id, user_key, position, answer_json, revision,
          last_client_operation_id, server_received_at_utc, updated_at
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?
        FROM study_group_exam_runs r
        JOIN study_group_exam_participants p ON p.run_id = r.id AND p.user_key = ?
        JOIN study_group_exam_question_public q ON q.run_id = r.id AND q.position = ?
        WHERE r.id = ? AND r.status = 'running'
          AND p.status IN ('rostered', 'in_progress')
          AND q.opens_at_utc <= ? AND q.deadline_at_utc > ?
          AND ? = 0
        ON CONFLICT(run_id, user_key, position) DO UPDATE SET
          answer_json = excluded.answer_json,
          revision = excluded.revision,
          last_client_operation_id = excluded.last_client_operation_id,
          server_received_at_utc = excluded.server_received_at_utc,
          updated_at = excluded.updated_at
        WHERE study_group_exam_answers.revision = ?
      `).bind(
        input.runId, input.userKey, input.position, input.answerJson, nextRevision,
        input.operationId, input.timestamp, input.timestamp, input.userKey,
        input.position, input.runId, input.timestamp, input.timestamp,
        input.expectedRevision, input.expectedRevision,
      ),
      this.connection().prepare(`
        INSERT INTO study_group_answer_operations (
          operation_id, run_id, user_key, position, answer_hash, result_revision, created_at
        ) SELECT ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM study_group_exam_answers a
          WHERE a.run_id = ? AND a.user_key = ? AND a.position = ?
            AND a.revision = ? AND a.last_client_operation_id = ?
        )
      `).bind(
        input.operationId, input.runId, input.userKey, input.position,
        input.answerHash, nextRevision, input.timestamp, input.runId,
        input.userKey, input.position, nextRevision, input.operationId,
      ),
      this.connection().prepare(`
        UPDATE study_group_exam_participants SET status = 'in_progress'
        WHERE run_id = ? AND user_key = ? AND status = 'rostered'
      `).bind(input.runId, input.userKey),
    ]);
    return Number(batch[0]?.meta?.changes ?? 0) > 0;
  }

  async submitParticipant(runId: string, userKey: string, timestamp: string, idempotency: MutationIdempotency) {
    idempotency.mutationAttempted = true;
    const batch = await this.connection().batch([this.connection().prepare(`
      UPDATE study_group_exam_participants
      SET status = 'submitted', submitted_at = ?, last_mutation_execution_id = ?
      WHERE run_id = ? AND user_key = ? AND status IN ('rostered', 'in_progress')
        AND EXISTS (SELECT 1 FROM study_group_exam_runs r WHERE r.id = ? AND r.status = 'running')
    `).bind(timestamp, idempotency.executionId, runId, userKey, runId),
    this.idempotencyStatementWhen(idempotency, idempotency.response,
      "EXISTS (SELECT 1 FROM study_group_exam_participants p WHERE p.run_id = ? AND p.user_key = ? AND p.status = 'submitted' AND p.last_mutation_execution_id = ?)",
      [runId, userKey, idempotency.executionId])]);
    const result = batch[0];
    return Number(result.meta?.changes ?? 0) > 0;
  }

  async claimFinalization(runId: string, leaseOwner: string, timestamp: string, leaseUntil: string) {
    const result = await this.connection().prepare(`
      UPDATE study_group_exam_runs
      SET status = 'finalizing', lease_owner = ?, lease_until = ?, revision = revision + 1
      WHERE id = ? AND final_deadline_at_utc <= ?
        AND NOT EXISTS (SELECT 1 FROM study_group_exam_run_contract_v2 v WHERE v.run_id = study_group_exam_runs.id)
        AND (status = 'running' OR (status = 'finalizing' AND lease_until < ?))
    `).bind(leaseOwner, leaseUntil, runId, timestamp, timestamp).run();
    return Number(result.meta?.changes ?? 0) > 0;
  }

  async completeFinalization(input: {
    run: RunRow;
    leaseOwner: string;
    participantResults: Array<{ userKey: string; status: string; score: number; wrongPositions: number[] }>;
    timestamp: string;
  }) {
    const statements: D1PreparedStatement[] = [];
    for (const result of input.participantResults) {
      statements.push(this.connection().prepare(`
        UPDATE study_group_exam_participants
        SET status = ?, submitted_at = COALESCE(submitted_at, ?), score = ?, wrong_count = ?, wrong_positions_json = ?
        WHERE run_id = ? AND user_key = ?
      `).bind(
        result.status, input.timestamp, result.score, result.wrongPositions.length,
        JSON.stringify(result.wrongPositions), input.run.id, result.userKey,
      ));
    }
    statements.push(this.connection().prepare(`
      UPDATE study_group_exam_runs
      SET status = 'completed', completed_at = ?, lease_owner = NULL, lease_until = NULL, revision = revision + 1
      WHERE id = ? AND status = 'finalizing' AND lease_owner = ?
    `).bind(input.timestamp, input.run.id, input.leaseOwner));
    statements.push(this.connection().prepare(`
      DELETE FROM study_group_active_runs
      WHERE group_id = ? AND run_id = ?
        AND EXISTS (SELECT 1 FROM study_group_exam_runs r WHERE r.id = ? AND r.status = 'completed')
    `).bind(input.run.group_id, input.run.id, input.run.id));
    const batch = await this.connection().batch(statements);
    return Number(batch.at(-2)?.meta?.changes ?? 0) > 0;
  }

  async writeGroupAudit(input: {
    groupId: string;
    actorUserKey: string;
    action: string;
    targetId?: string;
    before?: unknown;
    after?: unknown;
    timestamp: string;
  }, guardSql = "1", guardValues: unknown[] = []) {
    return this.connection().prepare(`
      INSERT INTO study_group_audit_events (
        id, group_id, actor_user_key, action, target_id, before_summary, after_summary, created_at
      ) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guardSql}
    `).bind(
      crypto.randomUUID(), input.groupId, input.actorUserKey, input.action,
      input.targetId ?? null, JSON.stringify(input.before ?? {}), JSON.stringify(input.after ?? {}),
      input.timestamp, ...guardValues,
    );
  }
}
