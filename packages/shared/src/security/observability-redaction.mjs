const SENSITIVE_KEYS = new Set([
  "adminnote",
  "anonymoussessionid",
  "apikey",
  "authorization",
  "blockedreason",
  "clientsecret",
  "cookie",
  "description",
  "descriptiveanswer",
  "descriptiveanswers",
  "displayname",
  "email",
  "password",
  "passphrase",
  "refreshtoken",
  "secret",
  "sessionid",
  "sessiontoken",
  "setcookie",
  "token",
  "userkey",
  "userkeyhash",
]);

function normalizedKey(value) {
  return String(value).toLocaleLowerCase("en-US").replace(/[^a-z0-9]/gu, "");
}

export function redactSensitiveText(value, limit = 500) {
  const text = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [redacted]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, "[redacted-email]")
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16})\b/gu, "[redacted-token]")
    .replace(/([?&](?:access_token|auth|code|key|secret|session|token)=)[^&#\s]+/giu, "$1[redacted]")
    .replace(/\b(authorization|cookie|set-cookie)\s*[:=]\s*[^,]+/giu, "$1=[redacted]")
    .replace(/\b(password|secret|session[_-]?token|token)\s*[:=]\s*[^,;&\s]+/giu, "$1=[redacted]");
  return text.slice(0, limit);
}

export function sanitizeObservabilityValue(value, options = {}) {
  const maxDepth = options.maxDepth ?? 4;
  const maxEntries = options.maxEntries ?? 32;
  const maxStringLength = options.maxStringLength ?? 320;
  const seen = new WeakSet();

  function visit(candidate, depth) {
    if (candidate === null || typeof candidate === "boolean" || typeof candidate === "number") {
      return candidate;
    }
    if (typeof candidate === "string" || typeof candidate === "bigint") {
      return redactSensitiveText(candidate, maxStringLength);
    }
    if (typeof candidate !== "object") return String(candidate);
    if (seen.has(candidate)) return "[circular]";
    if (depth >= maxDepth) return "[truncated]";
    seen.add(candidate);

    if (Array.isArray(candidate)) {
      return candidate.slice(0, maxEntries).map((item) => visit(item, depth + 1));
    }

    const result = {};
    for (const [key, item] of Object.entries(candidate).slice(0, maxEntries)) {
      result[key] = SENSITIVE_KEYS.has(normalizedKey(key))
        ? "[redacted]"
        : visit(item, depth + 1);
    }
    return result;
  }

  return visit(value, 0);
}
