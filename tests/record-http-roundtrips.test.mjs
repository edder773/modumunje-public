import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import worker from "../dist/server/index.js";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";
import { sqliteD1 } from "./helpers/sqlite-d1.mjs";

function sessionCookie(email, secret) {
  const now = Math.floor(Date.now() / 1000);
  const value = Buffer.from(JSON.stringify({
    v: 1, sub: "p1-3-http", email, name: "Record Test", iat: now, exp: now + 3600,
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(value).digest("base64url");
  return `__Host-baeumzip-google-session=${value}.${signature}`;
}

test("authenticated records HTTP reads use at most two D1 trips including actor context", async () => {
  const database = openCanonicalTestDatabase(process.cwd());
  try {
    const email = "p1-3-http@example.test";
    const secret = "p1-3-http-roundtrip-session-secret";
    const userKey = crypto.createHash("sha256").update(`sql-study-user:${email}`).digest("hex");
    const question = database.prepare(`SELECT id FROM questions
      WHERE active = 1 AND kind = 'single' AND exam_scope IN ('SQLP', 'both')
      ORDER BY id LIMIT 1`).get();
    assert.ok(question);
    database.prepare(`INSERT INTO attempts
      (question_id, selected_answers, correct, mode, user_key, exam_type, result, score)
      VALUES (?, '[0]', 0, 'practice', ?, 'SQLP', 'incorrect', 0)`).run(question.id, userKey);
    database.prepare("INSERT INTO user_bookmarks (user_key, question_id) VALUES (?, ?)").run(userKey, question.id);
    const binding = sqliteD1(database);
    const env = { DB: binding, GOOGLE_AUTH_SESSION_SECRET: secret };
    const context = { waitUntil() {}, passThroughOnException() {} };
    const headers = { cookie: sessionCookie(email, secret) };
    for (const view of ["stats", "incorrect", "bookmarks"]) {
      const before = binding.roundTrips;
      const response = await worker.fetch(new Request(
        `https://modumunje.com/api/study?scope=records&exam=SQLP&view=${view}&limit=1`,
        { headers },
      ), env, context);
      assert.equal(response.status, 200, `${view}: HTTP status`);
      const body = await response.json();
      assert.equal(body.recordsSummary.bookmarkCount, 1, view);
      assert.equal(body.recordsSummary.incorrectQuestionCount, 1, view);
      assert.ok(binding.roundTrips - before <= 2, `${view}: ${binding.roundTrips - before} total D1 trips`);
    }
  } finally {
    database.close();
  }
});
