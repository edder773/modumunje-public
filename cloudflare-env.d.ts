/**
 * Minimal Cloudflare runtime declarations used by the application and
 * drizzle-orm's D1 adapter. The production implementation is injected by
 * Cloudflare; these declarations keep strict local type-checking structural.
 */
interface D1Meta {
  duration?: number;
  changes?: number;
  last_row_id?: number;
  rows_read?: number;
  rows_written?: number;
  size_after?: number;
  changed_db?: boolean;
}

interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: D1Meta;
  error?: string;
}

type D1Response = D1Result<Record<string, unknown>>;

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = D1Result<Record<string, unknown>>>(
    statements: D1PreparedStatement[],
  ): Promise<T[]>;
  exec(query: string): Promise<D1Result<Record<string, unknown>>>;
  dump(): Promise<ArrayBuffer>;
}

interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

declare const __BAEUMZIP_BUILD_SHA__: string;
declare const __BAEUMZIP_BUILT_AT__: string;
declare const __BAEUMZIP_APP_VERSION__: string;
declare const __BAEUMZIP_SCHEMA_VERSION__: string;
