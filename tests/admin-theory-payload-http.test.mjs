import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import worker from "../dist/server/index.js";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";
import { sqliteD1 } from "./helpers/sqlite-d1.mjs";

function adminCookie(secret) {
  const now = Math.floor(Date.now() / 1000);
  const value = Buffer.from(JSON.stringify({
    v: 1, sub: "p5-admin", email: "admin@example.test", name: "Admin", iat: now, exp: now + 3600,
  })).toString("base64url");
  return `__Host-baeumzip-google-session=${value}.${crypto.createHmac("sha256", secret).update(value).digest("base64url")}`;
}

test("admin HTTP theory summaries are bounded while detail keeps the full editor body", async (t) => {
  const database = openCanonicalTestDatabase(process.cwd());
  const secret = "p5-admin-theory-payload-test-secret";
  const env = { DB: sqliteD1(database), GOOGLE_AUTH_SESSION_SECRET: secret, ADMIN_EMAIL: "admin@example.test" };
  const context = { waitUntil() {}, passThroughOnException() {} };
  const headers = { cookie: adminCookie(secret) };
  const read = (query) => worker.fetch(new Request(`https://modumunje.com/api/admin?${query}`, { headers }), env, context);
  const summaryBytes = {};
  try {
    for (const domain of ["sql", "da", "bae", "ipe", "ise", "sw"]) {
      const resource = domain === "sw" ? "sw-theories" : "theories";
      const response = await read(`resource=${resource}&contentDomain=${domain}&active=active&pageSize=50&view=summary`);
      assert.equal(response.status, 200, domain);
      const bodyText = await response.text();
      summaryBytes[domain] = Buffer.byteLength(bodyText);
      assert.ok(Buffer.byteLength(bodyText) <= 20 * 1024, `${domain}: ${Buffer.byteLength(bodyText)} bytes`);
      const body = JSON.parse(bodyText);
      assert.equal(body.pagination.pageSize, 20, domain);
      assert.ok(body.items.length > 0, domain);
      assert.ok(body.items.every((item) => !Object.keys(item).some((key) => key.includes("_") || key === "content")), domain);
      const id = body.items[0].id;
      const detail = await read(`resource=${resource}&contentDomain=${domain}&id=${id}`);
      assert.equal(detail.status, 200, `${domain}: detail`);
      const full = await detail.json();
      assert.equal(full.items.length, 1, domain);
      assert.equal(full.items[0].id, id, domain);
      assert.ok(typeof full.items[0].content === "string" && full.items[0].content.length > 0, domain);
    }
    t.diagnostic(JSON.stringify({ summaryBytes }));
  } finally { database.close(); }
});
