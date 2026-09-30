import assert from "node:assert/strict";
import test from "node:test";
import { readPracticeMutationContext } from "../apps/backend/src/modules/study/study-attempt.repository-query";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";
import { sqliteD1 } from "./helpers/sqlite-d1.mjs";

test("practice mutation reads account, live controls, question and content version in one batch", async () => {
  const database = openCanonicalTestDatabase(process.cwd());
  const d1 = sqliteD1(database);
  const input = { email: "practice-context@example.test", userKey: "practice-context-test-key",
    questionId: 999999999, adminBypassMaintenance: false };
  try {
    database.prepare(`INSERT INTO site_settings(key,value,value_type,updated_by_hash,updated_at)
      VALUES('content_revision_version','p1-test-v1','string','test',CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run();
    let before = d1.roundTrips;
    const first = await readPracticeMutationContext(d1 as unknown as D1Database, input);
    assert.equal(d1.roundTrips - before, 1);
    assert.equal(first.account?.userKey, input.userKey);
    assert.equal(first.question, null);
    assert.equal(JSON.parse(first.contentRevision)[0], "p1-test-v1");
    database.prepare("UPDATE site_settings SET value='true' WHERE key='maintenance_mode'").run();
    database.prepare("UPDATE site_settings SET value='p1-test-v2' WHERE key='content_revision_version'").run();
    before = d1.roundTrips;
    const changed = await readPracticeMutationContext(d1 as unknown as D1Database, input);
    assert.equal(d1.roundTrips - before, 1);
    assert.equal(changed.siteSettings.find(row => row.key === "maintenance_mode")?.value, "true");
    assert.equal(JSON.parse(changed.contentRevision)[0], "p1-test-v2");
    const fresh = { ...input, email: "new-practice-context@example.test", userKey: "new-practice-context-key" };
    const denied = await readPracticeMutationContext(d1 as unknown as D1Database, fresh);
    assert.equal(denied.account, null);
    const admin = await readPracticeMutationContext(d1 as unknown as D1Database,
      { ...fresh, adminBypassMaintenance: true });
    assert.equal(admin.account?.userKey, fresh.userKey);
  } finally {
    database.close();
  }
});
