import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { activateSkctBank, previewSkctBankActivation } from "../apps/backend/src/modules/admin/admin-skct-bank-use-cases";
import { sqliteD1 } from "./helpers/sqlite-d1.mjs";
import { readApprovedGroupBank } from "./helpers/approved-group-bank";

// Exercise schema compatibility through the real approved new300 activation gate.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const identity = { email: "admin@example.invalid", hash: "schema-compatibility-admin" };

async function probeBank() {
  return readApprovedGroupBank();
}

function databaseAt(version: "0558" | "0559" | "0560" | "0561" | "0562" | "0563") {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON");
  for (let number = 554; number <= Number(version); number += 1) {
    const name = { 554: "0554_schema_baseline.sql", 555: "0555_ipe_practical_subject.sql",
      556: "0556_retire_theory_progress.sql", 557: "0557_information_security_courses.sql",
      558: "0558_skct_group_exams.sql", 559: "0559_skct_group_improvements.sql",
      560: "0560_skct_personal_progress.sql", 561: "0561_skct_personal_staged.sql",
      562: "0562_guest_import_receipts.sql", 563: "0563_skct_personal_continuous.sql" }[number];
    assert.ok(name);
    database.exec(readFileSync(path.join(root, "apps/backend/drizzle", name), "utf8"));
  }
  assert.equal(database.prepare("SELECT migration_version FROM app_schema_state WHERE id=1").get()?.migration_version, version);
  return database;
}

function addBackup(database: DatabaseSync, schemaVersion: string, type: "full" | "auto-full" = "full") {
  database.prepare(`INSERT INTO backup_snapshots (id,backup_type,status,schema_version,app_version,included_data,
    counts,checksum,payload,byte_size,created_by_hash,created_at,error_message)
    VALUES ('schema-probe-backup',?,'completed',?,'test','[]','{}',?,'{}',2,'schema-probe',?,'')`)
    .run(type, schemaVersion, "e".repeat(64), new Date().toISOString());
}

test("approved new300 activation requires the matching full backup schema from 0559 through 0563", async () => {
  const bank = await probeBank();
  const preview = await previewSkctBankActivation(bank);
  assert.equal(preview.eligibleCount, 300);
  for (const [version, backupSchema] of [
    ["0559", "admin-6"], ["0560", "admin-7"], ["0561", "admin-8"],
    ["0562", "admin-9"], ["0563", "admin-9"],
  ] as const) {
    const database = databaseAt(version);
    const previous = globalThis.__BAEUMZIP_ENV__;
    addBackup(database, backupSchema);
    globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(database) as unknown as D1Database };
    try {
      const result = await activateSkctBank(identity, bank, preview.confirmation);
      assert.equal(result.activated, true);
      assert.equal(result.replayed, false);
      assert.equal(database.prepare("SELECT COUNT(*) AS n FROM skct_question_public").get()?.n, 300);
      assert.equal(database.prepare("SELECT COUNT(*) AS n FROM skct_question_secret").get()?.n, 300);
      assert.equal(database.prepare("SELECT COUNT(*) AS n FROM admin_audit_logs WHERE action='skct_bank_activated'").get()?.n, 1);
      assert.equal(database.prepare("SELECT status FROM skct_content_releases").get()?.status, "active");
      if (version === "0561") {
        assert.equal(database.prepare("SELECT COUNT(*) AS n FROM skct_personal_releases").get()?.n, 0);
      }
      const replay = await activateSkctBank(identity, bank, preview.confirmation);
      assert.equal(replay.replayed, true);
      assert.equal(database.prepare("SELECT COUNT(*) AS n FROM admin_audit_logs WHERE action='skct_bank_activated'").get()?.n, 1);
    } finally {
      database.close();
      globalThis.__BAEUMZIP_ENV__ = previous;
    }
  }
});

test("current schema 0563 accepts a matching recent automatic full backup", async () => {
  const bank = await probeBank();
  const preview = await previewSkctBankActivation(bank);
  const database = databaseAt("0563");
  const previous = globalThis.__BAEUMZIP_ENV__;
  addBackup(database, "admin-9", "auto-full");
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(database) as unknown as D1Database };
  try {
    const result = await activateSkctBank(identity, bank, preview.confirmation);
    assert.equal(result.activated, true);
    assert.equal(result.replayed, false);
  } finally {
    database.close();
    globalThis.__BAEUMZIP_ENV__ = previous;
  }
});

test("older and future full backup versions cannot authorize current schema 0563 activation", async () => {
  const bank = await probeBank();
  const preview = await previewSkctBankActivation(bank);
  for (const incompatible of ["admin-6", "admin-7", "admin-8", "admin-10"]) {
    const database = databaseAt("0563");
    const previous = globalThis.__BAEUMZIP_ENV__;
    addBackup(database, incompatible);
    globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(database) as unknown as D1Database };
    try {
      await assert.rejects(activateSkctBank(identity, bank, preview.confirmation), /admin-9 full backup/u);
      assert.equal(database.prepare("SELECT COUNT(*) AS n FROM skct_content_releases").get()?.n, 0);
      assert.equal(database.prepare("SELECT COUNT(*) AS n FROM admin_audit_logs WHERE action='skct_bank_activated'").get()?.n, 0);
    } finally {
      database.close();
      globalThis.__BAEUMZIP_ENV__ = previous;
    }
  }
});

test("schema 0558 still rejects group-bank activation", async () => {
  const bank = await probeBank();
  const preview = await previewSkctBankActivation(bank);
  const database = databaseAt("0558");
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(database) as unknown as D1Database };
  try {
    await assert.rejects(activateSkctBank(identity, bank, preview.confirmation), /schema 0559/u);
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM skct_content_releases").get()?.n, 0);
  } finally {
    database.close();
    globalThis.__BAEUMZIP_ENV__ = previous;
  }
});

test("unreviewed future schema versions reject group-bank activation", async () => {
  const bank = await probeBank();
  const preview = await previewSkctBankActivation(bank);
  for (const version of ["0600", "0999"]) {
    const database = databaseAt("0561");
    database.prepare("UPDATE app_schema_state SET migration_version=? WHERE id=1").run(version);
    const previous = globalThis.__BAEUMZIP_ENV__;
    globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(database) as unknown as D1Database };
    try {
      await assert.rejects(activateSkctBank(identity, bank, preview.confirmation), /schema 0559/u);
      assert.equal(database.prepare("SELECT COUNT(*) AS n FROM skct_content_releases").get()?.n, 0);
    } finally {
      database.close();
      globalThis.__BAEUMZIP_ENV__ = previous;
    }
  }
});
