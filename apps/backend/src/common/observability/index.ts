import { getD1 } from "@backend/infrastructure/database";
import {
  redactSensitiveText,
  sanitizeObservabilityValue,
} from "@shared/security/observability-redaction.mjs";

type AuditEntry = {
  adminUserHash: string;
  action: string;
  targetType?: string;
  targetId?: string | number | null;
  before?: unknown;
  after?: unknown;
  success?: boolean;
  failureReason?: string;
};

type SystemErrorEntry = {
  errorType: string;
  pagePath?: string;
  questionId?: number | null;
  impact?: string;
  message?: string;
};

function compactJson(value: unknown, limit = 1600) {
  let serialized = "{}";
  try {
    serialized = JSON.stringify(sanitizeObservabilityValue(value ?? {}));
  } catch {
    serialized = "{}";
  }
  if (serialized.length <= limit) return serialized;
  // Bound the serialized envelope, including JSON escaping, rather than
  // cutting a JSON document in the middle of a token or string.
  let result = JSON.stringify({ truncated: true, preview: "" });
  let low = 0;
  let high = Math.min(serialized.length, limit);
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const preview = serialized.slice(0, middle).replace(/[\uD800-\uDBFF]$/u, "");
    const candidate = JSON.stringify({ truncated: true, preview });
    if (candidate.length <= limit) {
      result = candidate;
      low = middle + 1;
    } else high = middle - 1;
  }
  return result;
}

export function readAuditSummary(value: unknown) {
  try {
    return JSON.parse(String(value ?? "{}"));
  } catch {
    return { unreadable: true, message: "이전 감사 요약의 JSON 형식을 읽을 수 없습니다. 원본 기록은 보존되어 있습니다." };
  }
}

function compactText(value: unknown, limit = 500) {
  return redactSensitiveText(value, limit);
}

async function digest(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function writeAdminAudit(entry: AuditEntry) {
  try {
    const targetType = compactText(entry.targetType ?? "system", 80);
    const targetId = entry.targetId === undefined || entry.targetId === null
      ? null
      : compactText(entry.targetId, targetType === "user-account" ? 12 : 120);
    await getD1().prepare(`
      INSERT INTO admin_audit_logs (
        id, admin_user_hash, action, target_type, target_id,
        before_summary, after_summary, success, failure_reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      entry.adminUserHash,
      compactText(entry.action, 100),
      targetType,
      targetId,
      compactJson(entry.before),
      compactJson(entry.after),
      entry.success === false ? 0 : 1,
      compactText(entry.failureReason, 500),
      new Date().toISOString(),
    ).run();
  } catch {
    // Audit persistence must never turn a completed admin operation into a
    // client-visible failure. Database failures are still surfaced by the
    // operation itself and can be recorded by writeSystemError.
  }
}

export async function writeSystemError(entry: SystemErrorEntry) {
  try {
    const message = compactText(entry.message || "작업을 완료하지 못했습니다.");
    const fingerprint = await digest([
      entry.errorType,
      entry.pagePath ?? "",
      entry.questionId ?? "",
      message,
    ].join("|"));
    const timestamp = new Date().toISOString();
    const database = getD1();
    const repeated = await database.prepare(`
      UPDATE system_errors
      SET occurrence_count = occurrence_count + 1,
          last_seen_at = ?, message = ?, impact = ?
      WHERE id = (
        SELECT id FROM system_errors
        WHERE fingerprint = ? AND status = 'open'
          AND COALESCE(last_seen_at, created_at) >= datetime(?, '-5 minutes')
        ORDER BY COALESCE(last_seen_at, created_at) DESC, id DESC
        LIMIT 1
      )
    `).bind(
      timestamp,
      message,
      compactText(entry.impact ?? "operation_failed", 100),
      fingerprint,
      timestamp,
    ).run();
    if (Number(repeated.meta.changes ?? 0) > 0) return;
    await database.prepare(`
      INSERT INTO system_errors (
        id, error_type, page_path, question_id, impact, status,
        message, fingerprint, created_at, first_seen_at, last_seen_at,
        occurrence_count
      ) VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, 1)
    `).bind(
      crypto.randomUUID(),
      compactText(entry.errorType, 100),
      compactText(entry.pagePath, 240),
      Number.isInteger(entry.questionId) ? entry.questionId : null,
      compactText(entry.impact ?? "operation_failed", 100),
      message,
      fingerprint,
      timestamp,
      timestamp,
      timestamp,
    ).run();
  } catch {
    // Observability is intentionally best-effort.
  }
}
