import { groupSocketRequest } from "./group-exam-socket";
import { beginGroupRequest } from "./group-exam-performance";

type AnyRecord = Record<string, unknown>;

const IDEMPOTENCY_PATTERN = /^[a-zA-Z0-9:_-]{8,100}$/u;
const EDGE_FAILURE_STATUSES = new Set([500, 502, 503, 504]);
const TOTAL_BUDGET_MS = 25_000;
const ATTEMPT_TIMEOUT_MS = 20_000;

export class GroupApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;

  constructor(
    message: string,
    status: number,
    code: string,
    requestId?: string,
  ) {
    super(message);
    this.name = "GroupApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

function operationKey(init?: RequestInit) {
  if (typeof init?.body !== "string") return "";
  try {
    const body: unknown = JSON.parse(init.body);
    if (!body || typeof body !== "object" || Array.isArray(body)) return "";
    const value = String((body as AnyRecord).idempotencyKey ?? "").trim();
    return IDEMPOTENCY_PATTERN.test(value) ? value : "";
  } catch {
    return "";
  }
}

function replayIsSafe(init?: RequestInit) {
  const method = String(init?.method ?? "GET").toUpperCase();
  return method === "GET" || method === "HEAD" || Boolean(operationKey(init));
}

function requestId() {
  return `skct_${crypto.randomUUID().replaceAll("-", "")}`;
}

function isJson(headers: Headers) {
  return headers.get("content-type")?.toLowerCase().includes("application/json") === true;
}

function edgeEnvelopeFailure(response: Response, body: AnyRecord | undefined) {
  return EDGE_FAILURE_STATUSES.has(response.status)
    && !response.headers.get("x-request-id")
    && !body;
}

function emitRetry(url: string, status: number) {
  const route = new URL(url, globalThis.location?.origin ?? "https://app.local").pathname;
  window.dispatchEvent(new CustomEvent("group-exam-edge-retry", {
    detail: { route, status, attempt: 2, reason: "missing_app_envelope" },
  }));
}

async function retryDelay(signal?: AbortSignal | null) {
  if (signal?.aborted) return;
  await new Promise<void>((resolve) => {
    const timer = window.setTimeout(resolve, 200);
    signal?.addEventListener("abort", () => {
      window.clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

export async function groupExamApi<T extends AnyRecord = AnyRecord>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const method = String(init?.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    headers.set("content-type", "application/json");
    headers.set("x-sql-study-user-request", "1");
  }
  const correlationId = headers.get("x-request-id") ?? requestId();
  headers.set("x-request-id", correlationId);
  const maximumAttempts = replayIsSafe(init) ? 2 : 1;
  const deadline = performance.now() + TOTAL_BUDGET_MS;
  let lastError: unknown;

  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    const metric = beginGroupRequest(url, init);
    const timeoutController = new AbortController();
    const remainingMs = Math.max(1, deadline - performance.now());
    const timer = window.setTimeout(
      () => timeoutController.abort("timeout"),
      Math.min(ATTEMPT_TIMEOUT_MS, remainingMs),
    );
    const signal = init?.signal
      ? AbortSignal.any([init.signal, timeoutController.signal])
      : timeoutController.signal;
    let result: Response | undefined;
    let metricFinished = false;
    try {
      const socketRequest = attempt === 0 ? groupSocketRequest(url, { ...init, headers, signal }) : null;
      result = socketRequest ? await socketRequest : await fetch(url, { ...init, headers, cache: "no-store", signal });
      metric.headers();
      const text = await result.text();
      metric.finish(result);
      metricFinished = true;

      let body: AnyRecord | undefined;
      if (isJson(result.headers) && text.trim()) {
        try {
          const parsed: unknown = JSON.parse(text);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as AnyRecord;
        } catch {
          body = undefined;
        }
      }

      if (body) {
        if (!result.ok) {
          throw new GroupApiError(
            String(body.error ?? "요청을 처리하지 못했습니다."),
            result.status,
            String(body.code ?? `HTTP_${result.status}`),
            String(body.requestId ?? result.headers.get("x-request-id") ?? "") || undefined,
          );
        }
        return body as T;
      }

      if (edgeEnvelopeFailure(result, body) && attempt + 1 < maximumAttempts && !init?.signal?.aborted) {
        emitRetry(url, result.status);
        await retryDelay(init?.signal);
        continue;
      }
      throw new GroupApiError(
        "서버 응답을 확인하지 못했습니다. 잠시 후 같은 작업을 다시 시도해 주세요.",
        result.status,
        "GROUP_INVALID_RESPONSE",
        result.headers.get("x-request-id") ?? undefined,
      );
    } catch (error) {
      lastError = error;
      if (!metricFinished) metric.finish(result);
      const transportFailure = !(error instanceof GroupApiError)
        && !init?.signal?.aborted
        && (error instanceof TypeError || timeoutController.signal.aborted);
      if (transportFailure && attempt + 1 < maximumAttempts) {
        window.dispatchEvent(new CustomEvent("group-exam-edge-retry", {
          detail: { route: new URL(url, location.origin).pathname, status: 0, attempt: 2, reason: "transport_failure" },
        }));
        await retryDelay(init?.signal);
        continue;
      }
      if (transportFailure) {
        throw new GroupApiError(
          "네트워크 응답을 확인하지 못했습니다. 같은 작업을 다시 시도해 주세요.",
          0,
          "GROUP_TRANSPORT_FAILURE",
        );
      }
      throw error;
    } finally {
      window.clearTimeout(timer);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new GroupApiError("요청을 처리하지 못했습니다.", 0, "GROUP_REQUEST_FAILED");
}
