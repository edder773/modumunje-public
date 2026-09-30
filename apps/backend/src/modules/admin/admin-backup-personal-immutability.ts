import { RESTORE_TABLES } from "@shared/admin/backup-contract.mjs";
import { firstRow, type D1Row, type SqlCommand } from "./admin-use-case-runtime";

export const IMMUTABLE_PERSONAL_TABLES = new Set([
  "skct_personal_releases",
  "skct_personal_public_items",
  "skct_personal_secret_items",
]);

export function immutablePersonalConflictAction(table: string) {
  const spec = RESTORE_TABLES[table as keyof typeof RESTORE_TABLES];
  const keys = Array.isArray(spec.primaryKey) ? spec.primaryKey : [spec.primaryKey];
  const guardedColumn = table === "skct_personal_releases"
    ? "content_sha256"
    : spec.columns.find(column => !keys.includes(column));
  if (!guardedColumn) throw new Error(`${table} 불변 원본 보호 열이 없습니다.`);
  const differs = spec.columns
    .map(column => `\`${table}\`.\`${column}\` IS NOT excluded.\`${column}\``)
    .join(" OR ");
  // Equal rows remain untouched. A conflicting row invokes the 0561 immutability trigger,
  // aborting the same D1 batch transaction rather than silently succeeding.
  return `DO UPDATE SET \`${guardedColumn}\` = excluded.\`${guardedColumn}\` WHERE ${differs}`;
}

export function immutablePersonalCountGuards(data: Record<string, D1Row[]>): SqlCommand[] {
  return [...IMMUTABLE_PERSONAL_TABLES]
    .filter(table => Object.hasOwn(data, table))
    .map(table => ({
      // SQLite CASE is lazy; integer overflow aborts the D1 batch if an extra row
      // appeared after preflight or a required row was not restored.
      sql: `SELECT CASE WHEN (SELECT COUNT(*) FROM \`${table}\`) = ? THEN 1 ELSE abs(-9223372036854775808) END AS restored_count`,
      values: [(data[table] ?? []).length],
    }));
}

// The personal SKCT source bank has database triggers that forbid replacement.
// Verify existing rows before any restore mutation; matching rows can be reused.
export async function verifyImmutablePersonalRows(data: Record<string, D1Row[]>, fullReplace: boolean) {
  for (const table of IMMUTABLE_PERSONAL_TABLES) {
    if (!Object.hasOwn(data,table)) continue;
    const incoming = data[table] ?? [];
    const spec = RESTORE_TABLES[table as keyof typeof RESTORE_TABLES];
    const keys = Array.isArray(spec.primaryKey) ? spec.primaryKey : [spec.primaryKey];
    const seenKeys = new Set<string>();
    for (const row of incoming) {
      const key = JSON.stringify(keys.map(column => row[column]));
      if (seenKeys.has(key)) throw new Error(`${table} 백업에 중복 기본 키가 있어 복원을 중단했습니다.`);
      seenKeys.add(key);
    }
    const join = keys.map(column => `existing.\`${column}\` IS json_extract(item.value, '$.${column}')`).join(" AND ");
    const differs = spec.columns.map(column => `existing.\`${column}\` IS NOT json_extract(item.value, '$.${column}')`).join(" OR ");
    const existingCount = Number((await firstRow<{ count: number }>(`SELECT COUNT(*) AS count FROM \`${table}\``))?.count ?? 0);
    let matchedCount = 0;
    for (let start=0; start<incoming.length; start+=20) {
      const chunk = incoming.slice(start,start+20);
      const result = await firstRow<{ matched: number; conflicts: number }>(`SELECT
        COALESCE(SUM(CASE WHEN ${differs} THEN 0 ELSE 1 END),0) AS matched,
        COALESCE(SUM(CASE WHEN ${differs} THEN 1 ELSE 0 END),0) AS conflicts
        FROM json_each(?) item JOIN \`${table}\` existing ON ${join}`, [JSON.stringify(chunk)]);
      if (Number(result?.conflicts ?? 0) > 0) throw new Error(`${table} 원본이 백업과 달라 복원을 중단했습니다.`);
      matchedCount += Number(result?.matched ?? 0);
    }
    if (fullReplace && matchedCount !== existingCount)
      throw new Error(`${table} 불변 원본 범위가 백업과 달라 전체 교체를 중단했습니다.`);
  }
}
