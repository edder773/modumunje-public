// Local regression adapter: records SQL and enforces D1's binding ceiling.
export function sqliteD1(database, queries = []) {
  let roundTrips = 0;
  class Statement {
    constructor(sql) { this.sql = sql; this.values = []; }
    bind(...values) {
      if (values.length > 100) throw new Error("D1 binding limit exceeded");
      this.values = values;
      return this;
    }
    execute() {
      queries.push({ sql: this.sql, values: this.values });
      const results = database.prepare(this.sql).all(...this.values);
      return { success: true, results, meta: database.prepare("SELECT changes() AS changes, last_insert_rowid() AS last_row_id").get() };
    }
    async all() { roundTrips += 1; return this.execute(); }
    async run() { roundTrips += 1; return this.execute(); }
    async first(column) { roundTrips += 1; const row = this.execute().results[0] ?? null; return column && row ? row[column] : row; }
    async raw() { roundTrips += 1; return this.execute().results.map(Object.values); }
  }
  return {
    get roundTrips() { return roundTrips; },
    prepare: (sql) => new Statement(sql),
    async batch(statements) {
      roundTrips += 1;
      database.exec("BEGIN");
      try {
        const results = statements.map((statement) => statement.execute());
        database.exec("COMMIT");
        return results;
      } catch (error) { database.exec("ROLLBACK"); throw error; }
    },
  };
}
