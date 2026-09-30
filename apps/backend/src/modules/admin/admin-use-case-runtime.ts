import {
  normalizeComparableContent,
  normalizeExplanationMarkdown,
  stripProblemApplicationSection,
  stripTheoryDifficultyMetadata,
} from "@shared/content/content-format.mjs";
import {
  hasBalancedMarkdownFences,
  normalizeContentImport,
} from "@shared/admin/admin-import.mjs";
import {
  createRowsExportStream,
  exportFilename,
} from "@shared/admin/admin-export.mjs";
import { canonicalContentSource } from "./infrastructure/canonical-content-source";
import { reviewedPracticalPrompt } from "../study/practical-question-presentation";
import {
  DEFAULT_EXAM_TYPE,
  EXAM_TYPES,
  contentScopeAllowsSubject,
  examScopesCompatible,
  isExamScope,
  isExamType,
  isDescriptiveAllowed,
  isSubject,
  parseJson,
  SUBJECTS,
  uniqueStrings,
} from "@shared/study/study-domain";
import {
  inferredQuestionPracticeScope,
  questionContentFingerprint,
} from "@shared/content/question-pool.mjs";
import { canonicalTopicId } from "@shared/content/topic-taxonomy.mjs";
import {
  adminRepository,
  type SqlCommand,
} from "./admin.repository";
import { readAdminOperationalStatus } from "./admin-operational-status";
import { splitBackupPayload } from "./backup-payload";
import {
  claimBackupCreationLease,
  claimAutomaticBackupLease,
  completeBackupCreationLease,
  completeAutomaticBackupLease,
  expireStalledBackups,
  failBackupCreationLease,
  failAutomaticBackupLease,
} from "./backup-lifecycle";
import {
  hasExplicitModelAnswerHeading,
  hasUnsafeLongLine,
  markdownFenceBalanced,
  modelAnswerForQuality,
  normalizedDuplicateKey,
} from "./admin-quality-rules";
import {
  analyticsAdminClause,
  boundedInteger,
  integer,
  readRange,
  searchTokens,
  sqlLike,
  startOfKoreanDay,
} from "./admin-query-parameters";
import {
  compactText,
  jsonList,
  numberList,
  QUESTION_KINDS,
  questionValues,
  requiredString,
  swTheoryValues,
  theoryValues,
} from "./admin-content-values";
import {
  BACKUP_DELETE_ORDER,
  BACKUP_INSERT_ORDER,
  BACKUP_SCHEMA_VERSION,
  BACKUP_TABLES,
  BACKUP_VERSION,
  RESTORE_TABLES,
  allowedBackupTables,
} from "@shared/admin/backup-contract.mjs";

export type JsonRecord = Record<string, unknown>;
export type AdminIdentity = { email: string; hash: string };
export type D1Row = Record<string, unknown>;
export type RestoreTableSpec = { primaryKey: string | string[]; columns: string[] };

export const APP_VERSION = __BAEUMZIP_APP_VERSION__;
export const SCHEMA_VERSION = BACKUP_SCHEMA_VERSION;
export const RESTORABLE_TABLES = RESTORE_TABLES as Record<string, RestoreTableSpec>;
export const MAX_PAGE_SIZE = 100;
export const SETTING_RULES = {
  site_notice: { type: "string", max: 800 },
  maintenance_mode: { type: "boolean" },
  default_exam_mode: { type: "exam" },
  ai_grading_enabled: { type: "boolean" },
  ai_grading_max_retries: { type: "number", min: 0, max: 3 },
  analytics_enabled: { type: "boolean" },
  analytics_retention_days: { type: "number", min: 7, max: 730 },
  backup_retention_count: { type: "number", min: 2, max: 50 },
  auto_backup_enabled: { type: "boolean" },
} as const;
export const SETTING_DEFAULTS = {
  site_notice: "",
  maintenance_mode: false,
  default_exam_mode: DEFAULT_EXAM_TYPE,
  ai_grading_enabled: false,
  ai_grading_max_retries: 0,
  analytics_enabled: true,
  analytics_retention_days: 90,
  backup_retention_count: 10,
  auto_backup_enabled: false,
} as const;

export function now() {
  return new Date().toISOString();
}

export function safeJson(value: unknown, fallback: unknown) {
  if (typeof value === "string") return parseJson(value, fallback);
  return value ?? fallback;
}

export async function allRows<T extends D1Row = D1Row>(
  sql: string,
  values: unknown[] = [],
) {
  return adminRepository.all<T>(sql, values);
}

export async function firstRow<T extends D1Row = D1Row>(
  sql: string,
  values: unknown[] = [],
) {
  return adminRepository.first<T>(sql, values);
}

export async function execute(sql: string, values: unknown[] = []) {
  return adminRepository.execute(sql, values);
}

export async function checksum(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function jsonResponse(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function errorStatus(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/BACKUP_OBJECTS|외부 백업 저장소|외부 백업 모드/.test(message)) return 503;
  if (/찾을 수|없습니다|required|필요|허용|유효|형식|범위|선택지|정답|서술형|비활성|확인 문구/.test(message)) {
    return 400;
  }
  if (/충돌|참조|중복/.test(message)) return 409;
  return 500;
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "관리자 작업을 완료하지 못했습니다.";
}

export function adminSummary(row: D1Row | null | undefined) {
  if (!row) return {};
  return {
    id: row.id,
    title: compactText(row.title ?? row.prompt, 120),
    category: row.category,
    topic: row.topic,
    examScope: row.exam_scope,
    kind: row.kind,
    difficulty: row.difficulty,
    active: Boolean(row.active),
    updatedAt: row.updated_at,
  };
}

export async function settingValue(key: string, fallback: string) {
  const row = await firstRow<{ value: string }>(
    "SELECT value FROM site_settings WHERE key = ?",
    [key],
  );
  return row?.value ?? fallback;
}

export function parseQuestionRow(row: D1Row) {
  return {
    ...row,
    displayPrompt: reviewedPracticalPrompt(Number(row.id), String(row.prompt)),
    id: Number(row.id),
    theoryId: row.theory_id === null ? null : Number(row.theory_id),
    practiceScope: inferredQuestionPracticeScope(row),
    displayOrder: Number(row.display_order),
    examScope: String(row.exam_scope),
    difficultyRationale: String(row.difficulty_rationale ?? ""),
    choices: jsonList(row.choices).map(String),
    correctAnswers: numberList(row.correct_answers),
    tags: uniqueStrings(row.tags),
    scoringCriteria: uniqueStrings(row.scoring_criteria),
    requiredConcepts: uniqueStrings(row.required_concepts),
    acceptableAlternatives: uniqueStrings(row.acceptable_alternatives),
    deductionConditions: uniqueStrings(row.deduction_conditions),
    errorConditions: uniqueStrings(row.error_conditions),
    active: Boolean(row.active),
    bookmarked: Boolean(row.bookmarked),
    totalAttempts: Number(row.total_attempts ?? 0),
    correctAttempts: Number(row.correct_attempts ?? 0),
    incorrectAttempts: Number(row.incorrect_attempts ?? 0),
    correctnessRate: row.correctness_rate === null || row.correctness_rate === undefined
      ? null
      : Number(row.correctness_rate),
    wrongNoteCount: Number(row.wrong_note_count ?? 0),
    averageDurationSeconds: row.average_duration_seconds === null
      || row.average_duration_seconds === undefined
      ? null
      : Number(row.average_duration_seconds),
    aiEvaluationErrors: Number(row.ai_evaluation_errors ?? 0),
    lastAttemptAt: row.last_attempt_at ?? null,
  };
}

export function parseTheoryRow(row: D1Row) {
  return {
    ...row,
    id: Number(row.id),
    sortOrder: Number(row.sort_order),
    examScope: String(row.exam_scope),
    reviewAnswers: String(row.review_answers ?? ""),
    keywords: uniqueStrings(row.keywords),
    active: Boolean(row.active),
    linkedQuestions: Number(row.linked_questions ?? 0),
    viewCount: Number(row.view_count ?? 0),
    relatedStarts: Number(row.related_starts ?? 0),
  };
}


export {
  BACKUP_DELETE_ORDER,
  BACKUP_INSERT_ORDER,
  BACKUP_SCHEMA_VERSION,
  BACKUP_TABLES,
  BACKUP_VERSION,
  DEFAULT_EXAM_TYPE,
  EXAM_TYPES,
  QUESTION_KINDS,
  RESTORE_TABLES,
  SUBJECTS,
  adminRepository,
  allowedBackupTables,
  analyticsAdminClause,
  boundedInteger,
  canonicalContentSource,
  canonicalTopicId,
  claimBackupCreationLease,
  claimAutomaticBackupLease,
  compactText,
  completeBackupCreationLease,
  completeAutomaticBackupLease,
  contentScopeAllowsSubject,
  createRowsExportStream,
  examScopesCompatible,
  expireStalledBackups,
  exportFilename,
  failBackupCreationLease,
  failAutomaticBackupLease,
  hasBalancedMarkdownFences,
  hasExplicitModelAnswerHeading,
  hasUnsafeLongLine,
  inferredQuestionPracticeScope,
  integer,
  isDescriptiveAllowed,
  isExamScope,
  isExamType,
  isSubject,
  jsonList,
  markdownFenceBalanced,
  modelAnswerForQuality,
  normalizeComparableContent,
  normalizeContentImport,
  normalizeExplanationMarkdown,
  normalizedDuplicateKey,
  numberList,
  parseJson,
  questionContentFingerprint,
  questionValues,
  readAdminOperationalStatus,
  readRange,
  requiredString,
  searchTokens,
  splitBackupPayload,
  sqlLike,
  startOfKoreanDay,
  stripProblemApplicationSection,
  stripTheoryDifficultyMetadata,
  swTheoryValues,
  theoryValues,
  uniqueStrings,
};
export type {
  SqlCommand,
};
