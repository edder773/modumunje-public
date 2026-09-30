import {
  ApiRequestError,
  requestJson,
} from "@frontend/shared/api/request-json";

type JsonRecord = Record<string, unknown>;

export const ADMIN_HEADER = { "x-sql-study-admin-request": "1" } as const;
const ADMIN_GET_CACHE_TTL_MS = 15_000;
const ADMIN_GET_CACHE_LIMIT = 64;
const QUALITY_SCAN_BUDGET_MS = 15_000;
const DURABLE_ADMIN_ACTION_BUDGET_MS = 180_000;
const DURABLE_ADMIN_ACTIONS = [
  "backup-create",
  "backup-cancel",
  "backup-delete",
  "self-learning-reset",
  "backup-auto-if-due",
  "restore-preview",
  "restore-run",
  "theory-content-repair-preview",
  "theory-content-repair-status",
  "theory-content-repair-run",
  "import-preview",
  "import-commit",
  "skct-bank-preview",
  "skct-bank-activate",
] as const;
type AdminGetCacheEntry = {
  expiresAt: number;
  promise: Promise<unknown>;
  generation: number;
};
type AdminGetCacheInvalidation = {
  resource?: string;
  predicate?: (request: { key: string; resource: string; params: URLSearchParams }) => boolean;
};
type AdminGetOptions = {
  bypassCache?: boolean;
};
const adminGetCache = new Map<string, AdminGetCacheEntry>();
let adminGetCacheGeneration = 0;

function clearAdminGetCache() {
  adminGetCacheGeneration += 1;
  adminGetCache.clear();
}

export function invalidateAdminGetCache(filter?: AdminGetCacheInvalidation) {
  if (!filter) {
    clearAdminGetCache();
    return;
  }
  for (const key of adminGetCache.keys()) {
    const params = new URLSearchParams(key);
    const request = { key, resource: params.get("resource") ?? "", params };
    if (
      (filter.resource === undefined || request.resource === filter.resource)
      && (filter.predicate === undefined || filter.predicate(request))
    ) {
      adminGetCache.delete(key);
    }
  }
}

function discardFailedEntry(key: string, entry: AdminGetCacheEntry, error: unknown) {
  if (
    error instanceof ApiRequestError
    && (error.status === 401 || error.status === 403)
    && entry.generation === adminGetCacheGeneration
  ) {
    clearAdminGetCache();
    return;
  }
  if (adminGetCache.get(key) === entry) {
    adminGetCache.delete(key);
  }
}

function clearCacheOnAuthorizationFailure(error: unknown) {
  if (error instanceof ApiRequestError && (error.status === 401 || error.status === 403)) {
    clearAdminGetCache();
  }
}

function pruneAdminGetCache(timestamp = Date.now()) {
  for (const [key, entry] of adminGetCache) {
    if (entry.expiresAt <= timestamp) adminGetCache.delete(key);
  }
  while (adminGetCache.size >= ADMIN_GET_CACHE_LIMIT) {
    const oldest = adminGetCache.keys().next().value;
    if (typeof oldest !== "string") break;
    adminGetCache.delete(oldest);
  }
}

export async function apiGet<T>(
  resource: string,
  params?: URLSearchParams,
  options: AdminGetOptions = {},
) {
  const query = new URLSearchParams(params);
  query.set("resource", resource);
  const key = query.toString();
  pruneAdminGetCache();
  const cached = adminGetCache.get(key);
  if (!options.bypassCache && cached && cached.expiresAt > Date.now()) {
    adminGetCache.delete(key);
    adminGetCache.set(key, cached);
    return cached.promise as Promise<T>;
  }

  const entry: AdminGetCacheEntry = {
    expiresAt: Date.now() + ADMIN_GET_CACHE_TTL_MS,
    generation: adminGetCacheGeneration,
    promise: Promise.resolve(undefined),
  };
  entry.promise = requestJson<T & JsonRecord>(
    `/api/admin?${key}`,
    { cache: "no-store" },
    {
      ...(resource === "quality"
        ? {
            totalBudgetMs: QUALITY_SCAN_BUDGET_MS,
            attemptTimeoutMs: QUALITY_SCAN_BUDGET_MS,
          }
        : {}),
      failureMessage: "관리자 데이터를 불러오지 못했습니다.",
      invalidResponseMessage: "관리자 데이터 응답 형식이 올바르지 않습니다.",
    },
  ).catch((error) => {
    discardFailedEntry(key, entry, error);
    throw error;
  });
  adminGetCache.set(key, entry);
  return entry.promise as Promise<T>;
}

export async function apiAction<T>(action: string, values: JsonRecord = {}) {
  try {
    const data = await requestJson<T & JsonRecord>(
      "/api/admin",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...ADMIN_HEADER,
        },
        body: JSON.stringify({ action, ...values }),
      },
      {
        ...(DURABLE_ADMIN_ACTIONS.includes(action as typeof DURABLE_ADMIN_ACTIONS[number])
          ? {
              totalBudgetMs: DURABLE_ADMIN_ACTION_BUDGET_MS,
              attemptTimeoutMs: DURABLE_ADMIN_ACTION_BUDGET_MS,
            }
          : {}),
        failureMessage: "관리자 작업을 완료하지 못했습니다.",
        invalidResponseMessage: "관리자 작업 응답 형식이 올바르지 않습니다.",
      },
    );
    clearAdminGetCache();
    return data as T;
  } catch (error) {
    clearCacheOnAuthorizationFailure(error);
    throw error;
  }
}
