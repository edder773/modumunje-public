import { isAdminEmail, learnerUserHash, type AdminIdentity } from "@backend/common/auth/admin-auth";
import { adminRepository } from "./admin.repository";
import { SELF_LEARNING_RESET_CONFIRMATION, type SelfLearningResetCounts, type SelfLearningResetResult } from "@shared/admin/self-learning-reset";

// Constant, reviewed allowlist. Never accept a table, email or user key from the client.
const resetScopes = [
  ["attempts", "user_key = ?"],
  ["ai_evaluations", "user_key = ?"],
  ["sw_attempts", "user_key = ?"],
  ["exam_session_items", "session_id IN (SELECT id FROM exam_sessions WHERE user_key = ?)"],
  ["exam_active_sessions", "user_key = ?"],
  ["exam_sessions", "user_key = ?"],
  ["sw_learning_sessions", "user_key = ?"],
] as const;
const countsSql = `SELECT json_object(${resetScopes.map(([table, where]) => (
  `'${table}', (SELECT COUNT(*) FROM ${table} WHERE ${where})`
)).join(", ")}) AS counts`;

async function selfUserKey(identity: AdminIdentity) {
  if (!isAdminEmail(identity.email)) throw new Error("관리자 본인만 학습 기록을 초기화할 수 있습니다.");
  return learnerUserHash(identity.email);
}

export async function readSelfLearningReset(identity: AdminIdentity) {
  const userKey = await selfUserKey(identity);
  const row = await adminRepository.first<{ counts: string }>(countsSql, resetScopes.map(() => userKey));
  if (!row) throw new Error("초기화할 기록을 조회하지 못했습니다.");
  return { email: identity.email, resetId: crypto.randomUUID(), counts: JSON.parse(row.counts) as SelfLearningResetCounts };
}

export async function resetSelfLearningRecords(identity: AdminIdentity, payload: Record<string, unknown>): Promise<SelfLearningResetResult> {
  const userKey = await selfUserKey(identity);
  if (Object.keys(payload).some(key => !["action", "confirmation", "acknowledged", "resetId"].includes(key))) {
    throw new Error("초기화 대상 계정이나 범위를 직접 지정할 수 없습니다.");
  }
  if (payload.confirmation !== SELF_LEARNING_RESET_CONFIRMATION || payload.acknowledged !== true) {
    throw new Error("삭제 범위와 확인 문구를 확인해 주세요.");
  }
  const resetId = String(payload.resetId ?? "");
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(resetId)) {
    throw new Error("삭제 대상 확인을 다시 진행해 주세요.");
  }
  // A lost response can be retried with this ID without deleting later learning activity.
  const existing = await adminRepository.first<{ before_summary: string; created_at: string }>(`
    SELECT before_summary, created_at FROM admin_audit_logs
    WHERE id = ? AND action = 'self-learning-reset' AND admin_user_hash = ? AND target_id = ? AND success = 1
  `, [resetId, identity.hash, userKey.slice(0, 12)]);
  if (existing) return { email: identity.email, resetId, deleted: JSON.parse(existing.before_summary), completedAt: existing.created_at, replayed: true };
  const completedAt = new Date().toISOString();
  const zeroCounts = Object.fromEntries(resetScopes.map(([table]) => [table, 0]));
  const results = await adminRepository.batch([
    {
      // Store the exact pre-delete counts in the SAME transaction. Cross-account
      // references fail closed so FK cascades cannot remove another user's rows.
      sql: `INSERT INTO admin_audit_logs (
        id, admin_user_hash, action, target_type, target_id,
        before_summary, after_summary, success, failure_reason, created_at
      ) SELECT ?, ?, 'self-learning-reset', 'user-account', ?,
        (${countsSql}), ?, 1, '', ?
      WHERE NOT EXISTS (
        SELECT 1 FROM exam_active_sessions a JOIN exam_sessions s ON s.id = a.session_id
        WHERE s.user_key = ? AND a.user_key != ?
      ) AND NOT EXISTS (
        SELECT 1 FROM attempts a JOIN ai_evaluations e ON e.id = a.evaluation_id
        WHERE e.user_key = ? AND a.user_key != ?
      ) RETURNING before_summary`,
      values: [resetId, identity.hash, userKey.slice(0, 12), ...resetScopes.map(() => userKey), JSON.stringify(zeroCounts), completedAt, userKey, userKey, userKey, userKey],
    },
    ...resetScopes.map(([table, where]) => ({
      sql: `DELETE FROM ${table} WHERE ${where} AND EXISTS (
        SELECT 1 FROM admin_audit_logs WHERE id = ? AND action = 'self-learning-reset'
          AND admin_user_hash = ? AND target_id = ? AND success = 1
      )`,
      values: [userKey, resetId, identity.hash, userKey.slice(0, 12)],
    })),
  ]);
  const audit = results[0].results?.[0] as { before_summary: string } | undefined;
  if (!audit) throw new Error("다른 계정의 연결 기록이 발견되어 초기화하지 않았습니다. 데이터 정합성을 먼저 확인해 주세요.");
  return { email: identity.email, resetId, deleted: JSON.parse(audit.before_summary), completedAt, replayed: false };
}
