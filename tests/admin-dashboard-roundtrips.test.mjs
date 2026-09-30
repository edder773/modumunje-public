import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import worker from "../dist/server/index.js";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";
import { sqliteD1 } from "./helpers/sqlite-d1.mjs";

function adminCookie(secret) {
  const now = Math.floor(Date.now() / 1000);
  const value = Buffer.from(JSON.stringify({
    v: 1, sub: "p5-dashboard", email: "admin@example.test", name: "Admin", iat: now, exp: now + 3600,
  })).toString("base64url");
  return `__Host-baeumzip-google-session=${value}.${crypto.createHmac("sha256", secret).update(value).digest("base64url")}`;
}

test("authenticated dashboard preserves metrics with batched D1 reads", async (t) => {
  const database = openCanonicalTestDatabase(process.cwd());
  const binding = sqliteD1(database);
  const secret = "p5-dashboard-roundtrips-test-secret";
  const env = { DB: binding, GOOGLE_AUTH_SESSION_SECRET: secret, ADMIN_EMAIL: "admin@example.test" };
  const context = { waitUntil() {}, passThroughOnException() {} };
  try {
    const before = binding.roundTrips;
    const response = await worker.fetch(new Request("https://modumunje.com/api/admin?resource=dashboard&range=custom&start=2026-09-01&end=2026-09-29", {
      headers: { cookie: adminCookie(secret) },
    }), env, context);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(body.metrics);
    assert.ok(Array.isArray(body.contentBreakdown));
    assert.ok(Array.isArray(body.activityTrend));
    assert.ok(body.recent.questions.length > 0);
    assert.ok(body.recent.questions.every((question) => !question.prompt.includes("<!--")),
      "recent-content previews must not expose internal HTML comments");
    const roundTrips = binding.roundTrips - before;
    t.diagnostic(JSON.stringify({
      roundTrips,
      payloadSha256: crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex"),
      contentFields: body.contentBreakdown.length,
      trendDays: body.activityTrend.length,
    }));
    assert.ok(roundTrips <= 3, `dashboard D1 round trips: ${roundTrips}`);
  } finally { database.close(); }
});
