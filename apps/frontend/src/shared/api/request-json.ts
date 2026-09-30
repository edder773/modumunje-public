type JsonObject = Record<string, unknown>;

const DEFAULT_TOTAL_BUDGET_MS = 5_000;
const DEFAULT_ATTEMPT_TIMEOUT_MS = 3_000;
const SLOW_REQUEST_NOTICE_MS = 2_000;

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
    readonly requestId?: string,
    readonly retryable = false,
    readonly retryAfterMs?: number,
    readonly payload?: JsonObject,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

function isJsonResponse(response: Response) {
  return response.headers.get("content-type")?.toLowerCase().includes("application/json") === true;
}

function responseError(payload: JsonObject, response: Response, fallback: string) {
  return typeof payload.error === "string" && payload.error.trim()
    ? payload.error
    : `${fallback} (${response.status})`;
}

function retryAfterMs(response: Response) {
  const value = response.headers.get("retry-after")?.trim();
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : undefined;
}

function apiRoute(input: RequestInfo | URL) {
  try {
    if (input instanceof Request) return new URL(input.url, globalThis.location?.origin).pathname;
    return new URL(String(input), globalThis.location?.origin ?? "https://app.local").pathname;
  } catch {
    return "/api/unknown";
  }
}

type ApiEvents = {
  "baeumzip:api-timing": {
    route: string;
    durationMs: number;
    status?: number;
    retries: number;
    cacheSource?: string;
    requestId?: string;
    outcome: "success" | "error";
  };
  "baeumzip:api-slow": { route: string; elapsedMs: number };
  "baeumzip:api-retrying": { route: string; attempt: number; delayMs: number };
};

function emitApiEvent<Name extends keyof ApiEvents>(name: Name, detail: ApiEvents[Name]) {
  if (typeof globalThis.dispatchEvent !== "function" || typeof CustomEvent === "undefined") return;
  globalThis.dispatchEvent(new CustomEvent(name, { detail }));
}

async function retryDelay(milliseconds: number, signal?: AbortSignal | null) {
  if (signal?.aborted) return;
  await new Promise<void>((resolve) => {
    const timeout = globalThis.setTimeout(resolve, milliseconds);
    signal?.addEventListener("abort", () => {
      globalThis.clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
}

export async function requestJson<T extends JsonObject>(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: {
    totalBudgetMs?: number;
    attemptTimeoutMs?: number;
    maxAttempts?: 1 | 2;
    failureMessage: string;
    invalidResponseMessage: string;
  },
): Promise<T> {
  const startedAt = performance.now();
  const deadline = startedAt + (options.totalBudgetMs ?? DEFAULT_TOTAL_BUDGET_MS);
  const maxAttempts = options.maxAttempts ?? 1;
  const route = apiRoute(input);
  const slowRequestTimer = globalThis.setTimeout(() => {
    emitApiEvent("baeumzip:api-slow", { route, elapsedMs: SLOW_REQUEST_NOTICE_MS });
  }, SLOW_REQUEST_NOTICE_MS);
  const invalidResponse = (response: Response) => new ApiRequestError(
    options.invalidResponseMessage,
    "INVALID_API_RESPONSE",
    response.status,
    response.headers.get("x-request-id") ?? undefined,
  );
  let lastError: ApiRequestError | undefined;
  let retries = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    retries = attempt;
    const timeoutController = new AbortController();
    const remainingMs = Math.max(1, deadline - performance.now());
    const timeout = globalThis.setTimeout(
      () => timeoutController.abort("timeout"),
      Math.min(options.attemptTimeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS, remainingMs),
    );
    const signal = init.signal
      ? AbortSignal.any([init.signal, timeoutController.signal])
      : timeoutController.signal;
    let response: Response | undefined;

    try {
      response = await fetch(input, { ...init, signal });
      if (!isJsonResponse(response)) {
        throw invalidResponse(response);
      }
      const payload: unknown = await response.json();
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw invalidResponse(response);
      }
      if (!response.ok) {
        const object = payload as JsonObject;
        throw new ApiRequestError(
          responseError(object, response, options.failureMessage),
          typeof object.code === "string" ? object.code : `HTTP_${response.status}`,
          response.status,
          typeof object.requestId === "string"
            ? object.requestId
            : response.headers.get("x-request-id") ?? undefined,
          [429, 502, 503, 504].includes(response.status),
          retryAfterMs(response),
          object,
        );
      }
      emitApiEvent("baeumzip:api-timing", {
        route,
        durationMs: performance.now() - startedAt,
        status: response.status,
        retries: attempt,
        cacheSource: response.headers.get("x-baeumzip-cache") ?? response.headers.get("cf-cache-status") ?? "unknown",
        requestId: response.headers.get("x-request-id") ?? undefined,
        outcome: "success",
      });
      globalThis.clearTimeout(slowRequestTimer);
      return payload as T;
    } catch (error) {
      if (error instanceof ApiRequestError) {
        lastError = error;
      } else if (init.signal?.aborted) {
        lastError = new ApiRequestError(
          "요청이 취소되었습니다.",
          "REQUEST_ABORTED",
        );
      } else if (response?.ok && error instanceof SyntaxError) {
        lastError = invalidResponse(response);
      } else if (error instanceof TypeError || timeoutController.signal.aborted) {
        lastError = new ApiRequestError(
          options.failureMessage,
          timeoutController.signal.aborted ? "REQUEST_TIMEOUT" : "NETWORK_ERROR",
          undefined,
          response?.headers.get("x-request-id") ?? undefined,
          true,
        );
      } else {
        lastError = new ApiRequestError(
          options.failureMessage,
          "UNEXPECTED_CLIENT_ERROR",
        );
      }
    } finally {
      globalThis.clearTimeout(timeout);
    }

    const jitterMs = 250 + Math.floor(Math.random() * 251);
    const delayMs = Math.min(2_000, Math.max(jitterMs, lastError.retryAfterMs ?? 0));
    if (
      attempt + 1 >= maxAttempts
      || !lastError.retryable
      || init.signal?.aborted
      || performance.now() + delayMs + 250 >= deadline
    ) break;
    emitApiEvent("baeumzip:api-retrying", { route, attempt: attempt + 2, delayMs });
    await retryDelay(delayMs, init.signal);
  }

  emitApiEvent("baeumzip:api-timing", {
    route,
    durationMs: performance.now() - startedAt,
    status: lastError?.status,
    retries,
    requestId: lastError?.requestId,
    outcome: "error",
  });
  globalThis.clearTimeout(slowRequestTimer);
  throw lastError ?? new ApiRequestError(options.failureMessage, "UNKNOWN_CLIENT_ERROR");
}
