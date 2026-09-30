import { validateAdminAnswerIndices } from "@shared/admin/question-answer-input";
import {
  normalizeExplanationMarkdown,
  normalizeMarkdownProse,
  stripProblemApplicationSection,
  stripTheoryDifficultyMetadata,
} from "@shared/content/content-format.mjs";
import {
  contentScopeAllowsSubject,
  isDescriptiveAllowed,
  isExamScope,
  isSubject,
  parseJson,
  uniqueStrings,
} from "@shared/study/study-domain";
import { boundedInteger, integer } from "./admin-query-parameters";

type JsonRecord = Record<string, unknown>;

export const QUESTION_KINDS = ["single", "multiple", "descriptive"] as const;

export function requiredString(value: unknown, field: string) {
  const result = typeof value === "string" ? value.trim() : "";
  if (!result) throw new Error(`${field} 값이 필요합니다.`);
  return result;
}

export function compactText(value: unknown, limit = 220) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

export function jsonList(value: unknown) {
  if (Array.isArray(value)) return value;
  return parseJson<unknown[]>(value, []);
}

export function numberList(value: unknown) {
  return jsonList(value).map(Number).filter(Number.isInteger);
}

export function questionValues(payload: JsonRecord) {
  const rawKind = String(payload.kind);
  if (!QUESTION_KINDS.includes(rawKind as typeof QUESTION_KINDS[number])) {
    throw new Error("문제 유형이 유효하지 않습니다.");
  }
  const kind = rawKind;
  const category = requiredString(payload.category, "과목");
  if (!isSubject(category)) {
    throw new Error("과목이 유효하지 않습니다.");
  }
  const examScope = String(payload.examScope);
  if (!isExamScope(examScope)) {
    throw new Error("시험 범위가 유효하지 않습니다.");
  }
  if (!contentScopeAllowsSubject(examScope, category)) {
    throw new Error("선택한 시험 범위에 포함되지 않는 과목입니다.");
  }
  if (kind === "descriptive" && !isDescriptiveAllowed(examScope, category)) {
    throw new Error("서술형 문제는 등록된 과정의 지정 과목에서만 등록할 수 있습니다.");
  }
  const choices = jsonList(payload.choices)
    .map(String)
    .map((item) => item.trim())
    .filter(Boolean);
  if (kind !== "descriptive" && ![2, 4].includes(choices.length)) {
    throw new Error("객관식 문제에는 OX형 선택지 2개 또는 일반 선택지 4개가 필요합니다.");
  }
  const correctAnswers = validateAdminAnswerIndices(jsonList(payload.correctAnswers), choices.length, kind);
  const scoringCriteria = uniqueStrings(payload.scoringCriteria);
  const requiredConcepts = uniqueStrings(payload.requiredConcepts);
  if (kind === "descriptive" && examScope !== "IPEP" && (!scoringCriteria.length || !requiredConcepts.length)) {
    throw new Error("서술형 문제에는 채점 기준과 필수 핵심 내용이 필요합니다.");
  }
  return {
    category,
    topic: requiredString(payload.topic, "소분류"),
    examScope,
    difficulty: (() => {
      const difficulty = String(payload.difficulty);
      if (!["하", "중", "상"].includes(difficulty)) {
        throw new Error("난이도가 유효하지 않습니다.");
      }
      return difficulty;
    })(),
    difficultyRationale: compactText(payload.difficultyRationale, 600),
    kind,
    prompt: normalizeMarkdownProse(requiredString(payload.prompt, "문제 본문")),
    choices: JSON.stringify(kind === "descriptive" ? [] : choices),
    correctAnswers: JSON.stringify(correctAnswers),
    explanation: normalizeExplanationMarkdown(requiredString(
      stripProblemApplicationSection(payload.explanation),
      "해설",
    )),
    tags: JSON.stringify(uniqueStrings(payload.tags)),
    scoringCriteria: JSON.stringify(scoringCriteria),
    requiredConcepts: JSON.stringify(requiredConcepts),
    acceptableAlternatives: JSON.stringify(uniqueStrings(payload.acceptableAlternatives)),
    deductionConditions: JSON.stringify(uniqueStrings(payload.deductionConditions)),
    errorConditions: JSON.stringify(uniqueStrings(payload.errorConditions)),
    theoryId: payload.theoryId === null
      || payload.theoryId === ""
      || payload.theoryId === undefined
      ? null
      : integer(payload.theoryId),
    active: payload.active === undefined ? 1 : payload.active ? 1 : 0,
  };
}

export function theoryValues(payload: JsonRecord) {
  const category = requiredString(payload.category, "과목");
  if (!isSubject(category)) {
    throw new Error("과목이 유효하지 않습니다.");
  }
  const examScope = String(payload.examScope);
  if (!isExamScope(examScope)) {
    throw new Error("시험 범위가 유효하지 않습니다.");
  }
  if (!contentScopeAllowsSubject(examScope, category)) {
    throw new Error("선택한 시험 범위에 포함되지 않는 과목입니다.");
  }
  return {
    title: requiredString(payload.title, "이론 제목"),
    category,
    topic: requiredString(payload.topic, "소분류"),
    sortOrder: boundedInteger(payload.sortOrder, 1, 99999, 999),
    examScope,
    // The column remains for backward-compatible migrations, but theories do
    // not expose or use a learner-facing difficulty level.
    difficulty: "",
    summary: requiredString(payload.summary, "요약"),
    content: normalizeMarkdownProse(stripTheoryDifficultyMetadata(
      requiredString(payload.content, "이론 본문"),
    )),
    reviewAnswers: normalizeMarkdownProse(String(payload.reviewAnswers ?? "")),
    keywords: JSON.stringify(uniqueStrings(payload.keywords)),
    active: payload.active === undefined ? 1 : payload.active ? 1 : 0,
  };
}

export function swTheoryValues(payload: JsonRecord) {
  return {
    subjectGroupId: requiredString(payload.subjectGroupId, "SW 대분류 ID"),
    subjectId: requiredString(payload.subjectId, "SW 소분류 ID"),
    category: requiredString(payload.category, "SW 대분류"),
    topic: requiredString(payload.topic, "SW 소분류"),
    title: requiredString(payload.title, "SW 이론 제목"),
    summary: requiredString(payload.summary, "SW 이론 요약"),
    content: requiredString(payload.content, "SW 이론 본문"),
    reviewAnswers: String(payload.reviewAnswers ?? "").trim(),
    keywords: JSON.stringify(uniqueStrings(payload.keywords)),
    sortOrder: Math.max(1, integer(payload.sortOrder, 999)),
    active: payload.active === false ? 0 : 1,
  };
}
