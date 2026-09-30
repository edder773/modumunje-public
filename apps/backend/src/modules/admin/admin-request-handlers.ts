import {
  authorizeAdminRequest,
  learnerUserHash,
  verifyAdminMutationRequest,
} from "@backend/common/auth/admin-auth";
import { adminSessionState, maybeAdminEntryBackup } from "./admin-backup-entry";
import { createManualBackupResponse } from "./admin-manual-backup-response";
import { handleTheoryContentRepair } from "./admin-theory-content-repair";
import { writeAdminAudit, writeSystemError } from "@backend/common/observability";
import {
  readBoundedJsonBody,
  RequestBodyError,
} from "@shared/http/bounded-json-body.mjs";
import { ADMIN_REQUEST_MAX_BYTES } from "@shared/admin/admin-transfer-limits.mjs";
import {
  compactText,
  numberList,
  requiredString,
} from "./admin-content-values";
import { AdminSearchInputError, integer, searchTokens, sqlLike } from "./admin-query-parameters";
import { readSelfLearningReset, resetSelfLearningRecords } from "./admin-self-learning-reset";
import {
  QUALITY_INVALIDATING_ACTIONS,
  adminSummary,
  allRows,
  applyQualityFix,
  bulkQuestions,
  commitImport,
  createSwQuestion,
  createSwTheory,
  deactivateQuestion,
  deactivateTheory,
  deleteBackupSnapshot,
  deleteInactiveQuestion,
  duplicateQuestion,
  errorMessage,
  errorStatus,
  execute,
  exportData,
  firstRow,
  insertQuestion,
  insertTheory,
  invalidateQualitySnapshot,
  jsonResponse,
  linkTheory,
  openBackupDownload,
  now,
  parseQuestionRow,
  parseTheoryRow,
  previewImport,
  readAnalytics,
  readBackupList,
  readDashboard,
  readExportPage,
  readLogs,
  readMembers,
  readQuality,
  readQuestionList,
  readReports,
  readReportNotification,
  readSettings,
  readSwQuestionList,
  readSwTheoryAdminList,
  readTheoryList,
  previewBackupPayload,
  restoreBackupPayload,
  previewSkctBankActivation,
  activateSkctBank,
  updateQuestion,
  updateSettings,
  updateSwQuestion,
  updateSwTheory,
  updateTheory,
  type D1Row,
  type JsonRecord,
} from "./admin-use-cases";

export async function GET(request: Request) {
  const authorization = await authorizeAdminRequest(request);
  if (!authorization.ok) return authorization.response;
  const identity = authorization.identity;
  const url = new URL(request.url);
  const resource = url.searchParams.get("resource") ?? "dashboard";
  try {
    // Validate before streamed exports can start their response or touch D1.
    for (const token of searchTokens(url.searchParams.get("search") ?? "")) sqlLike(token);
    if (resource === "dashboard") {
      return jsonResponse(await readDashboard(url, await learnerUserHash(identity.email)));
    }
    if (resource === "members") {
      return jsonResponse(await readMembers(url));
    }
    if (resource === "self-learning-reset") {
      return jsonResponse(await readSelfLearningReset(identity));
    }
    if (resource === "questions") {
      return jsonResponse(await readQuestionList(url));
    }
    if (resource === "sw-questions") {
      return jsonResponse(await readSwQuestionList(url));
    }
    if (resource === "theories") {
      return jsonResponse(await readTheoryList(url));
    }
    if (resource === "sw-theories") {
      return jsonResponse(await readSwTheoryAdminList(url));
    }
    if (resource === "sw-options") {
      const theories = await allRows(`
        SELECT id, title, subject_group_id, subject_id, category, topic
        FROM sw_theories WHERE active = 1
        ORDER BY sort_order, id
      `);
      return jsonResponse({ theories });
    }
    if (resource === "theory-links") {
      const theoryId = integer(url.searchParams.get("id"));
      if (!theoryId) throw new Error("이론 ID가 필요합니다.");
      const theory = await firstRow("SELECT * FROM theories WHERE id = ?", [theoryId]);
      if (!theory) throw new Error("이론을 찾을 수 없습니다.");
      const linked = await allRows(`
        SELECT id, display_order, prompt, category, topic, exam_scope, kind, active
        FROM questions WHERE theory_id = ?
        ORDER BY active DESC, display_order, id
      `, [theoryId]);
      return jsonResponse({
        theory: parseTheoryRow(theory),
        questions: linked.map((item: D1Row) => ({
          ...item,
          prompt: compactText(item.prompt, 140),
          active: Boolean(item.active),
        })),
      });
    }
    if (resource === "quality") {
      return jsonResponse(await readQuality(url.searchParams.get("refresh") === "1"));
    }
    if (resource === "backups") {
      return jsonResponse(await readBackupList());
    }
    if (resource === "analytics") {
      return jsonResponse(await readAnalytics(url, await learnerUserHash(identity.email)));
    }
    if (resource === "logs") {
      return jsonResponse(await readLogs(url));
    }
    if (resource === "report-notification") {
      return jsonResponse(await readReportNotification());
    }
    if (resource === "reports") {
      return jsonResponse(await readReports(url));
    }
    if (resource === "settings") {
      return jsonResponse(await readSettings());
    }
    if (resource === "options") {
      const [theoryOptions, categories] = await Promise.all([
        allRows(`
          SELECT id, title, category, topic, exam_scope
          FROM theories WHERE active = 1
          ORDER BY category, sort_order, id
        `),
        allRows(`
          SELECT category, topic, COUNT(*) AS questions
          FROM questions GROUP BY category, topic
          ORDER BY category, topic
        `),
      ]);
      return jsonResponse({ theories: theoryOptions, categories });
    }
    if (resource === "export") {
      const exported = await exportData(url);
      await writeAdminAudit({
        adminUserHash: identity.hash,
        action: "data_exported",
        targetType: String(url.searchParams.get("scope") ?? "questions"),
        after: {
          scope: url.searchParams.get("scope") ?? "questions",
          count: exported.count,
          mode: "streamed",
        },
      });
      return exported.response;
    }
    if (resource === "export-page") {
      const page = await readExportPage(url);
      if (page.page === 1) {
        await writeAdminAudit({
          adminUserHash: identity.hash,
          action: "data_exported",
          targetType: page.scope,
          after: { scope: page.scope, mode: "chunked", count: page.total },
        });
      }
      return jsonResponse(page);
    }
    if (resource === "backup-download") {
      const id = requiredString(url.searchParams.get("id"), "백업 ID");
      const row = await openBackupDownload(id);
      await writeAdminAudit({
        adminUserHash: identity.hash,
        action: "backup_downloaded",
        targetType: "backup",
        targetId: id,
        after: { type: row.backup_type, createdAt: row.created_at },
      });
      return new Response(row.body, {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="sql-study-backup-${id}.json"`,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    return jsonResponse({ error: "지원하지 않는 관리자 리소스입니다." }, 404);
  } catch (error) {
    if (error instanceof AdminSearchInputError) {
      return jsonResponse({ error: error.message, code: error.code }, 400);
    }
    await writeSystemError({
      errorType: "admin_read_failed",
      pagePath: `/admin/${resource}`,
      message: errorMessage(error),
    });
    return jsonResponse({ error: errorMessage(error) }, errorStatus(error));
  }
}

export async function POST(request: Request) {
  const authorization = await authorizeAdminRequest(request);
  if (!authorization.ok) return authorization.response;
  const identity = authorization.identity;
  const mutationError = verifyAdminMutationRequest(request);
  if (mutationError) return mutationError;

  let payload: JsonRecord = {};
  let action = "unknown";
  try {
    try {
      const candidate = await readBoundedJsonBody(request, ADMIN_REQUEST_MAX_BYTES);
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
        return jsonResponse({ error: "관리자 요청 본문이 올바른 JSON 객체가 아닙니다." }, 400);
      }
      payload = candidate as JsonRecord;
    } catch (error) {
      if (error instanceof RequestBodyError) {
        return jsonResponse({ error: error.message, code: error.code }, error.status);
      }
      throw error;
    }
    action = String(payload.action ?? "");
    if (["theory-content-repair-preview", "theory-content-repair-status", "theory-content-repair-run"].includes(action))
      return await handleTheoryContentRepair(identity, action, payload);
    if (action === "self-learning-reset") {
      // This operation records its audit atomically with the account-scoped deletion.
      return jsonResponse(await resetSelfLearningRecords(identity, payload));
    }
    let result: unknown;
    let targetType = "system";
    let targetId: string | number | null = null;
    let before: unknown = {};
    let after: unknown = {};

    if (action === "admin-session") {
      result = adminSessionState();
      action = "admin_session_started";
    } else if (action === "user-block" || action === "user-unblock") {
      const userKey = requiredString(payload.userKey, "회원 식별값");
      const previous = await firstRow(`
        SELECT user_key, email, display_name, status, blocked_reason, blocked_at
        FROM user_accounts WHERE user_key = ?
      `, [userKey]);
      if (!previous) throw new Error("회원을 찾을 수 없습니다.");
      if (userKey === await learnerUserHash(identity.email)) {
        throw new Error("현재 관리자 계정은 차단할 수 없습니다.");
      }
      const blocked = action === "user-block";
      const reason = blocked
        ? requiredString(payload.reason, "차단 사유").slice(0, 500)
        : "";
      const timestamp = now();
      await execute(`
        UPDATE user_accounts
        SET status = ?, blocked_reason = ?, blocked_at = ?,
            blocked_by_hash = ?, updated_at = ?
        WHERE user_key = ?
      `, [
        blocked ? "blocked" : "active",
        reason,
        blocked ? timestamp : null,
        blocked ? identity.hash : null,
        timestamp,
        userKey,
      ]);
      const changed = await firstRow(`
        SELECT user_key, email, display_name, status, blocked_reason, blocked_at
        FROM user_accounts WHERE user_key = ?
      `, [userKey]);
      result = { member: changed };
      targetType = "user-account";
      targetId = userKey;
      before = previous;
      after = changed;
    } else if (action === "question-create") {
      const created = await insertQuestion(payload);
      result = { question: created ? parseQuestionRow(created) : null };
      targetType = "question";
      targetId = Number(created?.id ?? 0);
      after = adminSummary(created);
    } else if (action === "sw-question-create") {
      const created = await createSwQuestion(payload);
      result = { question: created };
      targetType = "sw-question";
      targetId = String(created?.id ?? "");
      after = created;
    } else if (action === "sw-question-update") {
      const changed = await updateSwQuestion(payload);
      result = { question: changed.after };
      targetType = "sw-question";
      targetId = String(payload.id ?? "");
      before = changed.before;
      after = changed.after;
    } else if (action === "sw-question-deactivate") {
      const id = requiredString(payload.id, "SW 문제 ID");
      before = await firstRow("SELECT * FROM sw_questions WHERE id = ?", [id]);
      if (!before) throw new Error("비활성화할 SW 문제를 찾을 수 없습니다.");
      await execute("UPDATE sw_questions SET active = 0, updated_at = ? WHERE id = ?", [now(), id]);
      after = await firstRow("SELECT * FROM sw_questions WHERE id = ?", [id]);
      result = { question: after };
      targetType = "sw-question";
      targetId = id;
    } else if (action === "question-update") {
      const changed = await updateQuestion(payload);
      result = { question: changed.after ? parseQuestionRow(changed.after) : null };
      targetType = "question";
      targetId = integer(payload.id);
      before = adminSummary(changed.before);
      after = adminSummary(changed.after);
    } else if (action === "question-duplicate") {
      const created = await duplicateQuestion(payload);
      result = { question: created ? parseQuestionRow(created) : null };
      targetType = "question";
      targetId = Number(created?.id ?? 0);
      after = { sourceId: integer(payload.id), ...adminSummary(created) };
    } else if (action === "question-deactivate" || action === "question-delete") {
      const changed = await deactivateQuestion(payload);
      result = changed;
      targetType = "question";
      targetId = integer(payload.id);
      before = adminSummary(changed.before);
      after = adminSummary(changed.after);
    } else if (action === "question-delete-inactive") {
      const changed = await deleteInactiveQuestion(payload);
      result = {
        id: changed.id,
        deleted: changed.deleted,
        deletionMode: changed.deletionMode,
        references: changed.references,
      };
      targetType = "question";
      targetId = changed.id;
      before = adminSummary(changed.before);
      after = { deleted: true, deletionMode: "hard" };
    } else if (action === "question-bulk") {
      result = await bulkQuestions(payload);
      targetType = "question-bulk";
      targetId = `${numberList(payload.ids).length} items`;
      after = result;
    } else if (action === "theory-create") {
      const created = await insertTheory(payload);
      result = { theory: created ? parseTheoryRow(created) : null };
      targetType = "theory";
      targetId = Number(created?.id ?? 0);
      after = adminSummary(created);
    } else if (action === "theory-update") {
      const changed = await updateTheory(payload);
      result = { theory: changed.after ? parseTheoryRow(changed.after) : null };
      targetType = "theory";
      targetId = integer(payload.id);
      before = adminSummary(changed.before);
      after = adminSummary(changed.after);
    } else if (action === "theory-deactivate" || action === "theory-delete") {
      const changed = await deactivateTheory(payload);
      result = changed;
      targetType = "theory";
      targetId = integer(payload.id);
      before = adminSummary(changed.before);
      after = adminSummary(changed.after);
    } else if (action === "theory-link") {
      const changed = await linkTheory(payload);
      result = changed;
      targetType = "question-theory-link";
      targetId = integer(payload.questionId);
      before = changed.before;
      after = changed.after;
    } else if (action === "quality-fix") {
      result = await applyQualityFix(payload);
      targetType = "quality";
      targetId = String(payload.fixAction ?? "");
      after = result;
    } else if (action === "backup-create" || action === "backup-cancel") {
      const created = await createManualBackupResponse(identity, payload);
      result = created.response;
      targetType = "backup";
      targetId = created.audit.id;
      after = created.audit;
    } else if (action === "backup-auto-if-due") {
      const created = await maybeAdminEntryBackup(identity);
      if (!created) return jsonResponse({ created: false });
      result = { created: true, backup: created };
      action = "automatic_backup_created";
      targetType = "backup";
      targetId = created.id;
      after = created;
    } else if (action === "sw-theory-create") {
      const created = await createSwTheory(payload);
      result = { theory: created };
      targetType = "sw-theory";
      targetId = Number(created?.id ?? 0);
      after = created;
    } else if (action === "sw-theory-update") {
      const changed = await updateSwTheory(payload);
      result = { theory: changed.after };
      targetType = "sw-theory";
      targetId = integer(payload.id);
      before = changed.before;
      after = changed.after;
    } else if (action === "sw-theory-deactivate") {
      const id = integer(payload.id);
      before = await firstRow("SELECT * FROM sw_theories WHERE id = ?", [id]);
      if (!before) throw new Error("비활성화할 SW 이론을 찾을 수 없습니다.");
      await execute("UPDATE sw_theories SET active = 0, updated_at = ? WHERE id = ?", [now(), id]);
      after = await firstRow("SELECT * FROM sw_theories WHERE id = ?", [id]);
      result = { theory: after };
      targetType = "sw-theory";
      targetId = id;
    } else if (action === "backup-delete") {
      const id = requiredString(payload.id, "백업 ID");
      const backup = await deleteBackupSnapshot(id);
      result = { id, deleted: true };
      targetType = "backup";
      targetId = id;
      before = backup;
      after = result;
    } else if (action === "restore-preview") {
      return jsonResponse(await previewBackupPayload(payload));
    } else if (action === "restore-run") {
      const mode = ["merge", "full-replace", "content-only", "settings-only"].includes(String(payload.mode))
        ? String(payload.mode) as "merge" | "full-replace" | "content-only" | "settings-only"
        : "merge";
      result = await restoreBackupPayload(identity, payload, mode, payload.confirmation);
      targetType = "restore";
      targetId = String(payload.backupId ?? "uploaded-file");
      after = result;
    } else if (action === "import-preview") {
      return jsonResponse(await previewImport(payload));
    } else if (action === "import-commit") {
      result = await commitImport(identity, payload);
      targetType = "import";
      targetId = "content";
      after = result;
    } else if (action === "skct-bank-preview") {
      return jsonResponse(await previewSkctBankActivation(payload.bank));
    } else if (action === "skct-bank-activate") {
      // The release rows and required audit record are committed in one D1 batch.
      return jsonResponse(await activateSkctBank(identity, payload.bank, payload.confirmation));
    } else if (action === "settings-update") {
      const changed = await updateSettings(identity, payload);
      result = { values: changed.after };
      targetType = "settings";
      before = changed.before;
      after = changed.after;
    } else if (action === "error-status") {
      const id = requiredString(payload.id, "오류 ID");
      const status = ["open", "resolved", "ignored"].includes(String(payload.status))
        ? String(payload.status)
        : "";
      if (!status) throw new Error("오류 처리 상태가 유효하지 않습니다.");
      const previous = await firstRow("SELECT * FROM system_errors WHERE id = ?", [id]);
      if (!previous) throw new Error("오류 기록을 찾을 수 없습니다.");
      await execute("UPDATE system_errors SET status = ? WHERE id = ?", [status, id]);
      result = { id, status };
      targetType = "system-error";
      targetId = id;
      before = { status: previous.status };
      after = { status };
    } else if (action === "report-status") {
      const id = requiredString(payload.id, "제보 ID");
      const status = ["new", "reviewing", "resolved"].includes(String(payload.status))
        ? String(payload.status)
        : "";
      if (!status) throw new Error("제보 처리 상태가 유효하지 않습니다.");
      const adminNote = compactText(payload.adminNote, 1200);
      const previous = await firstRow("SELECT * FROM user_reports WHERE id = ?", [id]);
      if (!previous) throw new Error("제보 기록을 찾을 수 없습니다.");
      await execute(`
        UPDATE user_reports
        SET status = ?, admin_note = ?, updated_at = ?
        WHERE id = ?
      `, [status, adminNote, now(), id]);
      result = { id, status, adminNote };
      targetType = "user-report";
      targetId = id;
      before = { status: previous.status, adminNote: previous.admin_note };
      after = { status, adminNote };
    } else if (action === "report-delete") {
      const id = requiredString(payload.id, "제보 ID");
      const previous = await firstRow(`
        SELECT id, category, title, status, created_at
        FROM user_reports WHERE id = ?
      `, [id]);
      if (!previous) throw new Error("삭제할 제보를 찾을 수 없습니다.");
      await execute("DELETE FROM user_reports WHERE id = ?", [id]);
      result = { id, deleted: true };
      targetType = "user-report";
      targetId = id;
      before = previous;
      after = { deleted: true };
    } else {
      return jsonResponse({ error: "지원하지 않는 관리자 작업입니다." }, 400);
    }

    if (QUALITY_INVALIDATING_ACTIONS.has(action)) {
      await invalidateQualitySnapshot();
    }
    await writeAdminAudit({
      adminUserHash: identity.hash,
      action,
      targetType,
      targetId,
      before,
      after,
    });
    return jsonResponse(result, 200);
  } catch (error) {
    const message = errorMessage(error);
    await Promise.all([
      writeAdminAudit({
        adminUserHash: identity.hash,
        action,
        targetType: String(payload.targetType ?? "system"),
        targetId: payload.id === undefined ? null : String(payload.id),
        success: false,
        failureReason: message,
      }),
      writeSystemError({
        errorType: `admin_${compactText(action, 80)}_failed`,
        pagePath: "/api/admin",
        questionId: Number.isInteger(Number(payload.questionId))
          ? Number(payload.questionId)
          : null,
        message,
      }),
    ]);
    return jsonResponse({ error: message }, errorStatus(error));
  }
}

export async function PATCH(request: Request) {
  return POST(request);
}

export async function DELETE(request: Request) {
  return POST(request);
}
