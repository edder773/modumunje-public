import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const workerUrl = pathToFileURL(path.resolve("dist/server/index.js"));
workerUrl.searchParams.set("admin-export-worker-test", String(Date.now()));
const worker = (await import(workerUrl.href)).default;

class FakeStatement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql;
    this.values = [];
    database.queries.push(sql);
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async first() {
    if (/SELECT COUNT\(\*\) AS total FROM questions/u.test(this.sql)) {
      return { total: this.database.questions.length };
    }
    return null;
  }

  async all() {
    if (/SELECT COUNT\(\*\) AS total FROM questions/u.test(this.sql)) return { results: [{ total: this.database.questions.length }] };
    if (/SELECT \* FROM questions/u.test(this.sql)) {
      const limit = Number(this.values.at(-2) ?? this.database.questions.length);
      const offset = Number(this.values.at(-1) ?? 0);
      return { results: this.database.questions.slice(offset, offset + limit) };
    }
    return { results: [] };
  }

  async run() {
    return { success: true };
  }
}

function fakeD1(questions = []) {
  return {
    questions,
    queries: [],
    prepare(sql) {
      return new FakeStatement(this, sql);
    },
    async batch(statements) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
  };
}

async function exportQuestions(database) {
  const sessionSecret = "admin-export-worker-session-secret-value";
  const now = Math.floor(Date.now() / 1000);
  const encoded = Buffer.from(JSON.stringify({
    v: 1,
    sub: "google-admin-id",
    email: "admin@example.test",
    name: "Admin",
    iat: now,
    exp: now + 3600,
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", sessionSecret)
    .update(encoded)
    .digest("base64url");
  return worker.fetch(
    new Request("https://example.test/api/admin?scope=questions&resource=export", {
      headers: {
        cookie: `__Host-baeumzip-google-session=${encoded}.${signature}`,
      },
    }),
    {
      DB: database,
      ADMIN_EMAIL: "admin@example.test",
      GOOGLE_AUTH_SESSION_SECRET: sessionSecret,
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("platform and forged internal identity headers cannot bypass Google sessions", async () => {
  for (const headers of [
    { "oai-authenticated-user-email": "admin@example.test" },
    { "x-baeumzip-authenticated-user-email": "admin@example.test" },
  ]) {
    const response = await worker.fetch(
      new Request("https://example.test/api/admin?scope=questions&resource=export", { headers }),
      {
        DB: fakeD1(),
        ADMIN_EMAIL: "admin@example.test",
        GOOGLE_AUTH_SESSION_SECRET: "admin-export-worker-session-secret-value",
      },
      { waitUntil() {}, passThroughOnException() {} },
    );
    assert.equal(response.status, 401);
  }
});

test("built admin worker requires private restoration when D1 content is empty", async () => {
  const response = await exportQuestions(fakeD1());
  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.match(payload.error, /검증된 비공개 콘텐츠 릴리스 또는 백업/u);
  assert.equal(payload.questions, undefined);
  assert.equal(response.headers.get("x-baeumzip-export-count"), null);
});

test("an absent ids parameter does not silently add id IN (0)", async () => {
  const database = fakeD1([{
    id: 7,
    display_order: 1,
    prompt: "내보내기 회귀 테스트",
    active: 1,
  }]);
  const response = await exportQuestions(database);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-baeumzip-export-count"), "1");
  assert.equal(response.headers.get("x-baeumzip-export-source"), "database");
  const payload = await response.json();
  assert.equal(payload.count, 1);
  assert.equal(payload.questions[0].id, 7);
  assert.ok(database.queries.every((sql) => !/id IN/u.test(sql)));
});
