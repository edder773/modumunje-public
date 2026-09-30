/* eslint-disable @typescript-eslint/no-explicit-any -- synthetic JSON payloads are checked by concrete field and behavior assertions. */
import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import { openSkctTestDatabase as openCanonicalTestDatabase } from "./helpers/skct-test-database.mjs";
import { sqliteD1 } from "./helpers/sqlite-d1.mjs";
import { GET,POST } from "../apps/backend/src/modules/skct-personal/skct-personal.service";
const email="workspace@example.test";
async function call(body: Record<string,unknown> | string, actor=email) {
  const request=new Request(`https://example.test/api/skct-personal${typeof body === "string" ? body : ""}`,{
    method:typeof body === "string" ? "GET" : "POST",headers:{origin:"https://example.test","content-type":"application/json",
      "x-baeumzip-authenticated-user-email":actor,"x-sql-study-user-request":"1"},
    ...(typeof body === "string" ? {} : {body:JSON.stringify(body)})});
  const response=await (typeof body === "string" ? GET(request) : POST(request));
  return {status:response.status,body:await response.json() as any};
}
async function withDb(run:(db:ReturnType<typeof openCanonicalTestDatabase>)=>Promise<void>) {
  const db=openCanonicalTestDatabase(process.cwd());const previous=globalThis.__BAEUMZIP_ENV__;
  globalThis.__BAEUMZIP_ENV__={DB:sqliteD1(db) as unknown as D1Database};
  try {seed(db);await run(db);} finally {db.close();globalThis.__BAEUMZIP_ENV__=previous;}
}
const fresh=(mode="practice",unitId="U01",operationId=crypto.randomUUID())=>({action:"start",mode,unitId,fresh:true,practiceFlowVersion:3,operationId});
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
      pub.run(item,id,"b".repeat(64),"c".repeat(64),n,JSON.stringify({ sourceItemId:item, unitId:id, question:`공개 ${item}`,
        displayChoices:["하나","둘","셋","넷","다섯"],assetUrls:[] }),"d".repeat(64));
      sec.run(item,`비밀 해설 ${item}`,"e".repeat(64));
    }
  }
}

test("fresh practice starts one question, preserves the previous attempt, and replays its start once",()=>withDb(async db=>{
  const old=(await call(fresh())).body.attempt;
  const answered=await call({action:"answer",attemptId:old.id,revision:0,operationId:crypto.randomUUID(),position:1,choiceIndex:1,practiceFlowVersion:3});
  assert.equal(answered.status,200);assert.equal(answered.body.attempt.status,"in_progress");
  const request=fresh();const current=(await call(request)).body.attempt;
  assert.notEqual(current.id,old.id);assert.equal(current.items.length,1);assert.equal(current.activePosition,1);
  assert.equal(current.items[0].selectedIndex,null);assert.notEqual(current.items[0].sourceItemId,old.items[0].sourceItemId);
  assert.equal((await call(request)).body.attempt.id,current.id);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM skct_personal_attempts").get()?.n,2);
  assert.equal((await call(`?view=attempt&id=${old.id}`)).body.attempt.items[0].feedback.correct,true);
  const next=await call({action:"append",attemptId:old.id,revision:1,operationId:crypto.randomUUID(),practiceFlowVersion:3});
  assert.equal(next.status,200);assert.equal(next.body.attempt.items.length,2);assert.equal(next.body.attempt.activePosition,2);
  assert.equal((await call(`?view=attempt&id=${old.id}`,"outsider@example.test")).status,404);
}));
test("full mock chooses 20 per area, hides answers, locks passed questions and replays forward movement",()=>withDb(async db=>{
  let a=(await call(fresh("mock","ALL"))).body.attempt;
  assert.equal(a.items.length,100);assert.ok(a.fullMock);assert.equal(a.fullMock.phase,"answering");
  assert.deepEqual(["U01","U02","U03","U04","U05"].map(unit=>a.items.filter((q:any)=>q.question.unitId===unit).length),[20,20,20,20,20]);
  assert.doesNotMatch(JSON.stringify(a),/비밀 해설|answerIndex|explanation/);
  const step={action:"advance",attemptId:a.id,revision:a.revision,position:1,choiceIndex:1,operationId:crypto.randomUUID()};
  const response=await call(step);assert.equal(response.status,200);a=response.body.attempt;
  assert.equal(a.activePosition,2);assert.equal(a.items[0].selectedIndex,1);assert.equal(a.items[0].finalized,true);
  assert.equal(a.items[0].feedback,undefined);assert.equal((await call(step)).body.attempt.revision,a.revision);
  assert.equal((await call({action:"focus",attemptId:a.id,revision:a.revision,position:1,operationId:crypto.randomUUID()})).status,409);
  assert.equal((await call({action:"checkpoint",attemptId:a.id,revision:a.revision,operationId:crypto.randomUUID(),activePosition:1,answers:[{position:1,choiceIndex:2}],times:[]})).status,409);
  const interim=await call("?view=records");assert.equal(interim.body.statistics.length,0);assert.equal(interim.body.records[0].correct_count,0);
  for(let position=2;position<=20;position++) {
    const result=await call({action:"advance",attemptId:a.id,revision:a.revision,position,choiceIndex:position%2 ? 1 : 2,operationId:crypto.randomUUID()});
    assert.equal(result.status,200);a=result.body.attempt;
  }
  assert.equal(a.fullMock.phase,"break");assert.equal(a.fullMock.sectionIndex,1);assert.equal(a.activePosition,21);
  const state={...a.fullMock,breakUntil:new Date(Date.now()-1000).toISOString()};
  db.prepare("UPDATE skct_personal_attempts SET full_mock_json=? WHERE id=?").run(JSON.stringify(state),a.id);
  const resume=await call({action:"sync-exam",attemptId:a.id,revision:a.revision,operationId:crypto.randomUUID()});
  assert.equal(resume.status,200);a=resume.body.attempt;assert.equal(a.fullMock.phase,"answering");assert.equal(a.activePosition,21);
  assert.ok(Date.parse(a.fullMock.sectionDeadlineAt)-Date.now()>890000);
  const done=await call({action:"submit",attemptId:a.id,revision:a.revision,operationId:crypto.randomUUID()});
  assert.equal(done.status,200);assert.equal(done.body.attempt.status,"submitted");assert.equal(done.body.attempt.correctCount,10);
  const records=await call("?view=records");
  assert.equal(records.body.statistics.length,5);
  assert.equal(records.body.statistics[0].graded_count,20);assert.equal(records.body.statistics[0].correct_count,10);
  assert.equal(records.body.statistics[1].answered_count,0);assert.equal(records.body.statistics[1].graded_count,20);
}));
test("expired sections reject late choices and reconnection consumes the entire server deadline",()=>withDb(async db=>{
  let a=(await call(fresh("mock","ALL"))).body.attempt;
  const expired={...a.fullMock,sectionDeadlineAt:new Date(Date.now()-1500).toISOString()};
  db.prepare("UPDATE skct_personal_attempts SET full_mock_json=? WHERE id=?").run(JSON.stringify(expired),a.id);
  const late=await call({action:"advance",attemptId:a.id,revision:a.revision,position:1,choiceIndex:1,operationId:crypto.randomUUID()});
  assert.equal(late.status,200);a=late.body.attempt;assert.equal(a.fullMock.phase,"break");assert.equal(a.activePosition,21);
  assert.equal(a.items[0].selectedIndex,null);assert.equal(a.items[0].feedback,undefined);
  const longOffline={...a.fullMock,phase:"answering",sectionIndex:1,sectionDeadlineAt:new Date(Date.now()-2*3600000).toISOString(),breakUntil:null};
  db.prepare("UPDATE skct_personal_attempts SET full_mock_json=? WHERE id=?").run(JSON.stringify(longOffline),a.id);
  const end=await call({action:"sync-exam",attemptId:a.id,revision:a.revision,operationId:crypto.randomUUID()});
  assert.equal(end.status,200);assert.equal(end.body.attempt.status,"submitted");assert.equal(end.body.attempt.fullMock.phase,"completed");
  assert.equal(end.body.attempt.correctCount,0);assert.equal(end.body.attempt.items.every((item:any)=>item.finalized),true);
  assert.equal((await call("?view=records")).body.statistics.reduce((sum:number,row:any)=>sum+row.graded_count,0),100);
}));

test("0564 upgrades prior attempts and finalized answers without deleting learner records",()=>withDb(async db=>{
  db.exec(`DROP INDEX skct_personal_one_open_legacy_attempt;
    ALTER TABLE skct_personal_attempts DROP COLUMN start_request_id;
    ALTER TABLE skct_personal_attempts DROP COLUMN full_mock_json;
    CREATE UNIQUE INDEX skct_personal_one_open_attempt ON skct_personal_attempts(user_key,unit_id,mode) WHERE status='in_progress';
    UPDATE app_schema_state SET migration_version='0563' WHERE id=1;`);
  const started=await call({action:"start",unitId:"U01",mode:"practice"});assert.equal(started.status,201);
  const a=started.body.attempt;
  const graded=await call({action:"answer",attemptId:a.id,position:1,choiceIndex:1,revision:0,operationId:crypto.randomUUID()});assert.equal(graded.status,200);
  const before=db.prepare("SELECT * FROM skct_personal_attempts WHERE id=?").get(a.id);
  const items=db.prepare("SELECT * FROM skct_personal_attempt_items WHERE attempt_id=? ORDER BY position").all(a.id);
  db.exec(readFileSync("apps/backend/drizzle/0564_skct_personal_full_mock.sql","utf8"));
  assert.deepEqual({...db.prepare("SELECT * FROM skct_personal_attempts WHERE id=?").get(a.id)},{...before,start_request_id:null,full_mock_json:null});
  assert.deepEqual(db.prepare("SELECT * FROM skct_personal_attempt_items WHERE attempt_id=? ORDER BY position").all(a.id),items);
  const next=await call(fresh());assert.equal(next.status,201);assert.notEqual(next.body.attempt.id,a.id);
}));
