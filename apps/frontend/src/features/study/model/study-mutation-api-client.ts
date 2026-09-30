import {
  ApiRequestError,
  requestJson,
} from "@frontend/shared/api/request-json";
import {
  isStudyMutationResponse,
  isSwStudyMutationResponse,
  validateStudyMutationRequest,
  validateSwStudyMutationRequest,
} from "@shared/study/study-mutation-contract.mjs";
import {
  defineLearningMutationContentAdapter,
  type LearningMutationContentAdapter,
  type MutationValidation,
} from "./learning-content-adapters";

import { SW_STUDY_OWNER_HEADER } from "@shared/auth/authenticated-user";
import { withSafeStudyQuestionDefaults } from "./study-api-client";

type JsonRecord = Record<string, unknown>;

export type StudyMutationAction =
  | "account-touch"
  | "guest-import"
  | "question-feedback"
  | "short-answer"
  | "attempt"
  | "self-assessment"
  | "bookmark"
  | "settings"
  | "theory-progress"
  | "exam-start"
  | "exam-save"
  | "exam-submit";

export type SwStudyMutationAction =
  | "sw-attempt"
  | "sw-progress"
  | "sw-session-save"
  | "sw-session-submit"
  | "sw-import";

const USER_MUTATION_HEADERS = {
  "Content-Type": "application/json",
  "x-sql-study-user-request": "1",
};

const STUDY_MUTATION_ADAPTER = defineLearningMutationContentAdapter<StudyMutationAction>({
  engineId: "certification",
  validateMutationRequest: (payload): MutationValidation => (
    validateStudyMutationRequest(payload) as MutationValidation
  ),
  validateMutationResponse: (action, payload) => isStudyMutationResponse(action, payload),
});

const SW_STUDY_MUTATION_ADAPTER = defineLearningMutationContentAdapter<SwStudyMutationAction>({
  engineId: "curriculum",
  validateMutationRequest: (payload): MutationValidation => (
    validateSwStudyMutationRequest(payload) as MutationValidation
  ),
  validateMutationResponse: (action, payload) => isSwStudyMutationResponse(action, payload),
});

async function requestMutation<TMutationAction extends string>(
  adapter: LearningMutationContentAdapter<TMutationAction>,
  action: TMutationAction,
  payload: JsonRecord,
  signal?: AbortSignal,
  expectedUserKey?: string,
) {
  const body = { ...payload, action };
  const contract = adapter.validateMutationRequest(body);
  if (!contract.ok) {
    throw new ApiRequestError(contract.message, contract.code);
  }
  const result = await requestJson<JsonRecord>(adapter.apiPath, {
    method: "POST",
    headers: expectedUserKey
      ? { ...USER_MUTATION_HEADERS, [SW_STUDY_OWNER_HEADER]: expectedUserKey }
      : USER_MUTATION_HEADERS,
    signal,
    body: JSON.stringify(body),
  }, {
    failureMessage: "학습 상태를 저장하지 못했습니다.",
    invalidResponseMessage: "학습 저장 응답 형식이 올바르지 않습니다.",
    maxAttempts: 1,
    totalBudgetMs: 8_000,
    attemptTimeoutMs: 7_500,
  });
  if (!adapter.validateMutationResponse(action, result)) {
    throw new ApiRequestError(
      "학습 저장 응답 형식이 올바르지 않습니다.",
      action === "exam-start" ? "INVALID_SUCCESS_CONTRACT" : "INVALID_API_RESPONSE",
    );
  }
  return result;
}

export async function requestStudyMutation<T extends object>(
  action: StudyMutationAction,
  payload: JsonRecord = {},
  signal?: AbortSignal,
) {
  const result = await requestMutation(STUDY_MUTATION_ADAPTER, action, payload, signal);
  return (action === "exam-start"
    ? withSafeStudyQuestionDefaults(result)
    : result) as T;
}

export async function requestSwStudyMutation<T extends object>(
  action: SwStudyMutationAction,
  payload: JsonRecord = {},
  signal?: AbortSignal,
  expectedUserKey?: string,
) {
  if (!expectedUserKey) {
    throw new ApiRequestError("학습 계정을 확인할 수 없습니다. 새로고침 후 다시 시도해 주세요.", "SW_ACCOUNT_CHANGED");
  }
  return requestMutation(SW_STUDY_MUTATION_ADAPTER, action, payload, signal, expectedUserKey) as Promise<T>;
}
