const OPERATION_ID = /^[a-zA-Z0-9_-]{12,100}$/u;
const IMPORT_ID = /^[a-zA-Z0-9_-]{12,80}$/u;
const SW_QUESTION_ID = /^[A-Z0-9-]{1,64}$/u;

export const STUDY_MUTATION_ACTIONS = Object.freeze([
  "account-touch",
  "guest-import",
  "question-feedback",
  "attempt",
  "short-answer",
  "self-assessment",
  "bookmark",
  "settings",
  "theory-progress",
  "exam-start",
  "exam-save",
  "exam-submit",
]);

export const SW_STUDY_MUTATION_ACTIONS = Object.freeze([
  "sw-attempt",
  "sw-progress",
  "sw-session-save",
  "sw-session-submit",
  "sw-import",
]);

const LEGACY_STUDY_ACTIONS = new Set(["evaluate", "theory", "question", "import"]);
const STUDY_ACTION_SET = new Set([...STUDY_MUTATION_ACTIONS, ...LEGACY_STUDY_ACTIONS]);
const SW_ACTION_SET = new Set(SW_STUDY_MUTATION_ACTIONS);

export function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function stringValue(value) {
  return typeof value === "string" && Boolean(value.trim());
}

function optionalArray(value) {
  return value === undefined || Array.isArray(value);
}

function integerArray(value, minimum = 0) {
  return Array.isArray(value)
    && value.every((item) => Number.isInteger(item) && item >= minimum);
}

function numericKeyRecord(value, validator) {
  return isRecord(value) && Object.entries(value).every(([key, item]) => (
    /^[1-9]\d*$/u.test(key) && validator(item)
  ));
}

function contractError(code, message) {
  return { ok: false, code, message };
}

function validExamState(value) {
  return OPERATION_ID.test(String(value.sessionId ?? ""))
    && nonNegativeInteger(value.revision)
    && (value.answers === undefined
      || numericKeyRecord(value.answers, (item) => integerArray(item)))
    && (value.descriptiveAnswers === undefined
      || numericKeyRecord(value.descriptiveAnswers, (item) => typeof item === "string"))
    && (value.descriptiveScores === undefined
      || numericKeyRecord(value.descriptiveScores, (item) => (
        Number.isFinite(item) && item >= 0 && item <= 100
      )))
    && (value.descriptiveSnapshots === undefined
      || numericKeyRecord(value.descriptiveSnapshots, (item) => typeof item === "string"))
    && (value.flagged === undefined || integerArray(value.flagged, 1))
    && (value.currentIndex === undefined || nonNegativeInteger(value.currentIndex));
}

export function validateStudyMutationRequest(value) {
  if (!isRecord(value)) {
    return contractError("STUDY_BODY_INVALID", "학습 저장 요청 본문이 올바른 JSON 객체가 아닙니다.");
  }
  const action = typeof value.action === "string" ? value.action : "";
  if (!STUDY_ACTION_SET.has(action)) {
    return contractError("STUDY_ACTION_UNSUPPORTED", "지원하지 않는 학습 저장 요청입니다.");
  }

  let valid = true;
  if (action === "account-touch") {
    valid = value.displayName === undefined || typeof value.displayName === "string";
  } else if (action === "guest-import") {
    valid = IMPORT_ID.test(String(value.importId ?? ""))
      && (value.selectedExam === undefined || stringValue(value.selectedExam))
      && optionalArray(value.bookmarks)
      && optionalArray(value.attempts)
      && optionalArray(value.theoryProgress);
  } else if (action === "question-feedback") {
    valid = positiveInteger(value.questionId)
      && stringValue(value.examType)
      && stringValue(value.answerText)
      && stringValue(value.feedbackAuthorization);
  } else if (action === "short-answer") {
    valid = positiveInteger(value.questionId)
      && OPERATION_ID.test(String(value.clientOperationId ?? ""))
      && value.examType === "IPEP"
      && stringValue(value.mode)
      && stringValue(value.answerText)
      && stringValue(value.feedbackAuthorization);
  } else if (action === "attempt") {
    valid = positiveInteger(value.questionId)
      && OPERATION_ID.test(String(value.clientOperationId ?? ""))
      && integerArray(value.selectedAnswers)
      && stringValue(value.mode)
      && stringValue(value.examType)
      && stringValue(value.feedbackAuthorization);
  } else if (action === "self-assessment") {
    valid = positiveInteger(value.questionId)
      && OPERATION_ID.test(String(value.clientOperationId ?? ""))
      && stringValue(value.mode)
      && stringValue(value.examType)
      && stringValue(value.answerText)
      && stringValue(value.feedbackAuthorization)
      && Number.isFinite(value.score)
      && (value.evaluationId === undefined || positiveInteger(value.evaluationId));
  } else if (action === "bookmark") {
    valid = positiveInteger(value.questionId) && typeof value.bookmarked === "boolean";
  } else if (action === "settings") {
    valid = stringValue(value.selectedExam);
  } else if (action === "theory-progress") {
    valid = positiveInteger(value.theoryId)
      && stringValue(value.examType)
      && typeof value.completed === "boolean";
  } else if (action === "exam-start") {
    valid = stringValue(value.examType);
  } else if (action === "exam-save" || action === "exam-submit") {
    valid = validExamState(value);
  }

  if (!valid) {
    return contractError("STUDY_MUTATION_INVALID", "학습 저장 요청에 필요하거나 올바른 형식의 값이 없습니다.");
  }
  return { ok: true, action, payload: value };
}

export const SW_SESSION_QUESTION_LIMIT = 100;

function validSwSession(value) {
  return OPERATION_ID.test(String(value.sessionId ?? ""))
    && nonNegativeInteger(value.revision)
    && ["practice", "mock"].includes(value.mode)
    && Array.isArray(value.subjectIds)
    && value.subjectIds.length > 0
    && value.subjectIds.every(stringValue)
    && Array.isArray(value.questionIds)
    && value.questionIds.length > 0
    && value.questionIds.every((item) => SW_QUESTION_ID.test(String(item)))
    && (value.answers === undefined
      || (isRecord(value.answers) && Object.entries(value.answers).every(([key, item]) => (
        SW_QUESTION_ID.test(key) && integerArray(item)
      ))))
    && (value.revealedQuestionIds === undefined
      || (Array.isArray(value.revealedQuestionIds)
        && value.revealedQuestionIds.every((item) => SW_QUESTION_ID.test(String(item)))))
    && (value.currentIndex === undefined || nonNegativeInteger(value.currentIndex));
}

export function validateSwStudyMutationRequest(value) {
  if (!isRecord(value)) {
    return contractError("SW_BODY_INVALID", "SW 학습 저장 요청 본문이 올바른 JSON 객체가 아닙니다.");
  }
  const action = typeof value.action === "string" ? value.action : "";
  if (!SW_ACTION_SET.has(action)) {
    return contractError("SW_ACTION_UNSUPPORTED", "지원하지 않는 SW 학습 저장 요청입니다.");
  }

  let valid = true;
  const sessionCandidate = action === "sw-import" ? value.activeSession : value;
  if (["sw-session-save", "sw-session-submit", "sw-import"].includes(action)
    && isRecord(sessionCandidate) && Array.isArray(sessionCandidate.questionIds)
    && sessionCandidate.questionIds.length > SW_SESSION_QUESTION_LIMIT) {
    return contractError("SW_SESSION_TOO_LARGE", "활성 SW 학습 세션은 최대 100문항까지 저장할 수 있습니다.");
  }
  if (action === "sw-attempt") {
    valid = SW_QUESTION_ID.test(String(value.questionId ?? ""))
      && OPERATION_ID.test(String(value.clientOperationId ?? ""))
      && OPERATION_ID.test(String(value.sessionId ?? ""))
      && integerArray(value.selectedAnswers)
      && value.mode === "practice"
      && stringValue(value.feedbackAuthorization);
  } else if (action === "sw-progress") {
    valid = positiveInteger(value.theoryId) && typeof value.completed === "boolean";
  } else if (action === "sw-session-save" || action === "sw-session-submit") {
    valid = validSwSession(value);
  } else if (action === "sw-import") {
    const importedSession = isRecord(value.activeSession)
      ? { ...value.activeSession, sessionId: value.activeSession.id ?? value.activeSession.sessionId }
      : null;
    valid = (value.completedTheoryIds === undefined || integerArray(value.completedTheoryIds, 1))
      && (value.activeSession === undefined
        || value.activeSession === null
        || (Boolean(importedSession) && validSwSession(importedSession)));
  }

  if (!valid) {
    return contractError("SW_MUTATION_INVALID", "SW 학습 저장 요청에 필요하거나 올바른 형식의 값이 없습니다.");
  }
  return { ok: true, action, payload: value };
}

function hasSession(value) {
  return isRecord(value) && isRecord(value.session) && stringValue(value.session.id);
}

export function isStudyMutationResponse(action, value) {
  if (!isRecord(value)) return false;
  if (["account-touch", "bookmark", "settings", "theory-progress"].includes(action)) {
    return value.ok === true;
  }
  if (action === "guest-import") {
    return value.ok === true && typeof value.imported === "boolean";
  }
  if (action === "question-feedback") return isRecord(value.feedback);
  if (action === "attempt" || action === "self-assessment" || action === "short-answer") {
    return isRecord(value.attempt) && isRecord(value.feedback) && typeof value.duplicate === "boolean";
  }
  if (action === "exam-start") {
    return hasSession(value) && Array.isArray(value.questions) && typeof value.resumed === "boolean";
  }
  if (action === "exam-save") return hasSession(value);
  if (action === "exam-submit") return hasSession(value) && Array.isArray(value.questions);
  return false;
}

export function isSwStudyMutationResponse(action, value) {
  if (!isRecord(value)) return false;
  if (action === "sw-attempt") return isRecord(value.attempt) && isRecord(value.feedback);
  if (action === "sw-progress" || action === "sw-import") return value.ok === true;
  if (action === "sw-session-save") return hasSession(value);
  if (action === "sw-session-submit") return hasSession(value) && Array.isArray(value.questions);
  return false;
}
