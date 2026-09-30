import type { Plugin } from "vite";

const VINEXT_REQUEST_PIPELINE_SUFFIX = "/vinext/dist/server/request-pipeline.js";
const UNSAFE_REQUEST_COPY = "cloned = new Request(url, request);";
const SAFE_REQUEST_COPY = [
  "const requestInitSource = request.body && !request.bodyUsed ? request.clone() : request;",
  "\t\tcloned = new Request(url, requestInitSource);",
].join("\n");

// vinext 1.0.0-beta.9 passes a Request as RequestInit when rewriting a URL.
// Node accepts that shape but transfers the original body stream, so the next
// route-pipeline copy fails on the first POST handled by a cold worker. Apply a
// build-time, version-guarded clone until the upstream runtime ships the fix.
export function preserveVinextRequestBodies(): Plugin {
  return {
    name: "baeumzip:preserve-vinext-request-bodies",
    enforce: "pre",
    transform(code, id) {
      const normalizedId = id.replaceAll("\\", "/").split("?", 1)[0] ?? "";
      if (!normalizedId.endsWith(VINEXT_REQUEST_PIPELINE_SUFFIX)) return null;

      const occurrences = code.split(UNSAFE_REQUEST_COPY).length - 1;
      if (occurrences !== 1) {
        throw new Error(
          `Unsupported vinext request pipeline: expected one unsafe Request copy, found ${occurrences}.`,
        );
      }
      return {
        code: code.replace(UNSAFE_REQUEST_COPY, SAFE_REQUEST_COPY),
        map: null,
      };
    },
  };
}
