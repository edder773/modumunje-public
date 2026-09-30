/** Cloudflare Worker entry point for the Baeumzip frontend and direct API handlers. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { createLocalFixedWindowLimiter } from "@backend/modules/events/events-rate-limit.mjs";
import { metricPhase, withD1Metrics } from "@backend/common/observability/d1-metrics";
import { fetchImmutableStaticAsset } from "./immutable-static-assets";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  EVENT_RATE_LIMITER?: RateLimit;
  ADMIN_EMAIL?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_AUTH_SESSION_SECRET?: string;
  GOOGLE_OAUTH_REDIRECT_URI?: string;
  MAINTENANCE_TRIGGER_SECRET?: string;
  SKCT_GROUP_SERVICE_ENABLED?: string;
  SKCT_GROUP_V2_ENABLED?: string;
  SKCT_GROUP_REPEAT_IDENTITY_VERIFIED?: string;
  BAEUMZIP_E2E_CLIENT_BOOTSTRAP?: string;
  BACKUP_OBJECTS?: unknown;
  BACKUP_STORAGE_MODE?: "database" | "external";
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const RATE_LIMIT_WINDOW_MS = 60_000;
const rateLimitRules = {
  authentication: {
    local: createLocalFixedWindowLimiter({ limit: 30, windowMs: RATE_LIMIT_WINDOW_MS }),
  },
  health: {
    local: createLocalFixedWindowLimiter({ limit: 60, windowMs: RATE_LIMIT_WINDOW_MS }),
  },
  application: {
    local: createLocalFixedWindowLimiter({ limit: 120, windowMs: RATE_LIMIT_WINDOW_MS }),
  },
} as const;
type RateLimitGroup = keyof typeof rateLimitRules;
let rateLimitBindingErrorLastLoggedAt = 0;

function requestRateLimitGroup(request: Request, pathname: string): RateLimitGroup | null {
  if (pathname.startsWith("/api/auth/google/")) return "authentication";
  if (pathname === "/api/internal/maintenance") return "authentication";
  if (pathname === "/api/health") return "health";
  if (pathname === "/_vinext/image") return "application";
  if (
    pathname === "/api/admin"
    || pathname === "/api/group-exams"
    || pathname === "/api/group-exams/admin"
    || pathname === "/api/reports"
    || pathname === "/api/study"
    || pathname === "/api/sw-study"
  ) return "application";
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && pathname.startsWith("/api/")) {
    return "application";
  }
  return null;
}

async function rateLimitKey(request: Request, group: RateLimitGroup) {
  const address = request.headers.get("cf-connecting-ip")?.trim().slice(0, 64);
  if (!address) return null;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`baeumzip-request-rate:${group}:${address}`),
  );
  return `${group}:${Array.from(new Uint8Array(digest), (byte) => (
    byte.toString(16).padStart(2, "0")
  )).join("")}`;
}

async function enforceRequestRateLimit(request: Request, env: Env, pathname: string) {
  const group = requestRateLimitGroup(request, pathname);
  if (!group) return null;
  const key = await rateLimitKey(request, group);
  if (!key) return null;

  const rule = rateLimitRules[group];
  const localDecision = rule.local(key);
  let allowed = localDecision.allowed;
  let retryAfterSeconds = localDecision.retryAfterSeconds;
  if (allowed && env.EVENT_RATE_LIMITER) {
    try {
      const result = await env.EVENT_RATE_LIMITER.limit({ key });
      allowed = result?.success === true;
      retryAfterSeconds = allowed ? 0 : Math.ceil(RATE_LIMIT_WINDOW_MS / 1_000);
    } catch {
      const now = Date.now();
      if (now - rateLimitBindingErrorLastLoggedAt >= RATE_LIMIT_WINDOW_MS) {
        rateLimitBindingErrorLastLoggedAt = now;
        console.warn(JSON.stringify({
          level: "warn",
          event: "request_rate_limit_binding_failed",
          fallback: "local",
        }));
      }
    }
  }
  if (allowed) return null;
  return operationalResponse({
    status: "rate_limited",
    code: "REQUEST_RATE_LIMITED",
    error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
  }, 429, { "Retry-After": String(Math.max(1, retryAfterSeconds)) });
}

function scheduleMaintenance(ctx: ExecutionContext) {
  ctx.waitUntil(
    Promise.all([
      import("@backend/modules/operations/operations.service")
        .then(({ runOperationalMaintenance }) => runOperationalMaintenance()),
      import("@backend/modules/group-exams/group-exam.service")
        .then(({ runGroupExamMaintenance }) => runGroupExamMaintenance()),
    ])
      .catch((error) => {
        console.error(JSON.stringify({
          level: "error",
          event: "operational_maintenance_failed",
          errorName: error instanceof Error ? error.name : "UnknownError",
        }));
      }),
  );
}

const operationalResponse = (payload: Record<string, unknown>, status: number, headers?: HeadersInit) =>
  Response.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });

async function secretMatches(provided: string, expected: string) {
  const encoder = new TextEncoder();
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(providedHash);
  const right = new Uint8Array(expectedHash);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

async function handleOperationalMaintenanceRequest(
  request: Request,
  env: Env,
) {
  const expected = env.MAINTENANCE_TRIGGER_SECRET?.trim();
  if (!expected || expected.length < 32) {
    return operationalResponse({
      status: "unavailable",
      code: "MAINTENANCE_TRIGGER_UNAVAILABLE",
    }, 503);
  }
  const authorization = request.headers.get("authorization") ?? "";
  const provided = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
  if (!provided || !await secretMatches(provided, expected)) {
    return operationalResponse({
      status: "unauthorized",
      code: "MAINTENANCE_TRIGGER_UNAUTHORIZED",
    }, 401);
  }
  if (request.method === "GET") {
    const [{ readOperationalFreshness }, { readHealthDiagnostics }] = await Promise.all([
      import("@backend/modules/operations/operations.service"),
      import("@backend/modules/health/health.service"),
    ]);
    const [freshness, application] = await Promise.all([
      readOperationalFreshness(),
      readHealthDiagnostics(),
    ]);
    return operationalResponse({
      status: application.status === "ok"
        && freshness.maintenanceFresh
        && freshness.backupFresh
        ? "ok"
        : "degraded",
      application,
      ...freshness,
    }, 200);
  }
  if (request.method !== "POST") {
    return operationalResponse({
      status: "method_not_allowed",
      code: "METHOD_NOT_ALLOWED",
    }, 405, { Allow: "GET, POST" });
  }
  // Keep the authenticated scheduler request alive through the backup work.
  // A response followed by waitUntil has a shorter background lifetime.
  try {
    const { runOperationalMaintenance } = await import("@backend/modules/operations/operations.service");
    const result = await runOperationalMaintenance();
    return result.claimed
      ? operationalResponse({ status: "completed" }, 200)
      : operationalResponse({ status: "in_progress" }, 202);
  } catch {
    return operationalResponse({ status: "failed", code: "OPERATIONAL_MAINTENANCE_FAILED" }, 500);
  }
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    globalThis.__BAEUMZIP_ENV__ = env;
    // A code-generated ID links timing and API errors without trusting visitor IDs.
    const headers = new Headers(request.headers);
    headers.set("X-Request-ID", crypto.randomUUID().replaceAll("-", ""));
    request = new Request(request, { headers });
    return withD1Metrics(async () => {
      const url = new URL(request.url);
      const rateLimited = await metricPhase("rate_limit", () => enforceRequestRateLimit(request, env, url.pathname));
      if (rateLimited) return rateLimited;

      // vinext's standalone local server does not provide the Cloudflare
      // assets binding. Let its own static handler answer in that environment.
      const assets = (env as Partial<Env>).ASSETS;
      if (url.pathname.startsWith("/_next/static/")
        && ["GET", "HEAD"].includes(request.method)) {
        const response = assets
          ? await fetchImmutableStaticAsset(request, assets)
          : await handler.fetch(request, env, ctx);
        // Temporary production probe: proves whether Sites routed this asset
        // through the Worker, even if its ASSETS binding is absent.
        const headers = new Headers(response.headers);
        headers.set("X-Baeumzip-Asset-Route", assets ? "worker-assets" : "worker-no-assets");
        return new Response(response.body, {
          status: response.status, statusText: response.statusText, headers,
        });
      }

      if (url.pathname === "/api/internal/maintenance") {
        return handleOperationalMaintenanceRequest(request, env);
      }

      if (url.pathname === "/_vinext/image") {
        const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
        return handleImageOptimization(request, {
          fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
          transformImage: async (body, { width, format, quality }) => {
            const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
            return result.response();
          },
        }, allowedWidths);
      }

      return metricPhase("render", () => handler.fetch(request, env, ctx));
    }, { request });
  },
  async scheduled(_controller: unknown, env: Env, ctx: ExecutionContext) {
    globalThis.__BAEUMZIP_ENV__ = env;
    scheduleMaintenance(ctx);
  },
};

export default worker;
