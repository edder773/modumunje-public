import { activateApprovedGroupBank } from "./helpers/approved-group-bank";
/* eslint-disable @typescript-eslint/no-explicit-any -- dynamic JSON API contract assertions validate concrete field shapes below. */
import assert from "node:assert/strict";
import test from "node:test";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";
import { sqliteD1 } from "./helpers/sqlite-d1.mjs";
import { GET, POST, runGroupExamMaintenance } from "../apps/backend/src/modules/group-exams/group-exam.service";
import { learnerUserHash } from "../apps/backend/src/common/auth/admin-auth";
import { advanceProgress, reconcileProgress, questionIdentity, type Progress } from "../apps/backend/src/modules/group-exams/domain/group-exam-v2.domain";
import { v2Repository } from "../apps/backend/src/modules/group-exams/group-exam-v2.service";
import { classifyGroupExamInternalError, errorResponse } from "../apps/backend/src/modules/group-exams/group-exam-http";

const origin="https://example.test";
let serial=0;
const owner="v2-owner@example.test",peer="v2-peer@example.test";
async function post(email:string,body:Record<string,unknown>) {
 const response=await POST(new Request(origin+"/api/group-exams",{method:"POST",headers:{origin,"content-type":"application/json","x-sql-study-user-request":"1","x-baeumzip-authenticated-user-email":email},body:JSON.stringify({idempotencyKey:`v2-request-${++serial}`,...body})}));
 return {status:response.status,body:await response.json() as Record<string,any>};
}
async function get(email:string,query:string) {
 const response=await GET(new Request(origin+"/api/group-exams?"+query,{headers:{"x-baeumzip-authenticated-user-email":email}}));
 return {status:response.status,body:await response.json() as Record<string,any>};
}
async function seed(db: ReturnType<typeof openCanonicalTestDatabase>, count = 9) {
 await activateApprovedGroupBank(db);
 const selected = db.prepare(`SELECT question_uid FROM skct_question_public
   WHERE eligibility='eligible' AND dependency_group_id IS NULL ORDER BY question_uid LIMIT ?`).all(count)
   .map((row: { question_uid: unknown }) => String(row.question_uid));
 assert.equal(selected.length, count);
 const keep = new Set(selected);
 const candidates = db.prepare("SELECT question_uid FROM skct_question_public WHERE eligibility='eligible'").all();
 const exclude = db.prepare("UPDATE skct_question_public SET eligibility='excluded' WHERE question_uid=?");
 for (const row of candidates) if (!keep.has(String(row.question_uid))) exclude.run(String(row.question_uid));
}
async function setup(count=9,queries:Array<{sql:string;values:unknown[]}>=[]) {
 const db=openCanonicalTestDatabase(process.cwd());const previous=globalThis.__BAEUMZIP_ENV__;
 globalThis.__BAEUMZIP_ENV__={DB:sqliteD1(db,queries) as unknown as D1Database,SKCT_GROUP_SERVICE_ENABLED:"1",SKCT_GROUP_V2_ENABLED:"1",SKCT_GROUP_REPEAT_IDENTITY_VERIFIED:"1"};await seed(db,count);
 const created=await post(owner,{action:"group-create",name:"v2 검증 그룹",publicName:"대표"});assert.equal(created.status,201,JSON.stringify(created));
 const groupId=created.body.group.id as string; db.prepare("UPDATE study_groups SET admin_question_count_override=3 WHERE id=?").run(groupId);
 const ownerKey=await learnerUserHash(owner);
 return {db,groupId,ownerKey,cleanup:()=>{db.close();globalThis.__BAEUMZIP_ENV__=previous;}};
}
async function addPeer(groupId:string) {const invite=await post(owner,{action:"invite-create",groupId});assert.equal(invite.status,201);const joined=await post(peer,{action:"invite-accept",token:invite.body.invite.token,publicName:"참가자"});assert.equal(joined.status,200);}
async function start(groupId:string) {const r=await post(owner,{action:"run-start",mode:"immediate",groupId});assert.equal(r.status,201,JSON.stringify(r));const runId=String(r.body.run.id);const run=(await v2Repository.runById(runId))!;const startAt=Date.now()-1000;const duration=Date.parse(run.final_deadline_at_utc!)-Date.parse(run.actual_started_at_utc!);const db=globalThis.__BAEUMZIP_ENV__?.DB;assert.ok(db);await db.prepare("UPDATE study_group_exam_runs SET actual_started_at_utc=?,final_deadline_at_utc=? WHERE id=?").bind(new Date(startAt).toISOString(),new Date(startAt+duration).toISOString(),runId).run();await db.prepare("UPDATE study_group_exam_participant_progress SET current_opened_at_utc=?,current_deadline_at_utc=?,started_at_utc=? WHERE run_id=?").bind(new Date(startAt).toISOString(),new Date(startAt+45000).toISOString(),new Date(startAt).toISOString(),runId).run();return runId;}

test("internal failures expose safe diagnostics without raw exception text",async()=>{
 assert.equal(classifyGroupExamInternalError(new Error("D1_ERROR: database is locked")),"d1_contention");
 assert.equal(classifyGroupExamInternalError(new Error("UNIQUE constraint failed: secret_table.secret_column")),"d1_constraint");
 const messages:string[]=[];const original=console.error;console.error=(value?:unknown)=>{messages.push(String(value));};
 try {
  const response=errorResponse(new Error("D1_ERROR: database is locked; token=must-not-leak"),{phase:"mutation",operation:"invite-accept"});
  assert.equal(response.status,500);
  const body=await response.json() as Record<string,any>;
  assert.deepEqual(body.diagnostic,{phase:"mutation",operation:"invite-accept",causeCategory:"d1_contention"});
  assert.equal(JSON.stringify(body).includes("must-not-leak"),false);
 assert.equal(messages.length,1);
 assert.equal(messages[0].includes("must-not-leak"),false);
 assert.equal(JSON.parse(messages[0]).event,"group_exam_internal_error");
 const malicious=errorResponse(new Error("opaque failure"),{phase:"mutation",operation:"token=must-not-leak"});
 const maliciousBody=await malicious.json() as Record<string,any>;
 assert.equal(maliciousBody.diagnostic.operation,"unknown");
 assert.equal(JSON.stringify(maliciousBody).includes("must-not-leak"),false);
 assert.equal(messages.at(-1)?.includes("must-not-leak"),false);
 } finally {console.error=original;}
});
test("running v2 sync avoids group-wide maintenance and premature finalizer writes",async()=>{
 const queries:Array<{sql:string;values:unknown[]}>=[];const f=await setup(9,queries);try {
  await start(f.groupId);queries.length=0;
  const synced=await get(owner,`scope=sync&groupId=${f.groupId}`);assert.equal(synced.status,200,JSON.stringify(synced));
  assert.equal(queries.some(({sql})=>sql.includes("SET status='finalizing'")),false);
  assert.equal(queries.filter(({sql})=>sql.includes("connected_at_utc=COALESCE")).length,0);assert.equal(synced.body.current,null);
 }finally{f.cleanup();}
});
test("non-terminal v2 mutations skip group-wide reconcile and finalizer work",async()=>{
 const queries:Array<{sql:string;values:unknown[]}>=[];const f=await setup(9,queries);try {
  const runId=await start(f.groupId);queries.length=0;
  const advanced=await post(owner,{action:"question-advance",runId,position:0,expectedProgressRevision:0,answers:[0],expectedAnswerRevision:0});
  assert.equal(advanced.status,200,JSON.stringify(advanced));
  assert.equal(advanced.body.submitted,false);
  assert.equal(queries.filter(({sql})=>sql.includes("study_group_exam_participant_progress")&&sql.includes("ORDER BY roster_position")).length,0);
  assert.equal(queries.some(({sql})=>sql.includes("SET status='finalizing'")),false);
  const terminal=await post(owner,{action:"run-submit",runId,position:1,expectedProgressRevision:1});
  assert.equal(terminal.status,200,JSON.stringify(terminal));
  assert.equal((await get(owner,`scope=result&runId=${runId}`)).status,200);
 }finally{f.cleanup();}
});
const base:Progress={run_id:"r",user_key:"u",participant_id:"p",roster_position:0,current_position:0,current_opened_at_utc:"2026-01-01T00:00:00.000Z",current_deadline_at_utc:"2026-01-01T00:00:45.000Z",carried_ms:0,started_at_utc:"2026-01-01T00:00:00.000Z",connected_at_utc:"2026-01-01T00:00:00.000Z",finished_at_utc:null,terminal_status:null,correct_count:null,incorrect_count:null,unanswered_count:null,revision:0,last_mutation_execution_id:null};
test("v2 server timing: carry/reset/clamp/exact boundary/catch-up/last terminal",()=>{
 const now=Date.parse(base.started_at_utc)+30_000,hard=Date.parse(base.started_at_utc)+135_000;
 assert.equal(Date.parse(advanceProgress(base,45_000,now,hard,"carry_remaining").current_deadline_at_utc)-now,60_000);
 assert.equal(Date.parse(advanceProgress(base,45_000,now,hard,"reset_to_base").current_deadline_at_utc)-now,45_000);
 assert.equal(Date.parse(advanceProgress(base,45_000,now,now+1000,"carry_remaining").current_deadline_at_utc)-now,1000);
 assert.throws(()=>advanceProgress(base,45_000,Date.parse(base.current_deadline_at_utc),hard,"carry_remaining"));
 const caught=reconcileProgress(base,[45_000,45_000,45_000],Date.parse(base.started_at_utc)+100_000,hard);
 assert.equal(caught.current_position,2);assert.equal(Date.parse(caught.current_opened_at_utc)-Date.parse(base.started_at_utc),90_000);
 assert.equal(reconcileProgress(base,[45_000],hard,hard).finished_at_utc,base.current_deadline_at_utc);
 assert.equal(advanceProgress(base,null,now,hard,"carry_remaining").terminal_status,"submitted");
});
test("v2 solo early completion, answer revision updates, idempotency and secrecy",async()=>{
 const f=await setup();try {
 const runId=await start(f.groupId);const current=await get(owner,`scope=current&groupId=${f.groupId}&runId=${runId}`);
 assert.equal(current.body.run.contractVersion,2);assert.doesNotMatch(JSON.stringify(current.body),/SECRET|correct_count|correctAnswers|secret_hash/u);
 const sealed=f.db.prepare("SELECT position,correct_answers_snapshot_json FROM study_group_exam_question_secret WHERE run_id=? AND position IN (0,1) ORDER BY position").all(runId);
 assert.equal(sealed.length,2);
 const correctFirst=JSON.parse(String(sealed[0].correct_answers_snapshot_json)) as number[];
 const correctSecond=JSON.parse(String(sealed[1].correct_answers_snapshot_json)) as number[];
 assert.ok(correctFirst.length>0 && correctSecond.length>0);
 const wrongFirst=[correctFirst[0]===0?1:0],wrongSecond=[correctSecond[0]===0?1:0];
 const save=await post(owner,{action:"answer-save",runId,position:0,answers:wrongFirst,expectedRevision:0,expectedProgressRevision:0,operationId:"v2-answer-1"});assert.equal(save.status,200,JSON.stringify(save));
 const save2=await post(owner,{action:"answer-save",runId,position:0,answers:correctFirst,expectedRevision:1,expectedProgressRevision:1,operationId:"v2-answer-2"});assert.equal(save2.status,200,JSON.stringify(save2));
 const advanceBody={action:"question-advance",runId,position:0,expectedProgressRevision:2,answers:correctFirst,expectedAnswerRevision:2,idempotencyKey:"same-v2-advance"};
 const first=await post(owner,advanceBody);assert.equal(first.status,200,JSON.stringify(first));assert.deepEqual(await post(owner,advanceBody),first);
 assert.equal((await post(owner,{...advanceBody,answers:wrongFirst})).body.code,"GROUP_IDEMPOTENCY_CONFLICT");
 assert.equal((await get(owner,`scope=result&runId=${runId}`)).status,404);
 const finish=await post(owner,{action:"run-submit",runId,position:1,expectedProgressRevision:3,answers:wrongSecond,expectedAnswerRevision:0});assert.equal(finish.status,200,JSON.stringify(finish));
 const result=await get(owner,`scope=result&runId=${runId}`);assert.equal(result.status,200,JSON.stringify(result));
 const row=result.body.orderedResults[0];assert.deepEqual([row.correctCount,row.incorrectCount,row.unansweredCount],[1,1,1]);assert.equal(row.rank,1);assert.ok(row.totalElapsedMs>=0);
 assert.deepEqual(result.body.review.map((q:any)=>q.position),[0,1,2]);assert.ok(typeof result.body.review[0].explanation==="string" && result.body.review[0].explanation.length>0);
 assert.doesNotMatch(JSON.stringify(result.body.orderedResults),/"answer"|correctAnswers|SECRET|wrongPositions/u);
 }finally{f.cleanup();}
});
test("v2 concurrent saves/advance use one progress CAS; no-show blocks early results; kicked self still finishes",async()=>{
 const f=await setup();try {
 await addPeer(f.groupId);const runId=await start(f.groupId);
 const race=await Promise.all([post(owner,{action:"answer-save",runId,position:0,answers:[0],expectedRevision:0,expectedProgressRevision:0,operationId:"race-save"}),post(owner,{action:"question-advance",runId,position:0,answers:[1],expectedAnswerRevision:0,expectedProgressRevision:0})]);
 assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
 const before=await v2Repository.progress(runId,f.ownerKey);
 assert.equal((await post(owner,{action:"run-submit",runId,position:before!.current_position,expectedProgressRevision:before!.revision})).status,200);
 assert.equal((await get(owner,`scope=result&runId=${runId}`)).status,404);
 const peerKey=await learnerUserHash(peer);const membership=f.db.prepare("SELECT public_id FROM study_group_members WHERE group_id=? AND user_key=?").get(f.groupId,peerKey)!;
 assert.equal((await post(owner,{action:"member-kick",groupId:f.groupId,targetMembershipId:membership.public_id})).status,200);
 const peerCurrent=await get(peer,`scope=current&groupId=${f.groupId}&runId=${runId}`);assert.equal(peerCurrent.status,200);
 assert.equal((await post(peer,{action:"run-submit",runId,position:0,expectedProgressRevision:0})).status,200);
 const ownResult=await get(peer,`scope=result&runId=${runId}`);assert.equal(ownResult.status,200);assert.equal(ownResult.body.orderedResults.length,1);assert.equal(ownResult.body.orderedResults[0].self,true);
 assert.equal((await get(owner,`scope=result&runId=${runId}`)).body.orderedResults.length,2);
 assert.equal(f.db.prepare("SELECT revision FROM study_group_exam_runs WHERE id=?").get(runId)?.revision,2);
 }finally{f.cleanup();}
});
test("v2 hard deadline gives no-show and timeout actual times; two simultaneous finishes finalize once",async()=>{
 const f=await setup();try {
 await addPeer(f.groupId);const runId=await start(f.groupId);await get(owner,`scope=current&groupId=${f.groupId}&runId=${runId}`);
 const run=(await v2Repository.runById(runId))!;await runGroupExamMaintenance(new Date(Date.parse(run.final_deadline_at_utc!)+60_000));
 const result=await get(owner,`scope=result&runId=${runId}`);assert.equal(result.status,200);
 assert.equal(result.body.orderedResults.find((r:any)=>r.self).status,"auto_submitted");assert.equal(result.body.orderedResults.find((r:any)=>r.self).totalElapsedMs,135_000);
 const noShow=result.body.orderedResults.find((r:any)=>!r.self);assert.equal(noShow.status,"no_show");assert.equal(noShow.totalElapsedMs,null);assert.equal(noShow.unansweredCount,3);
 f.db.prepare("UPDATE study_group_quota_slots SET status='available',reserved_run_id=NULL WHERE group_id=?").run(f.groupId);
 const run2=await start(f.groupId);const finishes=await Promise.all([post(owner,{action:"run-submit",runId:run2,position:0,expectedProgressRevision:0}),post(peer,{action:"run-submit",runId:run2,position:0,expectedProgressRevision:0})]);
 assert.deepEqual(finishes.map(r=>r.status),[200,200]);assert.equal((await v2Repository.runById(run2))?.revision,2);
 }finally{f.cleanup();}
});
test("v2 strict repeat excludes sealed history and fails before consuming quota when exhausted",async()=>{
 const f=await setup(6);try {
  assert.equal((await post(owner,{action:"settings-update",groupId:f.groupId,memberLimit:50,expectedRevision:0,settings:{repeatPolicy:"forbid"}})).status,200);
  const first=await start(f.groupId);const firstQuestions=new Set((await v2Repository.questionsForRun(first)).map(q=>q.source_question_uid));
  const firstProgress=await v2Repository.progress(first,f.ownerKey);assert.equal((await post(owner,{action:"run-submit",runId:first,position:0,expectedProgressRevision:firstProgress!.revision})).status,200);
  f.db.prepare("UPDATE study_group_quota_slots SET status='available',reserved_run_id=NULL WHERE group_id=?").run(f.groupId);
  const second=await start(f.groupId);const secondQuestions=(await v2Repository.questionsForRun(second)).map(q=>q.source_question_uid);assert.ok(secondQuestions.every(uid=>!firstQuestions.has(uid)));
  const secondProgress=await v2Repository.progress(second,f.ownerKey);assert.equal((await post(owner,{action:"run-submit",runId:second,position:0,expectedProgressRevision:secondProgress!.revision})).status,200);
  f.db.prepare("UPDATE study_group_quota_slots SET status='available',reserved_run_id=NULL WHERE group_id=?").run(f.groupId);
  const failed=await post(owner,{action:"run-start",groupId:f.groupId,mode:"immediate"});assert.equal(failed.status,409);assert.equal(failed.body.code,"GROUP_QUESTION_SELECTION_UNAVAILABLE");
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM study_group_exam_runs WHERE group_id=?").get(f.groupId)?.n,2);assert.equal(f.db.prepare("SELECT status FROM study_group_quota_slots WHERE group_id=?").get(f.groupId)?.status,"available");
 }finally{f.cleanup();}
});
test("owner cap 0→3, parallel fourth, archive slot reuse, transfer cap, same-key duplicate",async()=>{
 const f=await setup();try {
 const more=await Promise.all([post(owner,{action:"group-create",name:"소유 그룹2",publicName:"대표"}),post(owner,{action:"group-create",name:"소유 그룹3",publicName:"대표"}),post(owner,{action:"group-create",name:"소유 그룹4",publicName:"대표"})]);assert.deepEqual(more.map(r=>r.status).sort(),[201,201,409]);
 const countBefore=f.db.prepare("SELECT COUNT(*) AS n FROM study_group_membership_events").get()!.n;
 assert.equal((await post(owner,{action:"group-create",name:"불가 그룹",publicName:"대표"})).body.code,"GROUP_OWNER_LIMIT");assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM study_group_membership_events").get()!.n,countBefore);
 assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM study_group_owner_slots WHERE owner_user_key=?").get(f.ownerKey)?.n,3);
 await post(owner,{action:"group-leave",groupId:more.find(r=>r.status===201)!.body.group.id});
 const duplicate={action:"group-create",name:"재사용 그룹",publicName:"대표",idempotencyKey:"same-create-key"};const d=await Promise.all([post(owner,duplicate),post(owner,duplicate)]);assert.deepEqual(d.map(r=>r.status),[201,201]);assert.equal(d[0].body.group.id,d[1].body.group.id);
 await addPeer(f.groupId);const peerGroup=await post(peer,{action:"group-create",name:"다른 대표 그룹",publicName:"참가자"});const invite=await post(peer,{action:"invite-create",groupId:peerGroup.body.group.id});await post(owner,{action:"invite-accept",token:invite.body.invite.token,publicName:"대표"});
 const membership=f.db.prepare("SELECT public_id FROM study_group_members WHERE group_id=? AND user_key=?").get(peerGroup.body.group.id,f.ownerKey)!;
 assert.equal((await post(peer,{action:"owner-transfer",groupId:peerGroup.body.group.id,targetMembershipId:membership.public_id})).body.code,"GROUP_OWNER_LIMIT");
 }finally{f.cleanup();}
});
test("canonical identity sorts complete nested refs, normalizes NFC, ignores release-local positions",async()=>{
 const q:any={content_set:"자료",area_code:"언어이해",question_no:1,question_source_refs_json:JSON.stringify({sourceRefs:[{sourceId:"b",pageBlock:"자료",sourceSha256:"e".repeat(64)},{sourceId:"a",pageBlock:"자료",sourceSha256:"f".repeat(64)}]})};
 const first=await questionIdentity(q);assert.ok(first);
 const refs=JSON.parse(q.question_source_refs_json).sourceRefs.reverse().map((r:any)=>({...r,jsonPointer:"/changed/99",pageBlock:r.pageBlock.normalize("NFD")}));
 assert.equal((await questionIdentity({...q,content_set:q.content_set.normalize("NFD"),question_source_refs_json:JSON.stringify({sourceRefs:refs,unifiedMdLines:[900,999]})}))?.questionIdentity,first.questionIdentity);
 assert.notEqual((await questionIdentity({...q,question_no:2}))?.questionIdentity,first.questionIdentity);
 assert.equal(await questionIdentity({...q,question_source_refs_json:"[]"}),null);
});
test("v2 ordered results use competition ties and frozen roster, independent of elapsed; exact-deadline mutations write nothing",async()=>{
 const f=await setup();try {
 await addPeer(f.groupId);const third="v2-third@example.test";const invite=await post(owner,{action:"invite-create",groupId:f.groupId});assert.equal((await post(third,{action:"invite-accept",token:invite.body.invite.token,publicName:"동점검증"})).status,200);
 const runId=await start(f.groupId);const run=(await v2Repository.runById(runId))!;const {mutateV2}=await import("../apps/backend/src/modules/group-exams/group-exam-v2.service");
 const startAt=Date.parse(run.actual_started_at_utc!);const keys=[f.ownerKey,await learnerUserHash(peer),await learnerUserHash(third)];
 const firstSecret=f.db.prepare("SELECT correct_answers_snapshot_json FROM study_group_exam_question_secret WHERE run_id=? AND position=0").get(runId);
 assert.ok(firstSecret);
 const correct=JSON.parse(String(firstSecret.correct_answers_snapshot_json)) as number[];
 assert.ok(correct.length>0);
 await assert.rejects(mutateV2({runId,userKey:keys[0],action:"answer-save",position:0,expectedProgressRevision:0,now:new Date(startAt+45000),answer:{answers:[0],expectedRevision:0,operationId:"exact-deadline",hash:"hash"}}),/마감/u);
 assert.equal(f.db.prepare("SELECT COUNT(*) n FROM study_group_exam_answers WHERE run_id=?").get(runId)?.n,0);
 for(let i=0;i<3;i++)await mutateV2({runId,userKey:keys[i],action:"run-submit",position:0,expectedProgressRevision:0,now:new Date(startAt+(i===0?5000:1000)),answer:{answers:i<2?correct:[],expectedRevision:0,operationId:`rank-${i}`,hash:`hash-${i}`}});
 const result=await get(owner,`scope=result&runId=${runId}`);assert.equal(result.status,200);assert.deepEqual(result.body.orderedResults.map((r:any)=>r.rank),[1,1,3]);
 const expected=await v2Repository.orderedResults(runId);assert.deepEqual(result.body.orderedResults.map((r:any)=>r.participantId),expected.map(r=>r.participant_id));
 assert.deepEqual(result.body.orderedResults.slice(0,2).map((r:any)=>r.totalElapsedMs).sort((a:number,b:number)=>a-b),[1000,5000]);
 }finally{f.cleanup();}
});
test("v2 flags stop new strict requests but persisted v2 drains; last advance finalizes, incomplete identity never falls back",async()=>{
 const f=await setup();try {
 f.db.prepare("UPDATE study_groups SET admin_question_count_override=1 WHERE id=?").run(f.groupId);
 const runId=await start(f.groupId);globalThis.__BAEUMZIP_ENV__!.SKCT_GROUP_V2_ENABLED="0";
 const response=await post(owner,{action:"question-advance",runId,position:0,expectedProgressRevision:0});assert.equal(response.status,200);assert.equal(response.body.submitted,true);assert.equal((await get(owner,`scope=result&runId=${runId}`)).status,200);
 globalThis.__BAEUMZIP_ENV__!.SKCT_GROUP_V2_ENABLED="1";
 f.db.prepare("UPDATE study_group_quota_slots SET status='available',reserved_run_id=NULL WHERE group_id=?").run(f.groupId);
 f.db.prepare("UPDATE study_groups SET settings_json=? WHERE id=?").run(JSON.stringify({repeatPolicy:"forbid"}),f.groupId);
 const unused=f.db.prepare("SELECT question_uid FROM skct_question_public WHERE eligibility='eligible' AND question_uid NOT IN (SELECT source_question_uid FROM study_group_exam_question_public WHERE run_id=?) ORDER BY question_uid LIMIT 1").get(runId);
 assert.ok(unused);
 f.db.prepare("UPDATE skct_question_public SET question_source_refs_json='{}' WHERE question_uid=?").run(unused.question_uid);
 const failed=await post(owner,{action:"run-start",mode:"immediate",groupId:f.groupId});assert.equal(failed.status,409);assert.equal(failed.body.code,"GROUP_REPEAT_IDENTITY_UNVERIFIED");
 assert.equal(f.db.prepare("SELECT COUNT(*) n FROM study_group_exam_runs WHERE group_id=?").get(f.groupId)?.n,1);
 assert.equal(f.db.prepare("SELECT status FROM study_group_quota_slots WHERE group_id=?").get(f.groupId)?.status,"available");
 }finally{f.cleanup();}
});
test("v2 precommit membership race retries without quota, snapshots, repeat claims or partial roster",async()=>{
 const f=await setup();const original=v2Repository.createRun;try {
 await addPeer(f.groupId);const peerKey=await learnerUserHash(peer);let injected=false;
 v2Repository.createRun=async function(input){if(!injected){injected=true;f.db.prepare("UPDATE study_group_members SET status='kicked' WHERE group_id=? AND user_key=?").run(f.groupId,peerKey);}return original.call(this,input);};
 const response=await post(owner,{action:"run-start",mode:"immediate",groupId:f.groupId});assert.equal(response.status,409);assert.equal(response.body.code,"GROUP_RUN_CONFLICT");
 for(const table of ["study_group_exam_runs","study_group_exam_participants","study_group_exam_question_public","study_group_exam_repeat_claims","study_group_exam_participant_progress"])assert.equal(f.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()?.n,0,table);
 assert.equal(f.db.prepare("SELECT status FROM study_group_quota_slots WHERE group_id=?").get(f.groupId)?.status,"available");
 const runId=await start(f.groupId);assert.equal((await v2Repository.progressRows(runId)).length,1);assert.equal((await v2Repository.runById(runId))?.participant_count_snapshot,1);
 }finally{v2Repository.createRun=original;f.cleanup();}
});
test("v2 simultaneous identical answer operation replays once; changed payload still conflicts",async()=>{
 const f=await setup();try {
 const runId=await start(f.groupId);const body={action:"answer-save",runId,position:0,answers:[0],expectedRevision:0,expectedProgressRevision:0,operationId:"same-concurrent-v2-operation"};
 const results=await Promise.all([post(owner,body),post(owner,body)]);assert.deepEqual(results.map(r=>r.status),[200,200]);assert.deepEqual(results.map(r=>r.body.revision),[1,1]);
 assert.equal((await v2Repository.progress(runId,f.ownerKey))?.revision,1);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM study_group_answer_operations WHERE operation_id=?").get(body.operationId)?.n,1);
 assert.equal((await post(owner,{...body,answers:[1]})).body.code,"GROUP_ANSWER_OPERATION_CONFLICT");
 assert.equal(f.db.prepare("SELECT COUNT(*) n FROM study_group_exam_selection_metadata WHERE run_id=?").get(runId)?.n,0);
 const selection=JSON.parse((await v2Repository.contract(runId))!.selection_json);assert.equal(selection.repeatPolicy,"allow");assert.equal(selection.selectionStatus,"selected");
 }finally{f.cleanup();}
});
test("terminal batch scores frozen answers once when the final participant submits",async()=>{
 const f=await setup();try {
  await addPeer(f.groupId);
  const runId=await start(f.groupId);
  const secret=f.db.prepare("SELECT correct_answers_snapshot_json FROM study_group_exam_question_secret WHERE run_id=? AND position=0").get(runId);
  assert.ok(secret);
  const correct=JSON.parse(String(secret.correct_answers_snapshot_json)) as number[];
  assert.ok(correct.length>0);
  const wrong=[correct[0]===0?1:0];
  const ownerSubmit=await post(owner,{action:"run-submit",runId,position:0,expectedProgressRevision:0,
    answers:correct,expectedAnswerRevision:0,idempotencyKey:"terminal-owner"});
  assert.equal(ownerSubmit.status,200);
  assert.equal(f.db.prepare("SELECT status FROM study_group_exam_runs WHERE id=?").get(runId)?.status,"running");
  assert.equal((await get(owner,`scope=result&runId=${runId}`)).status,404);
  const peerBody={action:"run-submit",runId,position:0,expectedProgressRevision:0,
    answers:wrong,expectedAnswerRevision:0,idempotencyKey:"terminal-peer"};
  const peerSubmit=await post(peer,peerBody);
  assert.equal(peerSubmit.status,200);
  assert.deepEqual(await post(peer,peerBody),peerSubmit);
  assert.equal(f.db.prepare("SELECT status FROM study_group_exam_runs WHERE id=?").get(runId)?.status,"completed");
  const ownerKey=await learnerUserHash(owner),peerKey=await learnerUserHash(peer);
  const ownerScore=f.db.prepare("SELECT correct_count,incorrect_count,unanswered_count FROM study_group_exam_participant_progress WHERE run_id=? AND user_key=?").get(runId,ownerKey);
  const peerScore=f.db.prepare("SELECT correct_count,incorrect_count,unanswered_count FROM study_group_exam_participant_progress WHERE run_id=? AND user_key=?").get(runId,peerKey);
  assert.deepEqual([ownerScore?.correct_count,ownerScore?.incorrect_count,ownerScore?.unanswered_count],[1,0,2]);
  assert.deepEqual([peerScore?.correct_count,peerScore?.incorrect_count,peerScore?.unanswered_count],[0,1,2]);
  const wrongPositions=f.db.prepare("SELECT wrong_positions_json FROM study_group_exam_participants WHERE run_id=? AND user_key=?").get(runId,peerKey);
  assert.deepEqual(JSON.parse(String(wrongPositions?.wrong_positions_json)),[0]);
  assert.equal((await get(owner,`scope=result&runId=${runId}`)).status,200);
 }finally{f.cleanup();}
});
test("terminal submit still reconciles an overdue peer at the original server deadline",async()=>{
 const f=await setup();try {
  await addPeer(f.groupId);
  const runId=await start(f.groupId);
  const peerKey=await learnerUserHash(peer);
  const deadline=new Date(Date.now()-500).toISOString();
  f.db.prepare("UPDATE study_group_exam_participant_progress SET current_position=2,current_deadline_at_utc=? WHERE run_id=? AND user_key=?")
   .run(deadline,runId,peerKey);
  const submitted=await POST(new Request(origin+"/api/group-exams",{method:"POST",
    headers:{origin,"content-type":"application/json","x-sql-study-user-request":"1","x-baeumzip-authenticated-user-email":owner},
    body:JSON.stringify({action:"run-submit",runId,position:0,expectedProgressRevision:0,idempotencyKey:"terminal-overdue-peer"})}));
  assert.equal(submitted.status,200);
  assert.ok(Number(submitted.headers.get("X-Group-DB-Ops"))<=3);
  const peerProgress=f.db.prepare("SELECT terminal_status,finished_at_utc FROM study_group_exam_participant_progress WHERE run_id=? AND user_key=?").get(runId,peerKey);
  assert.equal(peerProgress?.terminal_status,"auto_submitted");
  assert.equal(peerProgress?.finished_at_utc,deadline);
  assert.equal(f.db.prepare("SELECT status FROM study_group_exam_runs WHERE id=?").get(runId)?.status,"completed");
 }finally{f.cleanup();}
});
test("rejected terminal CAS cannot reconcile peers or publish a result",async()=>{
 const f=await setup();try {
  await addPeer(f.groupId);
  const runId=await start(f.groupId);
  const peerKey=await learnerUserHash(peer);
  const deadline=new Date(Date.now()-500).toISOString();
  f.db.prepare("UPDATE study_group_exam_participant_progress SET current_position=2,current_deadline_at_utc=? WHERE run_id=? AND user_key=?")
   .run(deadline,runId,peerKey);
  const rejected=await post(owner,{action:"run-submit",runId,position:0,expectedProgressRevision:99,idempotencyKey:"terminal-stale-cas"});
  assert.equal(rejected.status,409);
  const peerProgress=f.db.prepare("SELECT terminal_status,finished_at_utc,revision FROM study_group_exam_participant_progress WHERE run_id=? AND user_key=?").get(runId,peerKey);
  assert.equal(peerProgress?.terminal_status,null);
  assert.equal(peerProgress?.finished_at_utc,null);
  assert.equal(peerProgress?.revision,0);
  assert.equal(f.db.prepare("SELECT status FROM study_group_exam_runs WHERE id=?").get(runId)?.status,"running");
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM study_group_idempotency WHERE action='run-submit' AND idempotency_key='terminal-stale-cas'").get()?.n,0);
 }finally{f.cleanup();}
});
