import type { ExamSession } from "../components/study-screen-shared";

export type SqlExamDraft = {
  revision: number;
  updatedAt: string;
  answers: Record<string, number[]>;
  descriptiveAnswers: Record<string, string>;
  descriptiveScores: Record<string, number>;
  descriptiveSnapshots: Record<string, string>;
  flagged: number[];
  currentIndex: number;
};

function numberRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    if (!Array.isArray(item)) return [];
    const answers = [...new Set(item.map(Number).filter(Number.isInteger))];
    return answers.length ? [[key, answers]] : [];
  }));
}

function stringRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => (
    typeof item === "string" ? [[key, item]] : []
  )));
}

function scoreRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    const score = Number(item);
    return Number.isFinite(score) && score >= 0 && score <= 100 ? [[key, score]] : [];
  }));
}

export function sqlExamDraftKey(userKeyHash: string, sessionId: string) {
  return `sql-study-exam:${userKeyHash}:${sessionId}`;
}

export function readSqlExamDraft(userKeyHash: string, session: ExamSession): SqlExamDraft | null {
  try {
    const raw = window.localStorage.getItem(sqlExamDraftKey(userKeyHash, session.id));
    if (!raw) return null;
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (!value || typeof value !== "object") return null;
    const revision = Number(value.revision);
    const updatedAt = typeof value.updatedAt === "string" ? value.updatedAt : "";
    if (!Number.isInteger(revision) || revision < 0 || Number.isNaN(Date.parse(updatedAt))) return null;
    const questionIds = new Set(session.questionIds.map(String));
    const answers = Object.fromEntries(Object.entries(numberRecord(value.answers))
      .filter(([id]) => questionIds.has(id)));
    const descriptiveAnswers = Object.fromEntries(Object.entries(stringRecord(value.descriptiveAnswers))
      .filter(([id]) => questionIds.has(id)));
    const descriptiveScores = Object.fromEntries(Object.entries(scoreRecord(value.descriptiveScores))
      .filter(([id]) => questionIds.has(id)));
    const descriptiveSnapshots = Object.fromEntries(Object.entries(stringRecord(value.descriptiveSnapshots))
      .filter(([id]) => questionIds.has(id)));
    const flagged = Array.isArray(value.flagged)
      ? [...new Set(value.flagged.map(Number).filter((id) => Number.isInteger(id) && questionIds.has(String(id))))]
      : [];
    const currentIndex = Math.min(
      Math.max(0, Number(value.currentIndex) || 0),
      Math.max(0, session.questionIds.length - 1),
    );
    return {
      revision,
      updatedAt,
      answers,
      descriptiveAnswers,
      descriptiveScores,
      descriptiveSnapshots,
      flagged,
      currentIndex,
    };
  } catch {
    return null;
  }
}

export function draftIsNewer(draft: SqlExamDraft, session: ExamSession) {
  return draft.revision >= session.revision
    && Date.parse(draft.updatedAt) > Date.parse(session.updatedAt);
}

export function writeSqlExamDraft(userKeyHash: string, sessionId: string, draft: SqlExamDraft) {
  window.localStorage.setItem(sqlExamDraftKey(userKeyHash, sessionId), JSON.stringify(draft));
}

export function preserveConflictingSqlExamDraft(userKeyHash: string, sessionId: string, draft: SqlExamDraft) {
  window.localStorage.setItem(
    `${sqlExamDraftKey(userKeyHash, sessionId)}:conflict:${Date.now()}`,
    JSON.stringify(draft),
  );
}
