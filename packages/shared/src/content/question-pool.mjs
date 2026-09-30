import { isPracticalPastQuestion } from "../study/ipe-practical-past.mjs";
export const QUESTION_PRACTICE_SCOPES = Object.freeze({
  general: "general",
  theoryOnly: "theory_only",
});

// The reviewed 2026-08-02 supplement added 30 objective checks for each of
// the 122 subject-3 theories. These stable IDs let older exports/backups that
// predate practice_scope retain the intended delivery rule when restored.
export const THEORY_PAIR_QUESTION_RANGE = Object.freeze({
  firstId: 2239,
  lastId: 5898,
  count: 3660,
});

// Keep historical rows and learner references intact. Entries are added here
// only while two stable IDs still contain the same reviewed question content.
export const DUPLICATE_QUESTION_CANONICAL_IDS = Object.freeze({});

export function canonicalQuestionId(question) {
  const id = Number(question?.id ?? question);
  return DUPLICATE_QUESTION_CANONICAL_IDS[id] ?? id;
}

export function isCanonicalPracticeQuestion(question) {
  const id = Number(question?.id);
  return Number.isInteger(id) && canonicalQuestionId(id) === id;
}

/**
 * @template {{ id?: unknown, variantGroupId?: unknown, variant_group_id?: unknown }} T
 * @param {T[]} questions
 * @returns {T[]}
 */
export function dedupeCanonicalQuestions(questions) {
  const seen = new Set();
  return questions.filter((question) => {
    const explicitGroup = String(
      question?.variantGroupId ?? question?.variant_group_id ?? "",
    ).trim();
    const groupKey = explicitGroup || `question:${canonicalQuestionId(question)}`;
    if (seen.has(groupKey)) return false;
    seen.add(groupKey);
    return true;
  });
}

function parsedList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizedFingerprintText(value, removeLeadingTopic = false) {
  let normalized = String(value ?? "").normalize("NFKC");
  if (removeLeadingTopic) {
    normalized = normalized.replace(
      /^\s*[^:\n]{1,60}:\s*(?=(?:다음|아래|주어진|위|SQL)(?:\s|$))/iu,
      "",
    );
  }
  return normalized
    .replace(/^\s*(?:```|~~~)\s*[a-z0-9_+-]*\s*$/gimu, " ")
    .replace(/[`*_#>|[\](){}]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("ko-KR");
}

export function questionContentFingerprint(question) {
  const kind = String(question?.kind ?? "").trim();
  const prompt = normalizedFingerprintText(question?.prompt, true);
  const choices = parsedList(question?.choices)
    .map((choice) => normalizedFingerprintText(choice));
  const answers = parsedList(
    question?.correctAnswers ?? question?.correct_answers,
  ).map(Number).filter(Number.isInteger).sort((a, b) => a - b);
  if (!prompt) return "";
  return JSON.stringify([kind, prompt, choices, answers]);
}

export function inferredQuestionPracticeScope(question) {
  const explicit = String(
    question?.practiceScope ?? question?.practice_scope ?? "",
  ).trim();
  if (explicit === QUESTION_PRACTICE_SCOPES.theoryOnly) {
    return QUESTION_PRACTICE_SCOPES.theoryOnly;
  }
  if (explicit === QUESTION_PRACTICE_SCOPES.general) {
    return QUESTION_PRACTICE_SCOPES.general;
  }

  const id = Number(question?.id);
  const theoryId = Number(question?.theoryId ?? question?.theory_id);
  if (
    Number.isInteger(id)
    && id >= THEORY_PAIR_QUESTION_RANGE.firstId
    && id <= THEORY_PAIR_QUESTION_RANGE.lastId
    && Number.isInteger(theoryId)
    && theoryId > 0
    && String(question?.examScope ?? question?.exam_scope) === "SQLP"
    && String(question?.category) === "SQL 고급 활용 및 튜닝"
  ) {
    return QUESTION_PRACTICE_SCOPES.theoryOnly;
  }
  return QUESTION_PRACTICE_SCOPES.general;
}

export function isGeneralPracticeQuestion(question) {
  return !isPracticalPastQuestion(question) && inferredQuestionPracticeScope(question) === QUESTION_PRACTICE_SCOPES.general;
}

export function isTheoryOnlyQuestion(question) {
  return inferredQuestionPracticeScope(question) === QUESTION_PRACTICE_SCOPES.theoryOnly;
}
