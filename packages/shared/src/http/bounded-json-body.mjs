export class RequestBodyError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "RequestBodyError";
    this.status = status;
    this.code = code;
  }
}

function declaredBodyLength(request) {
  const value = request.headers.get("content-length");
  if (value === null || !/^\d+$/u.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export async function readBoundedRequestBody(request, maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new TypeError("maxBytes must be a positive safe integer");
  }

  const declaredLength = declaredBodyLength(request);
  if (declaredLength !== null && declaredLength > maxBytes) {
    throw new RequestBodyError(413, "REQUEST_BODY_TOO_LARGE", "요청 본문이 너무 큽니다.");
  }

  if (!request.body) {
    throw new RequestBodyError(400, "REQUEST_BODY_EMPTY", "요청 본문이 비어 있습니다.");
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let totalBytes = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel("request body limit exceeded").catch(() => undefined);
        throw new RequestBodyError(413, "REQUEST_BODY_TOO_LARGE", "요청 본문이 너무 큽니다.");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    if (error instanceof RequestBodyError) throw error;
    throw new RequestBodyError(400, "REQUEST_BODY_INVALID", "요청 본문을 읽을 수 없습니다.");
  }

  if (!text.trim()) {
    throw new RequestBodyError(400, "REQUEST_BODY_EMPTY", "요청 본문이 비어 있습니다.");
  }
  return text;
}

export async function readBoundedJsonBody(request, maxBytes) {
  const text = await readBoundedRequestBody(request, maxBytes);
  try {
    return JSON.parse(text);
  } catch {
    throw new RequestBodyError(400, "REQUEST_BODY_INVALID_JSON", "요청 본문이 올바른 JSON이 아닙니다.");
  }
}
