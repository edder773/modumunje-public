import { automatedAnalyticsAgent } from "@shared/runtime/analytics-agent";
import { isExamType } from "@shared/study/study-domain";
import { isAdminRequest, sha256 } from "@backend/common/auth/admin-auth";
import { writeSystemError } from "@backend/common/observability";
import { EventsRepository } from "./events.repository";
import { AUTHENTICATED_USER_EMAIL_HEADER } from "@shared/auth/authenticated-user";
import {
  readBoundedJsonBody,
  RequestBodyError,
} from "@shared/http/bounded-json-body.mjs";
import {
  checkDistributedRateLimit,
  createLocalFixedWindowLimiter,
} from "./events-rate-limit.mjs";

const EVENT_TYPES = new Set([
  "page_view",
  "question_session_started",
  "question_answer_submitted",
  "question_session_completed",
  "theory_viewed",
  "related_questions_started",
  "mock_exam_page_viewed",
  "mock_exam_started",
  "mock_exam_completed",
  "mock_exam_abandoned",
  "mock_exam_paused",
  "application_error",
  "web_vital",
  "api_timing",
]);
const DEVICES = new Set(["mobile", "tablet", "desktop", "unknown"]);
const BROWSERS = new Set(["Safari", "Chrome", "Edge", "Firefox", "Other", "unknown"]);
const EVENT_BODY_MAX_BYTES = 16 * 1024;
const EVENT_RATE_WINDOW_MS = 60_000;
const EVENT_RATE_LIMIT = 120;

const localEventRateLimit = createLocalFixedWindowLimiter({
  limit: EVENT_RATE_LIMIT,
  windowMs: EVENT_RATE_WINDOW_MS,
});
let bindingErrorLastLoggedAt = 0;

function text(value: unknown, limit: number) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim()
    .slice(0, limit);
}

function pagePath(value: unknown) {
  const candidate = text(value, 240);
  if (!candidate.startsWith("/") || candidate.startsWith("//")) return "/";
  try {
    return new URL(candidate, "https://app.local").pathname.slice(0, 180);
  } catch {
    return "/";
  }
}

function optionalPagePath(value: unknown) {
  const candidate = text(value, 240);
  if (!candidate) return null;
  const normalized = pagePath(candidate);
  return normalized === "/" && candidate !== "/" ? null : normalized;
}

function referrerHostname(value: unknown) {
  const candidate = text(value, 160).toLocaleLowerCase("en-US");
  if (!/^(?:\[[0-9a-f:]+\]|[a-z0-9.-]+)$/u.test(candidate)) return "";
  try {
    const parsed = new URL(`https://${candidate}`);
    if (parsed.username || parsed.password || parsed.port) return "";
    return parsed.hostname.slice(0, 120);
  } catch {
    return "";
  }
}

function viewport(value: unknown) {
  const width = Number(value);
  if (!Number.isFinite(width)) return "unknown";
  if (width <= 359) return "320-359";
  if (width <= 389) return "360-389";
  if (width <= 430) return "390-430";
  if (width <= 767) return "431-767";
  if (width <= 1023) return "768-1023";
  if (width <= 1439) return "1024-1439";
  return "1440+";
}

function json(data: unknown, status: number) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function eventRateLimit(repository: EventsRepository, sessionIdHash: string) {
  const decision = await checkDistributedRateLimit({
    key: `analytics-session:${sessionIdHash}`,
    limit: EVENT_RATE_LIMIT,
    windowMs: EVENT_RATE_WINDOW_MS,
    localLimit: localEventRateLimit,
    rateLimitBinding: repository.rateLimitBinding(),
    countRecent: (since: string) => repository.countRecentForSession(
      sessionIdHash,
      since,
      EVENT_RATE_LIMIT,
    ),
    onBindingError: () => {
      const now = Date.now();
      if (now - bindingErrorLastLoggedAt < EVENT_RATE_WINDOW_MS) return;
      bindingErrorLastLoggedAt = now;
      console.warn(JSON.stringify({
        level: "warn",
        event: "event_rate_limit_binding_failed",
        fallback: "d1",
      }));
    },
  });
  if (decision.allowed) return null;
  return Response.json({ error: "이벤트 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." }, {
    status: 429,
    headers: {
      "Cache-Control": "no-store",
      "Retry-After": String(decision.retryAfterSeconds),
      "X-Content-Type-Options": "nosniff",
    },
  });
}

const eventsRepository = new EventsRepository();

export async function POST(request: Request, repository = eventsRepository) {
  try {
    const origin = request.headers.get("origin");
    if ((origin && origin !== new URL(request.url).origin)
      || request.headers.get("sec-fetch-site") === "cross-site") {
      return json({ error: "허용되지 않은 이벤트 요청 출처입니다." }, 403);
    }
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      return json({ error: "JSON 이벤트 요청만 허용됩니다." }, 415);
    }
    if (automatedAnalyticsAgent(request.headers.get("user-agent") ?? "")) {
      return new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });
    }
    if (!await repository.analyticsEnabled()) return new Response(null, { status: 204 });

    let candidate: unknown;
    try {
      candidate = await readBoundedJsonBody(request, EVENT_BODY_MAX_BYTES);
    } catch (error) {
      if (error instanceof RequestBodyError) {
        return json({ error: error.message, code: error.code }, error.status);
      }
      throw error;
    }
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return json({ error: "이벤트 요청 본문이 올바른 JSON 객체가 아닙니다." }, 400);
    }
    const payload = candidate as Record<string, unknown>;
    const eventType = text(payload.eventType, 80);
    if (!EVENT_TYPES.has(eventType)) return json({ error: "지원하지 않는 이벤트입니다." }, 400);
    const sessionId = text(payload.anonymousSessionId, 80);
    const eventId = text(payload.eventId, 80);
    if (
      !/^[a-zA-Z0-9_-]{12,80}$/.test(sessionId)
      || !/^[a-zA-Z0-9_-]{12,80}$/.test(eventId)
    ) {
      return json({ error: "익명 세션 또는 이벤트 식별자가 유효하지 않습니다." }, 400);
    }
    const sessionIdHash = await sha256(`analytics-session:${sessionId}`);
    const rateLimited = await eventRateLimit(repository, sessionIdHash);
    if (rateLimited) return rateLimited;

    const rawQuestionId = Number(payload.questionId);
    const questionId = Number.isInteger(rawQuestionId) && rawQuestionId > 0
      ? rawQuestionId
      : null;
    const rawDurationMs = Number(payload.durationMs);
    const durationMs = Number.isFinite(rawDurationMs)
      && rawDurationMs >= 0
      && rawDurationMs <= 3 * 60 * 60 * 1000
      ? Math.round(rawDurationMs)
      : null;
    const email = text(request.headers.get(AUTHENTICATED_USER_EMAIL_HEADER), 240)
      .toLocaleLowerCase("en-US");
    const userKeyHash = email ? await sha256(`sql-study-user:${email}`) : null;
    const device = text(payload.deviceCategory, 20);
    const browser = text(payload.browserFamily, 20);
    const dedupeKey = await sha256(`${sessionId}:${eventId}:${eventType}`);
    const id = crypto.randomUUID();
    const occurredAt = new Date().toISOString();
    const contentId = text(payload.contentId, 64);
    const answerResultValue = payload["answerResult"];
    const answerResult = answerResultValue === "correct" || answerResultValue === "incorrect"
      ? answerResultValue
      : null;
    const insertStatus = await repository.insertEvent([
      id,
      eventType,
      occurredAt,
      sessionIdHash,
      userKeyHash,
      isAdminRequest(request) ? 1 : 0,
      isExamType(payload.examScope) || payload.examScope === "SW" || payload.examScope === "GROUP_SKCT"
        ? payload.examScope
        : null,
      text(payload.subject, 100) || null,
      questionId,
      contentId || null,
      answerResult,
      durationMs,
      pagePath(payload.pagePath),
      referrerHostname(payload.referrerHost),
      DEVICES.has(device) ? device : "unknown",
      viewport(payload.viewportWidth),
      BROWSERS.has(browser) ? browser : "Other",
      ["LCP", "INP", "CLS", "TTFB"].includes(text(payload.metricName, 16))
        ? text(payload.metricName, 16)
        : null,
      Number.isFinite(Number(payload.metricValue))
        ? Math.max(0, Math.min(600_000, Number(payload.metricValue)))
        : null,
      optionalPagePath(payload.apiRoute),
      Number.isInteger(Number(payload.httpStatus))
        ? Math.max(0, Math.min(599, Number(payload.httpStatus)))
        : null,
      Number.isInteger(Number(payload.retryCount))
        ? Math.max(0, Math.min(1, Number(payload.retryCount)))
        : null,
      text(payload.cacheSource, 32) || null,
      /^[a-f0-9]{7,40}$/u.test(text(payload.buildSha, 40)) ? text(payload.buildSha, 40) : null,
      dedupeKey,
    ], questionId);
    if (insertStatus === "disabled") return new Response(null, { status: 204 });
    if (insertStatus === "invalid-question") {
      return json({ error: "문제 식별자가 유효하지 않습니다." }, 400);
    }

    if (eventType === "application_error") {
      await writeSystemError({
        errorType: text(payload.errorType, 100) || "client_error",
        pagePath: pagePath(payload.pagePath),
        questionId,
        impact: text(payload.impact, 80) || "operation_failed",
        message: text(payload.message, 320) || "사용자 화면에서 오류가 발생했습니다.",
      });
    }
    return json({ accepted: true }, 202);
  } catch (error) {
    await writeSystemError({
      errorType: "analytics_event_failed",
      pagePath: "/api/events",
      message: error instanceof Error ? error.message : "이벤트 저장 실패",
    });
    return json({ error: "이벤트를 저장하지 못했습니다." }, 500);
  }
}
