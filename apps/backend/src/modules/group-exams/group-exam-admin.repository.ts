import { GroupExamRepository, type MutationIdempotency } from "./group-exam.repository";

export class GroupExamAdminRepository extends GroupExamRepository {
  async archiveGroupAsAdmin(input:{groupId:string;confirmedName:string;expectedRevision:number;actorHash:string;timestamp:string;idempotency:MutationIdempotency}){
    input.idempotency.mutationAttempted=true;
    const guard=`EXISTS(SELECT 1 FROM study_groups WHERE id=? AND status='archived' AND last_mutation_execution_id=?)`;
    const values=[input.groupId,input.idempotency.executionId];
    const batch=await this.connection().batch([
      this.connection().prepare(`UPDATE study_groups SET status='archived',revision=revision+1,last_mutation_execution_id=?,updated_at=?
        WHERE id=? AND status='active' AND revision=? AND name=?
        AND NOT EXISTS (SELECT 1 FROM study_group_active_runs active WHERE active.group_id=study_groups.id)`).bind(input.idempotency.executionId,input.timestamp,input.groupId,input.expectedRevision,input.confirmedName),
      this.connection().prepare(`UPDATE study_group_members SET status='left',left_at=?,last_mutation_execution_id=? WHERE group_id=? AND status='active' AND ${guard}`)
        .bind(input.timestamp,input.idempotency.executionId,input.groupId,...values),
      this.connection().prepare(`INSERT INTO study_group_membership_events(id,group_id,user_key,membership_epoch,event_type,actor_user_key,created_at)
        SELECT group_id||':'||user_key||':'||membership_epoch||':'||?,group_id,user_key,membership_epoch,'left',?,? FROM study_group_members
        WHERE group_id=? AND status='left' AND last_mutation_execution_id=? AND ${guard}`)
        .bind(input.idempotency.executionId,input.actorHash,input.timestamp,input.groupId,input.idempotency.executionId,...values),
      this.connection().prepare(`UPDATE study_group_invites SET status='revoked',revoked_at=?,revision=revision+1 WHERE group_id=? AND status='active' AND ${guard}`)
        .bind(input.timestamp,input.groupId,...values),
      this.connection().prepare(`DELETE FROM study_group_owner_slots WHERE group_id=? AND ${guard}`).bind(input.groupId,...values),
      this.connection().prepare(`INSERT INTO admin_audit_logs(id,admin_user_hash,action,target_type,target_id,before_summary,after_summary,success,failure_reason,created_at)
        SELECT ?,?,'skct_group_deleted','study-group',?,json_object('revision',?,'name',?),json_object('status','archived'),1,'',? WHERE ${guard}`)
        .bind(crypto.randomUUID(),input.actorHash,input.groupId,input.expectedRevision,input.confirmedName,input.timestamp,...values),
      this.idempotencyStatementWhen(input.idempotency,input.idempotency.response,guard,values),
    ]);
    return Number(batch[0]?.meta?.changes??0)>0;
  }
  async grantQuota(input: {
    groupId: string;
    dateKey: string;
    count: number;
    idempotencyKey: string;
    actorHash: string;
    timestamp: string;
    idempotency: MutationIdempotency;
    expectedRevision: number;
    auditAction: "skct_group_quota_granted" | "skct_group_quota_reset";
  }) {
    input.idempotency.mutationAttempted = true;
    const eventId = crypto.randomUUID();
    const auditId = crypto.randomUUID();
    const resultRevision = input.expectedRevision + 1;
    const groupGuard = `EXISTS (
      SELECT 1 FROM study_groups g
      WHERE g.id = ? AND g.last_mutation_execution_id = ? AND g.revision = ?
    )`;
    const ledgerJson = `json_object(
      'total', COUNT(*),
      'available', COALESCE(SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END), 0),
      'reserved', COALESCE(SUM(CASE WHEN status = 'reserved' THEN 1 ELSE 0 END), 0),
      'consumed', COALESCE(SUM(CASE WHEN status = 'consumed' THEN 1 ELSE 0 END), 0)
    )`;
    const statements: D1PreparedStatement[] = [this.connection().prepare(`
      UPDATE study_groups SET revision = revision + 1, last_mutation_execution_id = ?, updated_at = ?
      WHERE id = ? AND status = 'active' AND revision = ?
    `).bind(input.idempotency.executionId, input.timestamp, input.groupId, input.expectedRevision), this.connection().prepare(`
      INSERT INTO admin_audit_logs (
        id, admin_user_hash, action, target_type, target_id,
        before_summary, after_summary, success, failure_reason, created_at
      )
      SELECT ?, ?, ?, 'study-group', ?,
        json_object(
          'dateKey', ?,
          'ledger', json((SELECT ${ledgerJson} FROM study_group_quota_slots WHERE group_id = ? AND date_key = ?)),
          'expectedRevision', ?
        ),
        '{}', 1, '', ?
      WHERE ${groupGuard}
    `).bind(
      auditId, input.actorHash, input.auditAction, input.groupId,
      input.dateKey, input.groupId, input.dateKey, input.expectedRevision,
      input.timestamp, input.groupId, input.idempotency.executionId, resultRevision,
    ), this.connection().prepare(`
      INSERT OR IGNORE INTO study_group_quota_slots (
        group_id, date_key, slot_no, source, status, created_at, updated_at
      ) SELECT ?, ?, 1, 'base', 'available', ?, ?
        WHERE EXISTS (SELECT 1 FROM admin_audit_logs audit WHERE audit.id = ?)
    `).bind(input.groupId, input.dateKey, input.timestamp, input.timestamp, auditId), this.connection().prepare(`
      INSERT OR IGNORE INTO study_group_quota_events (
        id, idempotency_key, group_id, date_key, slot_no, event_type, actor_user_key, created_at
      ) SELECT ?, ?, ?, ?, 0, 'admin_grant', ?, ?
        WHERE EXISTS (SELECT 1 FROM admin_audit_logs audit WHERE audit.id = ?)
    `).bind(eventId, input.idempotencyKey, input.groupId, input.dateKey, input.actorHash, input.timestamp, auditId)];
    for (let index = 0; index < input.count; index += 1) {
      statements.push(this.connection().prepare(`
        INSERT INTO study_group_quota_slots (
          group_id, date_key, slot_no, source, status, created_at, updated_at
        )
        SELECT ?, ?, COALESCE(MAX(slot_no), 0) + 1, 'admin_grant', 'available', ?, ?
        FROM study_group_quota_slots
        WHERE group_id = ? AND date_key = ?
        HAVING EXISTS (SELECT 1 FROM study_group_quota_events event WHERE event.id = ?)
      `).bind(
        input.groupId, input.dateKey, input.timestamp, input.timestamp,
        input.groupId, input.dateKey, eventId,
      ));
    }
    statements.push(this.connection().prepare(`
      UPDATE study_group_quota_events
      SET slot_no = (
        SELECT MIN(slot_no) FROM study_group_quota_slots
        WHERE group_id = ? AND date_key = ? AND source = 'admin_grant' AND created_at = ?
      )
      WHERE id = ?
    `).bind(input.groupId, input.dateKey, input.timestamp, eventId));
    statements.push(this.connection().prepare(`
      UPDATE admin_audit_logs
      SET after_summary = json_object(
        'dateKey', ?,
        'count', ?,
        'ledger', json((SELECT ${ledgerJson} FROM study_group_quota_slots WHERE group_id = ? AND date_key = ?)),
        'resultRevision', ?,
        'executionId', ?,
        'idempotencyKey', ?
      )
      WHERE id = ? AND EXISTS (SELECT 1 FROM study_group_quota_events event WHERE event.id = ?)
    `).bind(
      input.dateKey, input.count, input.groupId, input.dateKey,
      resultRevision, input.idempotency.executionId, input.idempotency.key,
      auditId, eventId,
    ));
    statements.push(this.idempotencyStatementWhen(input.idempotency, input.idempotency.response,
      "EXISTS (SELECT 1 FROM study_group_quota_events e WHERE e.id = ?)", [eventId]));
    const batch = await this.connection().batch(statements);
    return Number(batch[0]?.meta?.changes ?? 0) > 0;
  }

  async setQuestionCountOverride(groupId: string, count: number, actorHash: string, timestamp: string, idempotency: MutationIdempotency, expectedRevision: number, beforeCount: number | null) {
    idempotency.mutationAttempted = true;
    const batch = await this.connection().batch([this.connection().prepare(`
      UPDATE study_groups
      SET admin_question_count_override = ?, revision = revision + 1,
          last_mutation_execution_id = ?, updated_at = ?
      WHERE id = ? AND status = 'active' AND revision = ?
    `).bind(count, idempotency.executionId, timestamp, groupId, expectedRevision), this.adminAuditStatement({
      adminUserHash: actorHash, action: "skct_group_question_count_set", groupId,
      before: { count: beforeCount }, after: { count }, timestamp,
      expectedRevision, resultRevision: expectedRevision + 1, idempotency,
    }, "EXISTS (SELECT 1 FROM study_groups g WHERE g.id = ? AND g.last_mutation_execution_id = ? AND g.admin_question_count_override = ?)", [groupId, idempotency.executionId, count]),
    this.idempotencyStatementWhen(idempotency, idempotency.response,
      "EXISTS (SELECT 1 FROM study_groups g WHERE g.id = ? AND g.last_mutation_execution_id = ? AND g.admin_question_count_override = ?)",
      [groupId, idempotency.executionId, count])]);
    const result = batch[0];
    return Number(result.meta?.changes ?? 0) > 0;
  }

  async resetQuestionCountOverride(
    groupId: string,
    actorHash: string,
    timestamp: string,
    idempotency: MutationIdempotency,
    expectedRevision: number,
    beforeCount: number | null,
  ) {
    idempotency.mutationAttempted = true;
    const batch = await this.connection().batch([this.connection().prepare(`
      UPDATE study_groups
      SET admin_question_count_override = NULL, revision = revision + 1,
          last_mutation_execution_id = ?, updated_at = ?
      WHERE id = ? AND status = 'active' AND revision = ?
    `).bind(idempotency.executionId, timestamp, groupId, expectedRevision), this.adminAuditStatement({
      adminUserHash: actorHash, action: "skct_group_question_count_reset", groupId,
      before: { count: beforeCount }, after: { count: null }, timestamp,
      expectedRevision, resultRevision: expectedRevision + 1, idempotency,
    }, "EXISTS (SELECT 1 FROM study_groups g WHERE g.id = ? AND g.last_mutation_execution_id = ? AND g.admin_question_count_override IS NULL)", [groupId, idempotency.executionId]),
    this.idempotencyStatementWhen(idempotency, idempotency.response,
      "EXISTS (SELECT 1 FROM study_groups g WHERE g.id = ? AND g.last_mutation_execution_id = ? AND g.admin_question_count_override IS NULL)",
      [groupId, idempotency.executionId])]);
    return Number(batch[0]?.meta?.changes ?? 0) > 0;
  }
}
