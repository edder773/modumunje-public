import {
  areEquivalentContents,
  extractModelAnswer,
  normalizeComparableContent,
  normalizeExplanationMarkdown,
  normalizeMarkdownProse,
  stripProblemApplicationSection,
  stripSourceArtifactAppendix,
  stripTheoryDifficultyMetadata,
} from "../content/content-format.mjs";
import { inferredQuestionPracticeScope } from "../content/question-pool.mjs";
import {
  contentScopeAllowsRegisteredSubject,
  normalizeRegisteredContentScope,
  REGISTERED_EXAM_TYPES,
  REGISTERED_SUBJECTS,
} from "../study/course-contract.mjs";

const SUBJECTS = REGISTERED_SUBJECTS;
const EXAM_TYPES = REGISTERED_EXAM_TYPES;
const CIRCLED = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n").trim();
}

function firstDefined(row, ...keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null) return row[key];
  }
  return undefined;
}

function jsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function uniqueStrings(value) {
  return [...new Set(jsonArray(value).map(text).filter(Boolean))];
}

function integer(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function booleanInteger(value, fallback = 1) {
  if (value === undefined || value === null || value === "") return fallback;
  if (value === false || value === 0 || value === "0" || value === "false") return 0;
  return 1;
}

function normalizeScope(value, examTypes = EXAM_TYPES) {
  const scope = normalizeRegisteredContentScope(value);
  return examTypes.find((examType) => examType.toLowerCase() === scope.toLowerCase()) ?? scope;
}

function normalizeQuestionKind(value, answerCount) {
  const kind = text(value).toLowerCase();
  if (kind === "descriptive" || kind === "essay" || kind === "practical") {
    return "descriptive";
  }
  if (kind === "multiple" || kind === "multiple_answer") return "multiple";
  if (
    kind === "single"
    || kind === "multiple_choice"
    || kind === "objective"
    || kind === "single_choice"
  ) {
    return answerCount > 1 ? "multiple" : "single";
  }
  return kind;
}

function normalizeCriteria(value) {
  return [...new Set(jsonArray(value).map((criterion) => {
    if (typeof criterion === "string") return text(criterion);
    if (!isRecord(criterion)) return "";
    const item = text(criterion.item);
    const description = text(criterion.description);
    const weight = Number(criterion.weight);
    return [
      item,
      Number.isFinite(weight) ? `(${weight}%)` : "",
      description ? `: ${description}` : "",
    ].filter(Boolean).join(" ");
  }).filter(Boolean))];
}

function cleanLearnerContent(value) {
  return stripSourceArtifactAppendix(
    stripProblemApplicationSection(text(value)),
  ).trim();
}

function normalizePrompt(row, databaseShape) {
  const storedPrompt = text(firstDefined(row, "prompt", "title"));
  if (databaseShape) return normalizeMarkdownProse(storedPrompt);
  const title = text(firstDefined(row, "title", "prompt"));
  const conditions = text(row.conditions);
  if (
    !conditions
    || normalizeComparableContent(title).includes(normalizeComparableContent(conditions))
  ) {
    return normalizeMarkdownProse(title);
  }
  return normalizeMarkdownProse(`${title}\n\n## 조건\n\n${conditions}`);
}

function objectiveExplanation(row, choices, correctAnswers, databaseShape) {
  const explanation = cleanLearnerContent(row.explanation);
  if (
    databaseShape
    || /^\s*#{1,6}\s+(?:정답|정답\s*및\s*해설|상세\s*해설)(?:\s|$)/imu.test(explanation)
  ) {
    return normalizeExplanationMarkdown(explanation);
  }
  const answerLines = correctAnswers.map((answer) => {
    const label = CIRCLED[answer] ?? `${answer + 1}번`;
    const choice = text(choices[answer]);
    return /^\s{0,3}(?:```|~~~)/u.test(choice)
      ? `${label}\n\n${choice}`
      : `${label} ${choice}`.trim();
  });
  return normalizeExplanationMarkdown([
    "## 정답",
    answerLines.join("\n\n"),
    "## 상세 해설",
    explanation,
  ].filter(Boolean).join("\n\n"));
}

function descriptiveExplanation(row, databaseShape) {
  const explanation = cleanLearnerContent(row.explanation);
  if (
    databaseShape
    || /^\s*#{1,6}\s+(?:모범답안|모범답안과\s*상세\s*해설)\b/imu.test(explanation)
  ) {
    return normalizeExplanationMarkdown(explanation);
  }
  const modelAnswer = cleanLearnerContent(
    firstDefined(row, "modelAnswer", "model_answer", "answerExample")
      || extractModelAnswer(explanation),
  );
  const sections = ["## 모범답안과 상세 해설", modelAnswer];
  if (
    explanation
    && !areEquivalentContents(explanation, modelAnswer)
    && !normalizeComparableContent(modelAnswer).includes(
      normalizeComparableContent(explanation),
    )
  ) {
    sections.push("## 핵심 해설", explanation);
  }
  return normalizeExplanationMarkdown(sections.filter(Boolean).join("\n\n"));
}

function deriveRequiredConcepts(row, modelAnswer) {
  const explicit = uniqueStrings(firstDefined(row, "required_concepts", "requiredConcepts"));
  if (explicit.length) return explicit;
  const prose = cleanLearnerContent(modelAnswer)
    .replace(/^\s*(?:```|~~~)[^\n]*$/gm, " ")
    .replace(/\*\*[^*]+\*\*/g, " ");
  const concepts = prose
    .split(/\n+|(?<=[.!?])\s+/u)
    .map((line) => line.replace(/^\s*(?:[-*+]|\d+[.)])\s*/, "").trim())
    .filter((line) => line.length >= 10 && line.length <= 240)
    .filter((line) => !/^(?:SELECT|INSERT|UPDATE|DELETE|MERGE|WITH|FROM|WHERE|AND|OR)\b/i.test(line))
    .slice(0, 6);
  if (!concepts.length) {
    for (const fallback of [text(row.topic), text(row.category)]) {
      if (fallback && !concepts.includes(fallback)) concepts.push(fallback);
    }
  }
  return concepts.slice(0, 6);
}

export function normalizeQuestionImportRow(
  value,
  index = 0,
  importedAt = new Date().toISOString(),
  contract = {},
) {
  if (!isRecord(value)) throw new Error(`문제 ${index + 1}: 객체 형식이 아닙니다.`);
  const row = value;
  const databaseShape = [
    "display_order",
    "exam_scope",
    "correct_answers",
    "theory_id",
  ].some((key) => Object.hasOwn(row, key));
  const choices = jsonArray(row.choices).map(text);
  const correctAnswers = jsonArray(
    firstDefined(row, "correct_answers", "correctAnswers"),
  ).map(Number).filter(Number.isInteger);
  const kind = normalizeQuestionKind(
    firstDefined(row, "kind", "questionType"),
    correctAnswers.length,
  );
  const explanation = kind === "descriptive"
    ? descriptiveExplanation(row, databaseShape)
    : objectiveExplanation(row, choices, correctAnswers, databaseShape);
  const modelAnswer = kind === "descriptive"
    ? cleanLearnerContent(
        firstDefined(row, "modelAnswer", "model_answer", "answerExample")
          || extractModelAnswer(explanation),
      )
    : "";
  const criteria = normalizeCriteria(
    firstDefined(row, "scoring_criteria", "scoringCriteria", "gradingCriteria"),
  );

  const normalized = {
    id: integer(row.id),
    category: text(row.category)
      || (contract.subjects ?? SUBJECTS)[integer(row.subject) - 1]
      || "",
    topic: text(row.topic),
    display_order: integer(
      firstDefined(row, "display_order", "displayOrder"),
      index + 1,
    ),
    exam_scope: normalizeScope(
      firstDefined(row, "exam_scope", "examScope"),
      contract.examTypes,
    ),
    difficulty: text(row.difficulty),
    difficulty_rationale: text(firstDefined(
      row,
      "difficulty_rationale",
      "difficultyRationale",
    )),
    kind,
    prompt: normalizePrompt(row, databaseShape),
    choices: JSON.stringify(kind === "descriptive" ? [] : choices),
    correct_answers: JSON.stringify(kind === "descriptive" ? [] : correctAnswers),
    explanation,
    tags: JSON.stringify(uniqueStrings(row.tags).length
      ? uniqueStrings(row.tags)
      : [text(row.topic), text(row.category)].filter(Boolean)),
    scoring_criteria: JSON.stringify(kind === "descriptive" ? criteria : []),
    required_concepts: JSON.stringify(
      kind === "descriptive" ? deriveRequiredConcepts(row, modelAnswer) : [],
    ),
    acceptable_alternatives: JSON.stringify(uniqueStrings(firstDefined(
      row,
      "acceptable_alternatives",
      "acceptableAlternatives",
      "acceptedAlternatives",
    ))),
    deduction_conditions: JSON.stringify(uniqueStrings(firstDefined(
      row,
      "deduction_conditions",
      "deductionConditions",
    ))),
    error_conditions: JSON.stringify(uniqueStrings(firstDefined(
      row,
      "error_conditions",
      "errorConditions",
    ))),
    theory_id: (() => {
      const theoryId = firstDefined(row, "theory_id", "theoryId");
      return theoryId === null || theoryId === undefined || theoryId === ""
        ? null
        : integer(theoryId);
    })(),
    practice_scope: "general",
    bookmarked: 0,
    active: booleanInteger(row.active, 1),
    created_at: text(firstDefined(row, "created_at", "createdAt")) || importedAt,
    updated_at: text(firstDefined(row, "updated_at", "updatedAt")) || importedAt,
  };
  normalized.practice_scope = inferredQuestionPracticeScope({
    ...normalized,
    practice_scope: firstDefined(row, "practice_scope", "practiceScope"),
  });
  if (!contentScopeAllowsRegisteredSubject(normalized.exam_scope, normalized.category)) {
    throw new Error(`문제 ${index + 1}: 시험 범위와 과목 조합이 유효하지 않습니다.`);
  }
  return normalized;
}

export function normalizeTheoryImportRow(
  value,
  index = 0,
  importedAt = new Date().toISOString(),
  contract = {},
) {
  if (!isRecord(value)) throw new Error(`이론 ${index + 1}: 객체 형식이 아닙니다.`);
  const row = value;
  const normalized = {
    id: integer(row.id),
    title: text(row.title),
    category: text(row.category)
      || (contract.subjects ?? SUBJECTS)[integer(row.subject) - 1]
      || "",
    topic: text(row.topic),
    sort_order: integer(firstDefined(row, "sort_order", "sortOrder"), index + 1),
    exam_scope: normalizeScope(
      firstDefined(row, "exam_scope", "examScope"),
      contract.examTypes,
    ),
    difficulty: "",
    active: booleanInteger(row.active, 1),
    summary: text(row.summary),
    content: stripTheoryDifficultyMetadata(text(row.content)),
    review_answers: text(firstDefined(row, "review_answers", "reviewAnswers")),
    keywords: JSON.stringify(uniqueStrings(row.keywords)),
    created_at: text(firstDefined(row, "created_at", "createdAt")) || importedAt,
    updated_at: text(firstDefined(row, "updated_at", "updatedAt")) || importedAt,
  };
  if (!contentScopeAllowsRegisteredSubject(normalized.exam_scope, normalized.category)) {
    throw new Error(`이론 ${index + 1}: 시험 범위와 과목 조합이 유효하지 않습니다.`);
  }
  return normalized;
}

export function normalizeSwQuestionImportRow(value, index = 0, importedAt = new Date().toISOString()) {
  if (!isRecord(value)) throw new Error(`SW 문제 ${index + 1}: 객체 형식이 아닙니다.`);
  const row = value;
  const choices = jsonArray(row.choices).map(text);
  const correctAnswers = jsonArray(firstDefined(row, "correct_answers", "correctAnswers"))
    .map(Number).filter(Number.isInteger);
  return {
    id: text(row.id),
    theory_id: integer(firstDefined(row, "theory_id", "theoryId")),
    subject_group_id: text(firstDefined(row, "subject_group_id", "subjectGroupId")),
    subject_id: text(firstDefined(row, "subject_id", "subjectId")),
    category: text(row.category),
    topic: text(row.topic),
    display_order: integer(firstDefined(row, "display_order", "displayOrder"), index + 1),
    difficulty: text(row.difficulty),
    difficulty_rationale: text(firstDefined(row, "difficulty_rationale", "difficultyRationale")),
    kind: correctAnswers.length > 1 || text(row.kind) === "multiple" ? "multiple" : "single",
    prompt: normalizeMarkdownProse(text(row.prompt)),
    choices: JSON.stringify(choices),
    correct_answers: JSON.stringify(correctAnswers),
    explanation: normalizeExplanationMarkdown(text(row.explanation)),
    tags: JSON.stringify(uniqueStrings(row.tags)),
    required_concepts: JSON.stringify(uniqueStrings(firstDefined(row, "required_concepts", "requiredConcepts"))),
    active: booleanInteger(row.active, 1),
    created_at: text(firstDefined(row, "created_at", "createdAt")) || importedAt,
    updated_at: text(firstDefined(row, "updated_at", "updatedAt")) || importedAt,
  };
}

export function normalizeSwTheoryImportRow(value, index = 0, importedAt = new Date().toISOString()) {
  if (!isRecord(value)) throw new Error(`SW 이론 ${index + 1}: 객체 형식이 아닙니다.`);
  const row = value;
  return {
    id: integer(row.id),
    subject_group_id: text(firstDefined(row, "subject_group_id", "subjectGroupId")),
    subject_id: text(firstDefined(row, "subject_id", "subjectId")),
    category: text(row.category),
    topic: text(row.topic),
    title: text(row.title),
    summary: text(row.summary),
    content: text(row.content),
    review_answers: text(firstDefined(row, "review_answers", "reviewAnswers")),
    keywords: JSON.stringify(uniqueStrings(row.keywords)),
    sort_order: integer(firstDefined(row, "sort_order", "sortOrder"), index + 1),
    active: booleanInteger(row.active, 1),
    created_at: text(firstDefined(row, "created_at", "createdAt")) || importedAt,
    updated_at: text(firstDefined(row, "updated_at", "updatedAt")) || importedAt,
  };
}

export function normalizeContentImport(
  value,
  importedAt = new Date().toISOString(),
  contract = {},
) {
  let source;
  let sourceFormat = "content";
  if (Array.isArray(value)) {
    source = { questions: value };
    sourceFormat = "question-array";
  } else if (isRecord(value)) {
    source = isRecord(value.data)
      && (
        Array.isArray(value.data.questions)
        || Array.isArray(value.data.theories)
        || Array.isArray(value.data.swQuestions)
        || Array.isArray(value.data.swTheories)
      )
      ? value.data
      : value;
    sourceFormat = Array.isArray(source.questions) && source.questions.some((row) => (
      isRecord(row) && (
        Object.hasOwn(row, "examScope")
        || Object.hasOwn(row, "correctAnswers")
        || Object.hasOwn(row, "theoryId")
      )
    ))
      ? "application-question-bank"
      : "database-export";
  } else {
    throw new Error("가져오기 파일 형식이 유효하지 않습니다.");
  }

  const hasQuestions = Array.isArray(source.questions);
  const hasTheories = Array.isArray(source.theories);
  const swQuestionSource = source.swQuestions ?? source.sw_questions;
  const swTheorySource = source.swTheories ?? source.sw_theories;
  const hasSwQuestions = Array.isArray(swQuestionSource);
  const hasSwTheories = Array.isArray(swTheorySource);
  if (!hasQuestions && !hasTheories && !hasSwQuestions && !hasSwTheories) {
    throw new Error("SQL·DA 또는 SW 문제·이론 데이터 배열이 없습니다.");
  }
  const questions = hasQuestions
    ? source.questions.map((row, index) => normalizeQuestionImportRow(row, index, importedAt, contract))
    : [];
  const theories = hasTheories
    ? source.theories.map((row, index) => normalizeTheoryImportRow(row, index, importedAt, contract))
    : [];
  const swQuestions = hasSwQuestions
    ? swQuestionSource.map((row, index) => normalizeSwQuestionImportRow(row, index, importedAt))
    : [];
  const swTheories = hasSwTheories
    ? swTheorySource.map((row, index) => normalizeSwTheoryImportRow(row, index, importedAt))
    : [];
  if (!questions.length && !theories.length && !swQuestions.length && !swTheories.length) {
    throw new Error("SQL·DA 또는 SW 문제·이론 데이터가 없습니다.");
  }
  return {
    questions,
    theories,
    swQuestions,
    swTheories,
    includedData: [
      ...(hasTheories ? ["theories"] : []),
      ...(hasQuestions ? ["questions"] : []),
      ...(hasSwTheories ? ["sw_theories"] : []),
      ...(hasSwQuestions ? ["sw_questions"] : []),
    ],
    sourceFormat,
  };
}

export function hasBalancedMarkdownFences(value) {
  const markers = String(value ?? "")
    .split(/\r?\n/u)
    .filter((line) => /^\s{0,3}(?:```|~~~)/u.test(line));
  return markers.length % 2 === 0;
}
