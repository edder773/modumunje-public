function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isArray(value, validator = isRecord) {
  return Array.isArray(value) && value.every(validator);
}

function isQuestion(value) {
  return isRecord(value)
    && Number.isInteger(value.id)
    && typeof value.prompt === "string"
    && Array.isArray(value.choices)
    && value.choices.every((choice) => typeof choice === "string")
    && (value.correctAnswers === undefined
      || (Array.isArray(value.correctAnswers)
        && value.correctAnswers.every((answer) => Number.isInteger(answer))))
    && (value.explanation === undefined || typeof value.explanation === "string")
    && (value.scoringCriteria === undefined || isArray(value.scoringCriteria, (item) => typeof item === "string"))
    && (value.requiredConcepts === undefined || isArray(value.requiredConcepts, (item) => typeof item === "string"))
    && (value.acceptableAlternatives === undefined || isArray(value.acceptableAlternatives, (item) => typeof item === "string"))
    && (value.deductionConditions === undefined || isArray(value.deductionConditions, (item) => typeof item === "string"))
    && (value.errorConditions === undefined || isArray(value.errorConditions, (item) => typeof item === "string"));
}

function isTheory(value) {
  return isRecord(value)
    && Number.isInteger(value.id)
    && typeof value.title === "string"
    && typeof value.summary === "string";
}

export function isStudyApiPayload(scope, value) {
  if (!isRecord(value)) return false;
  if ("questions" in value && !isArray(value.questions, isQuestion)) return false;
  if ("theories" in value && !isArray(value.theories, isTheory)) return false;
  if ("attempts" in value && !isArray(value.attempts)) return false;
  if ("examSessions" in value && !isArray(value.examSessions)) return false;

  if (scope === "shell") return isRecord(value.settings);
  if (scope === "overview" || scope === "bootstrap") return isRecord(value.overview);
  if (scope === "theories") return Array.isArray(value.theories);
  if (scope === "theory") {
    return Array.isArray(value.theories) && isRecord(value.theoryNavigation);
  }
  if (scope === "practice-meta") return isRecord(value.practiceMeta);
  if (scope === "practice" || scope === "questions") return Array.isArray(value.questions);
  if (scope === "records") {
    return Array.isArray(value.attempts)
      && Array.isArray(value.examSessions)
      && isRecord(value.recordsPagination);
  }
  if (scope === "mock" || scope === "mock-session") return Array.isArray(value.examSessions);
  return false;
}
