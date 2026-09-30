import assert from "node:assert/strict";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import test from "node:test";
import { AdminRepository } from "../apps/backend/src/modules/admin/admin.repository";
import { GET as readStudy } from "../apps/backend/src/modules/study/study.service";
import { learnerUserHash } from "../apps/backend/src/common/auth/admin-auth";
import { createPublicContentCache } from "../apps/backend/src/common/content/public-content-cache";
import { readSharedPublicResponse, storeSharedPublicResponse } from "../apps/backend/src/common/http/shared-response-cache";

import {
  contentCacheRevisionStatement,
  readContentCacheRevision,
} from "../apps/backend/src/common/content/content-cache-revision";
import {
  readPublicSiteSettings,
} from "../apps/backend/src/modules/study/study-site-settings-cache";
import { changesPublicContent } from "../apps/backend/src/modules/admin/admin-content-cache-policy";

class StatementAdapter {
  private values: SQLInputValue[] = [];
  constructor(private readonly database: DatabaseSync, private readonly sql: string) {}
  bind(...values: SQLInputValue[]) {
    this.values = values;
    return this;
  }
  async first<T>() {
    return (this.database.prepare(this.sql).get(...this.values) ?? null) as T | null;
  }
  async run() {
    this.database.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: 1 } };
  }
  async all() {
    return { success: true, results: this.database.prepare(this.sql).all(...this.values) };
  }
}

function revisionDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE site_settings (
      key TEXT PRIMARY KEY, value TEXT NOT NULL, value_type TEXT NOT NULL,
      updated_by_hash TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE content_releases (
      version TEXT PRIMARY KEY, status TEXT NOT NULL,
      created_at TEXT NOT NULL, activated_at TEXT
    );
    CREATE TABLE theories (
      id INTEGER PRIMARY KEY, title TEXT, category TEXT DEFAULT 'SQL', topic TEXT DEFAULT 'model',
      sort_order INTEGER DEFAULT 1, exam_scope TEXT DEFAULT 'SQLD', summary TEXT DEFAULT '',
      keywords TEXT DEFAULT '[]', active INTEGER DEFAULT 1,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE user_settings (
      user_key TEXT PRIMARY KEY, selected_exam TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE user_accounts (
      user_key TEXT PRIMARY KEY, email TEXT, display_name TEXT, status TEXT, blocked_reason TEXT
    );
    INSERT INTO theories (id, title) VALUES (1, 'before');
    INSERT INTO site_settings VALUES
      ('content_revision_version', 'content-v1', 'string', 'migration', CURRENT_TIMESTAMP);
    INSERT INTO content_releases VALUES
      ('release-v1', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
  `);
  return {
    database,
    d1: {
      prepare(sql: string) { return new StatementAdapter(database, sql); },
      async batch(statements: StatementAdapter[]) {
        database.exec("BEGIN");
        try {
          const results = [];
          for (const statement of statements) results.push(await statement.all());
          database.exec("COMMIT");
          return results;
        } catch (error) {
          database.exec("ROLLBACK");
          throw error;
        }
      },
    } as unknown as D1Database,
  };
}

test("stage 5 content mutation bumps a database-backed cross-worker revision", async () => {
  const { database, d1 } = revisionDatabase();
  assert.equal(await readContentCacheRevision(d1), JSON.stringify(["content-v1", "release-v1", "0"]));
  await contentCacheRevisionStatement(d1, "admin-hash").run();
  const revision = await readContentCacheRevision(d1);
  assert.match(JSON.parse(revision)[2], /^[a-f0-9-]{36}$/u);
  assert.equal(await readContentCacheRevision(d1), revision);
  const stored = database.prepare(`
    SELECT value_type, updated_by_hash FROM site_settings
    WHERE key = 'content_cache_revision'
  `).get();
  assert.equal(stored?.value_type, "string");
  assert.equal(stored?.updated_by_hash, "admin-hash");
  database.close();
});

test("content writes and revision publish commit or roll back together", async () => {
  const { database, d1 } = revisionDatabase();
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: d1 };
  try {
    const repository = new AdminRepository();
    const before = await readContentCacheRevision(d1);
    await repository.execute("UPDATE theories SET title = ? WHERE id = ?", ["after", 1]);
    assert.notEqual(await readContentCacheRevision(d1), before);
    database.exec(`CREATE TRIGGER reject_cache_revision BEFORE INSERT ON site_settings
      WHEN NEW.key = 'content_cache_revision' BEGIN SELECT RAISE(ABORT, 'revision failed'); END`);
    await assert.rejects(repository.execute("UPDATE theories SET title = ? WHERE id = ?", ["broken", 1]));
    assert.equal(database.prepare("SELECT title FROM theories WHERE id = 1").get()?.title, "after");
  } finally {
    globalThis.__BAEUMZIP_ENV__ = previous;
    database.close();
  }
});

test("stage 5 controls are live reads, including after an older pending read finishes", async () => {
  let release!: () => void;
  const oldRepository = {
    async findPublicSiteSettings() {
      await new Promise<void>((resolve) => { release = resolve; });
      return [{ key: "maintenance_mode", value: "false" }];
    },
  };
  const oldRead = readPublicSiteSettings(oldRepository);
  await Promise.resolve();
  let freshReads = 0;
  const repository = {
    async findPublicSiteSettings() {
      freshReads += 1;
      return [{ key: "maintenance_mode", value: "true" }];
    },
  };
  const fresh = await readPublicSiteSettings(repository);
  assert.equal(fresh.maintenanceMode, true);
  release();
  assert.equal((await oldRead).maintenanceMode, false);
  assert.equal(freshReads, 1);
  assert.equal((await readPublicSiteSettings(repository)).maintenanceMode, true);
  assert.equal(freshReads, 2);
});

test("content write policy covers edits, quality fixes, restore and release operations", () => {
  for (const sql of [
    "UPDATE questions SET content = ? WHERE id = ?",
    '/* restore */ INSERT OR REPLACE INTO "theories" SELECT * FROM staging',
    "DELETE FROM `sw_theories` WHERE id = ?",
    "REPLACE INTO site_settings (key, value) VALUES (?, ?)",
    "-- scope edit\nUPDATE course_content_scopes SET exam_type = ?",
    "INSERT INTO sw_question_tags VALUES (?, ?)",
    "UPDATE content_releases SET status = ?",
    "WITH input AS (SELECT 1) UPDATE questions SET active = 0",
  ]) assert.equal(changesPublicContent(sql), true, sql);
  for (const sql of [
    "SELECT * FROM questions",
    "INSERT INTO admin_audit_logs VALUES (?)",
    "DELETE FROM backup_chunks WHERE snapshot_id = ?",
    "UPDATE user_settings SET selected_exam = 'SQLP'",
  ]) assert.equal(changesPublicContent(sql), false, sql);
});

test("real study handlers keep guest/member/admin state separate on warm reads and recheck writes and blocks", async () => {
  const { database, d1 } = revisionDatabase();
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: d1, ADMIN_EMAIL: "admin@stage5.invalid" };
  (globalThis as typeof globalThis & { __BAEUMZIP_BUILD_SHA__: string }).__BAEUMZIP_BUILD_SHA__ = "stage5-test-build";
  try {
    const a = await learnerUserHash("a@stage5.invalid");
    const b = await learnerUserHash("b@stage5.invalid");
    for (const [key, email] of [[a, "a@stage5.invalid"], [b, "b@stage5.invalid"]]) {
      database.prepare("INSERT INTO user_accounts VALUES (?, ?, 'member', 'active', '')").run(key, email);
    }
    database.prepare("INSERT INTO user_settings VALUES (?, 'SQLP', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)").run(a);
    const request = (email = "", etag = "") => new Request("https://modumunje.com/api/study?scope=theories&exam=SQLD", {
      headers: { ...(email ? { "x-baeumzip-authenticated-user-email": email } : {}), ...(etag ? { "if-none-match": etag } : {}) },
    });
    const guest = await readStudy(request());
    assert.equal(guest.status, 200);
    assert.equal(guest.headers.get("cache-control"), "public, max-age=0, must-revalidate");
    const guestBody = await guest.json();
    assert.equal(guestBody.authenticated, false);
    assert.deepEqual(guestBody.settings, { userKey: "", selectedExam: "SQLD", createdAt: "", updatedAt: "" });
    assert.deepEqual(guestBody.theoryProgress, []);
    assert.equal((await readStudy(request("", guest.headers.get("etag")!))).status, 304);
    for (const [email, expectedProgress, admin] of [["a@stage5.invalid", 0, false], ["b@stage5.invalid", 0, false], ["admin@stage5.invalid", 0, true]] as const) {
      const response = await readStudy(request(email));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.equal(response.headers.get("etag"), null);
      const body = await response.json();
      assert.equal(body.theoryProgress.length, expectedProgress);
      assert.equal(body.adminAccess, admin);
      assert.equal(body.authenticated, true);
      assert.equal(body.settings.selectedExam, "SQLD");
      assert.deepEqual(body.theories, guestBody.theories);
      assert.doesNotMatch(JSON.stringify(body.theories), /correct_answers|correctAnswers|userKey|progress|bookmark/u);
    }
    assert.equal((await (await readStudy(request("b@stage5.invalid"))).json()).theoryProgress.length, 0);
    database.prepare("UPDATE user_accounts SET status = 'blocked' WHERE user_key = ?").run(b);
    assert.equal((await readStudy(request("b@stage5.invalid"))).status, 403);

    const admin = new AdminRepository();
    await admin.execute("UPDATE theories SET title = ? WHERE id = 1", ["edited"]);
    const edited = await readStudy(request("", guest.headers.get("etag")!));
    assert.equal(edited.status, 200);
    assert.equal((await edited.json()).theories[0].title, "edited");
    // Controls read fresh even when a writer outside AdminRepository did not bump the token.
    database.exec("INSERT INTO site_settings VALUES ('maintenance_mode', 'true', 'boolean', 'system', CURRENT_TIMESTAMP)");
    assert.equal((await (await readStudy(request())).json()).site.maintenanceMode, true);
    await admin.execute("UPDATE theories SET active = 0 WHERE id = 1");
    assert.deepEqual((await (await readStudy(request())).json()).theories, []);
  } finally {
    globalThis.__BAEUMZIP_ENV__ = previous;
    database.close();
  }
});

test("two independent worker caches observe database revision changes without cross-worker clear", async () => {
  const { database, d1 } = revisionDatabase();
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: d1 };
  try {
    const workers = [0, 1].map(() => createPublicContentCache({ ttlMs: 60_000, maxItems: 4, maxBytes: 1_024 }));
    const read = async (worker: typeof workers[number]) => worker.read({
      namespace: "theory", key: "1", revision: await readContentCacheRevision(d1),
      loader: async () => database.prepare("SELECT title FROM theories WHERE id = 1").get(),
    });
    for (const worker of workers) assert.equal((await read(worker))?.title, "before");
    await new AdminRepository().execute("UPDATE theories SET title = 'published' WHERE id = 1");
    for (const worker of workers) {
      assert.equal((await read(worker))?.title, "published");
      assert.equal(worker.diagnostics().items, 2); // Old revision remains stored but is unreachable.
    }
  } finally {
    globalThis.__BAEUMZIP_ENV__ = previous;
    database.close();
  }
});

test("edge contract separates internal TTL from browser freshness and never stores private responses", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "caches");
  const entries = new Map<string, Response>();
  Object.defineProperty(globalThis, "caches", { configurable: true, value: { default: {
    async match(request: Request) { return entries.get(request.url)?.clone(); },
    async put(request: Request, response: Response) { entries.set(request.url, response); },
  } } });
  (globalThis as typeof globalThis & { __BAEUMZIP_BUILD_SHA__: string }).__BAEUMZIP_BUILD_SHA__ = "stage5-edge-test";
  try {
    const request = new Request("https://modumunje.com/api/study?scope=theories");
    await storeSharedPublicResponse(request, "study", "revision-1", Response.json({ title: "public" }, {
      headers: { "cache-control": "public, max-age=0, must-revalidate", etag: '"one"' },
    }));
    assert.equal([...entries.values()][0].headers.get("cache-control"), "public, max-age=300");
    const hit = await readSharedPublicResponse(request, "study", "revision-1");
    assert.equal(hit?.headers.get("cache-control"), "public, max-age=0, must-revalidate");
    assert.deepEqual(await hit?.json(), { title: "public" });
    assert.equal(await readSharedPublicResponse(request, "study", "revision-2"), null);
    const conditional = new Request(request, { headers: { "if-none-match": '"one"' } });
    assert.equal((await readSharedPublicResponse(conditional, "study", "revision-1"))?.status, 304);
    for (const headers of [new Headers({ "cache-control": "private, no-store" }), new Headers({ "set-cookie": "session=secret" })]) {
      await storeSharedPublicResponse(request, "study", "private", Response.json({ secret: true }, { headers }));
    }
    assert.equal(entries.size, 1);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "caches", descriptor);
    else Reflect.deleteProperty(globalThis, "caches");
  }
});
