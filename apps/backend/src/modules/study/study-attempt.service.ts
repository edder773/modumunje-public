import {
  DEFAULT_EXAM_TYPE,
  RELEASED_EXAM_TYPES,
  examDisplayName,
  examScopeAllows,
  isReleasedExamType,
  isObjectiveKind,
  parseJson,
  selfAssessmentVerdict,
  type ExamType,
  uniqueStrings,
} from "./domain/study.domain";
import { normalizeExplanationMarkdown } from "@shared/content/content-format.mjs";
import type { StudyRepository } from "./study.repository";
import type { PracticeAttemptContext } from "./study-attempt.repository-query";
import { decidePracticeFeedbackAccess } from "./study-feedback-authorization";

import { gradePracticalAnswer } from "./ipe-practical-grading";
import { hasPracticalAnswer } from "@shared/study/practical-answer-fields";
import { isGuestLearningKey } from "@backend/common/auth/guest-learning-session";

type JsonRecord = Record<string, unknown>;

const ATTEMPT_OPERATION_ID = /^[a-zA-Z0-9_-]{12,80}$/u;
const OBJECTIVE_ATTEMPT_MODES = new Set([
  "practice",
  "bookmark-practice",
  "bookmark-modal",
  "incorrect-review",
]);
const SELF_ASSESSMENT_MODES = new Set([
  "self-assessment",
  "bookmark-self-assessment",
  "bookmark-modal-self-assessment",
]);
const MAX_ANSWER_TEXT_BYTES = 16_384;

export class StudyRequestError extends Error {
  constructor(
    readonly status: number,
    readonly publicMessage: string,
    internalMessage = publicMessage,
    readonly code = status === 404 ? "STUDY_RESOURCE_NOT_FOUND" : "STUDY_REQUEST_INVALID",
  ) {
    super(internalMessage);
    this.name = "StudyRequestError";
  }
}

function list(value: unknown) {
  if (Array.isArray(value)) return value;
  return parseJson<unknown[]>(value, []);
}

function numberList(value: unknown) {
  return list(value).map(Number).filter(Number.isInteger);
}

function sameAnswers(first: number[], second: number[]) {
  return first.length === second.length && first.every((answer, index) => answer === second[index]);
}

function requiredString(value: unknown, field: string) {
  const result = typeof value === "string" ? value.trim() : "";
  if (!result) {
    throw new StudyRequestError(
      400,
      "풀이 저장 식별자가 필요합니다.",
      `${field} is required`,
    );
  }
  return result;
}

function selectedExamType(value: unknown): ExamType {
  if (value === undefined || value === null || value === "") return DEFAULT_EXAM_TYPE;
  if (isReleasedExamType(value)) return value;
  throw new StudyRequestError(
    400,
    `지원하지 않는 시험 유형입니다. ${RELEASED_EXAM_TYPES.map(examDisplayName).join(" 또는 ")}를 선택해 주세요.`,
    `unsupported exam type: ${String(value)}`,
  );
}

export function questionFeedbackPayload(question: {
  correctAnswers: unknown;
  explanation: string;
  scoringCriteria: unknown;
  requiredConcepts: unknown;
  acceptableAlternatives: unknown;
  deductionConditions: unknown;
  errorConditions: unknown;
}) {
  return {
    correctAnswers: [...new Set(numberList(question.correctAnswers))]
      .sort((first, second) => first - second),
    explanation: normalizeExplanationMarkdown(question.explanation),
    scoringCriteria: uniqueStrings(question.scoringCriteria),
    requiredConcepts: uniqueStrings(question.requiredConcepts),
    acceptableAlternatives: uniqueStrings(question.acceptableAlternatives),
    deductionConditions: uniqueStrings(question.deductionConditions),
    errorConditions: uniqueStrings(question.errorConditions),
  };
}

export async function readAuthorizedPracticeQuestion(input: {
  key: string;
  questionId: number;
  feedbackAuthorization: unknown;
  repository: Pick<StudyRepository, "findPracticeAttemptContext">;
  context?: PracticeAttemptContext;
}) {
  const authorizationDecision = await decidePracticeFeedbackAccess({
    userKey: input.key,
    engine: "sql",
    questionId: input.questionId,
    authorization: input.feedbackAuthorization,
    blockingExamItem: null,
  });
  if (!authorizationDecision.allowed) {
    throw new StudyRequestError(
      403,
      "이 문항의 정답과 해설을 확인할 권한이 없거나 아직 공개되지 않았습니다.",
      `practice feedback denied: ${authorizationDecision.reason}`,
      "STUDY_FEEDBACK_FORBIDDEN",
    );
  }
  const context = input.context
    ?? await input.repository.findPracticeAttemptContext(input.key, input.questionId);
  if (context.blockingExamItem) {
    throw new StudyRequestError(
      403,
      "이 문항의 정답과 해설을 확인할 권한이 없거나 아직 공개되지 않았습니다.",
      "practice feedback denied: EXAM_FEEDBACK_NOT_RELEASED",
      "STUDY_FEEDBACK_FORBIDDEN",
    );
  }
  return context.question;
}

export async function saveLearningAttempt(input: {
  action: "attempt" | "self-assessment" | "short-answer";
  payload: JsonRecord;
  key: string;
  adminActivity: boolean;
  repository: StudyRepository;
  practiceContext?: PracticeAttemptContext;
}) {
  const { action, payload, key, adminActivity, repository, practiceContext } = input;
  const questionId = Number(payload.questionId);
  if (!Number.isInteger(questionId) || questionId <= 0) {
    throw new StudyRequestError(400, "유효한 문항이 필요합니다.", `invalid question id: ${String(payload.questionId)}`);
  }
  const selectedExam = selectedExamType(payload.examType);
  const question = await readAuthorizedPracticeQuestion({
    key,
    questionId,
    feedbackAuthorization: payload.feedbackAuthorization,
    repository,
    context: practiceContext,
  });
  if (!question || !examScopeAllows(question.examScope, selectedExam)) {
    throw new StudyRequestError(404, "현재 과정에서 학습할 수 있는 문항을 찾지 못했습니다.", `inactive or out-of-scope question: ${questionId}`);
  }
  const clientOperationId = requiredString(payload.clientOperationId, "clientOperationId");
  if (!ATTEMPT_OPERATION_ID.test(clientOperationId)) {
    throw new StudyRequestError(400, "풀이 저장 식별자가 올바르지 않습니다.", "invalid client operation id");
  }
  const mode = typeof payload.mode === "string" ? payload.mode : "";
  let selectedAnswers: number[] = [];
  let result: "correct" | "partial" | "incorrect";
  let score: number;
  let answerText = "";
  let evaluationId: number | null = null;
  let grading: Awaited<ReturnType<typeof gradePracticalAnswer>> = null;

  if (action === "short-answer") {
    if (selectedExam !== "IPEP" || !OBJECTIVE_ATTEMPT_MODES.has(mode)) {
      throw new StudyRequestError(400, "실기 단답형 풀이 방식이 올바르지 않습니다.");
    }
    answerText = typeof payload.answerText === "string" ? payload.answerText : "";
    if (!hasPracticalAnswer(answerText) || new TextEncoder().encode(answerText).byteLength > MAX_ANSWER_TEXT_BYTES) {
      throw new StudyRequestError(400, "답안은 16KB 이내로 입력해 주세요.");
    }
    const graded = await gradePracticalAnswer(question, answerText);
    if (!graded) throw new StudyRequestError(409, "이 문항의 정답 기준을 확인 중입니다. 다른 문제를 선택해 주세요.", "practical answer policy missing or stale", "STUDY_ANSWER_POLICY_STALE");
    result = graded.result;
    score = graded.score;
    grading = graded;
  } else if (action === "attempt") {
    if (!isObjectiveKind(question.kind)) {
      throw new StudyRequestError(400, "객관식 문항은 객관식 풀이로 저장해 주세요.", `objective attempt used for ${question.kind}`);
    }
    if (!OBJECTIVE_ATTEMPT_MODES.has(mode)) {
      throw new StudyRequestError(400, "지원하지 않는 풀이 방식입니다.", `unsupported attempt mode: ${mode}`);
    }
    const choices = list(question.choices);
    selectedAnswers = [...new Set(numberList(payload.selectedAnswers))].sort((first, second) => first - second);
    const expected = [...new Set(numberList(question.correctAnswers))].sort((first, second) => first - second);
    const choicesValid = selectedAnswers.length > 0
      && selectedAnswers.every((answer) => answer >= 0 && answer < choices.length)
      && (question.kind !== "single" || selectedAnswers.length === 1);
    if (!choicesValid) {
      throw new StudyRequestError(400, "선택한 답안이 문항의 선택지 범위를 벗어났습니다.", `invalid selected answers for question ${questionId}`);
    }
    const correct = sameAnswers(selectedAnswers, expected);
    result = correct ? "correct" : "incorrect";
    score = correct ? 100 : 0;
  } else {
    if (selectedExam === "IPEP") {
      throw new StudyRequestError(400, "실기는 답안을 제출해 정답 일치 여부를 확인해 주세요.");
    }
    if (question.kind !== "descriptive") {
      throw new StudyRequestError(400, "서술형 문항만 자기평가로 저장할 수 있습니다.", `self assessment used for ${question.kind}`);
    }
    if (!SELF_ASSESSMENT_MODES.has(mode)) {
      throw new StudyRequestError(400, "지원하지 않는 자기평가 방식입니다.", `unsupported self assessment mode: ${mode}`);
    }
    answerText = typeof payload.answerText === "string" ? payload.answerText.trim() : "";
    if (!answerText || new TextEncoder().encode(answerText).byteLength > MAX_ANSWER_TEXT_BYTES) {
      throw new StudyRequestError(400, "서술형 답안은 16KB 이내로 입력해 주세요.", "answer text is empty or too large");
    }
    score = Number(payload.score);
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      throw new StudyRequestError(400, "자기평가 점수는 0점부터 100점 사이여야 합니다.", `invalid self score: ${String(payload.score)}`);
    }
    score = Math.round(score);
    result = selfAssessmentVerdict(score);
    const requestedEvaluationId = Number(payload.evaluationId);
    if (Number.isInteger(requestedEvaluationId) && requestedEvaluationId > 0) {
      const owned = await repository.findOwnedEvaluation(key, requestedEvaluationId, questionId);
      if (!owned) {
        throw new StudyRequestError(400, "이 문항에 연결된 평가 기록을 찾지 못했습니다.", `invalid evaluation ownership: ${requestedEvaluationId}`);
      }
      evaluationId = requestedEvaluationId;
    }
  }

  if (isGuestLearningKey(key)) {
    return Response.json({
      attempt: { id: -Date.now(), questionId, selectedAnswers, correct: result === "correct",
        mode, examType: selectedExam, result, score, answerText, evaluationId,
        reviewStatus: result === "correct" ? "mastered" : "pending", clientOperationId,
        createdAt: new Date().toISOString() },
      feedback: questionFeedbackPayload(question), ...(grading ? { grading } : {}),
      duplicate: false, temporary: true,
    }, { status: 200, headers: { "Cache-Control": "private, no-store" } });
  }
  const stored = await repository.insertAttemptIdempotent({
    questionId,
    selectedAnswers: JSON.stringify(selectedAnswers),
    correct: result === "correct",
    mode,
    userKey: key,
    examType: selectedExam,
    result,
    score,
    answerText,
    evaluationId,
    reviewStatus: result === "correct" ? "mastered" : "pending",
    isAdmin: adminActivity,
    clientOperationId,
  });
  if (stored.conflict) {
    throw new StudyRequestError(
      409,
      "같은 풀이 저장 식별자가 다른 답안에 사용되었습니다. 화면을 새로고침한 뒤 다시 풀어 주세요.",
      `attempt operation reused with different payload: ${clientOperationId}`,
      "STUDY_IDEMPOTENCY_CONFLICT",
    );
  }
  const attempt = stored.attempt;
  return Response.json({
    attempt: {
      ...attempt,
      selectedAnswers: numberList(attempt.selectedAnswers),
      correct: Boolean(attempt.correct),
    },
    feedback: questionFeedbackPayload(question),
    ...(grading ? { grading } : {}),
    duplicate: !stored.created,
  }, { status: stored.created ? 201 : 200 });
}
