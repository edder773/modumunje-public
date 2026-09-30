type CacheOptions = {
  ttlMs: number;
  maxItems: number;
  maxBytes: number;
  maxEntryBytes?: number;
  maxPending?: number;
};

type CacheRead<T> = {
  namespace: string;
  key: string;
  revision: string;
  loader: () => Promise<T>;
};

type CacheEntry = {
  body: string;
  bytes: number;
  expiresAt: number;
};

const encoder = new TextEncoder();

export function createPublicContentCache(options: CacheOptions) {
  const entries = new Map<string, CacheEntry>();
  const pending = new Map<string, Promise<string | undefined>>();
  const maxEntryBytes = options.maxEntryBytes ?? Math.max(1, options.maxBytes);
  let totalBytes = 0;
  let generation = 0;

  function cacheKey(input: Pick<CacheRead<unknown>, "namespace" | "key" | "revision">) {
    return JSON.stringify([input.revision, input.namespace, input.key]);
  }

  function remove(key: string) {
    const existing = entries.get(key);
    if (!existing) return;
    entries.delete(key);
    totalBytes -= existing.bytes;
  }

  function prune() {
    while (entries.size > options.maxItems || totalBytes > options.maxBytes) {
      const oldest = entries.keys().next().value;
      if (!oldest) break;
      remove(oldest);
    }
  }

  async function read<T>(input: CacheRead<T>): Promise<T> {
    const key = cacheKey(input);
    const existing = entries.get(key);
    if (existing && existing.expiresAt > Date.now()) {
      entries.delete(key);
      entries.set(key, existing);
      return JSON.parse(existing.body) as T;
    }
    if (existing) remove(key);
    const inFlight = pending.get(key);
    if (inFlight) {
      const body = await inFlight;
      return (body === undefined ? undefined : JSON.parse(body)) as T;
    }
    if (pending.size >= (options.maxPending ?? options.maxItems)) return input.loader();

    const startedGeneration = generation;
    const request = input.loader().then((value) => {
      const serialized = JSON.stringify(value);
      const bytes = serialized === undefined ? maxEntryBytes + 1 : encoder.encode(serialized).byteLength;
      if (serialized !== undefined && generation === startedGeneration
        && bytes <= maxEntryBytes && bytes <= options.maxBytes) {
        remove(key);
        entries.set(key, { body: serialized, bytes, expiresAt: Date.now() + options.ttlMs });
        totalBytes += bytes;
        prune();
      }
      return serialized;
    }).finally(() => {
      if (pending.get(key) === request) pending.delete(key);
    });
    pending.set(key, request);
    const body = await request;
    return (body === undefined ? undefined : JSON.parse(body)) as T;
  }

  function peek<T>(namespace: string, key: string): { revision: string; value: T } | null {
    // LRU order is newest last. Return a copy, just as read() does, and never
    // revive an expired or invalidated entry.
    for (const [entryKey, entry] of [...entries].reverse()) {
      const [revision, entryNamespace, entryPath] = JSON.parse(entryKey) as [string, string, string];
      if (entryNamespace !== namespace || entryPath !== key) continue;
      if (entry.expiresAt <= Date.now()) { remove(entryKey); continue; }
      entries.delete(entryKey);
      entries.set(entryKey, entry);
      return { revision, value: JSON.parse(entry.body) as T };
    }
    return null;
  }

  return {
    read,
    peek,
    invalidate() {
      generation += 1;
      entries.clear();
      pending.clear();
      totalBytes = 0;
    },
    diagnostics() {
      return { items: entries.size, bytes: totalBytes, pending: pending.size, keys: [...entries.keys()] };
    },
  };
}

const publicContentCache = createPublicContentCache({
  ttlMs: 5 * 60_000,
  maxItems: 96,
  maxBytes: 8 * 1024 * 1024,
  maxEntryBytes: 512 * 1024,
});

export function readPublicContentCache<T>(input: CacheRead<T>) {
  return publicContentCache.read(input);
}

export function peekPublicContentCache<T>(namespace: string, key: string) {
  return publicContentCache.peek<T>(namespace, key);
}

export function invalidateLocalPublicContentCache() {
  publicContentCache.invalidate();
}
