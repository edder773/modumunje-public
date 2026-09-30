import {
  authorizeLearnerRequest,
  verifyUserMutationRequest,
} from "@backend/common/auth/admin-auth";
import { ReportsRepository } from "./reports.repository";
import { writeSystemError } from "@backend/common/observability";
import {
  readBoundedJsonBody,
  RequestBodyError,
} from "@shared/http/bounded-json-body.mjs";

const CATEGORIES = new Set(["bug", "improvement", "content"]);
const REPORT_BODY_MAX_BYTES = 20 * 1024;
const REPORT_RATE_LIMIT = 10;
const REPORT_RATE_WINDOW_MS = 10 * 60_000;

function cleanText(value: unknown, limit: number) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim()
    .slice(0, limit);
}

function json(data: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...Object.fromEntries(new Headers(headers)),
    },
  });
}

const reportsRepository = new ReportsRepository();

export async function GET(request: Request, repository = reportsRepository) {
  const authorization = await authorizeLearnerRequest(request, { createIfMissing: true });
  if (!authorization.ok) return authorization.response;
  const userKey = authorization.account.userKey;
  const rows = await repository.findRecentForUser(userKey);
  return json({ items: rows });
}

export async function POST(request: Request, repository = reportsRepository) {
  const mutationError = verifyUserMutationRequest(request);
  if (mutationError) return mutationError;
  const authorization = await authorizeLearnerRequest(request,{respectMaintenance:true});
  if (!authorization.ok) return authorization.response;
  const userKey = authorization.account.userKey;
  try {
    const candidate = await readBoundedJsonBody(request, REPORT_BODY_MAX_BYTES);
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return json({ error: "제보 요청 본문이 올바른 JSON 객체가 아닙니다." }, 400);
    }
    const payload = candidate as Record<string, unknown>;
    const category = cleanText(payload.category, 24);
    const title = cleanText(payload.title, 120);
    const description = cleanText(payload.description, 4000);
    if (!CATEGORIES.has(category)) {
      return json({ error: "제보 유형이 유효하지 않습니다." }, 400);
    }
    if (title.length < 4 || description.length < 10) {
      return json(
        { error: "제목은 4자, 상세 내용은 10자 이상 입력해 주세요." },
        400,
      );
    }
    const rawQuestionId = Number(payload.questionId);
    const questionId = Number.isInteger(rawQuestionId) && rawQuestionId > 0
      ? rawQuestionId
      : null;
    if (questionId) {
      const question = await repository.questionExists(questionId);
      if (!question) {
        return json({ error: "관련 문제를 찾을 수 없습니다." }, 400);
      }
    }
    const recentReportCount = await repository.countRecentForUser(
      userKey,
      new Date(Date.now() - REPORT_RATE_WINDOW_MS).toISOString(),
    );
    if (recentReportCount >= REPORT_RATE_LIMIT) {
      return json(
        { error: "제보 요청이 너무 많습니다. 10분 후 다시 시도해 주세요." },
        429,
        { "Retry-After": String(REPORT_RATE_WINDOW_MS / 1_000) },
      );
    }
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    await repository.create({ id, userKey, category, title, description, questionId, createdAt });
    return json({ report: { id, status: "new", createdAt } }, 201);
  } catch (error) {
    if (error instanceof RequestBodyError) {
      return json({ error: error.message, code: error.code }, error.status);
    }
    await writeSystemError({
      errorType: "user_report_failed",
      pagePath: "/api/reports",
      message: error instanceof Error ? error.message : "사용자 제보 저장 실패",
    });
    return json({ error: "제보를 저장하지 못했습니다." }, 500);
  }
}
