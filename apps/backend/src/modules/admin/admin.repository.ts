import { DatabaseRepository } from "@backend/infrastructure/database/database.repository";
import { contentCacheRevisionStatement } from "@backend/common/content/content-cache-revision";
import { invalidateLocalPublicContentCache } from "@backend/common/content/public-content-cache";
import { changesPublicContent } from "./admin-content-cache-policy";

export type SqlCommand = {
  sql: string;
  values?: unknown[];
};

export class AdminRepository extends DatabaseRepository {
  async all<T extends Record<string, unknown>>(sql: string, values: unknown[] = []) {
    const result = await this.connection().prepare(sql).bind(...values).all<T>();
    return result.results ?? [];
  }

  first<T extends Record<string, unknown>>(sql: string, values: unknown[] = []) {
    return this.connection().prepare(sql).bind(...values).first<T>();
  }

  async execute(sql: string, values: unknown[] = []) {
    if (changesPublicContent(sql)) return (await this.batch([{ sql, values }]))[0];
    return this.connection().prepare(sql).bind(...values).run();
  }

  // Like all/first, callers supply server-authored SELECTs; no revision is published.
  async readBatch(commands: SqlCommand[]) {
    const d1 = this.connection();
    return d1.batch(commands.map(({ sql, values = [] }) => d1.prepare(sql).bind(...values)));
  }

  async batch(commands: SqlCommand[]) {
    if (!commands.length) return [];
    const d1 = this.connection();
    const statements = commands.map((command) => (
      d1.prepare(command.sql).bind(...(command.values ?? []))
    ));
    const invalidates = commands.some((command) => changesPublicContent(command.sql));
    if (invalidates) statements.push(contentCacheRevisionStatement(d1));
    const results = await d1.batch(statements);
    if (invalidates) invalidateLocalPublicContentCache();
    return results.slice(0, commands.length);
  }
}

export const adminRepository = new AdminRepository();
