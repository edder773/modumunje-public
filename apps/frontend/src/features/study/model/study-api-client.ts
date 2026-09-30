import {
  ApiRequestError,
  requestJson,
} from "@frontend/shared/api/request-json";
import { isStudyApiPayload } from "@shared/study/study-api-contract.mjs";
import { defineLearningReadContentAdapter } from "./learning-content-adapters";

export type StudyScope =
  | "shell"
  | "overview"
  | "bootstrap"
  | "theories"
  | "theory"
  | "practice-meta"
  | "practice"
  | "questions"
  | "records"
  | "mock"
  | "mock-session";

function normalizeStudyPayload(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const record = payload as Record<string, unknown>;
  return {
    ...record,
    ...(Array.isArray(record.questions) ? { questions: record.questions.map((question) => {
      if (!question || typeof question !== "object" || Array.isArray(question)) return question;
      const row = question as Record<string, unknown>;
      return {
        ...row,
        correctAnswers: Array.isArray(row.correctAnswers) ? row.correctAnswers : [],
        explanation: typeof row.explanation === "string" ? row.explanation : "",
        scoringCriteria: Array.isArray(row.scoringCriteria) ? row.scoringCriteria : [],
        requiredConcepts: Array.isArray(row.requiredConcepts) ? row.requiredConcepts : [],
        acceptableAlternatives: Array.isArray(row.acceptableAlternatives) ? row.acceptableAlternatives : [],
        deductionConditions: Array.isArray(row.deductionConditions) ? row.deductionConditions : [],
        errorConditions: Array.isArray(row.errorConditions) ? row.errorConditions : [],
      };
    }) } : {}),
    ...(Array.isArray(record.theories) ? { theories: record.theories.map((theory) => {
      if (!theory || typeof theory !== "object" || Array.isArray(theory)) return theory;
      const row = theory as Record<string, unknown>;
      return {
        ...row,
        content: typeof row.content === "string" ? row.content : "",
        reviewAnswers: typeof row.reviewAnswers === "string" ? row.reviewAnswers : "",
        keywords: Array.isArray(row.keywords) ? row.keywords : [],
      };
    }) } : {}),
  };
}

const STUDY_CONTENT_ADAPTER = defineLearningReadContentAdapter<StudyScope>({
  engineId: "certification",
  validateRead: (scope, payload) => isStudyApiPayload(scope, payload),
  normalizeRead: normalizeStudyPayload,
});

export function withSafeStudyQuestionDefaults<T extends Record<string, unknown>>(payload: T): T {
  return STUDY_CONTENT_ADAPTER.normalizeRead(payload) as T;
}

export async function requestStudyData<T>({
  scope,
  exam,
  params = {},
  cache = "default",
  signal,
}: {
  scope: StudyScope;
  exam?: string;
  params?: Record<string, string | number>;
  cache?: RequestCache;
  signal?: AbortSignal;
}): Promise<T> {
  const search = new URLSearchParams({ scope });
  search.set("v", __BAEUMZIP_BUILD_SHA__.slice(0, 12));
  if (exam && !["shell", "overview", "bootstrap"].includes(scope)) search.set("exam", exam);
  for (const [key, value] of Object.entries(params)) search.set(key, String(value));

  const payload = await requestJson<T & Record<string, unknown>>(
        `${STUDY_CONTENT_ADAPTER.apiPath}?${search.toString()}`,
        { cache, signal },
        {
          failureMessage: "학습 데이터 요청이 실패했습니다.",
          invalidResponseMessage: "학습 데이터 응답 형식이 올바르지 않습니다.",
          maxAttempts: 2,
        },
      );
  if (!STUDY_CONTENT_ADAPTER.validateRead(scope, payload)) {
    throw new ApiRequestError(
      "학습 데이터 응답 형식이 올바르지 않습니다.",
      "INVALID_API_RESPONSE",
    );
  }
  return withSafeStudyQuestionDefaults(payload) as T;
}
