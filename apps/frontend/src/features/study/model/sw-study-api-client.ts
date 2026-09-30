import {
  ApiRequestError,
  requestJson,
} from "@frontend/shared/api/request-json";
import { waitForSharedRequest } from "@shared/runtime/abortable-shared-request.mjs";
import { isSwStudyPayload } from "@shared/study/sw-study-contract.mjs";
import { defineLearningReadContentAdapter } from "./learning-content-adapters";
import { SW_STUDY_OWNER_HEADER } from "@shared/auth/authenticated-user";

export type SwStudyView = "summary" | "theories" | "theory" | "session" | "practice" | "state";

export type SwAccountState = {
  progress: Array<{ theoryId: number; completed: boolean; updatedAt: string }>;
  sessions: Array<{
    id: string;
    mode: "practice" | "mock";
    status: "active" | "submitted";
    subjectIds: string[];
    questionIds: string[];
    answers: Record<string, number[]>;
    revealedQuestionIds: string[];
    currentIndex: number;
    revision: number;
    updatedAt: string;
  }>;
  attemptSummary: { total: number; correct: number; learningDays: number };
};

type SwStudyParameter = string | number | null | undefined;
type SwStudyCacheMode = "none" | "reuse" | "consume";

type CacheEntry = {
  expiresAt: number;
  payload: unknown;
};

const STABLE_CONTENT_TTL_MS = 5 * 60_000;
const PREFETCHED_PRACTICE_TTL_MS = 30_000;
const MAX_RESPONSE_CACHE_ENTRIES = 64;
const responseCache = new Map<string, CacheEntry>();
const inFlightRequests = new Map<string, Promise<unknown>>();

function normalizeSwStudyPayload(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const record = payload as Record<string, unknown>;
  if (!Array.isArray(record.questions)) return payload;
  return {
    ...record,
    questions: record.questions.map((question) => {
      if (!question || typeof question !== "object" || Array.isArray(question)) return question;
      const row = question as Record<string, unknown>;
      return {
        ...row,
        correctAnswers: Array.isArray(row.correctAnswers) ? row.correctAnswers : [],
        explanation: typeof row.explanation === "string" ? row.explanation : "",
      };
    }),
  };
}

const SW_STUDY_CONTENT_ADAPTER = defineLearningReadContentAdapter<SwStudyView>({
  engineId: "curriculum",
  validateRead: (view, payload) => isSwStudyPayload(view, payload),
  normalizeRead: normalizeSwStudyPayload,
});

function requestUrl(view: SwStudyView, params: Record<string, SwStudyParameter>) {
  const search = new URLSearchParams({
    view,
    v: __BAEUMZIP_BUILD_SHA__.slice(0, 12),
  });
  for (const [key, value] of Object.entries(params).sort(([first], [second]) => first.localeCompare(second))) {
    if (value === undefined || value === null || value === "") continue;
    const normalized = ["exclude", "subjects"].includes(key)
      ? [...new Set(String(value).split(",").map((item) => item.trim()).filter(Boolean))]
          .sort()
          .join(",")
      : String(value);
    if (normalized) search.set(key, normalized);
  }
  return `${SW_STUDY_CONTENT_ADAPTER.apiPath}?${search.toString()}`;
}

function pruneResponseCache(now = Date.now()) {
  for (const [key, entry] of responseCache) {
    if (entry.expiresAt <= now) responseCache.delete(key);
  }
  while (responseCache.size >= MAX_RESPONSE_CACHE_ENTRIES) {
    const oldestKey = responseCache.keys().next().value;
    if (typeof oldestKey !== "string") break;
    responseCache.delete(oldestKey);
  }
}

function storePayload(url: string, payload: unknown, ttlMs: number) {
  pruneResponseCache();
  responseCache.delete(url);
  responseCache.set(url, { payload, expiresAt: Date.now() + ttlMs });
}

function cachedPayload<T>(url: string, consume: boolean) {
  const cached = responseCache.get(url);
  if (!cached) return undefined;
  if (cached.expiresAt <= Date.now()) {
    responseCache.delete(url);
    return undefined;
  }
  responseCache.delete(url);
  if (!consume) responseCache.set(url, cached);
  return cached.payload as T;
}

async function fetchSwStudyData<T>(
  url: string,
  view: SwStudyView,
  signal?: AbortSignal,
  prefetch = false,
  expectedUserKey?: string,
) {
  const payload = await requestJson<Record<string, unknown>>(url, {
    signal,
    headers: expectedUserKey ? { [SW_STUDY_OWNER_HEADER]: expectedUserKey } : undefined,
  }, {
        failureMessage: "SW 학습 데이터 요청에 실패했습니다.",
        invalidResponseMessage: "SW 학습 데이터 응답 형식이 올바르지 않습니다.",
        maxAttempts: prefetch ? 1 : 2,
        totalBudgetMs: prefetch ? 3_000 : 5_000,
        attemptTimeoutMs: 3_000,
      });
  if (!SW_STUDY_CONTENT_ADAPTER.validateRead(view, payload)) {
    throw new ApiRequestError(
      "SW 학습 데이터 응답 형식이 올바르지 않습니다.",
      "INVALID_API_RESPONSE",
    );
  }
  return SW_STUDY_CONTENT_ADAPTER.normalizeRead(payload) as T;
}

export async function requestSwStudyData<T>({
  view,
  params = {},
  cacheMode = "none",
  signal,
  expectedUserKey,
}: {
  view: SwStudyView;
  params?: Record<string, SwStudyParameter>;
  cacheMode?: SwStudyCacheMode;
  signal?: AbortSignal;
  expectedUserKey?: string;
}) {
  const url = requestUrl(view, params);
  // Private responses and in-flight reads cannot be reused across owners.
  const cacheKey = expectedUserKey ? `${expectedUserKey}:${url}` : url;
  if (cacheMode !== "none") {
    const cached = cachedPayload<T>(cacheKey, cacheMode === "consume");
    if (cached !== undefined) return cached;

    const pending = inFlightRequests.get(cacheKey);
    if (pending) {
      const payload = await waitForSharedRequest(pending, signal) as T;
      if (cacheMode === "consume") responseCache.delete(cacheKey);
      return payload;
    }
  }

  if (cacheMode === "none") return fetchSwStudyData<T>(url, view, signal, false, expectedUserKey);

  if (signal) {
    const payload = await fetchSwStudyData<T>(url, view, signal, false, expectedUserKey);
    if (cacheMode === "reuse") storePayload(cacheKey, payload, STABLE_CONTENT_TTL_MS);
    return payload;
  }

  const request = fetchSwStudyData<T>(url, view, undefined, false, expectedUserKey);
  inFlightRequests.set(cacheKey, request);
  try {
    const payload = await request;
    if (cacheMode === "reuse") {
      storePayload(cacheKey, payload, STABLE_CONTENT_TTL_MS);
    }
    return payload;
  } finally {
    if (inFlightRequests.get(cacheKey) === request) inFlightRequests.delete(cacheKey);
  }
}

export function prefetchSwStudyData({
  view,
  params = {},
  cacheMode = "reuse",
  expectedUserKey,
}: {
  view: SwStudyView;
  params?: Record<string, SwStudyParameter>;
  cacheMode?: Exclude<SwStudyCacheMode, "none">;
  expectedUserKey?: string;
}) {
  const url = requestUrl(view, params);
  const cacheKey = expectedUserKey ? `${expectedUserKey}:${url}` : url;
  if (cachedPayload(cacheKey, false) !== undefined || inFlightRequests.has(cacheKey)) return;

  const request = fetchSwStudyData<unknown>(url, view, undefined, true, expectedUserKey);
  inFlightRequests.set(cacheKey, request);
  void request
    .then((payload) => {
      storePayload(
        cacheKey,
        payload,
        cacheMode === "consume" ? PREFETCHED_PRACTICE_TTL_MS : STABLE_CONTENT_TTL_MS,
      );
    })
    .catch(() => undefined)
    .finally(() => {
      if (inFlightRequests.get(cacheKey) === request) inFlightRequests.delete(cacheKey);
    });
}
