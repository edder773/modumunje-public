import { GroupExamReadRepository, type MutationIdempotency } from "./group-exam-read.repository";

export class GroupExamMutationRepository extends GroupExamReadRepository {
  idempotencyStatementWhen(input: MutationIdempotency, response: unknown, conditionSql: string, conditionValues: unknown[]) {
    return this.connection().prepare(`
      INSERT INTO study_group_idempotency (
        actor_user_key, action, idempotency_key, request_digest, execution_id,
        response_status, response_json, created_at
      ) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${conditionSql}
    `).bind(
      input.actorUserKey, input.action, input.key, input.requestDigest, input.executionId,
      input.responseStatus, JSON.stringify(response), input.timestamp, ...conditionValues,
    );
  }

  adminAuditStatement(input: {
    adminUserHash: string;
    action: string;
    groupId: string;
    before: Record<string, unknown>;
    after: unknown;
    timestamp: string;
    expectedRevision: number;
    resultRevision: number;
    idempotency: MutationIdempotency;
  }, guardSql: string, guardValues: unknown[]) {
    const before = { ...input.before, expectedRevision: input.expectedRevision };
    const after = {
      ...(input.after && typeof input.after === "object" ? input.after : { value: input.after }),
      resultRevision: input.resultRevision,
      executionId: input.idempotency.executionId,
      idempotencyKey: input.idempotency.key,
    };
    return this.connection().prepare(`
      INSERT INTO admin_audit_logs (
        id, admin_user_hash, action, target_type, target_id,
        before_summary, after_summary, success, failure_reason, created_at
      ) SELECT ?, ?, ?, 'study-group', ?, ?, ?, 1, '', ? WHERE ${guardSql}
    `).bind(
      crypto.randomUUID(), input.adminUserHash, input.action, input.groupId,
      JSON.stringify(before), JSON.stringify(after), input.timestamp, ...guardValues,
    );
  }

  async discardIdempotent(input: MutationIdempotency) {
    // Legacy test seam: failed mutations must never need cleanup because success rows are conditional.
    // Keep this read-only so the original race regression can pause at the former cleanup window.
    const published = await this.readIdempotent(input.actorUserKey, input.action, input.key);
    if (published?.execution_id === input.executionId) {
      throw new Error("Failed mutation published its own idempotency response.");
    }
  }

  async assertNoPublishedIdempotent(input: MutationIdempotency) {
    await this.discardIdempotent(input);
  }

}
