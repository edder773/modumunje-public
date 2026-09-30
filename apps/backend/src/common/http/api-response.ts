const REQUEST_ID_HEADER = "x-request-id";
const REQUEST_ID_PATTERN = /^[a-zA-Z0-9_-]{8,80}$/u;
const generatedRequestIds = new WeakMap<Request, string>();

function generatedRequestId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID().replaceAll("-", "");
  }
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

export function requestIdFor(request?: Request) {
  const supplied = request?.headers.get(REQUEST_ID_HEADER)?.trim() ?? "";
  if (REQUEST_ID_PATTERN.test(supplied)) return supplied;
  if (!request) return generatedRequestId();
  const existing = generatedRequestIds.get(request);
  if (existing) return existing;
  const generated = generatedRequestId();
  generatedRequestIds.set(request, generated);
  return generated;
}

export function apiErrorResponse(
  request: Request | undefined,
  options: {
    status: number;
    code: string;
    message: string;
    requestId?: string;
  },
) {
  const requestId = options.requestId ?? requestIdFor(request);
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  headers.set(REQUEST_ID_HEADER, requestId);
  return new Response(JSON.stringify({
    error: options.message,
    code: options.code,
    requestId,
  }), {
    status: options.status,
    headers,
  });
}

async function finalizedApiResponse(
  response: Response,
  requestId: string,
  startedAt: number,
  requestMethod?: string,
) {
  const headers = new Headers(response.headers);
  headers.set(REQUEST_ID_HEADER, requestId);
  headers.append("Server-Timing", `app;dur=${(performance.now() - startedAt).toFixed(1)}`);
  if (response.status < 400) {
    if (requestMethod && !["GET", "HEAD"].includes(requestMethod.toUpperCase())) {
      headers.set("Cache-Control", "no-store");
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.delete("Content-Length");
  let payload: Record<string, unknown> = {};
  try {
    const candidate: unknown = await response.json();
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      payload = candidate as Record<string, unknown>;
    }
  } catch {
    // Non-JSON upstream errors are replaced with the same safe API envelope.
  }
  return new Response(JSON.stringify({
    ...payload,
    error: typeof payload.error === "string" && payload.error.trim()
      ? payload.error
      : "요청을 처리하지 못했습니다.",
    code: typeof payload.code === "string" && payload.code.trim()
      ? payload.code
      : `HTTP_${response.status}`,
    requestId,
  }), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function withApiErrorBoundary(
  request: Request | undefined,
  operation: () => Promise<Response>,
  options: {
    code: string;
    message: string;
  },
) {
  const requestId = requestIdFor(request);
  const startedAt = performance.now();
  try {
    return finalizedApiResponse(await operation(), requestId, startedAt, request?.method);
  } catch (error) {
    console.error(JSON.stringify({
      level: "error",
      event: "api_request_failed",
      code: options.code,
      requestId,
      errorName: error instanceof Error ? error.name : "UnknownError",
    }));
    return finalizedApiResponse(apiErrorResponse(request, {
      status: 503,
      code: options.code,
      message: options.message,
      requestId,
    }), requestId, startedAt, request?.method);
  }
}
