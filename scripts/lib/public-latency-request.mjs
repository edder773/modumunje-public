export const MAX_STATIC_ASSET_RESPONSE_BYTES = 8 * 1024 * 1024;
export const MAX_PUBLIC_HTML_BYTES = 2 * 1024 * 1024;
export const MAX_PUBLIC_API_RESPONSE_BYTES = 8 * 1024 * 1024;

export function publicLatencyResponseByteLimit(path) {
  if (path.startsWith("/_next/static/")) return MAX_STATIC_ASSET_RESPONSE_BYTES;
  if (path.startsWith("/api/")) return MAX_PUBLIC_API_RESPONSE_BYTES;
  return MAX_PUBLIC_HTML_BYTES;
}

export function publicLatencyRequestOptions(path, agent) {
  return {
    method: "GET",
    agent,
    headers: {
      accept: path.startsWith("/api/") ? "application/json"
        : path.startsWith("/_next/static/") ? "*/*" : "text/html",
      "accept-encoding": "gzip, br",
      "user-agent": "modumunje-latency-probe/1 (read-only)",
    },
  };
}

export function countBoundedResponseBytes(response, maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new TypeError("a finite positive response byte limit is required");
  }
  return new Promise((resolve, reject) => {
    let bytes = 0;
    response.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) response.destroy(new Error(`response exceeded ${maxBytes} bytes`));
    });
    response.on("end", () => resolve(bytes));
    response.on("error", reject);
  });
}

export async function readBoundedWebText(response, maxBytes = MAX_PUBLIC_HTML_BYTES) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new Error(`response exceeded ${maxBytes} bytes`);
    }
    text += decoder.decode(value, { stream: true });
  }
}

// Cache-Control directives are comma-separated and order-independent.
export function isLongLivedImmutableCacheControl(header) {
  if (typeof header !== "string") return false;
  const directives = new Map(header.split(",").map(part => {
    const [name, ...value] = part.trim().toLowerCase().split("=");
    return [name, value.length ? value.join("=").trim().replace(/^"|"$/gu, "") : true];
  }));
  const maxAge = directives.get("max-age");
  return directives.get("public") === true && directives.get("immutable") === true
    && typeof maxAge === "string" && /^\d+$/u.test(maxAge) && Number(maxAge) >= 31_536_000
    && !["private", "no-store", "no-cache"].some(name => directives.has(name));
}
