import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { BACKUP_SCHEMA_VERSION } from "../packages/shared/src/admin/backup-contract.mjs";
import { sqliteD1 } from "./helpers/sqlite-d1.mjs";

(globalThis as typeof globalThis & { __BAEUMZIP_APP_VERSION__: string }).__BAEUMZIP_APP_VERSION__ = "theory-repair-test";
const { adminRepository } = await import("../apps/backend/src/modules/admin/admin.repository");
const { repairBatchStatements, parsePackage } = await import("../apps/backend/src/modules/admin/admin-theory-content-repair");

const version = "learning-2026.09.13.6";
const source = "a".repeat(64);
const checksum = "b".repeat(64);
const id = "11111111-1111-1111-1111-111111111111";
const rows = Array.from({ length: 106 }, (_, index) => ({
  id: index + 1, current: `이론${index + 1}내용`, target: `이론 ${index + 1} 내용`,
}));
const release = { version, source_checksum: source };
const backup = { id, checksum };
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

test("repair package accepts only the fixed 106 whitespace reversals and exact checksums", () => {
  const values = rows.map(row => ({
    id: row.id, current: row.current, target: `${row.current}\n\n`,
    currentSha256: sha(row.current), targetSha256: sha(`${row.current}\n\n`),
  }));
  const pkg = { format: "theory-whitespace-repair-v1", releaseVersion: version,
    sourceChecksum: source,
    questionChecksum: "95eb5d174893d7e8d1ffaaadaa80a65702c8c6693585d98bbec5bb1078c67fe3",
    theoryBeforeChecksum: "b05bb2c2ccbcc203372edcc543f4f20ccbefd0912cbc28896851f68c0b748ad3",
    theoryAfterChecksum: "6af0c6dff8103c63ab28237146c52365b5e48b6ff45811aa47f64426518b7955",
    contentCacheRevision: "original", backupId: id, rows: values,
  };
  assert.equal(parsePackage(pkg).rows.length, 106);
  assert.throws(() => parsePackage({ ...pkg, rows: values.slice(1) }), /계약/u);
  assert.throws(() => parsePackage({ ...pkg, rows: [values[0], ...values.slice(1, -1), values[0]] }), /중복/u);
  assert.throws(() => parsePackage({ ...pkg, rows: [{ ...values[0], target: "다른 내용" }, ...values.slice(1)] }), /역변환/u);
  assert.throws(() => parsePackage({ ...pkg, rows: [{ ...values[0], targetSha256: "a".repeat(64) }, ...values.slice(1)] }), /역변환/u);
  assert.throws(() => parsePackage({ ...pkg, unexpected: true }), /계약/u);
});

function fixture(t: { after: (callback: () => void) => void }) {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE theories(id INTEGER PRIMARY KEY, content TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE content_releases(version TEXT PRIMARY KEY, status TEXT, source_checksum TEXT,
      question_checksum TEXT, theory_checksum TEXT);
    CREATE TABLE site_settings(key TEXT PRIMARY KEY, value TEXT, value_type TEXT,
      updated_by_hash TEXT, updated_at TEXT);
    CREATE TABLE backup_snapshots(id TEXT PRIMARY KEY, status TEXT, backup_type TEXT,
      schema_version TEXT, checksum TEXT, byte_size INTEGER, created_at TEXT);
    INSERT INTO site_settings VALUES('content_cache_revision','original','string','test','2026-09-30');
  `);
  const insertTheory = db.prepare("INSERT INTO theories VALUES(?, ?, 'unchanged')");
  for (const row of rows) insertTheory.run(row.id, row.current);
  insertTheory.run(999, "이 이론은 바꾸지 않습니다.");
  db.prepare("INSERT INTO content_releases VALUES(?, 'active', ?, ?, ?)")
    .run(version, source,
      "95eb5d174893d7e8d1ffaaadaa80a65702c8c6693585d98bbec5bb1078c67fe3",
      "6af0c6dff8103c63ab28237146c52365b5e48b6ff45811aa47f64426518b7955");
  db.prepare("INSERT INTO backup_snapshots VALUES(?, 'completed', 'full', ?, ?, 10, ?)")
    .run(id, BACKUP_SCHEMA_VERSION, checksum, new Date().toISOString());
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(db) as never };
  t.after(() => { globalThis.__BAEUMZIP_ENV__ = previous; db.close(); });
  return db;
}

function statements() {
  return repairBatchStatements({ rows } as never, release as never, "original", backup);
}

function content(db: DatabaseSync, theoryId: number) {
  return { ...db.prepare("SELECT content, updated_at FROM theories WHERE id=?").get(theoryId) };
}

test("106-row repair is one transaction, bumps cache revision, and preserves unrelated rows and metadata", async (t) => {
  const db = fixture(t);
  const beforeRelease = db.prepare("SELECT * FROM content_releases").all();
  const beforeBackup = db.prepare("SELECT * FROM backup_snapshots").all();
  await adminRepository.batch(statements());
  for (const row of rows) assert.deepEqual(content(db, row.id), { content: row.target, updated_at: "unchanged" });
  assert.deepEqual(content(db, 999), { content: "이 이론은 바꾸지 않습니다.", updated_at: "unchanged" });
  assert.notEqual(db.prepare("SELECT value FROM site_settings WHERE key='content_cache_revision'").get()?.value, "original");
  assert.deepEqual(db.prepare("SELECT * FROM content_releases").all(), beforeRelease);
  assert.deepEqual(db.prepare("SELECT * FROM backup_snapshots").all(), beforeBackup);
});

test("stale row, revision, backup, or second active release rolls back the entire repair", async (t) => {
  for (const change of ["row", "revision", "backup", "release"]) {
    const db = fixture(t);
    if (change === "row") db.prepare("UPDATE theories SET content='new' WHERE id=106").run();
    if (change === "revision") db.prepare("UPDATE site_settings SET value='next' WHERE key='content_cache_revision'").run();
    if (change === "backup") db.prepare("INSERT INTO backup_snapshots VALUES('22222222-2222-2222-2222-222222222222','completed','full',?, ?, 10, ?)")
      .run(BACKUP_SCHEMA_VERSION, checksum, new Date(Date.now() + 1000).toISOString());
    if (change === "release") db.prepare("INSERT INTO content_releases VALUES('other','active',?,?,?)")
      .run(source, "c".repeat(64), "d".repeat(64));
    await assert.rejects(adminRepository.batch(statements()), /integer overflow/u, change);
    assert.deepEqual(content(db, 1), { content: rows[0].current, updated_at: "unchanged" });
    assert.equal(db.prepare("SELECT value FROM site_settings WHERE key='content_cache_revision'").get()?.value,
      change === "revision" ? "next" : "original");
  }
});

test("a mid-batch theory trigger abort leaves all 106 original rows and revision unchanged", async (t) => {
  const db = fixture(t);
  db.exec("CREATE TRIGGER refuse_repair BEFORE UPDATE OF content ON theories WHEN new.id=54 BEGIN SELECT RAISE(ABORT,'blocked'); END;");
  await assert.rejects(adminRepository.batch(statements()), /blocked/u);
  for (const row of rows) assert.equal(content(db, row.id)?.content, row.current);
  assert.equal(db.prepare("SELECT value FROM site_settings WHERE key='content_cache_revision'").get()?.value, "original");
});
