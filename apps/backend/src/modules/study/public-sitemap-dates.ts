import { getD1 } from "@backend/infrastructure/database";

export type SitemapTheoryDates = { byScope: Map<string,string>; swUpdatedAt: string | null };

let cached: { expiresAt: number; value: Promise<SitemapTheoryDates> } | null = null;

export async function readSitemapTheoryDates(database: D1Database = getD1()): Promise<SitemapTheoryDates> {
  const [course, sw] = await database.batch([
    database.prepare(`SELECT exam_scope,MAX(updated_at) AS updated_at FROM theories
      WHERE active=1 AND updated_at<>'' GROUP BY exam_scope`),
    database.prepare(`SELECT MAX(updated_at) AS updated_at FROM sw_theories
      WHERE active=1 AND updated_at<>''`),
  ]);
  return {
    byScope: new Map(((course.results ?? []) as Array<{exam_scope:string;updated_at:string}>).map(row =>
      [row.exam_scope,row.updated_at])),
    swUpdatedAt: ((sw.results ?? []) as Array<{updated_at:string|null}>)[0]?.updated_at ?? null,
  };
}

export function cachedSitemapTheoryDates() {
  const now=Date.now();
  if (cached && now<cached.expiresAt) return cached.value;
  const value=readSitemapTheoryDates().catch(error => { if (cached?.value===value) cached=null; throw error; });
  cached={expiresAt:now+300_000,value};
  return value;
}
