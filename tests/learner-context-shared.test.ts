import assert from "node:assert/strict";
import test from "node:test";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";
import { sqliteD1 } from "./helpers/sqlite-d1.mjs";
import { authorizeLearnerRequest, learnerUserHash } from "../apps/backend/src/common/auth/admin-auth";
import { GET as swGet } from "../apps/backend/src/modules/sw-study/sw-study.service";
import { readLearnerRequestContext } from "../apps/backend/src/common/auth/learner-request-context";
import { learnerContextPlan } from "../apps/backend/src/common/auth/learner-request-context";
import { withD1Metrics } from "../apps/backend/src/common/observability/d1-metrics";

test("shared learner authorization batches account, site and revision while preserving write and block policies", async () => {
  const db=openCanonicalTestDatabase(process.cwd());
  const previous=globalThis.__BAEUMZIP_ENV__;
  const d1=sqliteD1(db);
  globalThis.__BAEUMZIP_ENV__={DB:d1 as unknown as D1Database,ADMIN_EMAIL:"admin@example.test"};
  const request=(email:string,method="GET") => new Request("https://example.test/api/reports",{
    method,headers:{"x-baeumzip-authenticated-user-email":email},
  });
  try {
    const email="learner-context@example.test";
    let before=d1.roundTrips;
    assert.equal((await authorizeLearnerRequest(request(email))).ok,true);
    assert.equal(d1.roundTrips-before,1);
    const measured=await withD1Metrics(async () => {
      const authorization=await authorizeLearnerRequest(request(email));
      return Response.json({ok:authorization.ok});
    });
    assert.equal(measured.headers.get("X-DB-Ops"),"1");
    assert.match(measured.headers.get("Server-Timing") ?? "",/auth;dur=[\d.]+;desc="local identity and policy"/u);
    const key=await learnerUserHash(email);
    db.prepare("INSERT INTO user_accounts(user_key,email,display_name,status) VALUES(?,?,?,'active')")
      .run(key,email,email);
    db.prepare(`INSERT INTO site_settings(key,value,value_type,updated_by_hash,updated_at)
      VALUES('maintenance_mode','true','boolean','test',CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run();
    before=d1.roundTrips;
    const maintenance=await authorizeLearnerRequest(request(email,"POST"),{respectMaintenance:true});
    assert.equal(maintenance.ok,false);
    if (!maintenance.ok) assert.equal(maintenance.response.status,503);
    assert.equal(d1.roundTrips-before,1);
    const deniedCreate=await authorizeLearnerRequest(request("new-during-maintenance@example.test","POST"),
      {createIfMissing:true,respectMaintenance:true});
    assert.equal(deniedCreate.ok,false);
    if (!deniedCreate.ok) assert.equal(deniedCreate.response.status,503);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM user_accounts WHERE email=?")
      .get("new-during-maintenance@example.test")?.count,0);
    assert.equal((await authorizeLearnerRequest(request(email))).ok,true);
    assert.equal((await authorizeLearnerRequest(request("admin@example.test","POST"),{respectMaintenance:true})).ok,true);
    db.prepare("UPDATE user_accounts SET status='blocked' WHERE user_key=?").run(key);
    const blocked=await authorizeLearnerRequest(request(email,"POST"),{respectMaintenance:true});
    assert.equal(blocked.ok,false);
    if (!blocked.ok) assert.equal(blocked.response.status,403);
    db.prepare("UPDATE site_settings SET value='false' WHERE key='maintenance_mode'").run();
    const fresh=await authorizeLearnerRequest(request("fresh@example.test"),{createIfMissing:true});
    assert.equal(fresh.ok,true);
    if (fresh.ok) assert.equal(db.prepare("SELECT status FROM user_accounts WHERE user_key=?").get(fresh.account.userKey)?.status,"active");
  } finally { db.close(); globalThis.__BAEUMZIP_ENV__=previous; }
});

test("SW public cache keys follow the batched content revision and still check blocked accounts", async () => {
  const db=openCanonicalTestDatabase(process.cwd());
  const previous=globalThis.__BAEUMZIP_ENV__;
  const previousBuild=(globalThis as typeof globalThis & {__BAEUMZIP_BUILD_SHA__?:string}).__BAEUMZIP_BUILD_SHA__;
  const cacheDescriptor=Object.getOwnPropertyDescriptor(globalThis,"caches");
  const entries=new Map<string,Response>();
  const queries:Array<{sql:string;values:unknown[]}>=[];
  const d1=sqliteD1(db,queries);
  globalThis.__BAEUMZIP_ENV__={DB:d1 as unknown as D1Database};
  (globalThis as typeof globalThis & {__BAEUMZIP_BUILD_SHA__:string}).__BAEUMZIP_BUILD_SHA__="p1-learner-context-test";
  Object.defineProperty(globalThis,"caches",{configurable:true,value:{default:{
    async match(request:Request) { return entries.get(request.url)?.clone(); },
    async put(request:Request,response:Response) { entries.set(request.url,response); },
  }}});
  const revision=`p1-${crypto.randomUUID()}`;
  db.prepare(`INSERT INTO site_settings(key,value,value_type,updated_by_hash,updated_at)
    VALUES('content_revision_version',?,'string','test',CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(revision);
  const request=(email="") => new Request("https://example.test/api/sw-study?view=summary",{
    headers: email ? {"x-baeumzip-authenticated-user-email":email} : {},
  });
  try {
    let before=d1.roundTrips;
    const first=await swGet(request());
    assert.equal(first.status,200);
    const initialCount=(await first.json() as {subjectCount:number}).subjectCount;
    assert.ok(initialCount>0);
    assert.equal(d1.roundTrips-before,2);
    assert.ok(queries.some(query => query.sql.includes("maintenance_mode")));
    assert.ok(queries.some(query => query.sql.includes("content_cache_revision")));
    db.prepare(`INSERT INTO sw_theories(id,subject_group_id,subject_id,category,topic,title)
      VALUES(987001,'test','test-subject','test','test-topic','Synthetic')`).run();
    before=d1.roundTrips;
    const stale=await swGet(request());
    assert.equal((await stale.json() as {subjectCount:number}).subjectCount,initialCount);
    assert.equal(d1.roundTrips-before,1);
    db.prepare("UPDATE site_settings SET value=? WHERE key='content_revision_version'").run(`${revision}-changed`);
    before=d1.roundTrips;
    const changed=await swGet(request());
    assert.equal((await changed.json() as {subjectCount:number}).subjectCount,initialCount+1);
    assert.equal(d1.roundTrips-before,2);
    const email="blocked-sw-public@example.test";
    db.prepare("INSERT INTO user_accounts(user_key,email,display_name,status) VALUES(?,?,?,'blocked')")
      .run(await learnerUserHash(email),email,email);
    assert.equal((await swGet(request(email))).status,403);
  } finally {
    db.close(); globalThis.__BAEUMZIP_ENV__=previous;
    (globalThis as typeof globalThis & {__BAEUMZIP_BUILD_SHA__?:string}).__BAEUMZIP_BUILD_SHA__=previousBuild;
    if(cacheDescriptor) Object.defineProperty(globalThis,"caches",cacheDescriptor);
    else Reflect.deleteProperty(globalThis,"caches");
  }
});


test("anonymous revision and live controls share one statement, including empty controls and immediate updates", async () => {
  const db = openCanonicalTestDatabase(process.cwd());
  const d1 = sqliteD1(db) as unknown as D1Database;
  try {
    const publicPlan = learnerContextPlan(d1, null, { includeRevision: true });
    assert.equal(publicPlan.statements.length, 1);
    const original = await readLearnerRequestContext(d1, null, { includeRevision: true });
    assert.equal(original.accountRow, null);
    assert.equal(original.settingRow, null);
    assert.equal(learnerContextPlan(d1, "signed-in-user", { includeRevision: true, includeSetting: true }).statements.length, 4);
    db.prepare("UPDATE site_settings SET value='true' WHERE key='maintenance_mode'").run();
    const changed = await readLearnerRequestContext(d1, null, { includeRevision: true });
    assert.equal(changed.siteRows.find(row => row.key === "maintenance_mode")?.value, "true");
    assert.equal(changed.revision, original.revision);
    db.prepare("DELETE FROM site_settings WHERE key IN ('site_notice','maintenance_mode','default_exam_mode')").run();
    const empty = await readLearnerRequestContext(d1, null, { includeRevision: true });
    assert.deepEqual(empty.siteRows, []);
    assert.equal(empty.revision, original.revision);
  } finally { db.close(); }
});
