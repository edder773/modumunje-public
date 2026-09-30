import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";
import { instrumentD1 } from "@backend/common/observability/d1-metrics";

declare global {
  var __BAEUMZIP_ENV__:
    | {
        DB?: D1Database;
        EVENT_RATE_LIMITER?: RateLimit;
        ADMIN_EMAIL?: string;
        GOOGLE_CLIENT_ID?: string;
        GOOGLE_CLIENT_SECRET?: string;
        GOOGLE_AUTH_SESSION_SECRET?: string;
        GOOGLE_OAUTH_REDIRECT_URI?: string;
        MAINTENANCE_TRIGGER_SECRET?: string;
        SKCT_GROUP_SERVICE_ENABLED?: string;
        SKCT_GROUP_V2_ENABLED?: string;
        SKCT_GROUP_REPEAT_IDENTITY_VERIFIED?: string;
        BAEUMZIP_E2E_CLIENT_BOOTSTRAP?: string;
        CANONICAL_RECOVERY_SOURCE?: "embedded" | "disabled";
        BACKUP_OBJECTS?: unknown;
        BACKUP_STORAGE_MODE?: "database" | "external";
        BACKUP_SCHEDULE_VERIFIED?: string;
      }
    | undefined;
}

type BaeumzipRuntimeEnv = NonNullable<typeof globalThis.__BAEUMZIP_ENV__>;

function localRuntimeEnv(): BaeumzipRuntimeEnv {
  const processEnvironment = (
    globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } }
  ).process?.env;
  if (!processEnvironment) return {};
  return {
    ADMIN_EMAIL: processEnvironment.ADMIN_EMAIL,
    GOOGLE_CLIENT_ID: processEnvironment.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: processEnvironment.GOOGLE_CLIENT_SECRET,
    GOOGLE_AUTH_SESSION_SECRET: processEnvironment.GOOGLE_AUTH_SESSION_SECRET,
    GOOGLE_OAUTH_REDIRECT_URI: processEnvironment.GOOGLE_OAUTH_REDIRECT_URI,
    MAINTENANCE_TRIGGER_SECRET: processEnvironment.MAINTENANCE_TRIGGER_SECRET,
    SKCT_GROUP_SERVICE_ENABLED: processEnvironment.SKCT_GROUP_SERVICE_ENABLED,
    SKCT_GROUP_V2_ENABLED: processEnvironment.SKCT_GROUP_V2_ENABLED,
    SKCT_GROUP_REPEAT_IDENTITY_VERIFIED: processEnvironment.SKCT_GROUP_REPEAT_IDENTITY_VERIFIED,
    BAEUMZIP_E2E_CLIENT_BOOTSTRAP: processEnvironment.BAEUMZIP_E2E_CLIENT_BOOTSTRAP,
    BACKUP_STORAGE_MODE: processEnvironment.BACKUP_STORAGE_MODE === "external"
      ? "external"
      : processEnvironment.BACKUP_STORAGE_MODE === "database"
        ? "database"
        : undefined,
    BACKUP_SCHEDULE_VERIFIED: processEnvironment.BACKUP_SCHEDULE_VERIFIED,
    CANONICAL_RECOVERY_SOURCE: processEnvironment.CANONICAL_RECOVERY_SOURCE === "disabled"
      ? "disabled"
      : processEnvironment.CANONICAL_RECOVERY_SOURCE === "embedded"
        ? "embedded"
        : undefined,
  };
}

function definedRuntimeEnv(environment: BaeumzipRuntimeEnv | undefined): BaeumzipRuntimeEnv {
  if (!environment) return {};
  return Object.fromEntries(
    Object.entries(environment).filter(([, value]) => value !== undefined),
  ) as BaeumzipRuntimeEnv;
}

export function getD1() {
  const binding = globalThis.__BAEUMZIP_ENV__?.DB;
  if (!binding) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }
  return instrumentD1(binding);
}

export function getDb() {
  return drizzle(getD1(), { schema });
}

export function getRuntimeEnv() {
  return {
    ...localRuntimeEnv(),
    ...definedRuntimeEnv(globalThis.__BAEUMZIP_ENV__),
  };
}
