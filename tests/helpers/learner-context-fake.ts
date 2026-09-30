type LearnerAccountRow = {
  user_key: string;
  email: string;
  display_name: string;
  status: "active" | "blocked";
  blocked_reason: string;
};

/** Minimal D1 read fake for the shared learner context. Unknown SQL fails the test. */
export function learnerContextDatabase(account: LearnerAccountRow) {
  function rows(sql: string, values: unknown[]): Record<string, unknown>[] {
    if (/\bFROM\s+user_accounts\b/iu.test(sql)) {
      return values[0] === account.user_key ? [account] : [];
    }
    if (/\bFROM\s+user_settings\b/iu.test(sql)) return [];
    if (/\bAS\s+content_version\b/iu.test(sql)) {
      return [{ content_version: "", cache_revision: "0", release_version: "" }];
    }
    if (/\bFROM\s+site_settings\b/iu.test(sql)) return [];
    throw new Error(`Unexpected learner context query: ${sql.trim().slice(0, 80)}`);
  }

  return {
    prepare(sql: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...bound: unknown[]) {
          values = bound;
          return statement;
        },
        async first() {
          return rows(sql, values)[0] ?? null;
        },
        async all() {
          return { success: true, results: rows(sql, values) };
        },
      };
      return statement;
    },
    async batch(statements: Array<{ all(): Promise<{ success: boolean; results: Record<string, unknown>[] }> }>) {
      return Promise.all(statements.map((statement) => statement.all()));
    },
  };
}
