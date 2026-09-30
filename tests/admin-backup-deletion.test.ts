import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { readFileSync } from "node:fs";
import { sqliteD1 } from "./helpers/sqlite-d1.mjs";
import { canDeleteBackup } from "../packages/shared/src/admin/backup-deletion";
import { deleteBackupsSequentially } from "../apps/frontend/src/features/admin/model/admin-backup-deletion";
import { EXTERNAL_BACKUP_FORMAT } from "../apps/backend/src/modules/admin/backup-storage";
import { AUTHENTICATED_USER_EMAIL_HEADER } from "../packages/shared/src/auth/authenticated-user";

const oldId = "11111111-1111-4111-8111-111111111111";
const keepId = "22222222-2222-4222-8222-222222222222";

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE backup_snapshots (id TEXT PRIMARY KEY, backup_type TEXT, status TEXT, byte_size INTEGER, created_at TEXT, payload TEXT);
    CREATE TABLE backup_chunks (snapshot_id TEXT REFERENCES backup_snapshots(id), chunk_index INTEGER, payload TEXT);
    CREATE TABLE attempts (id INTEGER PRIMARY KEY, answer TEXT);
    INSERT INTO attempts VALUES (1, 'preserve live learning data');
  `);
  db.prepare("INSERT INTO backup_snapshots VALUES (?, 'full', 'completed', 3, '2026-09-08T14:59:59.999Z', '{}')").run(oldId);
  db.prepare("INSERT INTO backup_snapshots VALUES (?, 'auto-full', 'completed', 3, '2026-09-08T15:00:00.000Z', '{}')").run(keepId);
  for (const id of [oldId, keepId]) db.prepare("INSERT INTO backup_chunks VALUES (?, 0, 'part')").run(id);
  const originalEnv = globalThis.__BAEUMZIP_ENV__;
  Object.defineProperty(globalThis, "__BAEUMZIP_APP_VERSION__", { value: "backup-deletion-test", configurable: true });
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(db) as unknown as D1Database };
  return { db, close() { globalThis.__BAEUMZIP_ENV__ = originalEnv; db.close(); } };
}

test("only completed/failed backups are eligible; creation and restore staging stay protected", () => {
  for (const status of ["completed", "failed"]) assert.equal(canDeleteBackup({ status, backup_type: "full" }), true);
  for (const status of ["creating", "restoring", "unknown"]) assert.equal(canDeleteBackup({ status, backup_type: "full" }), false);
  assert.equal(canDeleteBackup({ status: "completed", backup_type: "restore-stage" }), false);
});

test("D1 deletion removes only the selected snapshot and chunks, including failed records", async () => {
  const f = fixture();
  try {
    const { deleteBackupSnapshot } = await import("../apps/backend/src/modules/admin/admin-backup-use-cases");
    f.db.prepare("UPDATE backup_snapshots SET status = 'failed' WHERE id = ?").run(oldId);
    const before = await deleteBackupSnapshot(oldId);
    assert.equal(before.status, "failed");
    assert.deepEqual(f.db.prepare("SELECT id FROM backup_snapshots").all().map(row => row.id), [keepId]);
    assert.deepEqual(f.db.prepare("SELECT snapshot_id FROM backup_chunks").all().map(row => row.snapshot_id), [keepId]);
    assert.equal(f.db.prepare("SELECT answer FROM attempts").get()!.answer, "preserve live learning data");
    await assert.rejects(deleteBackupSnapshot(oldId), /찾을 수 없습니다/u);
    await assert.rejects(deleteBackupSnapshot("' OR 1=1 --"), /찾을 수 없습니다/u);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM backup_snapshots").get()!.n, 1);
  } finally { f.close(); }
});

test("active snapshots are refused and D1 metadata/chunk cleanup rolls back together", async () => {
  const f = fixture();
  try {
    const { deleteBackupSnapshot } = await import("../apps/backend/src/modules/admin/admin-backup-use-cases");
    f.db.prepare("UPDATE backup_snapshots SET status = 'creating' WHERE id = ?").run(oldId);
    await assert.rejects(deleteBackupSnapshot(oldId), /작업 중/u);
    f.db.prepare("UPDATE backup_snapshots SET status = 'completed', backup_type = 'restore-stage' WHERE id = ?").run(oldId);
    await assert.rejects(deleteBackupSnapshot(oldId), /작업 중/u);
    f.db.prepare("UPDATE backup_snapshots SET backup_type = 'full' WHERE id = ?").run(oldId);
    f.db.exec("CREATE TRIGGER fail_delete BEFORE DELETE ON backup_snapshots BEGIN SELECT RAISE(ABORT, 'simulated database failure'); END;");
    await assert.rejects(deleteBackupSnapshot(oldId), /simulated database failure/u);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM backup_chunks").get()!.n, 2);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM backup_snapshots").get()!.n, 2);
  } finally { f.close(); }
});

test("delete endpoint preserves admin authorization and same-origin mutation checks", async () => {
  const f = fixture();
  try {
    globalThis.__BAEUMZIP_ENV__ = { ...globalThis.__BAEUMZIP_ENV__, ADMIN_EMAIL: "admin@example.test" };
    const { POST } = await import("../apps/backend/src/modules/admin/admin-request-handlers");
    const cases: Record<string, string>[] = [
      {},
      { [AUTHENTICATED_USER_EMAIL_HEADER]: "learner@example.test" },
      { [AUTHENTICATED_USER_EMAIL_HEADER]: "admin@example.test" },
      { [AUTHENTICATED_USER_EMAIL_HEADER]: "admin@example.test", "x-sql-study-admin-request": "1", origin: "https://other.test" },
    ];
    for (const headers of cases) {
      const response = await POST(new Request("https://example.test/api/admin", {
        method: "POST", headers, body: JSON.stringify({ action: "backup-delete", id: oldId }),
      }));
      assert.ok(response.status === 401 || response.status === 403);
      assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM backup_snapshots").get()!.n, 2);
    }
  } finally { f.close(); }
});

test("failed external backups can clean residual objects without a readable manifest; failures are retryable and scoped", async () => {
  const f = fixture();
  const prefix = `backups/${oldId}/`;
  const objects = new Set([`${prefix}parts/data.json`, `backups/${keepId}/manifest.json`]);
  let fail = true;
  const descriptor = (objectPrefix: string) => JSON.stringify({ kind: "external", format: EXTERNAL_BACKUP_FORMAT, objectPrefix, manifest: { objectKey: `${objectPrefix}manifest.json`, byteSize: 0, checksum: "0".repeat(64) } });
  try {
    const { deleteBackupSnapshot } = await import("../apps/backend/src/modules/admin/admin-backup-use-cases");
    globalThis.__BAEUMZIP_ENV__ = { ...globalThis.__BAEUMZIP_ENV__, BACKUP_OBJECTS: {
      async list({ prefix: scope }: { prefix: string }) { return { objects: [...objects].filter(key => key.startsWith(scope)).map(key => ({ key })), truncated: false }; },
      async delete(keys: string[]) { if (fail) throw new Error("denied"); for (const key of keys) objects.delete(key); },
      async get() { throw new Error("deletion must not require manifest reads"); },
    } };
    f.db.prepare("UPDATE backup_snapshots SET status = 'failed', payload = ? WHERE id = ?").run(descriptor(prefix), oldId);
    await assert.rejects(deleteBackupSnapshot(oldId), /denied/u);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM backup_snapshots").get()!.n, 2);
    f.db.prepare("UPDATE backup_snapshots SET payload = ? WHERE id = ?").run(descriptor(`backups/${keepId}/`), oldId);
    await assert.rejects(deleteBackupSnapshot(oldId), /범위/u);
    assert.equal(objects.size, 2);
    f.db.prepare("UPDATE backup_snapshots SET payload = ? WHERE id = ?").run(descriptor(prefix), oldId);
    fail = false;
    await deleteBackupSnapshot(oldId);
    assert.deepEqual([...objects], [`backups/${keepId}/manifest.json`]);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM backup_chunks").get()!.n, 1);
  } finally { f.close(); }
});

test("multi-delete freezes/deduplicates targets, runs serially and distinguishes partial failures", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  const progress: number[] = [];
  const selected = [oldId, "failure", oldId, keepId];
  let inFlight = 0;
  try {
    globalThis.fetch = async (_input, init) => {
      assert.equal(inFlight++, 0);
      const { action, id } = JSON.parse(String(init?.body));
      assert.equal(action, "backup-delete");
      calls.push(id);
      selected.push("must-not-be-deleted");
      await Promise.resolve();
      inFlight--;
      return id === "failure" ? Response.json({ error: "cannot delete" }, { status: 400 }) : Response.json({ id, deleted: true });
    };
    const result = await deleteBackupsSequentially(selected, finished => progress.push(finished));
    assert.deepEqual(calls, [oldId, "failure", keepId]);
    assert.deepEqual(result.deleted, [oldId, keepId]);
    assert.deepEqual(result.failed.map(item => item.id), ["failure"]);
    assert.deepEqual(progress, [1, 2, 3]);
    assert.deepEqual(result.skipped, []);
  } finally { globalThis.fetch = originalFetch; }
});

test("authorization loss stops remaining deletions; unexpected success bodies are not claimed as deleted", async () => {
  const originalFetch = globalThis.fetch;
  try {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return Response.json({ error: "login required" }, { status: 401 }); };
    const result = await deleteBackupsSequentially([oldId, keepId], () => {});
    assert.equal(calls, 1);
    assert.deepEqual(result.deleted, []);
    assert.deepEqual(result.skipped, [keepId]);
    globalThis.fetch = async () => Response.json({ deleted: true, id: "wrong-id" });
    const invalid = await deleteBackupsSequentially([oldId], () => {});
    assert.equal(invalid.failed.length, 1);
    assert.equal(invalid.deleted.length, 0);
    const ui = readFileSync("apps/frontend/src/features/admin/components/admin-core-sections.tsx", "utf8");
    assert.match(ui, /표시된 삭제 가능 백업 전체 선택/u);
    assert.match(ui, /node.indeterminate = selected.length > 0/u);
    assert.match(ui, /deletionLock.current = true/u);
    assert.match(ui, /window.confirm/u);
  } finally { globalThis.fetch = originalFetch; }
});
