type CloudflareCacheStorage = CacheStorage & {
  default?: Cache;
};

async function sharedCache() {
  const storage = (globalThis as typeof globalThis & { caches?: CloudflareCacheStorage }).caches;
  if (storage?.default) return storage.default;
  if (!storage?.open) return null;
  return storage.open("baeumzip-public-responses").catch(() => null);
}

function cacheRequest(request: Request, namespace: string, key: string) {
  const url = new URL(request.url);
  url.pathname = `/__baeumzip-cache/${namespace}`;
  url.search = "";
  url.searchParams.set("build", __BAEUMZIP_BUILD_SHA__.slice(0, 12));
  url.searchParams.set("key", key);
  return new Request(url, { method: "GET" });
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

export async function readSharedPublicResponse(
  request: Request,
  namespace: string,
  key: string,
) {
  const cache = await sharedCache();
  if (!cache || request.method !== "GET") return null;
  const cached = await cache.match(cacheRequest(request, namespace, key)).catch(() => undefined);
  if (!cached) return null;

  const headers = new Headers(cached.headers);
  headers.set("Cache-Control", "public, max-age=0, must-revalidate");
  headers.set("X-Baeumzip-Cache", "edge");
  const etag = headers.get("etag");
  if (etag && requestMatchesEtag(request, etag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(cached.body, {
    status: cached.status,
    statusText: cached.statusText,
    headers,
  });
}

export async function storeSharedPublicResponse(
  request: Request,
  namespace: string,
  key: string,
  response: Response,
) {
  if (response.headers.has("set-cookie")
    || /(?:private|no-store)/iu.test(response.headers.get("cache-control") ?? "")) return;
  const cache = await sharedCache();
  if (!cache || !response.ok || response.status !== 200) return;
  const cached = response.clone();
  const headers = new Headers(cached.headers);
  // Only the internal revision-addressed Cache API entry gets a storage TTL.
  headers.set("Cache-Control", "public, max-age=300");
  headers.set("X-Baeumzip-Cache", "edge");
  await cache.put(cacheRequest(request, namespace, key), new Response(cached.body, {
    status: cached.status,
    statusText: cached.statusText,
    headers,
  })).catch(() => undefined);
}
