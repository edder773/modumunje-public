/* eslint-disable @typescript-eslint/no-explicit-any -- API responses are verified by concrete contract assertions. */
import assert from "node:assert/strict";
import test from "node:test";
import {openSkctTestDatabase} from "./helpers/skct-test-database.mjs";
import {sqliteD1} from "./helpers/sqlite-d1.mjs";
import {seedSyntheticPersonalBank} from "./helpers/synthetic-personal-bank";
import {GET,POST} from "../apps/backend/src/modules/group-exams/group-exam.service";
import {v2Repository} from "../apps/backend/src/modules/group-exams/group-exam-v2.service";
async function call(email:string,body:Record<string,unknown>|string){const get=typeof body==="string";const response=await(get?GET:POST)(new Request("https://example.test/api/group-exams"+(get?body:""),{method:get?"GET":"POST",headers:{origin:"https://example.test","content-type":"application/json","x-sql-study-user-request":"1","x-baeumzip-authenticated-user-email":email},...(!get?{body:JSON.stringify({idempotencyKey:crypto.randomUUID(),...body as Record<string,unknown>})}:{})}));return {status:response.status,body:await response.json() as any};}
async function fixture(work:(db:ReturnType<typeof openSkctTestDatabase>,groupId:string)=>Promise<void>){const db=openSkctTestDatabase(process.cwd()),previous=globalThis.__BAEUMZIP_ENV__;globalThis.__BAEUMZIP_ENV__={DB:sqliteD1(db) as unknown as D1Database,SKCT_GROUP_SERVICE_ENABLED:"1",SKCT_GROUP_V2_ENABLED:"1",SKCT_GROUP_REPEAT_IDENTITY_VERIFIED:"1"};try{seedSyntheticPersonalBank(db);const group=await call("owner@example.test",{action:"group-create",name:"그룹 UX 검증",publicName:"대표",memberLimit:3});assert.equal(group.status,201);await work(db,group.body.group.id);}finally{db.close();globalThis.__BAEUMZIP_ENV__=previous;}}
test("one reusable invite admits several people and rejects a concurrent join beyond capacity",()=>fixture(async(db,groupId)=>{
 const made=await call("owner@example.test",{action:"invite-create",groupId,reusable:true});assert.equal(made.status,201);assert.equal(made.body.invite.reusable,true);
 assert.equal((await call("first@example.test",{action:"invite-accept",token:made.body.invite.token,publicName:"첫 참가자"})).status,200);
 assert.equal((await call("owner@example.test",`?scope=group&groupId=${groupId}`)).body.group.reserved_invites,0);
 const joined=await Promise.all(["second","third"].map(name=>call(`${name}@example.test`,{action:"invite-accept",token:made.body.invite.token,publicName:name})));assert.deepEqual(joined.map(row=>row.status).sort(),[200,409]);
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM study_group_members WHERE group_id=? AND status='active'").get(groupId)?.n,3);
 assert.equal(db.prepare("SELECT status FROM study_group_invites WHERE id=?").get(made.body.invite.id)?.status,"active");
 assert.equal((await call("owner@example.test",{action:"invite-revoke",groupId,inviteId:made.body.invite.id})).status,200);
 assert.equal((await call("later@example.test",{action:"invite-accept",token:made.body.invite.token,publicName:"나중 참가자"})).status,410);
}));
test("legacy single-use invite remains single-use after the additive migration",()=>fixture(async(db,groupId)=>{
 const made=await call("owner@example.test",{action:"invite-create",groupId,reusable:false});assert.equal(made.body.invite.reusable,false);
 assert.equal((await call("first@example.test",{action:"invite-accept",token:made.body.invite.token,publicName:"첫 참가자"})).status,200);
 assert.equal((await call("second@example.test",{action:"invite-accept",token:made.body.invite.token,publicName:"둘째 참가자"})).status,410);
 assert.equal(db.prepare("SELECT reusable FROM study_group_invites WHERE id=?").get(made.body.invite.id)?.reusable,0);
}));
test("settings acknowledgement includes committed values, and same-key replay never adds another revision",()=>fixture(async(db,groupId)=>{
 const detail=(await call("owner@example.test",`?scope=group&groupId=${groupId}`)).body.group;
 const body={action:"settings-update",groupId,expectedRevision:detail.revision,memberLimit:4,settings:JSON.parse(detail.settings_json),idempotencyKey:"settings-ux-replay"};
 const saved=await call("owner@example.test",body);assert.equal(saved.status,200);assert.equal(saved.body.settings.member_limit,4);
 assert.deepEqual((await call("owner@example.test",body)).body,saved.body);
 assert.equal(db.prepare("SELECT revision FROM study_groups WHERE id=?").get(groupId)?.revision,detail.revision+1);
 assert.equal((await call("owner@example.test",{...body,memberLimit:5})).status,409);
}));
test("slow preparation happens before the five-second countdown; start retry keeps its run and sealed content",()=>fixture(async(db,groupId)=>{
 const original=v2Repository.eligibleQuestions;v2Repository.eligibleQuestions=async(...args)=>{await new Promise(resolve=>setTimeout(resolve,900));return original.apply(v2Repository,args);};
 try{const start={action:"run-start",groupId,mode:"immediate",idempotencyKey:"slow-start-replay"};const made=await call("owner@example.test",start);assert.equal(made.status,201,JSON.stringify(made));
  const remaining=Date.parse(made.body.current.countdownEndsAt)-Date.now();assert.ok(remaining>=4_700&&remaining<=5_100,`countdown remaining ${remaining}`);
  assert.equal(made.body.current.phase,"countdown");assert.equal(made.body.current.question,null);assert.doesNotMatch(JSON.stringify(made.body),/correct_answers|SYNTHETIC_PRIVATE_EXPLANATION|secret_hash/);
  const replay=await call("owner@example.test",start);assert.equal(replay.body.run.id,made.body.run.id);assert.equal(db.prepare("SELECT COUNT(*) AS n FROM study_group_exam_runs").get()?.n,1);
 }finally{v2Repository.eligibleQuestions=original;}
}));
test("exhausted daily quota rejects before scanning or selecting the question bank",()=>fixture(async(db,groupId)=>{
 const start=await call("owner@example.test",{action:"run-start",groupId,mode:"immediate"});assert.equal(start.status,201);
 db.prepare("UPDATE study_group_exam_runs SET status='completed' WHERE group_id=?").run(groupId);db.prepare("DELETE FROM study_group_active_runs WHERE group_id=?").run(groupId);
 const original=v2Repository.eligibleQuestions;let calls=0;v2Repository.eligibleQuestions=async(...args)=>{calls++;return original.apply(v2Repository,args);};try{const next=await call("owner@example.test",{action:"run-start",groupId,mode:"immediate"});assert.equal(next.body.code,"GROUP_DAILY_QUOTA_EXHAUSTED");assert.equal(calls,0);}finally{v2Repository.eligibleQuestions=original;}
}));

test("the owner arms countdown after the exam view is ready; peers cannot arm it and repeat readiness never resets time",()=>fixture(async(db,groupId)=>{
 const made=await call("owner@example.test",{action:"run-start",groupId,mode:"immediate",waitForView:true});assert.equal(made.status,201);assert.equal(made.body.current.phase,"preparing");
 const runId=made.body.run.id;await new Promise(resolve=>setTimeout(resolve,1200));
 assert.equal((await call("peer@example.test",{action:"run-ready",runId})).status,403);
 const ready=await call("owner@example.test",{action:"run-ready",runId});assert.equal(ready.status,200);assert.equal(ready.body.current.phase,"countdown");assert.ok(Date.parse(ready.body.current.countdownEndsAt)-Date.now()>4700);assert.equal(ready.body.current.question,null);
 const again=await call("owner@example.test",{action:"run-ready",runId});assert.equal(again.body.current.countdownEndsAt,ready.body.current.countdownEndsAt);
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM study_group_quota_events WHERE group_id=? AND event_type='consume'").get(groupId)?.n,1);
}));

test("preparation never reveals questions or accepts answers, and a lost owner view recovers a shared countdown",()=>fixture(async(db,groupId)=>{
 const made=await call("owner@example.test",{action:"run-start",groupId,mode:"immediate",waitForView:true});const runId=made.body.run.id;
 const before=await call("owner@example.test",`?scope=current&runId=${runId}`);assert.equal(before.body.phase,"preparing");assert.equal(before.body.question,null);
 const denied=await call("owner@example.test",{action:"question-advance",runId,position:0,answers:[0],expectedAnswerRevision:0,expectedProgressRevision:0});assert.equal(denied.body.code,"GROUP_COUNTDOWN_ACTIVE");
 db.prepare("UPDATE study_group_exam_runs SET actual_started_at_utc=? WHERE id=?").run(new Date(Date.now()-1).toISOString(),runId);
 const recovered=await call("owner@example.test",`?scope=current&runId=${runId}`);assert.equal(recovered.body.phase,"countdown");assert.equal(recovered.body.question,null);assert.ok(Date.parse(recovered.body.countdownEndsAt)-Date.now()>4700);
}));
