import { AsyncLocalStorage } from "node:async_hooks";
import { requestIdFor } from "@backend/common/http/api-response";

type Metrics = {
  ops: number;
  statements: number;
  d1Ms: number;
  sqlMs: number;
  maxSqlMs: number;
  rowsRead: number;
  rowsWritten: number;
  errors: number;
  phases: Record<string, number>;
  requestMemo: Map<string, Promise<unknown>>;
};

const scope = new AsyncLocalStorage<Metrics>();
const unwrapped = new WeakMap<object, D1PreparedStatement>();
let instanceHasServedRequest = false;

function freshMetrics(): Metrics {
  return { ops: 0, statements: 0, d1Ms: 0, sqlMs: 0, maxSqlMs: 0,
    rowsRead: 0, rowsWritten: 0, errors: 0, phases: {}, requestMemo: new Map() };
}

/** Share one read within a Worker request, including metadata and page rendering. */
export function memoizeD1Request<T>(key: string, work: () => Promise<T>): Promise<T> {
  const memo = scope.getStore()?.requestMemo;
  if (!memo) return work();
  const existing = memo.get(key);
  if (existing) return existing as Promise<T>;
  const pending = work();
  memo.set(key, pending);
  void pending.catch(() => {
    if (memo.get(key) === pending) memo.delete(key);
  });
  return pending;
}

function collect(metrics: Metrics, value: unknown) {
  for (const result of Array.isArray(value) ? value : [value]) {
    const meta = (result as D1Result | undefined)?.meta;
    if (!meta) continue;
    const duration = Number(meta.duration ?? 0);
    metrics.sqlMs += duration;
    metrics.maxSqlMs = Math.max(metrics.maxSqlMs, duration);
    metrics.rowsRead += Number(meta.rows_read ?? 0);
    metrics.rowsWritten += Number(meta.rows_written ?? 0);
  }
}

export function instrumentD1(db: D1Database): D1Database {
  const activeMetrics = scope.getStore();
  if (!activeMetrics) return db;
  const metrics = activeMetrics;
  async function measured<T>(statements: number, work: () => Promise<T>): Promise<T> {
    metrics.ops += 1;
    metrics.statements += statements;
    const start = performance.now();
    try {
      const value = await work();
      collect(metrics, value);
      return value;
    } catch (error) {
      metrics.errors += 1;
      throw error;
    } finally {
      metrics.d1Ms += performance.now() - start;
    }
  }
  function statement(native: D1PreparedStatement): D1PreparedStatement {
    const proxy = new Proxy(native, { get(target, key) {
      if (key === "bind") return (...values: unknown[]) => statement(target.bind(...values));
      // all() supplies D1 metadata while retaining first()'s returned row shape.
      if (key === "first") return async (column?: string) => {
        const result = await measured(1, () => target.all<Record<string, unknown>>());
        const row = result.results?.[0] ?? null;
        return column && row ? row[column] : row;
      };
      if (key === "all") return () => measured(1, () => target.all());
      if (key === "run") return () => measured(1, () => target.run());
      if (key === "raw") return (options?: { columnNames?: boolean }) =>
        measured(1, () => target.raw(options));
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    unwrapped.set(proxy, native);
    return proxy;
  }
  return new Proxy(db, { get(target, key) {
    if (key === "prepare") return (sql: string) => statement(target.prepare(sql));
    if (key === "batch") return (statements: D1PreparedStatement[]) =>
      measured(statements.length, () => target.batch(statements.map((item) => unwrapped.get(item) ?? item)));
    if (key === "exec") return (sql: string) => measured(1, () => target.exec(sql));
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}

export async function metricPhase<T>(phase: string, work: () => Promise<T>): Promise<T> {
  const metrics = scope.getStore();
  if (!metrics) return work();
  const start = performance.now();
  try { return await work(); }
  finally { recordPhase(metrics, phase, performance.now() - start); }
}

// Only bounded code-owned phase names enter response headers or diagnostic logs.
function recordPhase(metrics: Metrics | undefined, phase: string, elapsed: number) {
  if (!metrics || !/^[a-z][a-z0-9_]{0,39}$/u.test(phase)
    || (!(phase in metrics.phases) && Object.keys(metrics.phases).length >= 24)) return;
  metrics.phases[phase] = (metrics.phases[phase] ?? 0) + elapsed;
}

export function metricSyncPhase<T>(phase: string, work: () => T): T {
  const started = performance.now();
  try { return work(); }
  finally { recordPhase(scope.getStore(), phase, performance.now() - started); }
}

export function performanceRoute(pathname: string) {
  if (["/", "/about", "/login"].includes(pathname)) return pathname;
  if (["/api/study", "/api/sw-study", "/api/health", "/api/admin", "/api/events", "/api/reports",
    "/api/skct-personal", "/api/group-exams"].includes(pathname)) return pathname;
  if (pathname.startsWith("/_next/static/")) return "/_next/static/:asset";
  if (pathname.startsWith("/learn/")) return "/learn/:field/:course/:page";
  if (pathname.startsWith("/api/")) return "/api/:route";
  return "/:route";
}

function decorate(response: Response, metrics: Metrics, boot: "instance-first-fetch" | "instance-reused" | null, group: boolean, start: number, request?: Request) {
  const headers = new Headers(response.headers);
  if (boot) {
    const headersMs = performance.now() - start;
    const requestId = request ? requestIdFor(request) : requestIdFor();
    headers.set("X-Request-ID", requestId);
    const entries = [
      `app_headers;dur=${headersMs.toFixed(2)};desc="Worker to response headers; overlapping phases"`,
      `trace;desc="${requestId}"`,
      ...["rate_limit", "proxy", "identity", "context", "cache", "data", "serialize", "render"].filter(key => key in metrics.phases)
        .map(key => `${key};dur=${metrics.phases[key].toFixed(2)}`),
      `d1;dur=${metrics.d1Ms.toFixed(2)}`,
      `sql;dur=${metrics.sqlMs.toFixed(2)}`,
      `d1_ops;dur=${metrics.ops}`,
      `boot;desc="${boot}"`,
      `auth;dur=${(metrics.phases.auth ?? 0).toFixed(2)};desc="local identity and policy"`,
    ];
    headers.append("Server-Timing", entries.join(", "));
    headers.set("X-DB-Ops", String(metrics.ops));
    headers.set("X-DB-Statements", String(metrics.statements));
    // Log only slow app requests. Do not inspect stream completion or log URLs,
    // cookies, identities, body content or client-provided query parameters.
    if (request && headersMs >= 1000 && !new URL(request.url).pathname.startsWith("/_next/static/")) {
      console.info(JSON.stringify({ event: "slow_response_headers", requestId,
        route: performanceRoute(new URL(request.url).pathname), method: request.method,
        status: response.status, headersMs: Math.round(headersMs), d1Ms: Math.round(metrics.d1Ms),
        d1Ops: metrics.ops, phases: metrics.phases, boot }));
    }
  }
  if (group) {
    const groupEntries = [
      `group_total;dur=${(performance.now() - start).toFixed(2)}`,
      `group_d1;dur=${metrics.d1Ms.toFixed(2)}`,
      `group_sql;dur=${metrics.sqlMs.toFixed(2)}`,
      `group_sql_max;dur=${metrics.maxSqlMs.toFixed(2)}`,
      ...Object.entries(metrics.phases).map(([key, ms]) => `group_${key};dur=${ms.toFixed(2)}`),
    ];
    headers.append("Server-Timing", groupEntries.join(", "));
    headers.set("X-Group-DB-Ops", String(metrics.ops));
    headers.set("X-Group-DB-Statements", String(metrics.statements));
    headers.set("X-Group-Rows-Read", String(metrics.rowsRead));
    headers.set("X-Group-Rows-Written", String(metrics.rowsWritten));
    headers.set("X-Group-DB-Errors", String(metrics.errors));
    // Content-Length may be absent for streams; do not consume a response to measure its size.
    const contentLength = headers.get("Content-Length");
    if (contentLength) headers.set("X-Group-Payload-Bytes", contentLength);
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function withD1Metrics(work: () => Promise<Response>, options: { group?: boolean; request?: Request } = {}) {
  const existing = scope.getStore();
  const started = performance.now();
  if (existing) {
    const response = await work();
    return options.group ? decorate(response, existing, null, true, started) : response;
  }
  const metrics = freshMetrics();
  const boot = instanceHasServedRequest ? "instance-reused" : "instance-first-fetch";
  instanceHasServedRequest = true;
  return scope.run(metrics, async () => decorate(await work(), metrics, boot, Boolean(options.group), started, options.request));
}
