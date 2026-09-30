import { readBoundedJsonBody, RequestBodyError } from "@shared/http/bounded-json-body.mjs";
import { GroupExamError } from "./domain/group-exam.domain";
type JsonObject = Record<string, unknown>;
const BODY_LIMIT = 32_000;
const IDEMPOTENCY_PATTERN = /^[a-zA-Z0-9:_-]{8,100}$/u;

export function response(payload: unknown, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      Vary: "Cookie",
    },
  });
}

export function string(value: unknown, label: string, maximum = 100) {
  const result = String(value ?? "").trim();
  if (!result || result.length > maximum) {
    throw new GroupExamError(400, `${label} 값을 확인해 주세요.`, "GROUP_INPUT_INVALID");
  }
  return result;
}

export function integer(value: unknown, label: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const result = Number(value);
  if (!Number.isInteger(result) || result < minimum || result > maximum) {
    throw new GroupExamError(400, `${label} 값을 확인해 주세요.`, "GROUP_INPUT_INVALID");
  }
  return result;
}

export function idempotencyKey(request: Request, payload: JsonObject) {
  const value = String(request.headers.get("idempotency-key") ?? payload.idempotencyKey ?? "").trim();
  if (!IDEMPOTENCY_PATTERN.test(value)) {
    throw new GroupExamError(400, "유효한 멱등성 키가 필요합니다.", "GROUP_IDEMPOTENCY_KEY_REQUIRED");
  }
  return value;
}

export async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as JsonObject).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function rawInviteToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function parseAnswers(value: unknown) {
  if (!Array.isArray(value) || value.length > 10) {
    throw new GroupExamError(400, "답안을 확인해 주세요.", "GROUP_ANSWER_INVALID");
  }
  const answers = [...new Set(value.map((item) => integer(item, "답안", 0, 20)))].sort((a, b) => a - b);
  if (answers.length > 1) throw new GroupExamError(400, "단일선택 문항에는 답을 하나만 선택할 수 있습니다.", "GROUP_ANSWER_INVALID");
  return answers;
}

export function safeJson(value: string, fallback: unknown) {
  try { return JSON.parse(value); } catch { return fallback; }
}

export async function payload(request: Request) {
  try {
    const candidate = await readBoundedJsonBody(request, BODY_LIMIT);
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new GroupExamError(400, "요청 본문을 확인해 주세요.", "GROUP_INPUT_INVALID");
    }
    return candidate as JsonObject;
  } catch (error) {
    if (error instanceof RequestBodyError) throw new GroupExamError(error.status, error.message, error.code);
    throw error;
  }
}

type ErrorContext = {
  phase: "read" | "mutation";
  operation: string;
};

const SAFE_OPERATIONS = new Set([
  "groups", "group", "sync", "invite", "current", "result",
  "group-create", "group-delete", "settings-update", "group-leave", "owner-transfer", "member-kick",
  "invite-create", "invite-resend", "invite-revoke", "invite-accept", "presence-heartbeat",
  "run-start", "run-cancel", "answer-save", "question-advance", "run-submit",
  "question-count-set", "question-count-reset", "quota-grant", "quota-reset",
]);

function safeOperation(operation: string | undefined) {
  return operation && SAFE_OPERATIONS.has(operation) ? operation : "unknown";
}

export function classifyGroupExamInternalError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (/locked|busy|write conflict|transaction conflict|concurrent/u.test(message)) return "d1_contention";
  if (/constraint|foreign key|unique/u.test(message)) return "d1_constraint";
  if (/timeout|timed out|deadline/u.test(message)) return "d1_timeout";
  if (/too many|overload|rate limit|capacity/u.test(message)) return "d1_capacity";
  if (/d1|database|sqlite/u.test(message)) return "d1_runtime";
  return "unexpected";
}

export function errorResponse(error: unknown, context?: ErrorContext) {
  if (error instanceof GroupExamError) return response({ code: error.code, error: error.message }, error.status);
  const causeCategory = classifyGroupExamInternalError(error);
  const diagnostic = {
    event: "group_exam_internal_error",
    phase: context?.phase ?? "read",
    operation: safeOperation(context?.operation),
    causeCategory,
    errorCode: "GROUP_INTERNAL_ERROR",
  };
  console.error(JSON.stringify(diagnostic));
  return response({
    code: "GROUP_INTERNAL_ERROR",
    error: "그룹 시험 요청을 처리하지 못했습니다.",
    diagnostic: {
      phase: diagnostic.phase,
      operation: diagnostic.operation,
      causeCategory,
    },
  }, 500);
}
