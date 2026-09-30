import { metricSyncPhase } from "@backend/common/observability/d1-metrics";
import { isIndexableLearningPath, isPublicLearningPath } from "@shared/study/learning-access";
import { type NextRequest, NextResponse } from "next/server";

const CANONICAL_HOST = "modumunje.com";
const REDIRECT_HOSTS = new Set([
  "www.modumunje.com",
  "baeumzip.site",
  "www.baeumzip.site",
  "sqlp-study-lab.edder773.chatgpt.site",
]);

function requestNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function contentSecurityPolicy(nonce: string) {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "form-action 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "media-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "upgrade-insecure-requests",
  ].join("; ");
}

function firstForwardedValue(value: string | null) {
  return value?.split(",")[0]?.trim() ?? "";
}

function applySecurityHeaders(
  response: NextResponse,
  secureCanonicalRequest: boolean,
  htmlDocumentRequest: boolean,
  policy: string,
) {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-DNS-Prefetch-Control", "off");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Permitted-Cross-Domain-Policies", "none");
  response.headers.set("Origin-Agent-Cluster", "?1");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.headers.set("Content-Security-Policy", policy);
  if (secureCanonicalRequest) {
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  }
  if (htmlDocumentRequest) {
    response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
    response.headers.set(
      "Cache-Control",
      "no-cache, no-store, must-revalidate",
    );
  }
  return response;
}

export function proxy(request: NextRequest) {
  return metricSyncPhase("proxy", () => proxyResponse(request));
}

function proxyResponse(request: NextRequest) {
  const forwardedHost = firstForwardedValue(request.headers.get("x-forwarded-host"));
  const host = (forwardedHost || request.nextUrl.host)
    .toLowerCase()
    .replace(/:\d+$/u, "");
  const forwardedProtocol = firstForwardedValue(request.headers.get("x-forwarded-proto"));
  const protocol = forwardedProtocol || request.nextUrl.protocol.replace(":", "");

  if (
    REDIRECT_HOSTS.has(host)
    || (host === CANONICAL_HOST && protocol !== "https")
  ) {
    const destination = request.nextUrl.clone();
    destination.protocol = "https:";
    destination.host = CANONICAL_HOST;
    destination.port = "";
    return NextResponse.redirect(destination, 308);
  }

  const nonce = requestNonce();
  const policy = contentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("Content-Security-Policy", policy);
  requestHeaders.set("x-nonce", nonce);

  const response = applySecurityHeaders(
    NextResponse.next({ request: { headers: requestHeaders } }),
    host === CANONICAL_HOST && protocol === "https",
    request.headers.get("accept")?.includes("text/html") ?? false,
    policy,
  );
  // Send the exclusion before streamed metadata or an authentication redirect.
  // This is a crawler instruction; authorization continues to guard private data.
  if (request.nextUrl.pathname === "/login"
    || (/^\/(?:learn|admin)(?:\/|$)/u.test(request.nextUrl.pathname)
      && !isIndexableLearningPath(request.nextUrl.pathname))) {
    response.headers.set("X-Robots-Tag", isPublicLearningPath(request.nextUrl.pathname) ? "noindex, follow" : "noindex, nofollow");
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.svg).*)"],
};
