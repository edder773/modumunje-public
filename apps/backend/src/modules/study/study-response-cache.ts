import { metricPhase, metricSyncPhase } from "@backend/common/observability/d1-metrics";
import {
  readSharedPublicResponse,
  storeSharedPublicResponse,
} from "@backend/common/http/shared-response-cache";

const PUBLIC_CACHE_TTL_MS = 60_000;
const PUBLIC_CACHE_LIMIT = 64;
const PUBLIC_CACHE_BYTES = 8 * 1024 * 1024;
let cachedBytes = 0;

type PublicCacheEntry = {
  body: string;
  etag: string;
  expiresAt: number;
  bytes: number;
};

const publicStudyResponseCache = new Map<string, PublicCacheEntry>();

function removeEntry(key: string) {
  cachedBytes -= publicStudyResponseCache.get(key)?.bytes ?? 0;
  publicStudyResponseCache.delete(key);
}

function responseHeaders(cacheControl: string, etag?: string, isPrivate = false) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": cacheControl,
    "X-Content-Type-Options": "nosniff",
    "X-Baeumzip-Content-Version": __BAEUMZIP_BUILD_SHA__.slice(0, 12),
  });
  if (isPrivate) headers.set("Vary", "Cookie");
  if (etag) headers.set("ETag", etag);
  return headers;
}

function requestMatchesEtag(request: Request, etag: string) {
  const ifNoneMatch = request.headers.get("if-none-match");
  if (!ifNoneMatch) return false;
  if (ifNoneMatch.trim() === "*") return true;
  const normalizedEtag = etag.replace(/^W\//u, "");
  return ifNoneMatch.split(",").some((candidate) => (
    candidate.trim().replace(/^W\//u, "") === normalizedEtag
  ));
}

function responseFromEntry(
  request: Request,
  entry: PublicCacheEntry,
  cacheControl: string,
  cacheSource?: "memory" | "edge",
) {
  const headers = responseHeaders(cacheControl, entry.etag);
  if (cacheSource) headers.set("X-Baeumzip-Cache", cacheSource);
  return requestMatchesEtag(request, entry.etag)
    ? new Response(null, { status: 304, headers })
    : new Response(entry.body, { status: 200, headers });
}

export function readPublicStudyResponseCache(
  request: Request,
  cacheKey: string,
  cacheControl: string,
) {
  return metricSyncPhase("cache", () => {
  const cached = publicStudyResponseCache.get(cacheKey);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    removeEntry(cacheKey);
    return null;
  }
  return responseFromEntry(request, cached, cacheControl, "memory");
  });
}

export function sharedStudyCacheKey(
  scope: string,
  selectedExam: string,
  searchParams: URLSearchParams,
  contentRevision = "",
) {
  const normalizedScope = scope === "bootstrap" ? "overview" : scope;
  if (!["shell", "overview", "theories", "theory", "practice-meta", "questions"].includes(normalizedScope)) {
    return null;
  }
  const key = new URLSearchParams({ scope: normalizedScope });
  if (contentRevision && normalizedScope !== "shell") key.set("revision", contentRevision);
  if (!["shell", "overview"].includes(normalizedScope)) key.set("exam", selectedExam);
  if (normalizedScope === "theory") key.set("id", searchParams.get("id") ?? "");
  if (normalizedScope === "questions") key.set("ids", searchParams.get("ids") ?? "");
  key.sort();
  return key.toString();
}

export function readSharedStudyResponseCache(request: Request, cacheKey: string) {
  return readSharedPublicResponse(request, "study", cacheKey);
}

export async function studyJsonResponse(
  request: Request,
  payload: unknown,
  options: {
    isPrivate: boolean;
    privateCacheControl: string;
    publicCacheControl: string;
    publicCacheKey?: string;
    sharedCacheKey?: string;
    status?: number;
  },
) {
  const body = metricSyncPhase("serialize", () => JSON.stringify(payload));
  if (options.isPrivate) {
    return new Response(body, {
      status: options.status ?? 200,
      headers: responseHeaders(options.privateCacheControl, undefined, true),
    });
  }

  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  const etag = `"${Array.from(new Uint8Array(digest)).slice(0, 12).map((value) => value.toString(16).padStart(2, "0")).join("")}"`;
  const bytes = new TextEncoder().encode(body).byteLength;
  const entry = { body, etag, bytes, expiresAt: Date.now() + PUBLIC_CACHE_TTL_MS };
  if (options.publicCacheKey && bytes <= 512 * 1024) {
    removeEntry(options.publicCacheKey);
    while (publicStudyResponseCache.size >= PUBLIC_CACHE_LIMIT || cachedBytes + bytes > PUBLIC_CACHE_BYTES) {
      const oldestKey = publicStudyResponseCache.keys().next().value;
      if (!oldestKey) break;
      removeEntry(oldestKey);
    }
    publicStudyResponseCache.set(options.publicCacheKey, entry);
    cachedBytes += bytes;
  }
  const response = responseFromEntry(request, entry, options.publicCacheControl);
  if (options.sharedCacheKey) {
    await metricPhase("cache", () => storeSharedPublicResponse(request, "study", options.sharedCacheKey!, response));
  }
  return response;
}
