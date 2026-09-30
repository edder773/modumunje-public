import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrations = path.join(root, "apps/backend/drizzle");
const names = fs.readdirSync(migrations).filter(name => /^\d{4}_.+\.sql$/u.test(name)).sort();
const receiptMigration = names.find(name => /^0562_/u.test(name));

test("0562 preserves legacy markers and raw reapplication leaves receipts unchanged", () => {
  assert.ok(receiptMigration, "0562 receipt migration must exist");
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  try {
    for (const name of names.filter(name => name < receiptMigration)) db.exec(fs.readFileSync(path.join(migrations, name), "utf8"));
    db.exec("INSERT INTO user_accounts(user_key) VALUES('legacy-user')");
    db.exec("INSERT INTO guest_import_batches(user_key,import_id) VALUES('legacy-user','old-import')");
    const migration = fs.readFileSync(path.join(migrations, receiptMigration), "utf8");
    db.exec("BEGIN IMMEDIATE");
    assert.throws(() => db.exec(`${migration}\nSELECT * FROM __forced_failure__;`));
    db.exec("ROLLBACK");
    assert.equal(db.prepare("SELECT migration_version AS value FROM app_schema_state").get().value, "0561");
    assert.equal(db.prepare("SELECT COUNT(*) AS value FROM sqlite_master WHERE name='guest_import_receipts'").get().value, 0);
    db.exec("BEGIN IMMEDIATE"); db.exec(migration); db.exec("COMMIT");
    assert.equal(db.prepare("SELECT COUNT(*) AS value FROM guest_import_batches").get().value, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS value FROM guest_import_receipts").get().value, 0);
    db.exec("INSERT INTO guest_import_batches(user_key,import_id) VALUES('legacy-user','new-import')");
    db.prepare("INSERT INTO guest_import_receipts(user_key,import_id,payload_digest) VALUES('legacy-user','new-import',?)")
      .run("a".repeat(64));
    const before = db.prepare("SELECT * FROM guest_import_receipts").all();
    db.exec("BEGIN IMMEDIATE"); db.exec(migration); db.exec("COMMIT");
    assert.deepEqual(db.prepare("SELECT * FROM guest_import_receipts").all(), before);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { db.close(); }
});

test("orphan receipts fail atomically at commit", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  try {
    for (const name of names) db.exec(fs.readFileSync(path.join(migrations, name), "utf8"));
    db.exec("INSERT INTO user_accounts(user_key) VALUES('owner')");
    db.exec("BEGIN IMMEDIATE");
    db.prepare("INSERT INTO guest_import_receipts(user_key,import_id,payload_digest) VALUES('owner','unsealed',?)")
      .run("b".repeat(64));
    assert.throws(() => db.exec("COMMIT"), /FOREIGN KEY constraint failed/u);
    db.exec("ROLLBACK");
    assert.equal(db.prepare("SELECT COUNT(*) AS value FROM guest_import_receipts").get().value, 0);
  } finally { db.close(); }
});
