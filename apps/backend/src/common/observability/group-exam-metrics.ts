import { instrumentD1, metricPhase, withD1Metrics } from "./d1-metrics";

export const instrumentGroupD1 = instrumentD1;
export const groupMetricPhase = metricPhase;
export const withGroupMetrics = (work: () => Promise<Response>) => withD1Metrics(async () => {
  const response = await work();
  // Group endpoints return JSON. Preserve their existing payload and serialization
  // headers while the common Worker wrapper leaves HTML and RSC streams untouched.
  const started = performance.now();
  const body = await response.arrayBuffer();
  const headers = new Headers(response.headers);
  headers.append("Server-Timing", `group_serialize;dur=${(performance.now() - started).toFixed(2)}`);
  headers.set("X-Group-Payload-Bytes", String(body.byteLength));
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}, { group: true });
