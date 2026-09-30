import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateDownloadedBackupEnvelope } from "../scripts/lib/downloaded-backup-verifier.mjs";
import { allowedBackupTables } from "../packages/shared/src/admin/backup-contract.mjs";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";
import { canonicalRowsSha256, readCanonicalContent } from "../scripts/lib/content-release.mjs";
import { stripTheoryDifficultyMetadata } from "../packages/shared/src/content/content-format.mjs";
import { AUTHENTICATED_USER_EMAIL_HEADER } from "../packages/shared/src/auth/authenticated-user";
import { ADMIN_REQUEST_HEADER } from "../apps/backend/src/common/auth/admin-auth";
import {
  BACKUP_PAGE_ROWS,
  EXTERNAL_BACKUP_FORMAT,
  InMemoryBackupStorage,
  backupPartGroups,
  backupStorageForMode,
  backupStorageStatus,
  readAndVerifyBackupObject,
} from "../apps/backend/src/modules/admin/backup-storage";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("explicit external mode never falls back to D1 when the private binding is absent", () => {
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = {};
  try {
    assert.throws(
      () => backupStorageForMode("external"),
      /BACKUP_OBJECTS.*연결/u,
    );
    assert.equal(backupStorageForMode("database"), null);
  } finally {
    globalThis.__BAEUMZIP_ENV__ = previous;
  }
});

test("admin-7 full backups cannot replace an admin-8 database with missing personal SKCT tables", async () => {
  (globalThis as typeof globalThis & { __BAEUMZIP_APP_VERSION__: string }).__BAEUMZIP_APP_VERSION__ = "stage4-test";
  const includedData = allowedBackupTables("full", false, "admin-7");
  const metadata = { type: "full", schemaVersion: "admin-7", includedData };
  const internal = await import("../apps/backend/src/modules/admin/admin-backup-use-cases");
  const external = await import("../apps/backend/src/modules/admin/admin-external-backup-use-cases");
  const internalReadiness = internal.backupReplacementReadiness({ metadata } as never);
  const externalReadiness = external.externalReplacementReadiness({ manifest: { metadata } } as never);
  for (const readiness of [internalReadiness, externalReadiness]) {
    assert.equal(readiness.ready, false);
    assert.deepEqual(readiness.missingTables.filter(table => table.startsWith("skct_personal_")), [
      "skct_personal_releases", "skct_personal_public_items", "skct_personal_secret_items",
      "skct_personal_release_audit", "skct_personal_attempts", "skct_personal_attempt_items",
    ]);
  }
  await assert.rejects(internal.restoreBackup({ hash: "test" } as never,
    { metadata, data: {} } as never, "full-replace", "전체 데이터를 복원합니다", { skipSafetyBackup: true }),
    /skct_personal_/u);
  await assert.rejects(external.restoreExternalBackup({ hash: "test" } as never,
    { manifest: { metadata } } as never, "full-replace", "전체 데이터를 복원합니다", async () => ({ id: "unused" })),
    /skct_personal_/u);
});

test("immutable personal content rejects duplicate primary keys before restore", async () => {
  const { verifyImmutablePersonalRows } = await import("../apps/backend/src/modules/admin/admin-backup-personal-immutability");
  const key = { release_id: "r1", source_item_id: "U01_001" };
  await assert.rejects(
    verifyImmutablePersonalRows({ skct_personal_public_items: [key, { ...key }] }, true),
    /중복 기본 키/u,
  );
});

test("admin-8 full restore rejects metadata that lists absent immutable row arrays", async () => {
  (globalThis as typeof globalThis & { __BAEUMZIP_APP_VERSION__: string }).__BAEUMZIP_APP_VERSION__ = "stage4-test";
  const internal = await import("../apps/backend/src/modules/admin/admin-backup-use-cases");
  await assert.rejects(internal.restoreBackup({ hash: "test" } as never, {
    metadata: { type: "full", schemaVersion: "admin-8", includedData: allowedBackupTables("full") },
    data: {},
  } as never, "full-replace", "전체 데이터를 복원합니다", { skipSafetyBackup: true }),
  /불변 원본 데이터가 누락/u);
});

test("settings-only restore ignores unrelated immutable personal rows", async () => {
  (globalThis as typeof globalThis & { __BAEUMZIP_APP_VERSION__: string }).__BAEUMZIP_APP_VERSION__ = "stage4-test";
  const database = backupFixture();
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(database) as never };
  try {
    const internal = await import("../apps/backend/src/modules/admin/admin-backup-use-cases");
    const siteSettings = database.prepare("SELECT * FROM site_settings").all();
    const duplicate = { release_id: "r1", source_item_id: "U01_001" };
    const envelope = {
      metadata: { type: "full", schemaVersion: "admin-8",
        includedData: ["site_settings", "skct_personal_public_items"] },
      data: { site_settings: siteSettings,
        skct_personal_public_items: [duplicate, { ...duplicate }] },
    } as never;
    database.prepare("UPDATE site_settings SET value = '변경됨' WHERE key = 'site_notice'").run();
    await internal.restoreBackup({ hash: "test" } as never, envelope,
      "settings-only", "", { skipSafetyBackup: true });
    assert.equal(database.prepare("SELECT value FROM site_settings WHERE key = 'site_notice'").get()?.value, "원본 공지");
  } finally {
    database.close();
    globalThis.__BAEUMZIP_ENV__ = undefined;
  }
});

test("the local contract adapter keeps objects private and detects transfer corruption", async () => {
  const storage = new InMemoryBackupStorage();
  const body = new TextEncoder().encode('[{"id":1,"prompt":"한글 백업"}]');
  const written = await storage.put("backups/test/parts/0000.json", body);
  assert.equal(written.byteSize, body.byteLength);
  assert.match(written.checksum, /^[a-f0-9]{64}$/u);

  const verified = await readAndVerifyBackupObject(storage, {
    objectKey: written.objectKey,
    byteSize: written.byteSize,
    checksum: written.checksum,
  });
  assert.deepEqual(verified, body);

  await storage.put(written.objectKey, new TextEncoder().encode("corrupted"));
  await assert.rejects(
    readAndVerifyBackupObject(storage, written),
    /크기|무결성/u,
  );
  assert.equal("publicUrl" in storage, false);
});

test("R2 transient writes retry the identical private object and retain checksum verification", async () => {
  const previous = globalThis.__BAEUMZIP_ENV__;
  const body = new TextEncoder().encode('[{"id":1}]');
  const objects = new Map<string, Uint8Array>();
  let calls = 0;
  globalThis.__BAEUMZIP_ENV__ = { BACKUP_OBJECTS: {
    async put(key: string, value: Uint8Array, options: { customMetadata: { visibility: string } }) {
      calls += 1;
      assert.equal(key, "backups/retry/part.json");
      assert.deepEqual(value, body);
      assert.equal(options.customMetadata.visibility, "private");
      objects.set(key, value.slice());
      if (calls < 3) throw new Error("put: We encountered an internal error. Please try again. (10001)");
    },
    async get(key: string) {
      const value = objects.get(key);
      return value ? { arrayBuffer: async () => Uint8Array.from(value).buffer } : null;
    },
  } };
  try {
    const storage = backupStorageForMode("external")!;
    const receipt = await storage.put("backups/retry/part.json", body);
    assert.equal(calls, 3);
    assert.equal(objects.size, 1);
    assert.deepEqual(await readAndVerifyBackupObject(storage, receipt), body);
  } finally { globalThis.__BAEUMZIP_ENV__ = previous; }
});

test("R2 retries are bounded and authentication failures stop immediately", async () => {
  const previous = globalThis.__BAEUMZIP_ENV__;
  try {
    for (const [code, expectedCalls] of [[10001, 4], [10000, 1]]) {
      let calls = 0;
      const failure = new Error(`put: failed (${code})`);
      globalThis.__BAEUMZIP_ENV__ = { BACKUP_OBJECTS: { async put() { calls += 1; throw failure; } } };
      await assert.rejects(backupStorageForMode("external")!.put("backups/failure/part.json", new Uint8Array([1])), error => error === failure);
      assert.equal(calls, expectedCalls);
    }
  } finally { globalThis.__BAEUMZIP_ENV__ = previous; }
});

test("missing external storage is reported as unavailable rather than a D1 fallback", () => {
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { BACKUP_STORAGE_MODE: "external" };
  try {
    const status = backupStorageStatus();
    assert.equal(status.defaultMode, "external");
    assert.equal(status.externalAvailable, false);
    assert.equal(status.location, "unavailable");
    assert.match(status.warning, /연결.*복구/u);
  } finally {
    globalThis.__BAEUMZIP_ENV__ = previous;
  }
});

test("Korean rows are grouped below the configured part budget without accumulating the dataset", () => {
  const rows = Array.from({ length: 25 }, (_, index) => ({
    id: index + 1,
    prompt: "한글".repeat(1_500),
  }));
  const groups = backupPartGroups(rows, 24 * 1024);
  assert.ok(groups.length > 1);
  assert.equal(groups.flat().length, rows.length);
  for (const group of groups) {
    assert.ok(new TextEncoder().encode(JSON.stringify(group)).byteLength <= 24 * 1024);
  }
  assert.equal(EXTERNAL_BACKUP_FORMAT, "baeumzip-external-parts-v1");
});

test("1x and 5x Korean payloads retain the same page and part memory ceiling", (context) => {
  const measure = (rowCount: number) => {
    let maximumPartBytes = 0;
    let maximumPageBytes = 0;
    let maximumPageRows = 0;
    let visited = 0;
    for (let start = 0; start < rowCount; start += BACKUP_PAGE_ROWS) {
      const page = Array.from(
        { length: Math.min(BACKUP_PAGE_ROWS, rowCount - start) },
        (_, index) => ({ id: start + index, body: "백업 데이터".repeat(1_000) }),
      );
      maximumPageRows = Math.max(maximumPageRows, page.length);
      maximumPageBytes = Math.max(
        maximumPageBytes,
        new TextEncoder().encode(JSON.stringify(page)).byteLength,
      );
      for (const group of backupPartGroups(page)) {
        maximumPartBytes = Math.max(
          maximumPartBytes,
          new TextEncoder().encode(JSON.stringify(group)).byteLength,
        );
        visited += group.length;
      }
    }
    return { maximumPageRows, maximumPageBytes, maximumPartBytes, visited };
  };
  const one = measure(1_000);
  const five = measure(5_000);
  assert.equal(one.visited, 1_000);
  assert.equal(five.visited, 5_000);
  assert.equal(one.maximumPageRows, BACKUP_PAGE_ROWS);
  assert.equal(five.maximumPageRows, BACKUP_PAGE_ROWS);
  assert.ok(one.maximumPageBytes <= 4 * 1024 * 1024);
  assert.ok(five.maximumPageBytes <= 4 * 1024 * 1024);
  assert.ok(one.maximumPartBytes <= 256 * 1024);
  assert.ok(five.maximumPartBytes <= 256 * 1024);
  context.diagnostic(JSON.stringify({ one, five }));
});

test("a single oversized row is rejected before upload", () => {
  assert.throws(
    () => backupPartGroups([{ id: 1, body: "가".repeat(20_000) }], 8 * 1024),
    /단일 행/u,
  );
});

class SqliteStatement {
  private values: SQLInputValue[] = [];

  constructor(private readonly database: DatabaseSync, private readonly sql: string) {}

  bind(...values: SQLInputValue[]) {
    this.values = values;
    return this;
  }

  all() {
    const results = this.database.prepare(this.sql).all(...this.values);
    const changes = Number(this.database.prepare("SELECT changes() AS value").get()?.value ?? 0);
    return { success: true, results, meta: { changes } };
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.values) ?? null;
  }

  async run() {
    return this.all();
  }
}

function sqliteD1(database: DatabaseSync) {
  return {
    prepare(sql: string) {
      return new SqliteStatement(database, sql);
    },
    async batch(statements: SqliteStatement[]) {
      database.exec("BEGIN");
      try {
        const results = [];
        // D1 executes a batch atomically; do not yield inside the SQLite transaction.
        for (const statement of statements) results.push(statement.all());
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

class MemoryR2 {
  readonly objects = new Map<string, Uint8Array>();
  afterFirstPart?: () => void;
  private partWrites = 0;

  async put(key: string, value: Uint8Array) {
    this.objects.set(key, value.slice());
    if (key.includes("/parts/")) {
      this.partWrites += 1;
      if (this.partWrites === 1) this.afterFirstPart?.();
    }
  }

  async get(key: string) {
    const value = this.objects.get(key);
    return value ? { arrayBuffer: async () => Uint8Array.from(value).buffer } : null;
  }

  async delete(keys: string | string[]) {
    for (const key of Array.isArray(keys) ? keys : [keys]) this.objects.delete(key);
  }

  async list({ prefix }: { prefix: string }) {
    return {
      objects: [...this.objects.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })),
      truncated: false,
    };
  }
}

function backupFixture() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE backup_snapshots (
      id TEXT PRIMARY KEY, backup_type TEXT NOT NULL, status TEXT NOT NULL,
      schema_version TEXT NOT NULL, app_version TEXT NOT NULL,
      included_data TEXT NOT NULL, counts TEXT NOT NULL, checksum TEXT NOT NULL,
      payload TEXT NOT NULL, byte_size INTEGER NOT NULL, created_by_hash TEXT NOT NULL,
      created_at TEXT NOT NULL, error_message TEXT NOT NULL
    );
    CREATE TABLE backup_chunks (
      snapshot_id TEXT NOT NULL, chunk_index INTEGER NOT NULL, payload TEXT NOT NULL,
      PRIMARY KEY (snapshot_id, chunk_index),
      FOREIGN KEY (snapshot_id) REFERENCES backup_snapshots(id) ON DELETE CASCADE
    );
    CREATE TABLE maintenance_runs (
      task TEXT PRIMARY KEY, lease_owner TEXT NOT NULL DEFAULT '', lease_until TEXT,
      last_started_at TEXT, last_succeeded_at TEXT, last_failed_at TEXT,
      consecutive_failures INTEGER NOT NULL DEFAULT 0, last_error TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE site_settings (
      key TEXT PRIMARY KEY, value TEXT NOT NULL, value_type TEXT NOT NULL,
      updated_by_hash TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    INSERT INTO site_settings VALUES
      ('site_notice', '원본 공지', 'string', 'admin', '2026-09-07T00:00:00.000Z'),
      ('maintenance_mode', 'false', 'boolean', 'admin', '2026-09-07T00:00:00.000Z');
  `);
  return database;
}

test("backup creation returns a fresh bounded private list in its durable response", async () => {
  (globalThis as typeof globalThis & { __BAEUMZIP_APP_VERSION__: string }).__BAEUMZIP_APP_VERSION__ = "stage4-test";
  const previous = globalThis.__BAEUMZIP_ENV__;
  const database = backupFixture();
  const bucket = new MemoryR2();
  globalThis.__BAEUMZIP_ENV__ = {
    DB: sqliteD1(database) as never,
    BACKUP_OBJECTS: bucket,
    BACKUP_STORAGE_MODE: "external",
    ADMIN_EMAIL: "admin@example.test",
  };
  try {
    const { POST } = await import("../apps/backend/src/modules/admin/admin-request-handlers");
    const response = await POST(new Request("https://example.test/api/admin", {
      method: "POST",
      headers: {
        [AUTHENTICATED_USER_EMAIL_HEADER]: "admin@example.test",
        [ADMIN_REQUEST_HEADER]: "1",
        "content-type": "application/json",
      },
      body: JSON.stringify({ action: "backup-create", type: "settings", storageMode: "external" }),
    }));
    assert.equal(response.status, 200);
    const created = await response.json() as {
      id: string;
      backupList: { items: Array<{ id: string; storageMode: string }>; storage: { externalAvailable: boolean } };
    };
    assert.equal(created.backupList.items[0].id, created.id);
    assert.equal(created.backupList.items[0].storageMode, "external");
    assert.equal(created.backupList.storage.externalAvailable, true);
    assert.equal("payload" in created.backupList.items[0], false);
    assert.equal(database.prepare("SELECT status FROM backup_snapshots WHERE id = ?").get(created.id)?.status, "completed");
    assert.ok(bucket.objects.size > 0);
  } finally {
    globalThis.__BAEUMZIP_ENV__ = previous;
    database.close();
  }
});

test("a backup remains successful when its optional list readback fails", async () => {
  (globalThis as typeof globalThis & { __BAEUMZIP_APP_VERSION__: string }).__BAEUMZIP_APP_VERSION__ = "stage4-test";
  const previous = globalThis.__BAEUMZIP_ENV__;
  const database = backupFixture();
  const db = sqliteD1(database);
  globalThis.__BAEUMZIP_ENV__ = {
    DB: {
      ...db,
      prepare(sql: string) {
        if (/SELECT id, backup_type, status, schema_version, app_version/u.test(sql)) {
          throw new Error("simulated post-creation list failure");
        }
        return db.prepare(sql);
      },
    } as never,
    ADMIN_EMAIL: "admin@example.test",
  };
  try {
    const { POST } = await import("../apps/backend/src/modules/admin/admin-request-handlers");
    const response = await POST(new Request("https://example.test/api/admin", {
      method: "POST",
      headers: {
        [AUTHENTICATED_USER_EMAIL_HEADER]: "admin@example.test",
        [ADMIN_REQUEST_HEADER]: "1",
        "content-type": "application/json",
      },
      body: JSON.stringify({ action: "backup-create", type: "settings", storageMode: "database" }),
    }));
    assert.equal(response.status, 200);
    const created = await response.json() as { id: string; backupList: null };
    assert.equal(created.backupList, null);
    assert.equal(database.prepare("SELECT status FROM backup_snapshots WHERE id = ?").get(created.id)?.status, "completed");
  } finally {
    globalThis.__BAEUMZIP_ENV__ = previous;
    database.close();
  }
});

test("unformattable list errors cannot turn a completed backup into an apparent failure", async () => {
  (globalThis as typeof globalThis & { __BAEUMZIP_APP_VERSION__: string }).__BAEUMZIP_APP_VERSION__ = "stage4-test";
  const previous = globalThis.__BAEUMZIP_ENV__;
  const database = backupFixture();
  const db = sqliteD1(database);
  class UnformattableError extends Error {
    override get message(): string { throw new Error("message getter failed"); }
  }
  globalThis.__BAEUMZIP_ENV__ = {
    DB: {
      ...db,
      prepare(sql: string) {
        if (/SELECT id, backup_type, status, schema_version, app_version/u.test(sql)) {
          throw new UnformattableError();
        }
        return db.prepare(sql);
      },
    } as never,
    ADMIN_EMAIL: "admin@example.test",
  };
  try {
    const { POST } = await import("../apps/backend/src/modules/admin/admin-request-handlers");
    const response = await POST(new Request("https://example.test/api/admin", {
      method: "POST",
      headers: {
        [AUTHENTICATED_USER_EMAIL_HEADER]: "admin@example.test",
        [ADMIN_REQUEST_HEADER]: "1",
        "content-type": "application/json",
      },
      body: JSON.stringify({ action: "backup-create", type: "settings", storageMode: "database" }),
    }));
    assert.equal(response.status, 200);
    const created = await response.json() as { id: string; backupList: null };
    assert.equal(created.backupList, null);
    assert.equal(database.prepare("SELECT status FROM backup_snapshots WHERE id = ?").get(created.id)?.status, "completed");
  } finally {
    globalThis.__BAEUMZIP_ENV__ = previous;
    database.close();
  }
});

test("external create, authenticated-download source, integrity preview, and staged restore use bounded parts", async () => {
  (globalThis as typeof globalThis & { __BAEUMZIP_APP_VERSION__: string })
    .__BAEUMZIP_APP_VERSION__ = "stage4-test";
  const database = backupFixture();
  const bucket = new MemoryR2();
  globalThis.__BAEUMZIP_ENV__ = {
    DB: sqliteD1(database) as never,
    BACKUP_OBJECTS: bucket,
    BACKUP_STORAGE_MODE: "external",
  };
  try {
    const external = await import("../apps/backend/src/modules/admin/admin-external-backup-use-cases");
    const created = await external.createExternalBackup(
      { email: "admin@example.invalid", hash: "stage4-admin" },
      "settings",
    );
    assert.equal(created.storageMode, "external");
    assert.ok(created.partCount > 0);
    assert.ok(created.maxBufferedBytes <= 256 * 1024);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM backup_chunks").get()?.count, 0);
    assert.equal(database.prepare("SELECT status FROM backup_snapshots WHERE id = ?").get(created.id)?.status, "completed");

    const source = await external.readExternalBackup(created.id);
    assert.ok(source);
    const downloaded = await new Response(external.externalBackupDownloadStream(source)).json() as {
      metadata: { backupVersion: string; checksum: string };
      data: { site_settings: Array<{ key: string; value: string }> };
    };
    assert.equal(downloaded.metadata.backupVersion, "2");
    assert.equal(downloaded.metadata.checksum, created.checksum);
    assert.deepEqual(downloaded.data.site_settings.map((row) => row.key), ["maintenance_mode", "site_notice"]);
    assert.equal(await external.validatePortableExternalEnvelope(downloaded), downloaded);
    assert.equal(validateDownloadedBackupEnvelope(downloaded, { requireFull: false }), downloaded);
    downloaded.data.site_settings[0].value = "tampered";
    await assert.rejects(external.validatePortableExternalEnvelope(downloaded), /무결성/u);
    downloaded.data.site_settings[0].value = "false";
    assert.equal((await external.externalBackupConflicts(source)).site_settings.existingIds, 2);

    database.prepare("UPDATE site_settings SET value = '변경됨' WHERE key = 'site_notice'").run();
    database.prepare(`
      INSERT INTO maintenance_runs (
        task, lease_owner, lease_until, last_started_at, updated_at
      ) VALUES ('backup_restore', 'other-worker', '2999-01-01T00:00:00.000Z',
        '2026-09-07T00:00:00.000Z', '2026-09-07T00:00:00.000Z')
    `).run();
    await assert.rejects(
      external.restoreExternalBackup(
        { email: "admin@example.invalid", hash: "stage4-admin" },
        source,
        "settings-only",
        "",
        async () => ({ id: "must-not-run" }),
      ),
      /진행 중/u,
    );
    database.prepare(`
      UPDATE maintenance_runs SET lease_until = '2000-01-01T00:00:00.000Z'
      WHERE task = 'backup_restore'
    `).run();
    const restored = await external.restoreExternalBackup(
      { email: "admin@example.invalid", hash: "stage4-admin" },
      source,
      "settings-only",
      "",
      async () => ({ id: "safety-backup-test" }),
    );
    assert.equal(restored.safetyBackupId, "safety-backup-test");
    assert.equal(database.prepare("SELECT value FROM site_settings WHERE key = 'site_notice'").get()?.value, "원본 공지");
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM backup_snapshots WHERE backup_type = 'restore-stage'").get()?.count, 0);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM backup_chunks").get()?.count, 0);

    database.prepare("UPDATE site_settings SET value = '병합 전' WHERE key = 'site_notice'").run();
    await external.restoreExternalBackup(
      { email: "admin@example.invalid", hash: "stage4-admin" },
      source,
      "merge",
      "",
      async () => ({ id: "merge-safety" }),
    );
    assert.equal(database.prepare("SELECT value FROM site_settings WHERE key = 'site_notice'").get()?.value, "원본 공지");

    database.prepare(`
      INSERT INTO site_settings VALUES
      ('temporary', 'remove-me', 'string', 'admin', '2026-09-07T00:00:00.000Z')
    `).run();
    await external.restoreExternalBackup(
      { email: "admin@example.invalid", hash: "stage4-admin" },
      source,
      "full-replace",
      "전체 데이터를 복원합니다",
      async () => ({ id: "replace-safety" }),
    );
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM site_settings WHERE key != 'content_cache_revision'").get()?.count, 2);
    assert.ok(database.prepare("SELECT value FROM site_settings WHERE key = 'content_cache_revision'").get()?.value);
  } finally {
    database.close();
    globalThis.__BAEUMZIP_ENV__ = undefined;
  }
});

test("manifest transfer interruption leaves no object body and a failed D1 record", async () => {
  (globalThis as typeof globalThis & { __BAEUMZIP_APP_VERSION__: string })
    .__BAEUMZIP_APP_VERSION__ = "stage4-test";
  const database = backupFixture();
  const bucket = new MemoryR2();
  const put = bucket.put.bind(bucket);
  bucket.put = async (key: string, value: Uint8Array) => {
    if (key.endsWith("manifest.json")) throw new Error("simulated transfer interruption");
    return put(key, value);
  };
  globalThis.__BAEUMZIP_ENV__ = {
    DB: sqliteD1(database) as never,
    BACKUP_OBJECTS: bucket,
    BACKUP_STORAGE_MODE: "external",
  };
  try {
    const { createExternalBackup } = await import("../apps/backend/src/modules/admin/admin-external-backup-use-cases");
    await assert.rejects(
      createExternalBackup({ email: "admin@example.invalid", hash: "stage4-admin" }, "settings"),
      /transfer interruption/u,
    );
    assert.equal(bucket.objects.size, 0);
    assert.equal(database.prepare("SELECT status FROM backup_snapshots").get()?.status, "failed");
  } finally {
    database.close();
    globalThis.__BAEUMZIP_ENV__ = undefined;
  }
});

test("automatic backup lease and freshness check suppress duplicate runs", async () => {
  (globalThis as typeof globalThis & { __BAEUMZIP_APP_VERSION__: string })
    .__BAEUMZIP_APP_VERSION__ = "stage4-test";
  const database = backupFixture();
  database.prepare(`
    INSERT INTO site_settings VALUES
    ('auto_backup_enabled', 'true', 'boolean', 'admin', ?)
  `).run(new Date().toISOString());
  database.prepare(`
    INSERT INTO backup_snapshots (
      id, backup_type, status, schema_version, app_version, included_data,
      counts, checksum, payload, byte_size, created_by_hash, created_at, error_message
    ) VALUES ('recent-auto', 'auto-full', 'completed', 'admin-4', 'test', '[]',
      '{}', 'checksum', '{}', 0, 'admin', ?, '')
  `).run(new Date().toISOString());
  globalThis.__BAEUMZIP_ENV__ = {
    DB: sqliteD1(database) as never,
    BACKUP_STORAGE_MODE: "database",
  };
  try {
    const { maybeCreateAutomaticBackup } = await import("../apps/backend/src/modules/admin/admin-backup-use-cases");
    const results = await Promise.all([
      maybeCreateAutomaticBackup({ email: "admin@example.invalid", hash: "stage4-admin" }),
      maybeCreateAutomaticBackup({ email: "admin@example.invalid", hash: "stage4-admin" }),
    ]);
    assert.deepEqual(results, [undefined, undefined]);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM backup_snapshots WHERE backup_type = 'auto-full'").get()?.count, 1);
  } finally {
    database.close();
    globalThis.__BAEUMZIP_ENV__ = undefined;
  }
});

test("admin entry preserves the existing backup path until the private schedule is explicitly verified", async () => {
  (globalThis as typeof globalThis & { __BAEUMZIP_APP_VERSION__: string }).__BAEUMZIP_APP_VERSION__ = "stage4-test";
  const previous = globalThis.__BAEUMZIP_ENV__;
  const database = backupFixture();
  database.prepare(`
    INSERT INTO site_settings VALUES
    ('auto_backup_enabled', 'true', 'boolean', 'admin', ?)
  `).run(new Date().toISOString());
  database.prepare(`
    INSERT INTO backup_snapshots (
      id, backup_type, status, schema_version, app_version, included_data,
      counts, checksum, payload, byte_size, created_by_hash, created_at, error_message
    ) VALUES ('recent-auto', 'auto-full', 'completed', 'admin-4', 'test', '[]',
      '{}', 'checksum', '{}', 0, 'admin', ?, '')
  `).run(new Date().toISOString());
  const { POST } = await import("../apps/backend/src/modules/admin/admin-request-handlers");
  const request = (action: string) => POST(new Request("https://example.test/api/admin", {
    method: "POST",
    headers: {
      [AUTHENTICATED_USER_EMAIL_HEADER]: "admin@example.test",
      [ADMIN_REQUEST_HEADER]: "1",
      "content-type": "application/json",
    },
    body: JSON.stringify({ action }),
  }));
  const leaseCount = () => Number(database.prepare(
    "SELECT COUNT(*) AS count FROM maintenance_runs WHERE task = 'automatic_backup'",
  ).get()?.count ?? 0);
  try {
    globalThis.__BAEUMZIP_ENV__ = {
      DB: sqliteD1(database) as unknown as D1Database,
      ADMIN_EMAIL: "admin@example.test",
    };
    const defaultSession = await request("admin-session");
    assert.equal(defaultSession.status, 200);
    assert.deepEqual(await defaultSession.json(), { ok: true, backupScheduleVerified: false });
    const legacyBackup = await request("backup-auto-if-due");
    assert.equal(legacyBackup.status, 200);
    assert.deepEqual(await legacyBackup.json(), { created: false });
    assert.equal(leaseCount(), 1, "default mode must enter the existing backup lease/freshness path");

    globalThis.__BAEUMZIP_ENV__.BACKUP_SCHEDULE_VERIFIED = "false";
    assert.deepEqual(await (await request("admin-session")).json(),
      { ok: true, backupScheduleVerified: false });

    database.prepare("DELETE FROM maintenance_runs WHERE task = 'automatic_backup'").run();
    globalThis.__BAEUMZIP_ENV__.BACKUP_SCHEDULE_VERIFIED = "true";
    const verifiedSession = await request("admin-session");
    assert.equal(verifiedSession.status, 200);
    assert.deepEqual(await verifiedSession.json(), { ok: true, backupScheduleVerified: true });
    const staleTabBackup = await request("backup-auto-if-due");
    assert.equal(staleTabBackup.status, 200);
    assert.deepEqual(await staleTabBackup.json(), { created: false });
    assert.equal(leaseCount(), 0, "verified mode must skip automatic backup even for an old tab");
  } finally {
    globalThis.__BAEUMZIP_ENV__ = previous;
    database.close();
  }
});

test("the shared creation lease rejects overlapping manual backups", async () => {
  (globalThis as typeof globalThis & { __BAEUMZIP_APP_VERSION__: string })
    .__BAEUMZIP_APP_VERSION__ = "stage4-test";
  const database = backupFixture();
  globalThis.__BAEUMZIP_ENV__ = {
    DB: sqliteD1(database) as never,
    BACKUP_STORAGE_MODE: "database",
  };
  try {
    const { createBackup } = await import("../apps/backend/src/modules/admin/admin-backup-use-cases");
    const outcomes = await Promise.allSettled([
      createBackup({ email: "admin@example.invalid", hash: "stage4-admin" }, "settings"),
      createBackup({ email: "admin@example.invalid", hash: "stage4-admin" }, "settings"),
    ]);
    assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    assert.ok(rejected && rejected.status === "rejected");
    assert.match(String(rejected.reason), /다른 백업 생성 작업/u);
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM backup_snapshots WHERE status = 'completed'").get()?.count,
      1,
    );
  } finally {
    database.close();
    globalThis.__BAEUMZIP_ENV__ = undefined;
  }
});

test("missing parts and corrupted manifests fail before restore data changes", async () => {
  (globalThis as typeof globalThis & { __BAEUMZIP_APP_VERSION__: string })
    .__BAEUMZIP_APP_VERSION__ = "stage4-test";
  const database = backupFixture();
  const bucket = new MemoryR2();
  globalThis.__BAEUMZIP_ENV__ = {
    DB: sqliteD1(database) as never,
    BACKUP_OBJECTS: bucket,
    BACKUP_STORAGE_MODE: "external",
  };
  try {
    const external = await import("../apps/backend/src/modules/admin/admin-external-backup-use-cases");
    const created = await external.createExternalBackup(
      { email: "admin@example.invalid", hash: "stage4-admin" },
      "settings",
    );
    const source = await external.readExternalBackup(created.id);
    assert.ok(source);
    const partKey = [...bucket.objects.keys()].find((key) => key.includes("/parts/"));
    assert.ok(partKey);
    bucket.objects.delete(partKey);
    await assert.rejects(external.externalBackupConflicts(source), /객체가 없습니다/u);
    assert.equal(database.prepare("SELECT value FROM site_settings WHERE key = 'site_notice'").get()?.value, "원본 공지");

    const manifestKey = [...bucket.objects.keys()].find((key) => key.endsWith("manifest.json"));
    assert.ok(manifestKey);
    bucket.objects.set(manifestKey, new TextEncoder().encode("{}"));
    await assert.rejects(external.readExternalBackup(created.id), /크기|무결성/u);
  } finally {
    database.close();
    globalThis.__BAEUMZIP_ENV__ = undefined;
  }
});

test("a write during backup is detected and incomplete private objects are cleaned", async () => {
  (globalThis as typeof globalThis & { __BAEUMZIP_APP_VERSION__: string })
    .__BAEUMZIP_APP_VERSION__ = "stage4-test";
  const database = backupFixture();
  const bucket = new MemoryR2();
  bucket.afterFirstPart = () => {
    database.prepare("UPDATE site_settings SET value = '동시 변경' WHERE key = 'site_notice'").run();
  };
  globalThis.__BAEUMZIP_ENV__ = {
    DB: sqliteD1(database) as never,
    BACKUP_OBJECTS: bucket,
    BACKUP_STORAGE_MODE: "external",
  };
  try {
    const { createExternalBackup } = await import("../apps/backend/src/modules/admin/admin-external-backup-use-cases");
    await assert.rejects(
      createExternalBackup({ email: "admin@example.invalid", hash: "stage4-admin" }, "settings"),
      /원본 데이터가 변경/u,
    );
    assert.equal(bucket.objects.size, 0);
    assert.equal(database.prepare("SELECT status FROM backup_snapshots").get()?.status, "failed");
  } finally {
    database.close();
    globalThis.__BAEUMZIP_ENV__ = undefined;
  }
});

test("canonical full external restore preserves IDs, references, representative learner state, and derived indexes", async (context) => {
  (globalThis as typeof globalThis & { __BAEUMZIP_APP_VERSION__: string })
    .__BAEUMZIP_APP_VERSION__ = "stage4-test";
  const database = openCanonicalTestDatabase(projectRoot);
  const bucket = new MemoryR2();
  const binding = sqliteD1(database);
  const prepare = binding.prepare.bind(binding);
  const countQueries = new Map<string, string>();
  binding.prepare = (sql) => {
    const table = /FROM `([a-z_]+)` existing/u.exec(sql)?.[1];
    if (table && sql.includes("json_each(?)")) {
      countQueries.set(table, sql);
      const plan = database.prepare(`EXPLAIN QUERY PLAN ${sql}`).all("[]");
      assert.ok(plan.some((row: { detail?: unknown }) => /SEARCH existing/u.test(String(row.detail))), `${table} conflicts must use primary-key lookups`);
    }
    return prepare(sql);
  };
  globalThis.__BAEUMZIP_ENV__ = {
    DB: binding as never,
    BACKUP_OBJECTS: bucket,
    BACKUP_STORAGE_MODE: "external",
  };
  try {
    const external = await import("../apps/backend/src/modules/admin/admin-external-backup-use-cases");
    const sqlQuestion = database.prepare(`
      SELECT id, theory_id FROM questions
      WHERE exam_scope = 'SQLP' AND theory_id IS NOT NULL
      ORDER BY id LIMIT 1
    `).get() as { id: number; theory_id: number };
    const timestamp = "2026-09-07T00:00:00.000Z";
    database.prepare("UPDATE theories SET difficulty = '하', content = content || ? WHERE id = ?")
      .run("\n\n## 난이도\n\n백업 원문 보존", sqlQuestion.theory_id);
    const originalTheory = database.prepare("SELECT * FROM theories WHERE id = ?").get(sqlQuestion.theory_id);
    database.prepare(`
      INSERT INTO user_accounts (
        user_key, email, display_name, status, blocked_reason, created_at,
        last_login_at, updated_at
      ) VALUES ('stage4-user', 'stage4@example.invalid', 'Stage 4', 'active', '', ?, ?, ?)
    `).run(timestamp, timestamp, timestamp);
    database.prepare(`
      INSERT INTO user_settings (user_key, selected_exam, created_at, updated_at)
      VALUES ('stage4-user', 'SQLP', ?, ?)
    `).run(timestamp, timestamp);
    database.prepare(`
      INSERT INTO user_bookmarks (user_key, question_id, created_at)
      VALUES ('stage4-user', ?, ?)
    `).run(sqlQuestion.id, timestamp);
    database.prepare(`INSERT INTO skct_personal_releases(id,status,content_sha256,item_count)
      VALUES('backup-skct','ACTIVE',?,300)`).run("a".repeat(64));
    database.prepare(`INSERT INTO skct_personal_public_items(release_id,source_item_id,unit_id,source_batch,
      source_archive_sha256,source_file,source_file_sha256,source_ordinal,source_schema_version,
      public_json,public_sha256,asset_refs_json)
      VALUES('backup-skct','U01_BACKUP_001','U01','B01',?,'item.json',?,1,'1.0',?,?,'[]')`)
      .run("b".repeat(64),"c".repeat(64),JSON.stringify({ question:"복구할 문항",displayChoices:["①","②","③","④","⑤"] }),"d".repeat(64));
    database.prepare(`INSERT INTO skct_personal_secret_items(release_id,source_item_id,answer_index,raw_answer_json,
      explanation,distractor_explanations_json,source_raw_json,normalization_version,secret_sha256)
      VALUES('backup-skct','U01_BACKUP_001',1,'"①"','복구할 해설','{}','{}','1',?)`).run("e".repeat(64));
    database.prepare(`INSERT INTO skct_personal_attempts(id,user_key,release_id,unit_id,mode,status,active_position)
      VALUES('backup-skct-attempt','stage4-user','backup-skct','U01','mock','in_progress',1)`).run();
    database.prepare(`INSERT INTO skct_personal_attempt_items(attempt_id,release_id,position,source_item_id,selected_index)
      VALUES('backup-skct-attempt','backup-skct',1,'U01_BACKUP_001',1)`).run();
    database.prepare(`INSERT INTO skct_personal_release_audit(id,release_id,event_type,actor)
      VALUES('backup-skct-audit','backup-skct','import','test')`).run();
    const personalBefore = Object.fromEntries([
      "skct_personal_releases", "skct_personal_public_items", "skct_personal_secret_items",
      "skct_personal_attempts", "skct_personal_attempt_items",
      "skct_personal_release_audit",
    ].map(table => [table, database.prepare(`SELECT * FROM ${table}`).all()]));
    const before = {
      questions: Number(database.prepare("SELECT COUNT(*) AS count FROM questions").get()?.count),
      theories: Number(database.prepare("SELECT COUNT(*) AS count FROM theories").get()?.count),
      swQuestions: Number(database.prepare("SELECT COUNT(*) AS count FROM sw_questions").get()?.count),
      swTags: Number(database.prepare("SELECT COUNT(*) AS count FROM sw_question_tags").get()?.count),
      questionId: database.prepare("SELECT id FROM questions ORDER BY id LIMIT 1").get()?.id,
      swQuestionId: database.prepare("SELECT id FROM sw_questions ORDER BY id LIMIT 1").get()?.id,
      learnerRows: Number(database.prepare(`
        SELECT
          (SELECT COUNT(*) FROM user_accounts WHERE user_key = 'stage4-user')
          + (SELECT COUNT(*) FROM user_settings WHERE user_key = 'stage4-user')
          + (SELECT COUNT(*) FROM user_bookmarks WHERE user_key = 'stage4-user')
         AS count
      `).get()?.count),
    };
    const createStartedAt = performance.now();
    const created = await external.createExternalBackup(
      { email: "admin@example.invalid", hash: "stage4-admin" },
      "full",
    );
    const createDurationMs = Number((performance.now() - createStartedAt).toFixed(1));
    assert.ok(created.partCount > 100 && created.partCount <= 800);
    assert.ok(created.maxBufferedBytes <= 256 * 1024);
    const source = await external.readExternalBackup(created.id);
    assert.ok(source);

    const previewStartedAt = performance.now();
    const conflicts = await external.externalBackupConflicts(source);
    const previewDurationMs = Number((performance.now() - previewStartedAt).toFixed(1));
    for (const [table, counts] of Object.entries(conflicts)) {
      assert.equal(counts.existingIds, created.counts[table]);
    }
    for (const [table, key] of [
      ["questions", { id: sqlQuestion.id }],
      ["user_bookmarks", { user_key: "stage4-user", question_id: sqlQuestion.id }],
    ] as const) {
      const sql = countQueries.get(table);
      assert.ok(sql);
      assert.equal(database.prepare(sql).get(JSON.stringify([key, key]))?.count, 1, "duplicate incoming keys must count one existing row");
    }

    database.prepare("UPDATE site_settings SET value = 'full-restore-mutation' WHERE key = 'site_notice'").run();
    database.prepare("UPDATE skct_personal_attempt_items SET selected_index=2 WHERE attempt_id='backup-skct-attempt'").run();
    const restoreStartedAt = performance.now();
    const restored = await external.restoreExternalBackup(
      { email: "admin@example.invalid", hash: "stage4-admin" },
      source,
      "full-replace",
      "전체 데이터를 복원합니다",
      async () => ({ id: "canonical-safety" }),
    );
    const restoreDurationMs = Number((performance.now() - restoreStartedAt).toFixed(1));
    assert.equal(restored.restoredTables.length, source.manifest.metadata.includedData.length);
    assert.deepEqual(database.prepare("SELECT * FROM theories WHERE id = ?").get(sqlQuestion.theory_id), originalTheory);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM questions").get()?.count, before.questions);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM theories").get()?.count, before.theories);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM sw_questions").get()?.count, before.swQuestions);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM sw_question_tags").get()?.count, before.swTags);
    assert.equal(database.prepare("SELECT id FROM questions ORDER BY id LIMIT 1").get()?.id, before.questionId);
    assert.equal(database.prepare("SELECT id FROM sw_questions ORDER BY id LIMIT 1").get()?.id, before.swQuestionId);
    assert.equal(database.prepare(`
      SELECT
        (SELECT COUNT(*) FROM user_accounts WHERE user_key = 'stage4-user')
        + (SELECT COUNT(*) FROM user_settings WHERE user_key = 'stage4-user')
        + (SELECT COUNT(*) FROM user_bookmarks WHERE user_key = 'stage4-user')
         AS count
    `).get()?.count, before.learnerRows);
    assert.equal(before.learnerRows, 3);
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM backup_chunks").get()?.count, 0);
    for (const [table, rows] of Object.entries(personalBefore))
      assert.deepEqual(database.prepare(`SELECT * FROM ${table}`).all(), rows, `${table} must roundtrip exactly`);
    // Simulate divergent immutable content in this fixture to prove that a settings-only
    // restore ignores personal rows which are outside the selected restore scope.
    const originalNotice = database.prepare("SELECT value FROM site_settings WHERE key='site_notice'").get()?.value;
    database.exec("DROP TRIGGER skct_personal_public_immutable_update");
    database.prepare("UPDATE skct_personal_public_items SET public_json='fixture-divergence' WHERE release_id='backup-skct'").run();
    database.prepare("UPDATE site_settings SET value='settings-mutation' WHERE key='site_notice'").run();
    await external.restoreExternalBackup(
      { email: "admin@example.invalid", hash: "stage4-admin" }, source,
      "settings-only", "", async () => ({ id: "settings-safety" }),
    );
    assert.equal(database.prepare("SELECT value FROM site_settings WHERE key='site_notice'").get()?.value, originalNotice);
    assert.equal(database.prepare("SELECT public_json FROM skct_personal_public_items WHERE source_item_id='U01_BACKUP_001'").get()?.public_json, "fixture-divergence");
    context.diagnostic(JSON.stringify({
      byteSize: created.byteSize,
      createDurationMs,
      previewDurationMs,
      maxBufferedBytes: created.maxBufferedBytes,
      partCount: created.partCount,
      restoreDurationMs,
      restoredTableCount: restored.restoredTables.length,
    }));
  } finally {
    database.close();
    globalThis.__BAEUMZIP_ENV__ = undefined;
  }
});

test("external backup overlaps four bounded part uploads and preserves manifest order", async () => {
  Object.assign(globalThis, { __BAEUMZIP_APP_VERSION__: "runtime-backup-test" });
  const database = backupFixture();
  const insert = database.prepare("INSERT INTO site_settings VALUES (?, ?, 'string', 'admin', '2026-09-07T00:00:00Z')");
  for (let index = 0; index < 550; index += 1) insert.run(`bulk-${String(index).padStart(4, "0")}`, "가".repeat(1500));
  const bucket = new MemoryR2();
  const put = bucket.put.bind(bucket);
  let active = 0;
  let maximum = 0;
  bucket.put = async (key, value) => {
    if (!key.includes("/parts/")) return put(key, value);
    active += 1;
    maximum = Math.max(maximum, active);
    try {
      await new Promise(resolve => setTimeout(resolve, 5));
      await put(key, value);
    } finally { active -= 1; }
  };
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(database) as never, BACKUP_OBJECTS: bucket };
  try {
    const external = await import("../apps/backend/src/modules/admin/admin-external-backup-use-cases");
    const created = await external.createExternalBackup({ email: "admin@example.invalid", hash: "runtime" }, "settings");
    assert.equal(maximum, 4);
    assert.ok(created.maxPendingUploadBytes <= 4 * 256 * 1024);
    assert.equal(active, 0);
    assert.ok(created.maxBufferedBytes <= 256 * 1024);
    const source = await external.readExternalBackup(created.id);
    assert.ok(source);
    const envelope = await new Response(external.externalBackupDownloadStream(source)).json();
    validateDownloadedBackupEnvelope(envelope, { requireFull: false });
  } finally { globalThis.__BAEUMZIP_ENV__ = previous; database.close(); }
});

test("slow or canceled downloads stop reading external parts instead of buffering the whole backup", async () => {
  Object.assign(globalThis, { __BAEUMZIP_APP_VERSION__: "stream-backup-test" });
  const database = backupFixture();
  const insert = database.prepare("INSERT INTO site_settings VALUES (?, ?, 'string', 'admin', '2026-09-07T00:00:00Z')");
  for (let index = 0; index < 350; index += 1) insert.run(`stream-${index}`, "가".repeat(1500));
  const bucket = new MemoryR2();
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(database) as never, BACKUP_OBJECTS: bucket };
  try {
    const external = await import("../apps/backend/src/modules/admin/admin-external-backup-use-cases");
    const created = await external.createExternalBackup({ email: "admin@example.invalid", hash: "stream" }, "settings");
    const source = await external.readExternalBackup(created.id);
    assert.ok(source);
    assert.ok(source.manifest.parts.length > 3);
    const get = bucket.get.bind(bucket);
    let partReads = 0;
    bucket.get = async (key) => {
      if (key.includes("/parts/")) partReads += 1;
      return get(key);
    };
    const reader = external.externalBackupDownloadStream(source).getReader();
    try {
      await new Promise(resolve => setTimeout(resolve, 20));
      assert.equal(partReads, 0, "an idle consumer must not start reading the backup body");
      for (let index = 0; index < 5 && partReads === 0; index += 1) await reader.read();
      assert.equal(partReads, 1);
      await new Promise(resolve => setTimeout(resolve, 20));
      assert.equal(partReads, 1, "a stalled consumer must retain at most its current part");
    } finally { await reader.cancel(); }
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(partReads, 1, "cancellation must not fetch the remaining parts");
  } finally { globalThis.__BAEUMZIP_ENV__ = previous; database.close(); }
});

test("failed parallel uploads finish before cleanup so late writes cannot orphan objects", async () => {
  Object.assign(globalThis, { __BAEUMZIP_APP_VERSION__: "runtime-backup-test" });
  const database = backupFixture();
  const insert = database.prepare("INSERT INTO site_settings VALUES (?, ?, 'string', 'admin', '2026-09-07T00:00:00Z')");
  for (let index = 0; index < 550; index += 1) insert.run(`bulk-${String(index).padStart(4, "0")}`, "가".repeat(1500));
  const bucket = new MemoryR2();
  const put = bucket.put.bind(bucket);
  let count = 0;
  let active = 0;
  bucket.put = async (key, value) => {
    if (!key.includes("/parts/")) return put(key, value);
    const ordinal = count++;
    active += 1;
    try {
      await new Promise(resolve => setTimeout(resolve, ordinal === 0 ? 1 : 15));
      await put(key, value);
      if (ordinal === 0) throw new Error("simulated upload failure");
    } finally { active -= 1; }
  };
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(database) as never, BACKUP_OBJECTS: bucket };
  try {
    const external = await import("../apps/backend/src/modules/admin/admin-external-backup-use-cases");
    await assert.rejects(external.createExternalBackup({ email: "admin@example.invalid", hash: "runtime" }, "settings"), /simulated upload failure/u);
    assert.ok(count > 1);
    assert.equal(active, 0);
    assert.equal(bucket.objects.size, 0);
    assert.equal(database.prepare("SELECT status FROM backup_snapshots").get()?.status, "failed");
  } finally { globalThis.__BAEUMZIP_ENV__ = previous; database.close(); }
});

test("ISO-dated stalled backups expire and release only their stale creation lease", async () => {
  const database = backupFixture();
  const timestamp = Date.now();
  const old = new Date(timestamp - 16 * 60_000).toISOString();
  const recent = new Date(timestamp - 60_000).toISOString();
  database.prepare("INSERT INTO backup_snapshots VALUES ('stalled', 'full', 'creating', 'admin-4', 'test', '[]', '{}', '', '@chunked', 0, 'admin', ?, '')").run(old);
  database.prepare("INSERT INTO backup_snapshots VALUES ('recent', 'full', 'creating', 'admin-4', 'test', '[]', '{}', '', '@chunked', 0, 'admin', ?, '')").run(recent);
  database.exec("INSERT INTO backup_chunks VALUES ('stalled', 0, 'partial')");
  database.prepare("INSERT INTO maintenance_runs (task, lease_owner, lease_until, last_started_at, updated_at) VALUES ('backup_create', 'stale-owner', ?, ?, ?)").run(new Date(timestamp + 14 * 60_000).toISOString(), old, old);
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(database) as never };
  try {
    const lifecycle = await import("../apps/backend/src/modules/admin/backup-lifecycle");
    await lifecycle.expireStalledBackups();
    assert.equal(database.prepare("SELECT status FROM backup_snapshots WHERE id = 'stalled'").get()?.status, "failed");
    assert.equal(database.prepare("SELECT status FROM backup_snapshots WHERE id = 'recent'").get()?.status, "creating");
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM backup_chunks").get()?.n, 0);
    assert.equal(await lifecycle.claimBackupCreationLease("new-owner"), true);
    await lifecycle.expireStalledBackups();
    assert.equal(await lifecycle.claimBackupCreationLease("duplicate-owner"), false);
    assert.equal(database.prepare("SELECT lease_owner FROM maintenance_runs WHERE task = 'backup_create'").get()?.lease_owner, "new-owner");
  } finally { globalThis.__BAEUMZIP_ENV__ = previous; database.close(); }
});

test("maintenance leases compare ISO timestamps as dates and reject concurrent owners", async () => {
  const database = backupFixture();
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(database) as never };
  try {
    const { OperationsRepository } = await import("../apps/backend/src/modules/operations/operations.repository");
    const repository = new OperationsRepository();
    assert.equal(await repository.claimLease("test-housekeeping", "first", 15), true);
    assert.equal(await repository.claimLease("test-housekeeping", "second", 15), false);
    database.exec("UPDATE maintenance_runs SET lease_until = datetime('now', '-1 minute')");
    assert.equal(await repository.claimLease("test-housekeeping", "third", 15), true);
  } finally { globalThis.__BAEUMZIP_ENV__ = previous; database.close(); }
});


test("legacy internal and external backups validate retired progress but never restore or query its tables", async () => {
  const database = openCanonicalTestDatabase(projectRoot);
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(database) as never };
  try {
    database.exec("INSERT INTO user_accounts (user_key, email, display_name) VALUES ('legacy-backup-user', 'legacy@example.invalid', 'before')");
    const user = { ...database.prepare("SELECT * FROM user_accounts WHERE user_key = 'legacy-backup-user'").get()!, display_name: "restored" };
    const data = {
      user_accounts: [user],
      theory_progress: [{ id: 1, user_key: "legacy-backup-user", theory_id: 1, exam_type: "SQLP", completed: 1, updated_at: "2026-09-08T00:00:00Z" }],
      sw_theory_progress: [{ user_key: "legacy-backup-user", theory_id: "retired", completed: 1, updated_at: "2026-09-08T00:00:00Z" }],
    };
    const metadata = { backupVersion: "1", schemaVersion: "admin-4", appVersion: "legacy-test", type: "learning" as const, source: "manual" as const, generatedAt: "2026-09-08T00:00:00Z", includedData: Object.keys(data), counts: Object.fromEntries(Object.entries(data).map(([table, rows]) => [table, rows.length])) };
    const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
    const internal = await import("../apps/backend/src/modules/admin/admin-backup-use-cases");
    const envelope = await internal.validateBackupEnvelope({ metadata: { ...metadata, checksum: digest({ metadata, data }) }, data });
    assert.deepEqual(Object.keys(await internal.backupConflicts(envelope)), ["user_accounts"]);
    const restored = await internal.restoreBackup({ email: "admin@example.invalid", hash: "legacy-admin" }, envelope, "merge", "", { skipSafetyBackup: true });
    assert.deepEqual(restored.restoredTables, ["user_accounts"]);
    assert.equal(database.prepare("SELECT display_name FROM user_accounts WHERE user_key = 'legacy-backup-user'").get()!.display_name, "restored");
    const corruptInternal = structuredClone(envelope);
    corruptInternal.data.theory_progress[0].completed = 0;
    await assert.rejects(internal.validateBackupEnvelope(corruptInternal), /무결성/u);

    const storage = new InMemoryBackupStorage();
    const parts = [];
    for (const [table, rows] of Object.entries(data)) {
      const receipt = await storage.put(`legacy/${table}.json`, new TextEncoder().encode(JSON.stringify(rows)));
      parts.push({ table, partIndex: 0, rowStart: 0, rowCount: rows.length, ...receipt });
    }
    const external = await import("../apps/backend/src/modules/admin/admin-external-backup-use-cases");
    const externalMetadata = { ...metadata, backupVersion: "2", storageFormat: EXTERNAL_BACKUP_FORMAT };
    const publicParts = parts.map(({ table, partIndex, rowStart, rowCount, byteSize, checksum }) => ({ table, partIndex, rowStart, rowCount, byteSize, checksum }));
    const checksum = digest({ format: EXTERNAL_BACKUP_FORMAT, metadata: externalMetadata, parts: publicParts });
    const manifest = await external.validateExternalManifest({ format: EXTERNAL_BACKUP_FORMAT, metadata: { ...externalMetadata, checksum }, parts });
    const source = { id: "legacy-fixture", backup_type: "learning", created_at: metadata.generatedAt, descriptor: { objectPrefix: "legacy/" } as never, manifest, storage };
    const downloaded = await new Response(external.externalBackupDownloadStream(source)).json();
    await external.validatePortableExternalEnvelope(downloaded);
    validateDownloadedBackupEnvelope(downloaded, { requireFull: false });
    assert.deepEqual(Object.keys(await external.externalBackupConflicts(source)), ["user_accounts"]);
    database.exec("UPDATE user_accounts SET display_name = 'changed' WHERE user_key = 'legacy-backup-user'");
    const externalResult = await external.restoreExternalBackup({ email: "admin@example.invalid", hash: "legacy-admin" }, source, "merge", "", async () => ({ id: "test-safety" }));
    assert.deepEqual(externalResult.restoredTables, ["user_accounts"]);
    assert.equal(externalResult.validatedParts, 3);
    assert.equal(database.prepare("SELECT display_name FROM user_accounts WHERE user_key = 'legacy-backup-user'").get()!.display_name, "restored");
    assert.deepEqual(database.prepare("SELECT name FROM sqlite_master WHERE name IN ('theory_progress', 'sw_theory_progress')").all(), []);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM backup_chunks").get()!.count, 0);
    const retiredPart = parts.find(part => part.table === "theory_progress")!;
    await storage.put(retiredPart.objectKey, new TextEncoder().encode("corrupted"));
    await assert.rejects(external.externalBackupConflicts(source), /무결성|크기/u);
    let safetyCalled = false;
    await assert.rejects(external.restoreExternalBackup({ email: "admin@example.invalid", hash: "legacy-admin" }, source, "merge", "", async () => { safetyCalled = true; return { id: "must-not-run" }; }), /무결성|크기/u);
    assert.equal(safetyCalled, false);
  } finally { database.close(); globalThis.__BAEUMZIP_ENV__ = previous; }
});


test("incremental legacy backup digest preserves JSON bytes for Korean, escapes, empty tables, and large content", async () => {
  const { backupDigestBase } = await import("../apps/backend/src/modules/admin/admin-backup-use-cases");
  for (const schemaVersion of ["admin-4", "admin-5", "admin-6"]) {
    const metadata = { backupVersion: "1", appVersion: "test", schemaVersion, type: "content" as const, source: "manual" as const, generatedAt: "2026-09-08T00:00:00Z", includedData: ["theories", "questions"], counts: { theories: 1800, questions: 0 } };
    const data = { theories: Array.from({ length: 1800 }, (_, id) => ({ id, title: '한글 \" 따옴표 😀', content: "한국어\n".repeat(1600), absent: null })), questions: [] };
    const expected = createHash("sha256").update(JSON.stringify({ metadata, data })).digest("hex");
    assert.equal(await backupDigestBase(metadata, data), expected);
  }
});

test("loose content imports retain legacy cleanup while release snapshots keep exact rows", async () => {
  (globalThis as typeof globalThis & { __BAEUMZIP_APP_VERSION__: string }).__BAEUMZIP_APP_VERSION__ = "stage4-test";
  const { restoredContentRows } = await import("../apps/backend/src/modules/admin/admin-backup-restore-content");
  const source = [{ id: 1, difficulty: "상", content: "학습 본문\n\n" }];
  assert.equal(restoredContentRows("theories", source, true, "content", "admin-8"), source);
  const verifiedOnlyReleases = [{ version: "historical", status: "verified" }];
  assert.equal(restoredContentRows("theories", source, verifiedOnlyReleases.length > 0, "content", "admin-8"), source);
  assert.equal(restoredContentRows("theories", source, true, "full", "admin-9"), source);
  assert.equal(restoredContentRows("theories", source, false, "full", "admin-4"), source);
  assert.deepEqual(restoredContentRows("theories", source, false, "content", "admin-9"), [
    { id: 1, difficulty: "", content: "학습 본문" },
  ]);
  const legacyQuestion = [{ id: 7, exam_scope: "SQLD", category: "SQL 기본" }];
  assert.equal(restoredContentRows("questions", legacyQuestion, true, "content", "admin-8"), legacyQuestion);
  assert.equal(restoredContentRows("questions", legacyQuestion, false, "full", "admin-9"), legacyQuestion);
  assert.notEqual(restoredContentRows("questions", legacyQuestion, false, "full", "admin-4"), legacyQuestion);
});

test("admin-9 internal content backup restores exact release bytes without touching learner data and rolls back a failed batch", async () => {
  (globalThis as typeof globalThis & { __BAEUMZIP_APP_VERSION__: string }).__BAEUMZIP_APP_VERSION__ = "stage4-test";
  const database = openCanonicalTestDatabase(projectRoot);
  database.exec("PRAGMA temp_store=MEMORY");
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(database) as never, BACKUP_STORAGE_MODE: "database" };
  try {
    const original = readCanonicalContent(database);
    const theory = original.theories.find((row: { content: string }) => stripTheoryDifficultyMetadata(row.content) !== row.content);
    assert.ok(theory, "fixture needs a byte-sensitive historical theory");
    const active = database.prepare("SELECT * FROM content_releases WHERE status='active'").get() as Record<string, unknown>;
    assert.equal(active.question_checksum, canonicalRowsSha256(original.questions));
    assert.equal(active.theory_checksum, canonicalRowsSha256(original.theories));
    database.prepare("INSERT INTO user_accounts (user_key,email,display_name) VALUES ('restore-test-user','restore@example.invalid','before')").run();
    const learnerBefore = database.prepare("SELECT * FROM user_accounts WHERE user_key='restore-test-user'").get();
    const internal = await import("../apps/backend/src/modules/admin/admin-backup-use-cases");
    const created = await internal.createBackup({ email: "admin@example.invalid", hash: "restore-test" }, "content", { storageMode: "database" });
    const saved = await internal.readBackupPayload(created.id);
    const envelope = await internal.validateBackupEnvelope(JSON.parse(saved.serialized));
    database.prepare("UPDATE theories SET content='local unsaved change' WHERE id=?").run(theory.id);
    await internal.restoreBackup({ email: "admin@example.invalid", hash: "restore-test" }, envelope, "content-only", "", { skipSafetyBackup: true });
    assert.equal(database.prepare("SELECT content FROM theories WHERE id=?").get(theory.id)?.content, theory.content);
    const restored = readCanonicalContent(database);
    assert.equal(canonicalRowsSha256(restored.questions), active.question_checksum);
    assert.equal(canonicalRowsSha256(restored.theories), active.theory_checksum);
    assert.deepEqual(database.prepare("SELECT * FROM user_accounts WHERE user_key='restore-test-user'").get(), learnerBefore);

    const legacyMetadata = { ...envelope.metadata, schemaVersion: "admin-8" };
    const legacyBase = { ...legacyMetadata };
    Reflect.deleteProperty(legacyBase, "checksum");
    const legacyEnvelope = await internal.validateBackupEnvelope({
      metadata: { ...legacyBase, checksum: await internal.backupDigestBase(legacyBase, envelope.data) },
      data: envelope.data,
    });
    database.prepare("UPDATE theories SET content='local unsaved change' WHERE id=?").run(theory.id);
    await internal.restoreBackup(
      { email: "admin@example.invalid", hash: "restore-test" }, legacyEnvelope,
      "content-only", "", { skipSafetyBackup: true },
    );
    assert.equal(database.prepare("SELECT content FROM theories WHERE id=?").get(theory.id)?.content, theory.content);
    assert.equal(canonicalRowsSha256(readCanonicalContent(database).theories), active.theory_checksum);

    database.prepare("UPDATE theories SET content='local unsaved change' WHERE id=?").run(theory.id);
    database.exec("CREATE TRIGGER fail_restore_question BEFORE UPDATE ON questions BEGIN SELECT RAISE(ABORT, 'forced_restore_abort'); END");
    await assert.rejects(
      internal.restoreBackup({ email: "admin@example.invalid", hash: "restore-test" }, envelope, "content-only", "", { skipSafetyBackup: true }),
      /forced_restore_abort/u,
    );
    assert.equal(database.prepare("SELECT content FROM theories WHERE id=?").get(theory.id)?.content, "local unsaved change");
    assert.deepEqual(database.prepare("SELECT * FROM content_releases WHERE status='active'").get(), active);
    assert.deepEqual(database.prepare("SELECT * FROM user_accounts WHERE user_key='restore-test-user'").get(), learnerBefore);
  } finally {
    globalThis.__BAEUMZIP_ENV__ = previous;
    database.close();
  }
});

test("admin-9 external content backup preserves release bytes and learner data through staged restore", async () => {
  (globalThis as typeof globalThis & { __BAEUMZIP_APP_VERSION__: string }).__BAEUMZIP_APP_VERSION__ = "stage4-test";
  const database = openCanonicalTestDatabase(projectRoot);
  database.exec("PRAGMA temp_store=MEMORY");
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = {
    DB: sqliteD1(database) as never,
    BACKUP_OBJECTS: new MemoryR2(),
    BACKUP_STORAGE_MODE: "external",
  };
  try {
    const original = readCanonicalContent(database);
    const theory = original.theories.find((row: { content: string }) => stripTheoryDifficultyMetadata(row.content) !== row.content);
    assert.ok(theory);
    const active = database.prepare("SELECT * FROM content_releases WHERE status='active'").get() as Record<string, unknown>;
    database.prepare("INSERT INTO user_accounts (user_key,email,display_name) VALUES ('restore-test-user','restore@example.invalid','before')").run();
    const learnerBefore = database.prepare("SELECT * FROM user_accounts WHERE user_key='restore-test-user'").get();
    const external = await import("../apps/backend/src/modules/admin/admin-external-backup-use-cases");
    const created = await external.createExternalBackup({ email: "admin@example.invalid", hash: "restore-test" }, "content");
    const source = await external.readExternalBackup(created.id);
    assert.ok(source);
    database.prepare("UPDATE theories SET content='local unsaved change' WHERE id=?").run(theory.id);
    await external.restoreExternalBackup(
      { email: "admin@example.invalid", hash: "restore-test" }, source, "content-only", "",
      async () => ({ id: "synthetic-safety-backup" }),
    );
    assert.equal(database.prepare("SELECT content FROM theories WHERE id=?").get(theory.id)?.content, theory.content);
    const restored = readCanonicalContent(database);
    assert.equal(canonicalRowsSha256(restored.questions), active.question_checksum);
    assert.equal(canonicalRowsSha256(restored.theories), active.theory_checksum);
    assert.deepEqual(database.prepare("SELECT * FROM user_accounts WHERE user_key='restore-test-user'").get(), learnerBefore);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM backup_chunks WHERE snapshot_id LIKE 'restore-stage-%'").get()?.count, 0);

    database.prepare("UPDATE theories SET content='local unsaved change' WHERE id=?").run(theory.id);
    database.exec("CREATE TRIGGER fail_restore_question BEFORE UPDATE ON questions BEGIN SELECT RAISE(ABORT, 'forced_restore_abort'); END");
    await assert.rejects(
      external.restoreExternalBackup(
        { email: "admin@example.invalid", hash: "restore-test" }, source, "content-only", "",
        async () => ({ id: "synthetic-safety-backup" }),
      ),
      /forced_restore_abort/u,
    );
    assert.equal(database.prepare("SELECT content FROM theories WHERE id=?").get(theory.id)?.content, "local unsaved change");
    assert.deepEqual(database.prepare("SELECT * FROM content_releases WHERE status='active'").get(), active);
    assert.deepEqual(database.prepare("SELECT * FROM user_accounts WHERE user_key='restore-test-user'").get(), learnerBefore);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM backup_chunks WHERE snapshot_id LIKE 'restore-stage-%'").get()?.count, 0);
  } finally {
    globalThis.__BAEUMZIP_ENV__ = previous;
    database.close();
  }
});


test("D1 backup conflict preview probes primary keys instead of rescanning each incoming group", async () => {
  const database = openCanonicalTestDatabase(projectRoot);
  const previous = globalThis.__BAEUMZIP_ENV__;
  const adapter = sqliteD1(database);
  const plans: string[] = [];
  globalThis.__BAEUMZIP_ENV__ = { DB: { ...adapter, prepare(sql: string) {
    const statement = adapter.prepare(sql);
    const bind = statement.bind.bind(statement);
    statement.bind = (...values: SQLInputValue[]) => {
      if (sql.includes("CROSS JOIN")) plans.push(database.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...values).map((row: { detail: unknown }) => String(row.detail)).join("\n"));
      return bind(...values);
    };
    return statement;
  } } as never };
  try {
    const { backupConflicts } = await import("../apps/backend/src/modules/admin/admin-backup-use-cases");
    const rows = database.prepare("SELECT id FROM questions ORDER BY id LIMIT 6000").all();
    const id = Number(rows[0].id);
    database.prepare("INSERT INTO user_bookmarks (user_key, question_id) VALUES ('preview-a', ?), ('preview-b', ?)").run(id, id);
    const data = {
      questions: [...rows, { id }, { id: String(id) }, { id: -999 }],
      user_bookmarks: [{ user_key: "preview-a", question_id: id }, { user_key: "preview-a", question_id: String(id) }, { user_key: "preview-b", question_id: id }, { user_key: "missing", question_id: id }],
    };
    const result = await backupConflicts({ metadata: { includedData: Object.keys(data) }, data } as never);
    assert.equal(result.questions.existingIds, 6000);
    assert.equal(result.user_bookmarks.existingIds, 2);
    assert.equal(plans.length, 2);
    for (const plan of plans) {
      assert.match(plan, /SCAN incoming VIRTUAL TABLE/u);
      assert.match(plan, /SEARCH existing USING (?:COVERING INDEX|INTEGER PRIMARY KEY)/u);
      assert.doesNotMatch(plan, /SCAN existing/u);
    }
  } finally { database.close(); globalThis.__BAEUMZIP_ENV__ = previous; }
});

test("resumable external backup checkpoints pages and publishes only after the second scan", async () => {
  Object.assign(globalThis, { __BAEUMZIP_APP_VERSION__: "durable-backup-test" });
  const database = backupFixture();
  const insert = database.prepare("INSERT INTO site_settings VALUES (?, ?, 'string', 'admin', '2026-09-07T00:00:00Z')");
  for (let index = 0; index < 510; index += 1) {
    insert.run(`durable-${String(index).padStart(4, "0")}`, "검증".repeat(80));
  }
  const bucket = new MemoryR2();
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(database) as never, BACKUP_OBJECTS: bucket };
  try {
    const external = await import("../apps/backend/src/modules/admin/admin-external-backup-use-cases");
    const durable = await import("../apps/backend/src/modules/admin/admin-manual-external-backup-use-cases");
    const identity = { email: "admin@example.invalid", hash: "durable-admin" };
    const id = crypto.randomUUID();
    const first = await durable.advanceManualExternalBackup(identity, "settings", false, id);
    assert.equal(first.completed, false);
    assert.equal(database.prepare("SELECT status FROM backup_snapshots WHERE id = ?").get(id)?.status, "creating");
    const orphanKey = `backups/${id}/parts/uncheckpointed.json`;
    await bucket.put(orphanKey, new TextEncoder().encode("orphan"));
    let result = first;
    let steps = 1;
    while (!result.completed && steps < 20) {
      result = await durable.advanceManualExternalBackup(identity, "settings", false, id);
      steps += 1;
    }
    assert.ok(steps > 1 && steps < 20);
    assert.equal(result.completed, true);
    const persisted = database.prepare("SELECT status, checksum FROM backup_snapshots WHERE id = ?").get(id);
    assert.equal(persisted?.status, "completed");
    assert.match(String(persisted?.checksum), /^[a-f0-9]{64}$/u);
    const source = await external.readExternalBackup(id);
    assert.ok(source);
    assert.equal(bucket.objects.has(orphanKey), false);
    const envelope = await new Response(external.externalBackupDownloadStream(source)).json();
    validateDownloadedBackupEnvelope(envelope, { requireFull: false });
    const again = await durable.advanceManualExternalBackup(identity, "settings", false, id);
    assert.equal(again.completed, true);
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM backup_snapshots WHERE id = ?").get(id)?.n, 1);
  } finally {
    globalThis.__BAEUMZIP_ENV__ = previous;
    database.close();
  }
});

test("resumable external backup fails closed and removes its R2 prefix after source mutation", async () => {
  Object.assign(globalThis, { __BAEUMZIP_APP_VERSION__: "durable-backup-test" });
  const database = backupFixture();
  const insert = database.prepare("INSERT INTO site_settings VALUES (?, ?, 'string', 'admin', '2026-09-07T00:00:00Z')");
  for (let index = 0; index < 510; index += 1) {
    insert.run(`mutation-${String(index).padStart(4, "0")}`, "검증".repeat(80));
  }
  const bucket = new MemoryR2();
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(database) as never, BACKUP_OBJECTS: bucket };
  try {
    const external = await import("../apps/backend/src/modules/admin/admin-external-backup-use-cases");
    const durable = await import("../apps/backend/src/modules/admin/admin-manual-external-backup-use-cases");
    const identity = { email: "admin@example.invalid", hash: "durable-admin" };
    const id = crypto.randomUUID();
    const first = await durable.advanceManualExternalBackup(identity, "settings", false, id);
    assert.equal(first.completed, false);
    database.prepare("UPDATE site_settings SET value = 'changed' WHERE key = 'mutation-0000'").run();
    let rejected = false;
    for (let step = 0; step < 20; step += 1) {
      try {
        await durable.advanceManualExternalBackup(identity, "settings", false, id);
      } catch (error) {
        assert.match(String(error), /원본 데이터가 변경/u);
        rejected = true;
        break;
      }
    }
    assert.equal(rejected, true);
    assert.equal(database.prepare("SELECT status FROM backup_snapshots WHERE id = ?").get(id)?.status, "failed");
    assert.equal([...bucket.objects.keys()].filter(key => key.startsWith(`backups/${id}/`)).length, 0);
  } finally {
    globalThis.__BAEUMZIP_ENV__ = previous;
    database.close();
  }
});

test("a completed database snapshot remains successful if lease cleanup fails", async () => {
  Object.assign(globalThis, { __BAEUMZIP_APP_VERSION__: "durable-backup-test" });
  const database = backupFixture();
  const binding = sqliteD1(database);
  const prepare = binding.prepare.bind(binding);
  binding.prepare = (sql) => {
    if (/UPDATE maintenance_runs\s+SET lease_owner = ''[\s\S]*last_succeeded_at/u.test(sql)) {
      throw new Error("simulated lease completion failure");
    }
    return prepare(sql);
  };
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: binding as never };
  try {
    const internal = await import("../apps/backend/src/modules/admin/admin-backup-use-cases");
    const created = await internal.createBackup(
      { email: "admin@example.invalid", hash: "durable-admin" }, "settings", { storageMode: "database" },
    );
    assert.equal(database.prepare("SELECT status FROM backup_snapshots WHERE id = ?").get(created.id)?.status, "completed");
    assert.match(created.checksum, /^[a-f0-9]{64}$/u);
  } finally {
    globalThis.__BAEUMZIP_ENV__ = previous;
    database.close();
  }
});

test("resumable external backup retries the same page after a transient R2 failure", async () => {
  Object.assign(globalThis, { __BAEUMZIP_APP_VERSION__: "durable-backup-test" });
  const database = backupFixture();
  const bucket = new MemoryR2();
  const put = bucket.put.bind(bucket);
  let failed = false;
  bucket.put = async (key, value) => {
    if (!failed && key.includes("/parts/")) {
      failed = true;
      throw new Error("temporary R2 outage");
    }
    return put(key, value);
  };
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(database) as never, BACKUP_OBJECTS: bucket };
  try {
    const external = await import("../apps/backend/src/modules/admin/admin-external-backup-use-cases");
    const durable = await import("../apps/backend/src/modules/admin/admin-manual-external-backup-use-cases");
    const identity = { email: "admin@example.invalid", hash: "durable-admin" };
    const id = crypto.randomUUID();
    await assert.rejects(durable.advanceManualExternalBackup(identity, "settings", false, id), /temporary R2 outage/u);
    assert.equal(database.prepare("SELECT status FROM backup_snapshots WHERE id = ?").get(id)?.status, "creating");
    let result = await durable.advanceManualExternalBackup(identity, "settings", false, id);
    for (let step = 0; !result.completed && step < 20; step += 1) {
      result = await durable.advanceManualExternalBackup(identity, "settings", false, id);
    }
    assert.equal(result.completed, true);
    assert.ok(await external.readExternalBackup(id));
  } finally {
    globalThis.__BAEUMZIP_ENV__ = previous;
    database.close();
  }
});

test("manual cancellation fails the snapshot and removes partial private R2 objects", async () => {
  Object.assign(globalThis, { __BAEUMZIP_APP_VERSION__: "durable-backup-test" });
  const database = backupFixture();
  const insert = database.prepare("INSERT INTO site_settings VALUES (?, ?, 'string', 'admin', '2026-09-07T00:00:00Z')");
  for (let index = 0; index < 450; index += 1) {
    insert.run(`cancel-${String(index).padStart(4, "0")}`, "검증".repeat(80));
  }
  const bucket = new MemoryR2();
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(database) as never, BACKUP_OBJECTS: bucket };
  try {
    const external = await import("../apps/backend/src/modules/admin/admin-external-backup-use-cases");
    const durable = await import("../apps/backend/src/modules/admin/admin-manual-external-backup-use-cases");
    const identity = { email: "admin@example.invalid", hash: "durable-admin" };
    const id = crypto.randomUUID();
    const started = await durable.advanceManualExternalBackup(identity, "settings", false, id);
    assert.equal(started.completed, false);
    assert.ok([...bucket.objects.keys()].some(key => key.startsWith(`backups/${id}/`)));
    await assert.rejects(
      durable.cancelManualExternalBackup({ email: "other@example.invalid", hash: "other" }, id),
      /찾을 수 없습니다/u,
    );
    assert.equal((await durable.cancelManualExternalBackup(identity, id)).canceled, true);
    assert.equal(database.prepare("SELECT status FROM backup_snapshots WHERE id = ?").get(id)?.status, "failed");
    assert.equal([...bucket.objects.keys()].filter(key => key.startsWith(`backups/${id}/`)).length, 0);
  } finally {
    globalThis.__BAEUMZIP_ENV__ = previous;
    database.close();
  }
});

test("resumable full backup includes all 50 admin-9 tables and validates its manifest", async () => {
  Object.assign(globalThis, { __BAEUMZIP_APP_VERSION__: "durable-backup-test" });
  const database = openCanonicalTestDatabase(projectRoot);
  const bucket = new MemoryR2();
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(database) as never, BACKUP_OBJECTS: bucket };
  try {
    const external = await import("../apps/backend/src/modules/admin/admin-external-backup-use-cases");
    const durable = await import("../apps/backend/src/modules/admin/admin-manual-external-backup-use-cases");
    const identity = { email: "admin@example.invalid", hash: "durable-admin" };
    const id = crypto.randomUUID();
    let result = await durable.advanceManualExternalBackup(identity, "full", false, id);
    let steps = 1;
    while (!result.completed && steps < 2_000) {
      result = await durable.advanceManualExternalBackup(identity, "full", false, id);
      steps += 1;
    }
    assert.equal(result.completed, true);
    assert.ok(steps > 100 && steps < 2_000);
    const source = await external.readExternalBackup(id);
    assert.ok(source);
    assert.equal(source.manifest.metadata.includedData.length, 50);
    for (const table of [
      "skct_personal_public_items", "skct_personal_secret_items",
      "study_group_exam_question_public", "study_group_exam_question_secret",
      "study_group_exam_participant_progress", "user_reports", "site_settings",
    ]) assert.ok(source.manifest.metadata.includedData.includes(table));
    const envelope = await new Response(external.externalBackupDownloadStream(source)).json();
    validateDownloadedBackupEnvelope(envelope, { requireFull: true });
  } finally {
    globalThis.__BAEUMZIP_ENV__ = previous;
    database.close();
  }
});

test("a changed backup source contract cannot resume an earlier checkpoint", async () => {
  Object.assign(globalThis, { __BAEUMZIP_APP_VERSION__: "durable-backup-test" });
  const database = backupFixture();
  const insert = database.prepare("INSERT INTO site_settings VALUES (?, ?, 'string', 'admin', '2026-09-07T00:00:00Z')");
  for (let index = 0; index < 450; index += 1) {
    insert.run(`contract-${String(index).padStart(4, "0")}`, "검증".repeat(80));
  }
  const bucket = new MemoryR2();
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(database) as never, BACKUP_OBJECTS: bucket };
  try {
    const external = await import("../apps/backend/src/modules/admin/admin-external-backup-use-cases");
    const durable = await import("../apps/backend/src/modules/admin/admin-manual-external-backup-use-cases");
    const identity = { email: "admin@example.invalid", hash: "durable-admin" };
    const id = crypto.randomUUID();
    assert.equal((await durable.advanceManualExternalBackup(identity, "settings", false, id)).completed, false);
    const row = database.prepare("SELECT payload FROM backup_snapshots WHERE id = ?").get(id);
    const progress = JSON.parse(String(row?.payload));
    progress.schemaVersion = "admin-8";
    database.prepare("UPDATE backup_snapshots SET payload = ? WHERE id = ?").run(JSON.stringify(progress), id);
    await assert.rejects(
      durable.advanceManualExternalBackup(identity, "settings", false, id),
      /소스·스키마 버전/u,
    );
    assert.equal(database.prepare("SELECT status FROM backup_snapshots WHERE id = ?").get(id)?.status, "failed");
    assert.equal([...bucket.objects.keys()].filter(key => key.startsWith(`backups/${id}/`)).length, 0);
  } finally {
    globalThis.__BAEUMZIP_ENV__ = previous;
    database.close();
  }
});

test("an expired writer cannot overwrite a newer completed part or manifest", async () => {
  Object.assign(globalThis, { __BAEUMZIP_APP_VERSION__: "durable-backup-test" });
  const database = backupFixture();
  const bucket = new MemoryR2();
  const originalPut = bucket.put.bind(bucket);
  let releaseOldPut!: () => void;
  let signalOldPut!: () => void;
  const oldPutHeld = new Promise<void>(resolve => { releaseOldPut = resolve; });
  const oldPutStarted = new Promise<void>(resolve => { signalOldPut = resolve; });
  let delayed = false;
  let oldPartKey = "";
  bucket.put = async (key, value) => {
    if (!delayed && key.includes("/parts/")) {
      delayed = true;
      oldPartKey = key;
      signalOldPut();
      await oldPutHeld;
    }
    return originalPut(key, value);
  };
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(database) as never, BACKUP_OBJECTS: bucket };
  try {
    const external = await import("../apps/backend/src/modules/admin/admin-external-backup-use-cases");
    const durable = await import("../apps/backend/src/modules/admin/admin-manual-external-backup-use-cases");
    const identity = { email: "admin@example.invalid", hash: "durable-admin" };
    const id = crypto.randomUUID();
    const stale = durable.advanceManualExternalBackup(identity, "settings", false, id);
    await oldPutStarted;
    database.prepare("UPDATE maintenance_runs SET lease_until = '2000-01-01 00:00:00' WHERE task = 'backup_create'").run();
    database.prepare("UPDATE site_settings SET value = '새 값' WHERE key = 'site_notice'").run();
    let current = await durable.advanceManualExternalBackup(identity, "settings", false, id);
    for (let step = 0; !current.completed && step < 20; step += 1) {
      current = await durable.advanceManualExternalBackup(identity, "settings", false, id);
    }
    assert.equal(current.completed, true);
    releaseOldPut();
    await assert.rejects(stale, /충돌/u);
    assert.equal(database.prepare("SELECT status FROM backup_snapshots WHERE id = ?").get(id)?.status, "completed");
    assert.equal(bucket.objects.has(oldPartKey), false);
    const source = await external.readExternalBackup(id);
    assert.ok(source);
    assert.ok(source.manifest.parts.every(part => part.objectKey !== oldPartKey));
    const envelope = await new Response(external.externalBackupDownloadStream(source)).json();
    validateDownloadedBackupEnvelope(envelope, { requireFull: false });
  } finally {
    releaseOldPut();
    globalThis.__BAEUMZIP_ENV__ = previous;
    database.close();
  }
});

test("a manual progress checkpoint remains resumable after the legacy 15 minute expiry", async () => {
  Object.assign(globalThis, { __BAEUMZIP_APP_VERSION__: "durable-backup-test" });
  const database = backupFixture();
  const bucket = new MemoryR2();
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(database) as never, BACKUP_OBJECTS: bucket };
  try {
    const external = await import("../apps/backend/src/modules/admin/admin-external-backup-use-cases");
    const durable = await import("../apps/backend/src/modules/admin/admin-manual-external-backup-use-cases");
    const lifecycle = await import("../apps/backend/src/modules/admin/backup-lifecycle");
    const identity = { email: "admin@example.invalid", hash: "durable-admin" };
    const id = crypto.randomUUID();
    assert.equal((await durable.advanceManualExternalBackup(identity, "settings", false, id)).completed, false);
    database.prepare("UPDATE backup_snapshots SET created_at = '2000-01-01T00:00:00Z' WHERE id = ?").run(id);
    await lifecycle.expireStalledBackups();
    assert.equal(database.prepare("SELECT status FROM backup_snapshots WHERE id = ?").get(id)?.status, "creating");
    let current = await durable.advanceManualExternalBackup(identity, "settings", false, id);
    for (let step = 0; !current.completed && step < 20; step += 1) {
      current = await durable.advanceManualExternalBackup(identity, "settings", false, id);
    }
    assert.equal(current.completed, true);
  } finally {
    globalThis.__BAEUMZIP_ENV__ = previous;
    database.close();
  }
});

test("a previously opened admin tab retains the one-shot external create contract", async () => {
  Object.assign(globalThis, { __BAEUMZIP_APP_VERSION__: "durable-backup-test" });
  const database = openCanonicalTestDatabase(projectRoot);
  const bucket = new MemoryR2();
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(database) as never, BACKUP_OBJECTS: bucket };
  try {
    const manual = await import("../apps/backend/src/modules/admin/admin-manual-backup-response");
    const result = await manual.createManualBackupResponse(
      { email: "admin@example.invalid", hash: "durable-admin" },
      { type: "full", includeAnalytics: false, storageMode: "external" },
    );
    const response = result.response as { id: string; backupList?: { items: Array<{ id: string }> } | null };
    assert.equal("completed" in response, false);
    assert.equal(database.prepare("SELECT status FROM backup_snapshots WHERE id = ?").get(response.id)?.status, "completed");
    assert.ok(response.backupList?.items.some(item => item.id === response.id));
  } finally {
    globalThis.__BAEUMZIP_ENV__ = previous;
    database.close();
  }
});

test("the stalled reaper still expires legacy JSON with no kind field", async () => {
  const database = backupFixture();
  database.prepare(`INSERT INTO backup_snapshots VALUES (
    'stalled-json', 'settings', 'creating', 'admin-9', 'test', '[]', '{}', '', '{"other":true}',
    0, 'admin', '2000-01-01T00:00:00Z', ''
  )`).run();
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(database) as never };
  try {
    const lifecycle = await import("../apps/backend/src/modules/admin/backup-lifecycle");
    await lifecycle.expireStalledBackups();
    assert.equal(database.prepare("SELECT status FROM backup_snapshots WHERE id = 'stalled-json'").get()?.status, "failed");
  } finally {
    globalThis.__BAEUMZIP_ENV__ = previous;
    database.close();
  }
});

test("deleting failed durable progress clears only its own private R2 prefix", async () => {
  Object.assign(globalThis, { __BAEUMZIP_APP_VERSION__: "durable-backup-test" });
  const database = backupFixture();
  const bucket = new MemoryR2();
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(database) as never, BACKUP_OBJECTS: bucket };
  try {
    const external = await import("../apps/backend/src/modules/admin/admin-external-backup-use-cases");
    const durable = await import("../apps/backend/src/modules/admin/admin-manual-external-backup-use-cases");
    const identity = { email: "admin@example.invalid", hash: "durable-admin" };
    const id = crypto.randomUUID();
    assert.equal((await durable.advanceManualExternalBackup(identity, "settings", false, id)).completed, false);
    const otherId = crypto.randomUUID();
    const ownKey = `backups/${id}/parts/orphan.json`;
    const otherKey = `backups/${otherId}/parts/keep.json`;
    await bucket.put(ownKey, new TextEncoder().encode("private"));
    await bucket.put(otherKey, new TextEncoder().encode("private"));
    database.prepare("UPDATE backup_snapshots SET status = 'failed' WHERE id = ?").run(id);
    assert.equal(await external.deleteExternalBackupObjects(id), true);
    assert.equal(bucket.objects.has(ownKey), false);
    assert.equal(bucket.objects.has(otherKey), true);
  } finally {
    globalThis.__BAEUMZIP_ENV__ = previous;
    database.close();
  }
});

test("durable client respects 429 Retry-After and stops on permanent authorization errors", async () => {
  const { durableRetryDelay, runDurableAdminBackup } = await import("../apps/frontend/src/features/admin/model/admin-durable-backup");
  const { ApiRequestError } = await import("../apps/frontend/src/shared/api/request-json");
  assert.equal(durableRetryDelay(new ApiRequestError("busy", "RATE_LIMIT", 429, undefined, true, 61_000), 0), 61_000);
  assert.equal(durableRetryDelay(new ApiRequestError("busy", "RATE_LIMIT", 429, undefined, true), 0), 60_000);
  for (const status of [400, 401, 403, 404, 422]) {
    assert.equal(durableRetryDelay(new ApiRequestError("permanent", "BAD_REQUEST", status), 0), null);
  }
  assert.equal(durableRetryDelay(new ApiRequestError("temporary", "SERVER_ERROR", 503, undefined, true), 0), 3_000);
  const calls: Array<{ name: string; backupId: unknown }> = [];
  const waits: number[] = [];
  const id = crypto.randomUUID();
  const result = await runDurableAdminBackup({
    backupId: id, type: "full", includeAnalytics: false,
    shouldCancel: () => false, onProgress: () => undefined,
    sleep: async ms => { waits.push(ms); },
    action: async (name, values) => {
      calls.push({ name, backupId: values.backupId });
      if (calls.length === 1) throw new ApiRequestError("rate limited", "RATE_LIMIT", 429, undefined, true, 61_000);
      return { id, completed: true };
    },
  });
  assert.equal(result.completed, true);
  assert.deepEqual(waits, [61_000]);
  assert.deepEqual(calls, [
    { name: "backup-create", backupId: id }, { name: "backup-create", backupId: id },
  ]);
  for (const status of [401, 403]) {
    let requests = 0;
    await assert.rejects(runDurableAdminBackup({
      backupId: crypto.randomUUID(), type: "full", includeAnalytics: false,
      shouldCancel: () => false, onProgress: () => undefined,
      sleep: async () => { throw new Error("must not wait"); },
      action: async () => {
        requests += 1;
        throw new ApiRequestError("not authorized", "UNAUTHORIZED", status);
      },
    }), /not authorized/u);
    assert.equal(requests, 1);
  }
});
