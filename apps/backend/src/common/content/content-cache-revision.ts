import { getD1 } from "@backend/infrastructure/database";

export type RevisionRow = {
  content_version?: string;
  cache_revision?: string;
  release_version?: string;
};

export const CONTENT_CACHE_REVISION_COLUMNS_SQL = `
  COALESCE((SELECT value FROM site_settings WHERE key = 'content_revision_version'), '')
        AS content_version,
      COALESCE((SELECT value FROM site_settings WHERE key = 'content_cache_revision'), '0')
        AS cache_revision,
      COALESCE((SELECT version FROM content_releases WHERE status = 'active'
        ORDER BY activated_at DESC, created_at DESC LIMIT 1), '')
        AS release_version
`;

export function contentCacheRevisionReadStatement(database: D1Database) {
  return database.prepare(`SELECT ${CONTENT_CACHE_REVISION_COLUMNS_SQL}`);
}

export function contentCacheRevisionFromRow(row: RevisionRow | null | undefined) {
  return JSON.stringify([row?.content_version ?? "", row?.release_version ?? "", row?.cache_revision ?? "0"]);
}

export function parseContentCacheRevision(value: string): [string, string, string] | null {
  try {
    const parts: unknown = JSON.parse(value);
    return Array.isArray(parts) && parts.length === 3 && parts.every((part) => typeof part === "string")
      && JSON.stringify(parts) === value ? parts as [string, string, string] : null;
  } catch {
    return null;
  }
}

// Recheck the same three values that form contentCacheRevisionFromRow inside
// the list/detail statements of a single D1 batch. On a warm hit, SQLite can
// skip the theory scan while the first batch result still proves freshness.
export const CONTENT_REVISION_CHANGED_SQL = `(
  ? = 0
  OR COALESCE((SELECT value FROM site_settings WHERE key = 'content_revision_version'), '') != ?
  OR COALESCE((SELECT version FROM content_releases WHERE status = 'active'
    ORDER BY activated_at DESC, created_at DESC LIMIT 1), '') != ?
  OR COALESCE((SELECT value FROM site_settings WHERE key = 'content_cache_revision'), '0') != ?
)`;

export function contentRevisionChangedBindings(cached: [string, string, string] | null) {
  return [cached ? 1 : 0, ...(cached ?? ["", "", "0"])] as const;
}

export async function readContentCacheRevision(database: D1Database = getD1()) {
  return contentCacheRevisionFromRow(await contentCacheRevisionReadStatement(database).first<RevisionRow>());
}

export function contentCacheRevisionStatement(database: D1Database, updatedByHash = "system") {
  return database.prepare(`
    INSERT INTO site_settings (key, value, value_type, updated_by_hash, updated_at)
    VALUES ('content_cache_revision', ?, 'string', ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      value_type = excluded.value_type,
      updated_by_hash = excluded.updated_by_hash,
      updated_at = excluded.updated_at
  `).bind(crypto.randomUUID(), updatedByHash);
}
