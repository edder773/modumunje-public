function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isNumberArray(value) {
  return Array.isArray(value) && value.every((item) => Number.isInteger(item));
}

export function isSwTheory(value) {
  if (!isRecord(value)) return false;
  return Number.isInteger(value.id)
    && typeof value.subjectGroupId === "string"
    && typeof value.subjectId === "string"
    && typeof value.category === "string"
    && typeof value.topic === "string"
    && typeof value.title === "string"
    && typeof value.summary === "string"
    && (value.content === undefined || typeof value.content === "string")
    && (value.reviewAnswers === undefined || typeof value.reviewAnswers === "string")
    && isStringArray(value.keywords)
    && Number.isInteger(value.sortOrder);
}

export function isSwQuestion(value) {
  if (!isRecord(value)) return false;
  return typeof value.id === "string"
    && Number.isInteger(value.theoryId)
    && typeof value.subjectGroupId === "string"
    && typeof value.subjectId === "string"
    && typeof value.category === "string"
    && typeof value.topic === "string"
    && Number.isInteger(value.displayOrder)
    && ["하", "중", "상"].includes(String(value.difficulty))
    && typeof value.difficultyRationale === "string"
    && ["single", "multiple"].includes(String(value.kind))
    && typeof value.prompt === "string"
    && isStringArray(value.choices)
    && (value.correctAnswers === undefined || isNumberArray(value.correctAnswers))
    && (value.explanation === undefined || typeof value.explanation === "string")
    && isStringArray(value.tags);
}

export function isSwStudyPayload(view, value) {
  if (!isRecord(value)) return false;
  if (view === "summary") {
    return typeof value.available === "boolean" && Number.isInteger(value.subjectCount);
  }
  if (view === "theories") {
    return Array.isArray(value.theories) && value.theories.every(isSwTheory);
  }
  if (view === "theory") return isSwTheory(value.theory);
  if (view === "session" || view === "practice") {
    return Array.isArray(value.questions) && value.questions.every(isSwQuestion);
  }
  if (view === "state") {
    return Array.isArray(value.progress)
      && Array.isArray(value.sessions)
      && isRecord(value.attemptSummary);
  }
  return false;
}
