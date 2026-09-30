const HASHED_CHUNK = /^\/_next\/static\/chunks\/[^/]+-[A-Za-z0-9_-]{8,16}\.js$/u;
const HASHED_STYLESHEET = /^\/_next\/static\/css\/[^/]+\.[A-Za-z0-9_-]{8,16}\.css$/u;
export const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

export function isImmutableStaticAssetPath(pathname: string): boolean {
  return HASHED_CHUNK.test(pathname) || HASHED_STYLESHEET.test(pathname);
}

export async function fetchImmutableStaticAsset(
  request: Request,
  assets: Pick<Fetcher, "fetch">,
): Promise<Response> {
  const response = await assets.fetch(request);
  const pathname = new URL(request.url).pathname;
  if (!isImmutableStaticAssetPath(pathname) || ![200, 304].includes(response.status)) return response;

  const contentType = response.headers.get("content-type") ?? "";
  const expectedType = pathname.endsWith(".css") ? /text\/css/iu : /(?:javascript|ecmascript)/iu;
  const existingPolicy = response.headers.get("cache-control") ?? "";
  // A 304 without MIME evidence keeps its original policy.
  if (!expectedType.test(contentType)
    || /(?:private|no-store)/iu.test(existingPolicy)
    || response.headers.has("set-cookie")) return response;

  const headers = new Headers(response.headers);
  headers.set("Cache-Control", IMMUTABLE_CACHE_CONTROL);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
