import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";
import { sqliteD1 } from "./helpers/sqlite-d1.mjs";
import { GET as releaseGet, POST as releasePost } from "../apps/backend/src/modules/skct-personal/skct-personal-release-admin";

type Package = { releaseId: string; contentSha256: string; rows: Record<string, unknown>[] };
const packagePath = process.env.SKCT_PERSONAL_ADMIN_PACKAGE;
const origin = "https://example.test";
const identity = (data: Package) => ({ releaseId:data.releaseId, contentSha256:data.contentSha256 });
function request(method: "GET" | "POST", body?: Record<string, unknown>, admin = true) {
  return new Request(`${origin}/api/skct-personal/admin-release`, { method,
    headers:{ origin,"content-type":"application/json","x-sql-study-admin-request":"1",
      "x-baeumzip-authenticated-user-email":admin ? "admin@example.test" : "learner@example.test" },
    ...(body ? { body:JSON.stringify(body) } : {}) });
}
async function post(body: Record<string, unknown>, admin = true) {
  const response = await releasePost(request("POST",body,admin));
  return { status:response.status, body:await response.json() as Record<string, unknown> };
}
async function get(admin = true) {
  const response = await releaseGet(request("GET",undefined,admin));
  return { status:response.status, body:await response.json() as Record<string, unknown> };
}

test("admin-only release preparation leaves incomplete content staged", async () => {
  const db = openCanonicalTestDatabase(process.cwd());
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB:sqliteD1(db) as unknown as D1Database,ADMIN_EMAIL:"admin@example.test" };
  const approved = { releaseId:"skct-personal-300-20260927-r1",
    contentSha256:"849c5d1d1ebbffbf60c6b5aad016b4ad76ba56305872573ffcb9b56fd19512a9" };
  try {
    assert.equal((await post({ action:"prepare",...approved },false)).status,403);
    assert.equal((await post({ action:"prepare",...approved })).status,200);
    assert.equal((await post({ action:"prepare",...approved })).status,200);
    assert.equal((await post({ action:"batch",...approved,rows:[{ sourceItemId:"U01_FAKE_001" }] })).status,400);
    assert.equal((await post({ action:"activate",...approved })).status,409);
    assert.equal((await get()).body.status,"STAGED");
    assert.equal((await get()).body.verified,false);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM skct_personal_public_items").get()?.n,0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM skct_personal_secret_items").get()?.n,0);
  } finally { db.close();globalThis.__BAEUMZIP_ENV__ = previous; }
});

if (packagePath) test("private exact 300 package stages idempotently and activates only after full readback", async () => {
  const data = JSON.parse(readFileSync(packagePath!,"utf8")) as Package;
  const db = openCanonicalTestDatabase(process.cwd());
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB:sqliteD1(db) as unknown as D1Database,ADMIN_EMAIL:"admin@example.test" };
  try {
    assert.equal((await post({ action:"prepare",...identity(data) },false)).status,403);
    assert.equal((await post({ action:"prepare",...identity(data) })).status,200);
    const first = { action:"batch",...identity(data),rows:data.rows.slice(0,5) };
    assert.equal((await post(first)).status,200);
    assert.equal((await post(first)).status,200);
    assert.equal((await post({ action:"activate",...identity(data) })).status,409);
    const bad = { ...data.rows[5],publicSha256:"0".repeat(64) };
    assert.equal((await post({ action:"batch",...identity(data),rows:[bad] })).status,400);
    for (let offset=5; offset<data.rows.length; offset+=5) {
      const response = await post({ action:"batch",...identity(data),rows:data.rows.slice(offset,offset+5) });
      assert.equal(response.status,200,`batch ${offset}: ${JSON.stringify(response.body)}`);
    }
    const staged = await get();
    assert.equal(staged.status,200);
    assert.equal(staged.body.verified,true);
    assert.equal(staged.body.status,"STAGED");
    assert.deepEqual(Object.values(staged.body.counts as Record<string,number>),[60,60,60,60,60]);
    assert.doesNotMatch(JSON.stringify(staged.body),/rawSource|explanation|rawAnswer|answerIndex/u);
    assert.equal((await post({ action:"activate",...identity(data) })).status,200);
    assert.equal((await post({ action:"activate",...identity(data) })).status,200);
    const active = await get();
    assert.equal(active.body.status,"ACTIVE");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM skct_personal_public_items").get()?.n,300);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM skct_personal_secret_items").get()?.n,300);
    assert.equal((await get(false)).status,403);
    assert.equal((await post({ action:"retire",...identity(data),confirmation:"wrong" })).status,400);
    assert.equal((await post({ action:"retire",...identity(data),confirmation:data.releaseId })).status,200);
    assert.equal((await get()).body.status,"RETIRED");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM skct_personal_public_items").get()?.n,300);
  } finally { db.close();globalThis.__BAEUMZIP_ENV__ = previous; }
});
