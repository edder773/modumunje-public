import { practicalPastQuestion } from "@shared/study/ipe-practical-past.mjs";
import {
  normalizeExplanationMarkdown,
  normalizeMarkdownProse,
} from "@shared/content/content-format.mjs";
import {
  parseJson,
  questionAllowedForExam,
  type ExamType,
  type QuestionKind,
  uniqueStrings,
} from "./domain/study.domain";
import type {
  QuestionDeliveryRow,
  QuestionRow,
  StudyRepository,
} from "./study.repository";
import { issuePracticeFeedbackAuthorization } from "./study-feedback-authorization";
import type { RecordQuestionDeliveryRow } from "./study-records.repository-queries";
import { readPublicContentCache } from "@backend/common/content/public-content-cache";

import { practicalAnswerInput } from "./ipe-practical-grading";
import { reviewedPracticalPrompt } from "./practical-question-presentation";

function values(value: unknown) {
  return Array.isArray(value) ? value : parseJson<unknown[]>(value, []);
}

export function parseQuestionDelivery(row: QuestionDeliveryRow, bookmarked = false) {
  return {
    ...row,
    kind: row.kind as QuestionKind,
    shortAnswerInput: practicalAnswerInput(row.id, row.examScope),
    historicalExam: row.examScope === "IPEP" ? practicalPastQuestion(row.id) : undefined,
    prompt: reviewedPracticalPrompt(row.id, row.prompt) ?? normalizeMarkdownProse(row.prompt),
    choices: values(row.choices).map(String),
    tags: uniqueStrings(row.tags),
    bookmarked,
    active: Boolean(row.active),
  };
}

export function parseQuestion(row: QuestionRow, bookmarked = false) {
  return {
    ...parseQuestionDelivery(row, bookmarked),
    explanation: normalizeExplanationMarkdown(row.explanation),
    correctAnswers: values(row.correctAnswers).map(Number).filter(Number.isInteger),
    scoringCriteria: uniqueStrings(row.scoringCriteria),
    requiredConcepts: uniqueStrings(row.requiredConcepts),
    acceptableAlternatives: uniqueStrings(row.acceptableAlternatives),
    deductionConditions: uniqueStrings(row.deductionConditions),
    errorConditions: uniqueStrings(row.errorConditions),
  };
}

export function questionAttemptPayload(question: ReturnType<typeof parseQuestionDelivery>) {
  return {
    id: question.id,
    category: question.category,
    topic: question.topic,
    displayOrder: question.displayOrder,
    examScope: question.examScope,
    difficulty: question.difficulty,
    difficultyRationale: question.difficultyRationale,
    kind: question.kind,
    shortAnswerInput: question.shortAnswerInput,
    historicalExam: question.historicalExam,
    prompt: question.prompt,
    choices: question.choices,
    tags: question.tags,
    theoryId: question.theoryId,
    practiceScope: question.practiceScope,
    variantGroupId: question.variantGroupId,
    bookmarked: question.bookmarked,
    active: question.active,
    createdAt: question.createdAt,
    updatedAt: question.updatedAt,
  };
}

export async function withPracticeFeedbackAuthorization<T extends { id: number }>(
  questions: T[],
  key: string | undefined,
  repository: Pick<StudyRepository, "findPracticeBlockedQuestionIds">,
  knownBlockedIds?: readonly number[],
) {
  if (!key) return questions;
  const blocked = new Set(knownBlockedIds ?? await repository.findPracticeBlockedQuestionIds(
    key, questions.map((question) => question.id),
  ));
  return Promise.all(questions.map(async (question) => ({
    ...question,
    ...(!blocked.has(question.id)
      ? { feedbackAuthorization: await issuePracticeFeedbackAuthorization(key, "sql", question.id) }
      : {}),
  })));
}

export async function recordQuestionPayloadsFromRows(
  ids: number[],
  key: string,
  rows: RecordQuestionDeliveryRow[],
) {
  if (!ids.length) return [];
  const bookmarkedIds = rows.filter((row) => Boolean(row.recordBookmarked)).map((row) => row.id);
  const blockedIds = new Set(rows.filter((row) => Boolean(row.recordBlocked)).map((row) => row.id));
  const questions = orderedQuestionDeliveries(ids, rows, bookmarkedIds).map(questionAttemptPayload);
  return Promise.all(questions.map(async (question) => ({
    ...question,
    ...(!blockedIds.has(question.id)
      ? { feedbackAuthorization: await issuePracticeFeedbackAuthorization(key, "sql", question.id) }
      : {}),
  })));
}

export function requestedNumericIds(searchParams: URLSearchParams, limit = 100) {
  return [...new Set(
    (searchParams.get("ids") ?? "")
      .split(",")
      .map(Number)
      .filter((id) => Number.isInteger(id) && id > 0),
  )].slice(0, limit);
}

export async function questionRowsByIds(
  repository: StudyRepository,
  ids: number[],
  key: string | undefined,
  includeFeedback: true,
  knownBookmarkedIds?: readonly number[],
): Promise<ReturnType<typeof parseQuestion>[]>;
export async function questionRowsByIds(
  repository: StudyRepository,
  ids: number[],
  key?: string,
  includeFeedback?: false,
  knownBookmarkedIds?: readonly number[],
): Promise<ReturnType<typeof questionAttemptPayload>[]>;
export async function questionRowsByIds(
  repository: StudyRepository,
  ids: number[],
  key?: string,
  includeFeedback = false,
  knownBookmarkedIds?: readonly number[],
) {
  if (!ids.length) return [];
  const { rows: deliveryRows, bookmarkedIds } = await repository.findActiveQuestionsByIds(ids, key, {
    knownBookmarkedIds,
  });
  if (!includeFeedback) {
    return orderedQuestionDeliveries(ids, deliveryRows, bookmarkedIds).map(questionAttemptPayload);
  }
  const rows = await repository.findFeedbackQuestionsByIds(ids);
  return orderedParsedQuestions(ids, rows, bookmarkedIds);
}

function orderedQuestionDeliveries(
  ids: number[],
  rows: QuestionDeliveryRow[],
  bookmarkedIds: readonly number[],
) {
  const bookmarked = new Set(bookmarkedIds);
  const byId = new Map(rows.map((row) => {
    const question = parseQuestionDelivery(row, bookmarked.has(row.id));
    return [row.id, question] as const;
  }));
  return ids.map((id) => byId.get(id)).filter((row): row is NonNullable<typeof row> => Boolean(row));
}

function orderedParsedQuestions(
  ids: number[],
  rows: QuestionRow[],
  bookmarkedIds: readonly number[],
) {
  const bookmarked = new Set(bookmarkedIds);
  const byId = new Map(rows.map((row) => {
    const question = parseQuestion(row, bookmarked.has(row.id));
    return [row.id, question] as const;
  }));
  return ids.map((id) => byId.get(id)).filter((row): row is NonNullable<typeof row> => Boolean(row));
}

function emptyPayload(settings: { selectedExam: string }) {
  return {
    questions: [],
    theories: [],
    attempts: [],
    examSessions: [],
    theoryProgress: [],
    evaluations: [],
    settings,
  };
}

export async function readPracticeMeta(
  repository: StudyRepository,
  key: string | undefined,
  selectedExam: ExamType,
  contentRevision = "",
) {
  const publicRead = contentRevision
    ? readPublicContentCache({
        namespace: "practice-meta",
        key: selectedExam,
        revision: contentRevision,
        loader: () => repository.findPracticeMeta(selectedExam),
      })
    : repository.findPracticeMeta(selectedExam);
  const [publicMeta, setting] = await Promise.all([
    publicRead,
    key ? repository.readUserSetting(key) : Promise.resolve({ selectedExam }),
  ]);
  const meta = {
    ...publicMeta,
    setting,
  };
  return {
    ...emptyPayload(meta.setting),
    practiceMeta: {
      counts: meta.rows.map((row) => ({
        category: row.category,
        difficulty: row.difficulty,
        kind: row.kind,
        count: Number(row.item_count ?? 0),
        eligibleGroupCount: Number(row.eligible_group_count ?? 0),
      })),
      summary: {
        questionCount: Number(meta.summary.item_count ?? 0),
        eligibleGroupCount: Number(meta.summary.eligible_group_count ?? 0),
      },
    },
  };
}

export async function readQuestionSelection(
  repository: StudyRepository,
  key: string | undefined,
  selectedExam: ExamType,
  searchParams: URLSearchParams,
) {
  const ids = requestedNumericIds(searchParams);
  const context = await repository.findActiveQuestionsByIds(ids, key, {
    includeSetting: Boolean(key),
  });
  const questionRows = orderedQuestionDeliveries(ids, context.rows, context.bookmarkedIds)
    .map(questionAttemptPayload);
  const settings = context.setting ?? { selectedExam };
  const questions = questionRows.filter((question) => (
    questionAllowedForExam(question, selectedExam)
  ));
  return { ...emptyPayload(settings), questions: await withPracticeFeedbackAuthorization(questions, key, repository) };
}

export async function readPracticeBatch(
  repository: StudyRepository,
  key: string | undefined,
  selectedExam: ExamType,
  searchParams: URLSearchParams,
) {
  const category = (searchParams.get("category") ?? "").trim();
  const difficulty = (searchParams.get("difficulty") ?? "").trim();
  const kind = searchParams.get("kind") ?? "objective";
  const theoryId = Number(searchParams.get("theoryId"));
  const bookmarkOnly = searchParams.get("bookmarks") === "1";
  const excluded = requestedNumericIds(
    new URLSearchParams({ ids: searchParams.get("exclude") ?? "" }),
    100,
  );
  const requestedLimit = Number(searchParams.get("limit") ?? "5");
  const limit = Math.min(12, Math.max(
    1,
    Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 5,
  ));
  if (bookmarkOnly && !key) return { ...emptyPayload({ selectedExam }), questions: [] };
  const candidateInput = {
    selectedExam,
    category,
    difficulty,
    kind,
    theoryId,
    bookmarkUserKey: bookmarkOnly ? key : undefined,
    excludedIds: excluded,
    excludedVariantGroupIds: [],
    limit,
  };
  const { rows, setting: settings } = key
    ? await repository.findPracticeQuestionsWithSetting(candidateInput, key)
    : { rows: await repository.findPracticeQuestions(candidateInput), setting: { selectedExam } };
  return {
    ...emptyPayload(settings),
    questions: await withPracticeFeedbackAuthorization(
      rows.map((row) => questionAttemptPayload(
        parseQuestionDelivery(row, Boolean(row.selectedBookmarked)),
      )),
      key,
      repository,
    ),
  };
}
