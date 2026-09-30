import { getD1 } from "@backend/infrastructure/database";
import type { LearnerAccountRow } from "./admin-auth";
import { CONTENT_CACHE_REVISION_COLUMNS_SQL, contentCacheRevisionFromRow, contentCacheRevisionReadStatement,
  type RevisionRow } from "@backend/common/content/content-cache-revision";

type Options = { includeRevision?: boolean; includeSetting?: boolean };
type Result = D1Result<Record<string,unknown>>;

export function learnerContextPlan(database: D1Database, userKey: string | null, options: Options = {}) {
  // Anonymous content reads still check live controls and revision on every
  // request. One snapshot/statement reduces batch overhead without TTLs or
  // relying on cross-POP invalidation. No account or personal setting is read.
  if (userKey === null && options.includeRevision) {
    return {
      statements: [database.prepare(`SELECT
        COALESCE(json_group_array(json_object('key', key, 'value', value)), '[]') AS site_rows_json,
        ${CONTENT_CACHE_REVISION_COLUMNS_SQL}
        FROM site_settings WHERE key IN ('site_notice','maintenance_mode','default_exam_mode')`)],
      parse(results: Result[]) {
        const row = results[0]?.results?.[0];
        return { siteRows: JSON.parse(String(row?.site_rows_json ?? "[]")) as Array<{key:string;value:string}>,
          accountRow: null, settingRow: null, revision: contentCacheRevisionFromRow(row as RevisionRow | undefined) };
      },
    };
  }
  const statements: D1PreparedStatement[] = [database.prepare(`SELECT key,value FROM site_settings
    WHERE key IN ('site_notice','maintenance_mode','default_exam_mode')`)];
  const accountIndex=userKey===null ? -1 : statements.push(database.prepare(`SELECT user_key,email,display_name,status,blocked_reason
    FROM user_accounts WHERE user_key=?`).bind(userKey))-1;
  const settingIndex=!userKey || !options.includeSetting ? -1 : statements.push(database.prepare(`SELECT user_key AS userKey,
    selected_exam AS selectedExam,created_at AS createdAt,updated_at AS updatedAt FROM user_settings
    WHERE user_key=? LIMIT 1`).bind(userKey))-1;
  const revisionIndex=!options.includeRevision ? -1 : statements.push(contentCacheRevisionReadStatement(database))-1;
  return {
    statements,
    parse(results: Result[]) {
      return {
        siteRows: (results[0]?.results ?? []) as Array<{key:string;value:string}>,
        accountRow: accountIndex<0 ? null : (results[accountIndex]?.results?.[0] as LearnerAccountRow | undefined) ?? null,
        settingRow: settingIndex<0 ? null : (results[settingIndex]?.results?.[0] as Record<string,unknown> | undefined) ?? null,
        revision: revisionIndex<0 ? "" : contentCacheRevisionFromRow(results[revisionIndex]?.results?.[0] as RevisionRow | undefined),
      };
    },
  };
}

export async function readLearnerRequestContext(database: D1Database, userKey: string | null, options: Options = {}) {
  const plan=learnerContextPlan(database,userKey,options);
  return plan.parse(await database.batch(plan.statements));
}

// Services request an auth context without opening database connections themselves.
export function readRuntimeLearnerRequestContext(userKey: string | null, options: Options = {}) {
  return readLearnerRequestContext(getD1(), userKey, options);
}
