/**
 * A fast first layer for bursts that reach the same Worker isolate. This layer
 * is intentionally paired with a shared binding or D1 check below; it is never
 * the sole production rate-limit authority.
 */
export function createLocalFixedWindowLimiter({ limit, windowMs, maxKeys = 2_000 }) {
  const buckets = new Map();

  return (key, now = Date.now()) => {
    let current = buckets.get(key);
    if (!current && buckets.size >= maxKeys) {
      for (const [bucketKey, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(bucketKey);
      }
      while (buckets.size >= maxKeys) {
        const oldestKey = buckets.keys().next().value;
        if (oldestKey === undefined) break;
        buckets.delete(oldestKey);
      }
      current = buckets.get(key);
    }

    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, retryAfterSeconds: 0, source: "local" };
    }

    current.count += 1;
    if (current.count <= limit) {
      return { allowed: true, retryAfterSeconds: 0, source: "local" };
    }

    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1_000)),
      source: "local",
    };
  };
}

/**
 * Uses Cloudflare's shared Rate Limiting binding when it is available. Sites
 * currently exposes D1 but not arbitrary bindings, so D1 is the fail-safe
 * shared authority for that runtime and for transient binding failures.
 */
export async function checkDistributedRateLimit({
  key,
  limit,
  windowMs,
  localLimit,
  rateLimitBinding,
  countRecent,
  now = Date.now(),
  onBindingError = () => {},
}) {
  const localDecision = localLimit(key, now);
  if (!localDecision.allowed) return localDecision;

  if (rateLimitBinding) {
    try {
      const result = await rateLimitBinding.limit({ key });
      if (result?.success === true) {
        return { allowed: true, retryAfterSeconds: 0, source: "binding" };
      }
      if (result?.success === false) {
        return {
          allowed: false,
          retryAfterSeconds: Math.ceil(windowMs / 1_000),
          source: "binding",
        };
      }
      throw new Error("Rate Limiting binding returned an invalid result");
    } catch (error) {
      await onBindingError(error);
    }
  }

  const since = new Date(now - windowMs).toISOString();
  const recentCount = Number(await countRecent(since));
  if (!Number.isFinite(recentCount) || recentCount < 0) {
    throw new Error("Distributed event rate-limit count is invalid");
  }
  if (recentCount >= limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil(windowMs / 1_000),
      source: "d1",
    };
  }
  return { allowed: true, retryAfterSeconds: 0, source: "d1" };
}
