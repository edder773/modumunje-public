/** @typedef {{mode: string, status: string, subjectIds: string[], questionIds: string[], answers: unknown, revealedQuestionIds: string[], currentIndex: number}} SwSessionMutation */
// @ts-check
/** @param {unknown} value @returns {unknown[]} */
function parsedArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** @param {unknown} value */
function normalizedAnswers(value) {
  return [...new Set(parsedArray(value).map(Number).filter(Number.isInteger))]
    .sort((first, second) => first - second);
}

/** @template T @param {T[]} first @param {T[]} second */
function sameArray(first, second) {
  return first.length === second.length
    && first.every((item, index) => item === second[index]);
}

/** @param {unknown} value */
function normalizedRecord(value) {
  let candidate = value;
  if (typeof value === "string") {
    try {
      candidate = JSON.parse(value);
    } catch {
      candidate = {};
    }
  }
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return {};
  return Object.fromEntries(Object.entries(candidate)
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([key, item]) => [key, normalizedAnswers(item)]));
}

/** @param {unknown} first @param {unknown} second */
function sameRecord(first, second) {
  return JSON.stringify(normalizedRecord(first)) === JSON.stringify(normalizedRecord(second));
}

/** @param {Record<string, unknown>} existing @param {Record<string, unknown>} requested */
export function sameSqlAttemptMutation(existing, requested) {
  return Number(existing.questionId) === Number(requested.questionId)
    && sameArray(normalizedAnswers(existing.selectedAnswers), normalizedAnswers(requested.selectedAnswers))
    && Boolean(existing.correct) === Boolean(requested.correct)
    && String(existing.mode ?? "") === String(requested.mode ?? "")
    && String(existing.examType ?? "") === String(requested.examType ?? "")
    && String(existing.result ?? "") === String(requested.result ?? "")
    && Number(existing.score) === Number(requested.score)
    && String(existing.answerText ?? "") === String(requested.answerText ?? "")
    && Number(existing.evaluationId ?? 0) === Number(requested.evaluationId ?? 0)
    && String(existing.reviewStatus ?? "") === String(requested.reviewStatus ?? "")
    && Boolean(existing.isAdmin) === Boolean(requested.isAdmin);
}

/** @param {Record<string, unknown>} existing @param {Record<string, unknown>} requested */
export function sameSwAttemptMutation(existing, requested) {
  return String(existing.questionId ?? "") === String(requested.questionId ?? "")
    && sameArray(normalizedAnswers(existing.selectedAnswers), normalizedAnswers(requested.selectedAnswers))
    && Boolean(existing.correct) === Boolean(requested.correct)
    && String(existing.mode ?? "") === String(requested.mode ?? "");
}

/** @param {Record<string, unknown>} existing @param {SwSessionMutation} requested */
function sameSwSessionState(existing, requested) {
  return String(existing.mode ?? "") === String(requested.mode ?? "")
    && sameArray(parsedArray(existing.subjectIds).map(String), requested.subjectIds.map(String))
    && sameArray(parsedArray(existing.questionIds).map(String), requested.questionIds.map(String))
    && sameRecord(existing.answers, requested.answers)
    && sameArray(
      parsedArray(existing.revealedQuestionIds).map(String),
      requested.revealedQuestionIds.map(String),
    )
    && Number(existing.currentIndex) === Number(requested.currentIndex);
}

/** @param {Record<string, unknown>} existing @param {SwSessionMutation} requested */
export function sameSwActiveSessionMutation(existing, requested) {
  return existing.status === "active"
    && requested.status === "active"
    && sameSwSessionState(existing, requested);
}

/** @param {Record<string, unknown>} existing @param {SwSessionMutation} requested */
export function sameSwSubmittedSessionMutation(existing, requested) {
  return existing.status === "submitted"
    && requested.status === "submitted"
    && sameSwSessionState(existing, requested);
}

/** @param {unknown} importId @param {number} index */
export function guestAttemptOperationId(importId, index) {
  const normalizedImportId = String(importId ?? "");
  if (!/^[a-zA-Z0-9_-]{12,80}$/u.test(normalizedImportId)
    || !Number.isInteger(index)
    || index < 0
    || index > 9_999) {
    throw new TypeError("invalid guest import attempt identity");
  }
  return `guest_${normalizedImportId}_${String(index).padStart(4, "0")}`;
}

/** @param {unknown} sessionId @param {number} questionId */
export function examAttemptOperationId(sessionId, questionId) {
  const normalizedSessionId = String(sessionId ?? "");
  if (!/^[a-zA-Z0-9_-]{12,100}$/u.test(normalizedSessionId)
    || !Number.isInteger(questionId)
    || questionId < 1) {
    throw new TypeError("invalid exam attempt identity");
  }
  return `exam_${normalizedSessionId}_${questionId}`;
}
