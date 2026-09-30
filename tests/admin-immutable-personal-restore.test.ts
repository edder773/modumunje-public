import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { sqliteD1 } from "./helpers/sqlite-d1.mjs";

(globalThis as typeof globalThis & { __BAEUMZIP_APP_VERSION__: string }).__BAEUMZIP_APP_VERSION__ = "immutable-restore-test";

const { adminRepository } = await import("../apps/backend/src/modules/admin/admin.repository");
const { restoreStatement } = await import("../apps/backend/src/modules/admin/admin-backup-use-cases");
const { immutablePersonalCountGuards, verifyImmutablePersonalRows } = await import(
  "../apps/backend/src/modules/admin/admin-backup-personal-immutability"
);
const { withD1Metrics } = await import("../apps/backend/src/common/observability/d1-metrics");

function fixture(t: { after: (callback: () => void) => void }) {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE skct_personal_releases (
      id TEXT PRIMARY KEY NOT NULL, status TEXT NOT NULL,
      content_sha256 TEXT NOT NULL, item_count INTEGER NOT NULL,
      created_at TEXT NOT NULL, activated_at TEXT
    );
    CREATE TRIGGER skct_personal_release_content_immutable
      BEFORE UPDATE OF id,content_sha256,item_count ON skct_personal_releases
      BEGIN SELECT RAISE(ABORT,'SKCT personal release identity is immutable'); END;
    CREATE TRIGGER skct_personal_release_immutable_delete
      BEFORE DELETE ON skct_personal_releases
      BEGIN SELECT RAISE(ABORT,'SKCT personal releases are immutable'); END;
    CREATE TABLE site_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO site_settings VALUES('site_notice','original');
  `);
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(database) as never };
  t.after(() => { globalThis.__BAEUMZIP_ENV__ = previous; database.close(); });
  return database;
}

function release(id: string, hash = "a".repeat(64)) {
  return {
    id, status: "STAGED", content_sha256: hash, item_count: 300,
    created_at: "2026-09-29T00:00:00.000Z", activated_at: null,
  };
}

function insert(database: DatabaseSync, row: ReturnType<typeof release>) {
  database.prepare(`INSERT INTO skct_personal_releases
    (id,status,content_sha256,item_count,created_at,activated_at)
    VALUES(?,?,?,?,?,?)`).run(
    row.id, row.status, row.content_sha256, row.item_count, row.created_at, row.activated_at,
  );
}

function rows(database: DatabaseSync) {
  return database.prepare("SELECT * FROM skct_personal_releases ORDER BY id").all()
    .map(row => ({ ...row }));
}

async function restoreFull(data: ReturnType<typeof release>[]) {
  const payload = { skct_personal_releases: data };
  await verifyImmutablePersonalRows(payload, true);
  await adminRepository.batch([
    restoreStatement("skct_personal_releases", data),
    ...immutablePersonalCountGuards(payload),
  ]);
}

test("full restore accepts an empty database and repairs a partially lost immutable release set", async (t) => {
  const database = fixture(t);
  const a = release("A");
  const b = release("B", "b".repeat(64));
  await restoreFull([a, b]);
  assert.deepEqual(rows(database), [a, b]);
  // Simulate pre-existing data loss in an isolated fixture; the production trigger remains in force.
  database.exec("DROP TRIGGER skct_personal_release_immutable_delete");
  database.prepare("DELETE FROM skct_personal_releases WHERE id='B'").run();
  await restoreFull([a, b]);
  assert.deepEqual(rows(database), [a, b]);
});

test("full restore rejects extra existing immutable rows and differing values for the same key", async (t) => {
  const database = fixture(t);
  const a = release("A");
  insert(database, a);
  insert(database, release("C"));
  await assert.rejects(verifyImmutablePersonalRows({ skct_personal_releases: [a, release("B")] }, true),
    /불변 원본 범위/u);
  database.exec("DROP TRIGGER skct_personal_release_immutable_delete");
  database.prepare("DELETE FROM skct_personal_releases WHERE id='C'").run();
  await assert.rejects(verifyImmutablePersonalRows({ skct_personal_releases: [release("A", "d".repeat(64))] }, true),
    /원본이 백업과 달라/u);
});

test("a conflicting row inserted after preflight aborts the transactional restore", async (t) => {
  const database = fixture(t);
  const snapshot = release("A");
  const payload = { skct_personal_releases: [snapshot] };
  await verifyImmutablePersonalRows(payload, true);
  insert(database, release("A", "x".repeat(64)));
  await assert.rejects(adminRepository.batch([
    { sql: "UPDATE site_settings SET value='changed' WHERE key='site_notice'" },
    restoreStatement("skct_personal_releases", [snapshot]),
    ...immutablePersonalCountGuards(payload),
  ]), /immutable/u);
  assert.equal(database.prepare("SELECT value FROM site_settings WHERE key='site_notice'").get()?.value, "original");
  assert.equal((rows(database)[0] as ReturnType<typeof release>).content_sha256, "x".repeat(64));
});

test("an extra row inserted after preflight rolls back other restore mutations", async (t) => {
  const database = fixture(t);
  const snapshot = release("A");
  const payload = { skct_personal_releases: [snapshot] };
  await verifyImmutablePersonalRows(payload, true);
  insert(database, release("C"));
  await assert.rejects(adminRepository.batch([
    { sql: "UPDATE site_settings SET value='changed' WHERE key='site_notice'" },
    restoreStatement("skct_personal_releases", [snapshot]),
    ...immutablePersonalCountGuards(payload),
  ]), /integer overflow/u);
  assert.equal(database.prepare("SELECT value FROM site_settings WHERE key='site_notice'").get()?.value, "original");
  assert.deepEqual(rows(database), [release("C")]);
});

test("the 0561 public and secret immutability triggers abort conflicting restore upserts", async (t) => {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON");
  const migration = readFileSync(new URL("../apps/backend/drizzle/0561_skct_personal_staged.sql", import.meta.url), "utf8");
  for (const statement of migration.split("--> statement-breakpoint")
    .map(part => part.replace(/^--[^\n]*\n/gmu, "").trim())) {
    if (/^CREATE TABLE IF NOT EXISTS skct_personal_(?:releases|public_items|secret_items)\b/u.test(statement)
      || /^CREATE TRIGGER IF NOT EXISTS skct_personal_(?:public|secret)_immutable_update\b/u.test(statement)) {
      database.exec(statement);
    }
  }
  database.exec("CREATE TABLE site_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO site_settings VALUES('site_notice','original')");
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(database) as never };
  t.after(() => { globalThis.__BAEUMZIP_ENV__ = previous; database.close(); });

  const publicItem = {
    release_id: "A", source_item_id: "item-1", unit_id: "U01",
    source_batch: "synthetic", source_archive_sha256: "a".repeat(64),
    source_file: "synthetic.json", source_file_sha256: "b".repeat(64),
    source_ordinal: 1, source_schema_version: "test", public_json: "{}",
    public_sha256: "c".repeat(64), asset_refs_json: "[]",
  };
  const secretItem = {
    release_id: "A", source_item_id: "item-1", answer_index: 1,
    raw_answer_json: "{}", explanation: "synthetic",
    distractor_explanations_json: "[]", source_raw_json: "{}",
    normalization_version: "test", secret_sha256: "d".repeat(64),
  };
  await adminRepository.batch([
    restoreStatement("skct_personal_releases", [release("A")]),
    restoreStatement("skct_personal_public_items", [publicItem]),
    restoreStatement("skct_personal_secret_items", [secretItem]),
  ]);
  // Exact duplicates are accepted without issuing an UPDATE that would fire the triggers.
  await adminRepository.batch([
    restoreStatement("skct_personal_public_items", [publicItem]),
    restoreStatement("skct_personal_secret_items", [secretItem]),
  ]);

  for (const [table, changed, message] of [
    ["skct_personal_public_items", { ...publicItem, unit_id: "U02" }, /SKCT personal public content is immutable/u],
    ["skct_personal_secret_items", { ...secretItem, answer_index: 2 }, /SKCT personal secret content is immutable/u],
  ] as const) {
    const statement = restoreStatement(table, [changed]);
    assert.match(statement.sql, table === "skct_personal_public_items"
      ? /DO UPDATE SET `unit_id` = excluded\.`unit_id`/u
      : /DO UPDATE SET `answer_index` = excluded\.`answer_index`/u);
    await assert.rejects(adminRepository.batch([
      { sql: "UPDATE site_settings SET value='changed' WHERE key='site_notice'" },
      statement,
    ]), message);
    assert.equal(database.prepare("SELECT value FROM site_settings WHERE key='site_notice'").get()?.value, "original");
  }
  assert.equal(database.prepare("SELECT unit_id FROM skct_personal_public_items").get()?.unit_id, "U01");
  assert.equal(database.prepare("SELECT answer_index FROM skct_personal_secret_items").get()?.answer_index, 1);
});

test("admin batch propagates a D1 rejection with and without request metrics", async (t) => {
  const sentinel = new Error("D1 batch rejected");
  let batchCalls = 0;
  const binding = {
    prepare: (sql: string) => ({ sql, bind() { return this; } }),
    batch: async () => { batchCalls += 1; throw sentinel; },
  };
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: binding as never };
  t.after(() => { globalThis.__BAEUMZIP_ENV__ = previous; });
  const command = [{ sql: "SELECT 1" }];
  await assert.rejects(adminRepository.batch(command), error => error === sentinel);
  await assert.rejects(withD1Metrics(async () => {
    await adminRepository.batch(command);
    return new Response(null);
  }), error => error === sentinel);
  assert.equal(batchCalls, 2);
});
