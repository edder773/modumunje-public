import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";
import { sqliteD1 } from "./helpers/sqlite-d1.mjs";
import { GET, POST } from "../apps/backend/src/modules/skct-personal/skct-personal.service";
import { readConcurrentStart } from "../apps/backend/src/modules/skct-personal/skct-personal.repository";
import { readLearnerRequestContext } from "../apps/backend/src/common/auth/learner-request-context";
import { StudyRepository } from "../apps/backend/src/modules/study/study.repository";

const origin = "https://example.test";
const email = "skct-learner@example.test";
const unit = "U01";
function request(method: "GET" | "POST", path: string, body?: Record<string, unknown>, actor = email) {
  return new Request(`${origin}/api/skct-personal${path}`, {
    method, headers: { "content-type": "application/json", origin,
      "x-baeumzip-authenticated-user-email": actor, "x-sql-study-user-request": "1" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
async function post(body: Record<string, unknown>, actor = email) {
  const response = await POST(request("POST","",body,actor));
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}
async function get(path: string, actor = email) {
  const response = await GET(request("GET",path,undefined,actor));
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}
function seed(db: ReturnType<typeof openCanonicalTestDatabase>) {
  db.prepare("INSERT INTO skct_personal_releases(id,status,content_sha256,item_count) VALUES('test-release','ACTIVE',?,300)").run("a".repeat(64));
  const pub = db.prepare(`INSERT INTO skct_personal_public_items(release_id,source_item_id,unit_id,source_batch,source_archive_sha256,
    source_file,source_file_sha256,source_ordinal,source_schema_version,public_json,public_sha256,asset_refs_json)
    VALUES('test-release',?,?,'B01',?,'unit.json',?,?, '1.0',? ,?,'[]')`);
  const sec = db.prepare(`INSERT INTO skct_personal_secret_items(release_id,source_item_id,answer_index,raw_answer_json,explanation,
    distractor_explanations_json,source_raw_json,normalization_version,secret_sha256)
    VALUES('test-release',?,1,'"①"',?,'{}','{}','test',?)`);
  for (const id of ["U01","U02","U03","U04","U05"]) {
    for (let n=1;n<=60;n++) {
      const item = `${id}_TEST_${String(n).padStart(3,"0")}`;
      pub.run(item,id,"b".repeat(64),"c".repeat(64),n,JSON.stringify({ sourceItemId:item, question:`공개 ${item}`,
        displayChoices:["하나","둘","셋","넷","다섯"],assetUrls:[] }),"d".repeat(64));
      sec.run(item,`비밀 해설 ${item}`,"e".repeat(64));
    }
  }
}
function attempt(value: Record<string, unknown>) { return value.attempt as Record<string, unknown>; }
function applyContinuousMigration(db: ReturnType<typeof openCanonicalTestDatabase>) {
  const current = db.prepare("SELECT migration_version FROM app_schema_state WHERE id=1").get()?.migration_version;
  if (String(current) >= "0563") return;
  assert.equal(current,"0562");
  const file = process.env.SKCT_CONTINUOUS_MIGRATION
    ?? path.join(process.cwd(),"apps/backend/drizzle/0563_skct_personal_continuous.sql");
  db.exec(readFileSync(file,"utf8"));
  assert.equal(db.prepare("SELECT migration_version FROM app_schema_state WHERE id=1").get()?.migration_version,"0563");
}

test("migration 0563 preserves a preexisting practice attempt and its finalized rows", async () => {
  const db = new DatabaseSync(":memory:");
  const previous = globalThis.__BAEUMZIP_ENV__;
  try {
    db.exec("PRAGMA foreign_keys = ON");
    const directory = path.join(process.cwd(),"apps/backend/drizzle");
    for (const name of readdirSync(directory).filter(name => /^\d{4}_.+[.]sql$/u.test(name)).sort()) {
      if (name.slice(0,4) > "0562") break;
      db.exec(readFileSync(path.join(directory,name),"utf8"));
    }
    seed(db);
    globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(db) as unknown as D1Database };
    const begun = await post({ action:"start",unitId:unit,mode:"practice" });
    const id = String(attempt(begun.body).id);
    const answered = await post({ action:"answer",attemptId:id,position:1,choiceIndex:2,
      operationId:"before-0563",revision:0 });
    assert.equal(answered.status,200);
    const oldRows = db.prepare(`SELECT position,source_item_id,selected_index,finalized_at,elapsed_seconds
      FROM skct_personal_attempt_items WHERE attempt_id=? ORDER BY position`).all(id);
    applyContinuousMigration(db);
    const newRows = db.prepare(`SELECT position,source_item_id,selected_index,finalized_at,elapsed_seconds
      FROM skct_personal_attempt_items WHERE attempt_id=? ORDER BY position`).all(id);
    assert.deepEqual(newRows,oldRows);
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length,0);
  } finally { db.close(); globalThis.__BAEUMZIP_ENV__ = previous; }
});

test("learner home requires login and exposes no bank inventory", async () => {
  const db = openCanonicalTestDatabase(process.cwd());
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(db) as unknown as D1Database };
  try {
    seed(db);
    const guest = await GET(new Request(`${origin}/api/skct-personal?view=home`));
    assert.equal(guest.status,401);
    assert.doesNotMatch(await guest.text(),/U01|300|60|units/u);
    assert.equal((await get("?view=records", "")).status,401);
    assert.equal((await get("?view=attempt&id=unknown", "")).status,401);
    assert.equal((await post({ action:"start",unitId:unit,mode:"practice" }, "")).status,401);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM skct_personal_attempts").get()?.n,0);
    const home = await get("?view=home");
    assert.equal(home.status,200);
    assert.equal(home.body.available,true);
    assert.equal((home.body.units as unknown[]).length,5);
    assert.doesNotMatch(JSON.stringify(home.body),/count|notice|300|60|비공식/u);
  } finally { db.close(); globalThis.__BAEUMZIP_ENV__ = previous; }
});

test("personal SKCT HTTP requests include account authorization in their D1 round-trip budgets", async () => {
  const db = openCanonicalTestDatabase(process.cwd());
  const previous = globalThis.__BAEUMZIP_ENV__;
  const d1 = sqliteD1(db);
  globalThis.__BAEUMZIP_ENV__ = { DB: d1 as unknown as D1Database };
  try {
    seed(db);
    const checked = async (budget: number, operation: () => Promise<{status:number;body:Record<string,unknown>}>) => {
      const before=d1.roundTrips;
      const result=await operation();
      assert.ok(d1.roundTrips-before <= budget, `D1 budget exceeded: ${d1.roundTrips-before} > ${budget}`);
      return result;
    };
    assert.equal((await checked(1,() => get("?view=home"))).status,200);
    assert.equal((await checked(1,() => get("?view=records"))).status,200);
    const begun=await checked(3,() => post({action:"start",unitId:unit,mode:"practice"}));
    assert.equal(begun.status,201);
    const id=String(attempt(begun.body).id);
    const resumed=await checked(3,() => post({action:"start",unitId:unit,mode:"practice"}));
    assert.equal(resumed.body.resumed,true);
    const ownerKey=String(db.prepare("SELECT user_key FROM skct_personal_attempts WHERE id=?").get(id)?.user_key);
    const beforeConcurrent=d1.roundTrips;
    assert.equal((await readConcurrentStart(ownerKey,unit,"practice")).attempt?.id,id);
    assert.equal(d1.roundTrips-beforeConcurrent,1);
    assert.equal((await checked(1,() => get(`?view=attempt&id=${id}`))).status,200);
    const answer={action:"answer",attemptId:id,position:1,choiceIndex:1,operationId:"budget-answer",revision:0};
    assert.equal((await checked(2,() => post(answer))).status,200);
    assert.equal((await checked(2,() => post(answer))).body.replayed,true);
    assert.equal((await checked(2,() => post({...answer,operationId:"budget-stale"}))).status,409);
    for (let position=2;position<=5;position++) {
      assert.equal((await checked(2,() => post({action:"answer",attemptId:id,position,choiceIndex:1,
        operationId:`budget-answer-${position}`,revision:position-1,practiceFlowVersion:2}))).status,200);
    }
    const appended=await checked(2,() => post({action:"append",attemptId:id,revision:5,operationId:"budget-append"}));
    assert.equal(appended.status,200);
    assert.equal((attempt(appended.body).items as unknown[]).length,10);
    assert.equal((await checked(2,() => post({action:"finish",attemptId:id,revision:6,operationId:"budget-finish"}))).status,200);
    const mock=await checked(3,() => post({action:"start",unitId:unit,mode:"mock"}));
    assert.equal(mock.status,201);
    const mockId=String(attempt(mock.body).id);
    assert.equal((await checked(2,() => post({action:"checkpoint",attemptId:mockId,revision:0,
      operationId:"budget-checkpoint",activePosition:2,answers:[{position:1,choiceIndex:1}],times:[{position:1,seconds:3}]}))).status,200);
    const submitted=await checked(2,() => post({action:"submit",attemptId:mockId,revision:1,operationId:"budget-submit"}));
    assert.equal(submitted.status,200);
    assert.equal(attempt(submitted.body).status,"submitted");
    const key=String(db.prepare("SELECT user_key FROM skct_personal_attempts WHERE id=?").get(id)?.user_key);
    db.prepare("INSERT INTO user_accounts(user_key,email,display_name,status) VALUES(?,?,?,'blocked')")
      .run(key,email,email);
    assert.equal((await checked(1,() => get("?view=home"))).status,403);
    assert.equal((await checked(1,() => get(`?view=attempt&id=${id}`))).status,403);
    assert.equal((await checked(1,() => post({action:"pause",attemptId:id,revision:1,operationId:"blocked"}))).status,403);
  } finally { db.close(); globalThis.__BAEUMZIP_ENV__ = previous; }
});

test("personal SKCT reads maintenance and content revision with account state without adding a round trip", async () => {
  const db=openCanonicalTestDatabase(process.cwd());
  const previous=globalThis.__BAEUMZIP_ENV__;
  const d1=sqliteD1(db);
  globalThis.__BAEUMZIP_ENV__={DB:d1 as unknown as D1Database};
  try {
    seed(db);
    const begun=await post({action:"start",unitId:unit,mode:"practice"});
    assert.equal(begun.status,201);
    const id=String(attempt(begun.body).id);
    const key=String(db.prepare("SELECT user_key FROM skct_personal_attempts WHERE id=?").get(id)?.user_key);
    const first=await readLearnerRequestContext(d1 as unknown as D1Database,key,{includeRevision:true});
    db.prepare(`INSERT INTO site_settings(key,value,value_type,updated_by_hash,updated_at)
      VALUES('content_revision_version','test-v2','string','test',CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run();
    db.prepare(`INSERT INTO site_settings(key,value,value_type,updated_by_hash,updated_at)
      VALUES('maintenance_mode','true','string','test',CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run();
    const second=await readLearnerRequestContext(d1 as unknown as D1Database,key,{includeRevision:true});
    assert.notEqual(first.revision,second.revision);
    assert.equal(second.siteRows.find(row => row.key==="maintenance_mode")?.value,"true");
    const beforeStudy=d1.roundTrips;
    const studyContext=await new StudyRepository().readStudyRequestContext(key,{includeRevision:true,includeSetting:true});
    assert.equal(d1.roundTrips-beforeStudy,1);
    assert.equal(studyContext.revision,second.revision);
    assert.equal(studyContext.accountRow,null);
    assert.equal(studyContext.setting?.userKey,key);
    const before=d1.roundTrips;
    const paused=await post({action:"pause",attemptId:id,revision:0,operationId:"maintenance-pause"});
    assert.equal(paused.status,503);
    assert.equal(d1.roundTrips-before,1);
    assert.equal(db.prepare("SELECT revision FROM skct_personal_attempts WHERE id=?").get(id)?.revision,0);
    assert.equal((await get(`?view=attempt&id=${id}`)).status,200);
    assert.equal((await post({action:"start",unitId:"U02",mode:"mock"})).status,503);
  } finally { db.close(); globalThis.__BAEUMZIP_ENV__=previous; }
});

test("personal SKCT keeps secret content gated, saves one practice result, and blocks other users", async () => {
  const db = openCanonicalTestDatabase(process.cwd());
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(db) as unknown as D1Database, ADMIN_EMAIL: "admin@example.test" };
  try {
    seed(db);
    const begun = await post({ action:"start",unitId:unit,mode:"practice" });
    assert.equal(begun.status,201,JSON.stringify(begun.body));
    const first = attempt(begun.body);
    assert.equal((first.items as unknown[]).length,5);
    assert.doesNotMatch(JSON.stringify(begun.body),/비밀 해설|answerIndex|distractorExplanations/u);
    const id = String(first.id);
    assert.equal((await get(`?view=attempt&id=${id}`, "other@example.test")).status,404);
    const answered = await post({ action:"answer",attemptId:id,position:1,choiceIndex:1,operationId:"answer-1",revision:0 });
    assert.equal(answered.status,200,JSON.stringify(answered.body));
    const items = attempt(answered.body).items as Array<Record<string, unknown>>;
    assert.match(JSON.stringify(items[0]),/비밀 해설/u);
    assert.doesNotMatch(JSON.stringify(items[1]),/비밀 해설|answerIndex/u);
    const replay = await post({ action:"answer",attemptId:id,position:1,choiceIndex:1,operationId:"answer-1",revision:0 });
    assert.equal(replay.status,200);
    assert.equal((await post({ action:"answer",attemptId:id,position:1,choiceIndex:2,operationId:"answer-1",revision:0 })).status,409);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM skct_personal_attempt_items WHERE attempt_id=? AND finalized_at IS NOT NULL").get(id)?.n,1);
    assert.equal((await post({ action:"answer",attemptId:id,position:2,choiceIndex:2,operationId:"stale",revision:0 })).status,409);
    const adminItems = await get("?view=admin-items", "admin@example.test");
    assert.equal(adminItems.status,200);
    assert.equal((adminItems.body.items as unknown[]).length,5);
    const adminSummary = await get("?view=admin", "admin@example.test");
    assert.equal(adminSummary.status,200);
    assert.equal((adminSummary.body.aggregates as unknown[]).length,1);
    db.prepare("UPDATE skct_personal_releases SET status='RETIRED' WHERE id='test-release'").run();
    db.prepare("INSERT INTO skct_personal_releases(id,status,content_sha256,item_count) VALUES('new-release','ACTIVE',?,300)").run("f".repeat(64));
    const historical = await get(`?view=attempt&id=${id}`);
    assert.equal(attempt(historical.body).releaseId,"test-release");
    assert.match(JSON.stringify(historical.body),/비밀 해설/u);
  } finally { db.close(); globalThis.__BAEUMZIP_ENV__ = previous; }
});

test("mock answers stay hidden until explicit submit and stale tab cannot overwrite", async () => {
  const db = openCanonicalTestDatabase(process.cwd());
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(db) as unknown as D1Database };
  try {
    seed(db);
    const begun = await post({ action:"start",unitId:unit,mode:"mock" });
    const first = attempt(begun.body);
    assert.equal((first.items as unknown[]).length,10);
    const id = String(first.id);
    const saved = await post({ action:"save",attemptId:id,position:1,choiceIndex:1,operationId:"mock-save-1",revision:0 });
    assert.equal(saved.status,200,JSON.stringify(saved.body));
    assert.doesNotMatch(JSON.stringify(saved.body),/비밀 해설|answerIndex/u);
    assert.equal((await post({ action:"save",attemptId:id,position:1,choiceIndex:2,operationId:"stale-tab",revision:0 })).status,409);
    const submitted = await post({ action:"submit",attemptId:id,operationId:"mock-submit",revision:1 });
    assert.equal(submitted.status,200,JSON.stringify(submitted.body));
    assert.match(JSON.stringify(submitted.body),/비밀 해설/u);
    assert.equal(attempt(submitted.body).status,"submitted");
    assert.equal((await post({ action:"submit",attemptId:id,operationId:"mock-submit",revision:1 })).status,200);
    const record = await get("?view=records");
    assert.equal((record.body.records as unknown[]).length,1);
    const summary = (record.body.records as Array<Record<string, number>>)[0];
    assert.equal(summary.answered_count,1);
    assert.equal(summary.finalized_count,10);
    assert.equal(summary.question_count,10);
  } finally { db.close(); globalThis.__BAEUMZIP_ENV__ = previous; }
});

test("visible heartbeat intervals accumulate beyond 30 seconds while one abandoned interval is bounded", async () => {
  const db = openCanonicalTestDatabase(process.cwd());
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(db) as unknown as D1Database };
  try {
    seed(db);
    const begun = await post({ action:"start",unitId:unit,mode:"practice" });
    const id = String(attempt(begun.body).id);
    db.prepare("UPDATE skct_personal_attempts SET active_since=datetime('now','-45 seconds') WHERE id=?").run(id);
    assert.equal((await post({ action:"focus",attemptId:id,position:1,operationId:"tick-1",revision:0 })).status,200);
    db.prepare("UPDATE skct_personal_attempts SET active_since=datetime('now','-25 seconds') WHERE id=?").run(id);
    assert.equal((await post({ action:"focus",attemptId:id,position:1,operationId:"tick-2",revision:1 })).status,200);
    db.prepare("UPDATE skct_personal_attempts SET active_since=datetime('now','-120 seconds') WHERE id=?").run(id);
    assert.equal((await post({ action:"pause",attemptId:id,operationId:"hidden",revision:2 })).status,200);
    const seconds = Number(db.prepare("SELECT elapsed_seconds FROM skct_personal_attempt_items WHERE attempt_id=? AND position=1").get(id)?.elapsed_seconds);
    assert.ok(seconds >= 83 && seconds <= 86, `unexpected cumulative elapsed ${seconds}`);
    assert.equal(db.prepare("SELECT active_since FROM skct_personal_attempts WHERE id=?").get(id)?.active_since,null);
    assert.equal((await post({ action:"focus",attemptId:id,position:1,operationId:"visible",revision:3 })).status,200);
  } finally { db.close(); globalThis.__BAEUMZIP_ENV__ = previous; }
});

test("record cursor reaches older attempts and admin period filters SQLite timestamps", async () => {
  const db = openCanonicalTestDatabase(process.cwd());
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(db) as unknown as D1Database, ADMIN_EMAIL: "admin@example.test" };
  try {
    seed(db);
    const begun = await post({ action:"start",unitId:unit,mode:"practice" });
    assert.equal(begun.status,201);
    const key = String(db.prepare("SELECT user_key FROM skct_personal_attempts LIMIT 1").get()?.user_key);
    const insertAttempt = db.prepare(`INSERT INTO skct_personal_attempts
      (id,user_key,release_id,unit_id,mode,status,started_at,submitted_at)
      VALUES (? ,?,'test-release','U01','mock','submitted',datetime('now',?),CURRENT_TIMESTAMP)`);
    const insertItem = db.prepare(`INSERT INTO skct_personal_attempt_items
      (attempt_id,release_id,position,source_item_id,selected_index,finalized_at)
      VALUES (?,'test-release',1,'U01_TEST_001',NULL,CURRENT_TIMESTAMP)`);
    for (let index=1;index<=101;index++) {
      const id = `history-${String(index).padStart(3,"0")}`;
      insertAttempt.run(id,key,`-${index} seconds`);
      insertItem.run(id);
    }
    insertAttempt.run("history-old",key,"-40 days");
    insertItem.run("history-old");
    const first = await get("?view=records");
    assert.equal((first.body.records as unknown[]).length,100);
    assert.equal(typeof first.body.nextCursor,"string");
    const second = await get(`?view=records&cursor=${encodeURIComponent(String(first.body.nextCursor))}`);
    assert.equal((second.body.records as unknown[]).length,3);
    assert.equal(second.body.nextCursor,null);
    assert.equal((await get("?view=records&cursor=invalid")).status,400);
    const recent = await get("?view=admin&days=30","admin@example.test");
    const all = await get("?view=admin&days=all","admin@example.test");
    const total = (body: Record<string, unknown>) => (body.aggregates as Array<{attempts: number}>)
      .reduce((sum,row) => sum + Number(row.attempts),0);
    assert.equal(total(recent.body),102);
    assert.equal(total(all.body),103);
  } finally { db.close(); globalThis.__BAEUMZIP_ENV__ = previous; }
});

test("twelve practice windows reach all 60 questions before repeating", async () => {
  const db = openCanonicalTestDatabase(process.cwd());
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(db) as unknown as D1Database };
  try {
    seed(db);
    const seen = new Set<string>();
    for (let window=0;window<12;window++) {
      const begun = await post({ action:"start",unitId:unit,mode:"practice" });
      assert.equal(begun.status,201,JSON.stringify(begun.body));
      const current = attempt(begun.body);
      for (const item of current.items as Array<Record<string,unknown>>) seen.add(String(item.sourceItemId));
      db.prepare("UPDATE skct_personal_attempts SET status='submitted',submitted_at=CURRENT_TIMESTAMP WHERE id=?").run(String(current.id));
    }
    assert.equal(seen.size,60);
  } finally { db.close(); globalThis.__BAEUMZIP_ENV__ = previous; }
});

test("rejected focus never adds elapsed time to the previously active item", async () => {
  const db = openCanonicalTestDatabase(process.cwd());
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(db) as unknown as D1Database };
  try {
    seed(db);
    const begun = await post({ action:"start",unitId:unit,mode:"practice" });
    const id = String(attempt(begun.body).id);
    db.prepare("UPDATE skct_personal_attempts SET active_since=datetime('now','-30 seconds') WHERE id=?").run(id);
    assert.equal((await post({ action:"focus",attemptId:id,position:6,operationId:"missing-target",revision:0 })).status,409);
    assert.equal(db.prepare("SELECT elapsed_seconds FROM skct_personal_attempt_items WHERE attempt_id=? AND position=1").get(id)?.elapsed_seconds,0);
    assert.equal((await post({ action:"answer",attemptId:id,position:1,choiceIndex:1,operationId:"first-answer",revision:0 })).status,200);
    assert.equal((await post({ action:"focus",attemptId:id,position:2,operationId:"next-focus",revision:1 })).status,200);
    db.prepare("UPDATE skct_personal_attempts SET active_since=datetime('now','-30 seconds') WHERE id=?").run(id);
    assert.equal((await post({ action:"focus",attemptId:id,position:1,operationId:"finalized-target",revision:2 })).status,409);
    assert.equal(db.prepare("SELECT elapsed_seconds FROM skct_personal_attempt_items WHERE attempt_id=? AND position=2").get(id)?.elapsed_seconds,0);
  } finally { db.close(); globalThis.__BAEUMZIP_ENV__ = previous; }
});

test("continuous practice preserves the old batch, appends in one attempt, and ends only on finish", async () => {
  const db = openCanonicalTestDatabase(process.cwd());
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(db) as unknown as D1Database };
  try {
    seed(db);
    const begun = await post({ action:"start",unitId:unit,mode:"practice" });
    const id = String(attempt(begun.body).id);
    applyContinuousMigration(db);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM skct_personal_attempt_items WHERE attempt_id=?").get(id)?.n,5);
    for (let position=1;position<=5;position++) {
      const result = await post({ action:"answer",attemptId:id,position,choiceIndex:1,
        operationId:`answer-${position}`,revision:position-1,practiceFlowVersion:2 });
      assert.equal(result.status,200,JSON.stringify(result.body));
      assert.equal(attempt(result.body).status,"in_progress");
    }
    const appended = await post({ action:"append",attemptId:id,operationId:"append-1",revision:5 });
    assert.equal(appended.status,200,JSON.stringify(appended.body));
    assert.equal((attempt(appended.body).items as unknown[]).length,10);
    assert.equal(attempt(appended.body).status,"in_progress");
    assert.equal((await post({ action:"append",attemptId:id,operationId:"append-1",revision:5 })).body.replayed,true);
    assert.equal((await post({ action:"append",attemptId:id,operationId:"append-stale",revision:5 })).status,409);
    const sixth = await post({ action:"answer",attemptId:id,position:6,choiceIndex:1,
      operationId:"answer-6",revision:6,practiceFlowVersion:2 });
    assert.equal(sixth.status,200);
    const finished = await post({ action:"finish",attemptId:id,operationId:"finish-1",revision:7 });
    assert.equal(finished.status,200,JSON.stringify(finished.body));
    assert.equal(attempt(finished.body).status,"submitted");
    assert.equal((await post({ action:"finish",attemptId:id,operationId:"finish-1",revision:7 })).body.replayed,true);
    const items = attempt(finished.body).items as Array<Record<string,unknown>>;
    assert.ok(items.slice(0,6).every(item => item.feedback));
    assert.ok(items.slice(6).every(item => !item.feedback));
    const records = await get("?view=records");
    assert.equal((records.body.records as Array<Record<string,unknown>>)[0].question_count,10);
  } finally { db.close(); globalThis.__BAEUMZIP_ENV__ = previous; }
});

test("pre-upgrade practice clients still complete after their fifth answer", async () => {
  const db = openCanonicalTestDatabase(process.cwd());
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(db) as unknown as D1Database };
  try {
    seed(db);
    applyContinuousMigration(db);
    const begun = await post({ action:"start",unitId:unit,mode:"practice" });
    const id = String(attempt(begun.body).id);
    for (let position=1;position<=5;position++) {
      const result = await post({ action:"answer",attemptId:id,position,choiceIndex:1,
        operationId:`legacy-answer-${position}`,revision:position-1 });
      assert.equal(result.status,200,JSON.stringify(result.body));
      assert.equal(attempt(result.body).status,position === 5 ? "submitted" : "in_progress");
    }
    const replay = await post({ action:"answer",attemptId:id,position:5,choiceIndex:1,
      operationId:"legacy-answer-5",revision:4 });
    assert.equal(replay.body.replayed,true);
  } finally { db.close(); globalThis.__BAEUMZIP_ENV__ = previous; }
});

test("one practice attempt can continue past all 60 source items without exposing release inventory", async () => {
  const db = openCanonicalTestDatabase(process.cwd());
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(db) as unknown as D1Database };
  try {
    seed(db);
    applyContinuousMigration(db);
    const begun = await post({ action:"start",unitId:unit,mode:"practice" });
    const id = String(attempt(begun.body).id);
    const seen = new Set<string>();
    let revision = 0;
    for (let batch=0;batch<13;batch++) {
      const state = await get(`?view=attempt&id=${id}`);
      const items = attempt(state.body).items as Array<Record<string,unknown>>;
      for (const item of items.slice(batch*5,batch*5+5)) {
        if (batch < 12) seen.add(String(item.sourceItemId));
        const response = await post({ action:"answer",attemptId:id,position:item.position,
          choiceIndex:1,operationId:`continuous-answer-${item.position}`,revision,practiceFlowVersion:2 });
        assert.equal(response.status,200,JSON.stringify(response.body));
        revision += 1;
      }
      if (batch < 12) {
        const appended = await post({ action:"append",attemptId:id,operationId:`continuous-append-${batch}`,
          revision });
        assert.equal(appended.status,200,JSON.stringify(appended.body));
        revision += 1;
      }
    }
    assert.equal(seen.size,60);
    const state = await get(`?view=attempt&id=${id}`);
    assert.equal(attempt(state.body).status,"in_progress");
    assert.equal((attempt(state.body).items as unknown[]).length,65);
    assert.doesNotMatch(JSON.stringify(state.body),/itemCount|availableCount|inventory/u);
  } finally { db.close(); globalThis.__BAEUMZIP_ENV__ = previous; }
});

test("mock checkpoint batches local answers and time behind one revision guard", async () => {
  const db = openCanonicalTestDatabase(process.cwd());
  const previous = globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__ = { DB: sqliteD1(db) as unknown as D1Database };
  try {
    seed(db);
    applyContinuousMigration(db);
    const begun = await post({ action:"start",unitId:unit,mode:"mock" });
    const id = String(attempt(begun.body).id);
    const checkpoint = { action:"checkpoint",attemptId:id,operationId:"checkpoint-1",revision:0,
      activePosition:2,answers:[{position:1,choiceIndex:1},{position:2,choiceIndex:2}],
      times:[{position:1,seconds:9},{position:2,seconds:3}] };
    const saved = await post(checkpoint);
    assert.equal(saved.status,200,JSON.stringify(saved.body));
    assert.equal(attempt(saved.body).revision,1);
    assert.doesNotMatch(JSON.stringify(saved.body),/비밀 해설|answerIndex/u);
    assert.equal((await post(checkpoint)).body.replayed,true);
    assert.equal((await post({ ...checkpoint,answers:[{position:1,choiceIndex:3}] })).status,409);
    assert.equal((await post({ ...checkpoint,operationId:"checkpoint-stale" })).status,409);
    assert.equal((await post({ action:"checkpoint",attemptId:id,operationId:"invalid-clock",revision:1,
      activePosition:2,answers:[],times:[{position:1,seconds:31}] })).status,400);
    assert.equal(db.prepare("SELECT elapsed_seconds FROM skct_personal_attempt_items WHERE attempt_id=? AND position=1").get(id)?.elapsed_seconds,9);
    const paused = await post({ action:"checkpoint",attemptId:id,operationId:"checkpoint-pause",revision:1,
      activePosition:null,answers:[],times:[] });
    assert.equal(paused.status,200);
    assert.equal(attempt(paused.body).activeSince,null);
    const submitted = await post({ action:"submit",attemptId:id,operationId:"checkpoint-submit",revision:2 });
    assert.equal(submitted.status,200);
    assert.match(JSON.stringify(submitted.body),/비밀 해설/u);
  } finally { db.close(); globalThis.__BAEUMZIP_ENV__ = previous; }
});
