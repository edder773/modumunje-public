/* eslint-disable @typescript-eslint/no-explicit-any -- isolated synthetic API assertions. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {openSkctTestDatabase} from './helpers/skct-test-database.mjs';
import {sqliteD1} from './helpers/sqlite-d1.mjs';
import {seedSyntheticPersonalBank} from './helpers/synthetic-personal-bank';
import {GET,POST} from '../apps/backend/src/modules/group-exams/group-exam.service';
import {GroupExamAdvanceRepository} from '../apps/backend/src/modules/group-exams/group-exam-advance.repository';
import {learnerUserHash,sha256} from '../apps/backend/src/common/auth/admin-auth';
import {advanceProgress} from '../apps/backend/src/modules/group-exams/domain/group-exam-v2.domain';
async function call(email:string,body:Record<string,unknown>|string){const read=typeof body==='string';const r=await(read?GET:POST)(new Request('https://example.test/api/group-exams'+(read?body:''),{method:read?'GET':'POST',headers:{origin:'https://example.test','content-type':'application/json','x-sql-study-user-request':'1','x-baeumzip-authenticated-user-email':email},...(!read?{body:JSON.stringify({idempotencyKey:crypto.randomUUID(),...body as Record<string,unknown>})}:{})}));return {status:r.status,body:await r.json() as any};}
async function fixture(work:(db:ReturnType<typeof openSkctTestDatabase>,groupId:string,runId:string,owner:string)=>Promise<void>){const db=openSkctTestDatabase(process.cwd()),before=globalThis.__BAEUMZIP_ENV__;globalThis.__BAEUMZIP_ENV__={DB:sqliteD1(db) as unknown as D1Database,SKCT_GROUP_SERVICE_ENABLED:'1',SKCT_GROUP_V2_ENABLED:'1',SKCT_GROUP_REPEAT_IDENTITY_VERIFIED:'1'};try{seedSyntheticPersonalBank(db);const group=await call('owner@example.test',{action:'group-create',name:'합성 그룹 검증',publicName:'대표'});const groupId=group.body.group.id;const start=await call('owner@example.test',{action:'run-start',groupId,mode:'immediate'});assert.equal(start.status,201);const runId=start.body.run.id;const now=Date.now();db.prepare('UPDATE study_group_exam_runs SET actual_started_at_utc=?,final_deadline_at_utc=? WHERE id=?').run(new Date(now-1000).toISOString(),new Date(now+900000).toISOString(),runId);db.prepare('UPDATE study_group_exam_participant_progress SET current_opened_at_utc=?,current_deadline_at_utc=? WHERE run_id=?').run(new Date(now-1000).toISOString(),new Date(now+40000).toISOString(),runId);await work(db,groupId,runId,await learnerUserHash('owner@example.test'));}finally{db.close();globalThis.__BAEUMZIP_ENV__=before;}}

test('atomic advance checks authorization, fixed roster, time and both CAS revisions before writing or exposing the next snapshot',()=>fixture(async(db,_groupId,runId,owner)=>{
 const repo=new GroupExamAdvanceRepository();const now=new Date().toISOString();
 const make=async(overrides:any={})=>{const id=crypto.randomUUID();return {runId,userKey:owner,position:0,revision:0,answers:[1],answerRevision:0,admin:false,now,answerHash:await sha256('[1]'),idempotency:{actorUserKey:owner,action:'question-advance',key:id,requestDigest:await sha256(id),executionId:id,responseStatus:200,response:{},timestamp:now},...overrides};};
 const progress=()=>db.prepare('SELECT * FROM study_group_exam_participant_progress WHERE run_id=? AND user_key=?').get(runId,owner) as any;
 const initial=progress();const unchanged=()=>{assert.deepEqual(progress(),initial);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM study_group_exam_answers WHERE run_id=?').get(runId)?.n,0);assert.equal(db.prepare("SELECT COUNT(*) AS n FROM study_group_idempotency WHERE action='question-advance'").get()?.n,0);};
 db.prepare("UPDATE user_accounts SET status='blocked' WHERE user_key=?").run(owner);assert.equal((await repo.advance(await make())).account_status,'blocked');unchanged();db.prepare("UPDATE user_accounts SET status='active' WHERE user_key=?").run(owner);
 db.prepare("INSERT INTO site_settings(key,value,value_type,updated_by_hash,updated_at) VALUES('maintenance_mode','true','boolean','test',CURRENT_TIMESTAMP)").run();assert.equal((await repo.advance(await make())).response_json,null);unchanged();db.prepare("DELETE FROM site_settings WHERE key='maintenance_mode'").run();
 for(const changes of [{userKey:await learnerUserHash('outsider@example.test')},{revision:1},{answerRevision:1},{position:1},{now:new Date(Date.parse(initial.current_deadline_at_utc)).toISOString()},{now:new Date(Date.parse(initial.current_opened_at_utc)-1).toISOString()}]){assert.equal((await repo.advance(await make(changes))).response_json,null);unchanged();}
 // A stray progress row is insufficient; the immutable participant roster is required.
 db.exec('PRAGMA foreign_keys=OFF');db.prepare('DELETE FROM study_group_exam_participants WHERE run_id=? AND user_key=?').run(runId,owner);assert.equal((await repo.advance(await make())).response_json,null);unchanged();db.prepare("INSERT INTO study_group_exam_participants(run_id,user_key,public_name_snapshot,membership_epoch_snapshot,status) VALUES(?,?,?,1,'rostered')").run(runId,owner,'대표');db.exec('PRAGMA foreign_keys=ON');
 const d1=sqliteD1(db);globalThis.__BAEUMZIP_ENV__!.DB=d1 as unknown as D1Database;const input=await make();const result=await repo.advance(input);assert.equal(d1.roundTrips,1);const response=JSON.parse(result.response_json!);assert.equal(response.position,1);assert.equal(response.progressRevision,1);assert.doesNotMatch(result.response_json!,/correct_answers|secret_hash|SYNTHETIC_PRIVATE_EXPLANATION/);assert.deepEqual((await repo.advance(input)),result);assert.equal(progress().revision,1);
}));

test('atomic timer arithmetic matches the domain for both policies, millisecond precision and hard-deadline clipping',()=>fixture(async(db,_groupId,runId,owner)=>{
 const repo=new GroupExamAdvanceRepository();const hard=Date.parse(String(db.prepare('SELECT final_deadline_at_utc AS value FROM study_group_exam_runs WHERE id=?').get(runId)?.value));
 const nextMs=Number(db.prepare('SELECT time_limit_seconds AS n FROM study_group_exam_question_public WHERE run_id=? AND position=1').get(runId)?.n)*1000;
 for(const policy of ['reset_to_base','carry_remaining'] as const){for(const left of [1,137,999,37654,880001]){
 const now=new Date(hard-900000+123).toISOString(),deadline=new Date(Date.parse(now)+left).toISOString();db.prepare('UPDATE study_group_exam_run_contract_v2 SET advance_time_policy=? WHERE run_id=?').run(policy,runId);db.prepare('UPDATE study_group_exam_participant_progress SET current_position=0,current_opened_at_utc=?,current_deadline_at_utc=?,revision=0 WHERE run_id=? AND user_key=?').run(new Date(Date.parse(now)-1000).toISOString(),deadline,runId,owner);
 const before=db.prepare('SELECT * FROM study_group_exam_participant_progress WHERE run_id=? AND user_key=?').get(runId,owner) as any;const id=crypto.randomUUID();const output=await repo.advance({runId,userKey:owner,position:0,revision:0,admin:false,now,idempotency:{actorUserKey:owner,action:'question-advance',key:id,requestDigest:id,executionId:id,responseStatus:200,response:{},timestamp:now}});assert.ok(output.response_json);
 const after=db.prepare('SELECT * FROM study_group_exam_participant_progress WHERE run_id=? AND user_key=?').get(runId,owner) as any;const expected=advanceProgress(before,nextMs,Date.parse(now),hard,policy);for(const key of ['current_position','current_opened_at_utc','current_deadline_at_utc','carried_ms'])assert.equal(after[key],(expected as any)[key],`${policy} ${left} ${key}`);
 }}
}));

test('own nickname changes keep exam snapshots intact, reject outsiders and replay once',()=>fixture(async(db,groupId,runId,owner)=>{
 const body={action:'member-name-update',groupId,publicName:'새 닉네임',idempotencyKey:'self-nickname-test'};
 assert.equal((await call('outsider@example.test',body)).status,404);assert.equal((await call('owner@example.test',body)).status,200);const revision=db.prepare('SELECT revision FROM study_groups WHERE id=?').get(groupId)?.revision;assert.equal((await call('owner@example.test',body)).status,200);assert.equal(db.prepare('SELECT revision FROM study_groups WHERE id=?').get(groupId)?.revision,revision);assert.equal(db.prepare('SELECT public_name_snapshot AS name FROM study_group_exam_participants WHERE run_id=? AND user_key=?').get(runId,owner)?.name,'대표');assert.equal(db.prepare('SELECT public_name AS name FROM study_group_members WHERE group_id=? AND user_key=?').get(groupId,owner)?.name,'새 닉네임');assert.equal((await call('owner@example.test',{...body,publicName:'다른 이름'})).status,409);
}));

test('date-filtered history contains only my frozen attempts and exposes scores only after completion',()=>fixture(async(db,groupId,runId,owner)=>{
 db.prepare('UPDATE study_group_exam_runs SET created_at=?,actual_started_at_utc=? WHERE id=?').run('2026-09-29T14:59:58.000Z','2026-09-29T15:00:03.000Z',runId);
 const path=`?scope=history&groupId=${groupId}`;assert.equal((await call('outsider@example.test',path)).status,404);
 const live=await call('owner@example.test',path+'&day=2026-09-30');assert.equal(live.body.records.length,1);assert.equal(live.body.records[0].score,null);assert.doesNotMatch(JSON.stringify(live.body),/user_key|correct_answers|public_name_snapshot/);assert.equal((await call('owner@example.test',path+'&day=2026-09-29')).body.records.length,0);
 db.prepare("UPDATE study_group_exam_runs SET status='completed' WHERE id=?").run(runId);db.prepare('UPDATE study_group_exam_participants SET score=7 WHERE run_id=? AND user_key=?').run(runId,owner);assert.equal((await call('owner@example.test',path)).body.records[0].score,7);
 const invite=await call('owner@example.test',{action:'invite-create',groupId});await call('later@example.test',{action:'invite-accept',token:invite.body.invite.token,publicName:'나중 참가자'});assert.deepEqual((await call('later@example.test',path)).body.records,[]);
 assert.equal((await call('owner@example.test',path+'&day=bad')).status,400);
}));

test('history pagination is stable for tied timestamps and never duplicates attempts',()=>fixture(async(db,groupId,runId,owner)=>{
 const template=db.prepare('SELECT * FROM study_group_exam_runs WHERE id=?').get(runId) as any;
 const columns=Object.keys(template),insert=db.prepare(`INSERT INTO study_group_exam_runs(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`);
 for(let i=0;i<24;i++){const row={...template,id:`synthetic-history-${i.toString().padStart(2,'0')}`,start_request_id:crypto.randomUUID(),status:'completed',actual_started_at_utc:'2026-09-29T00:00:00.000Z',created_at:'2026-09-28T23:59:58.000Z',quota_date_key:`synthetic-${i}`,quota_slot_no:1};insert.run(...columns.map(column=>row[column]));db.prepare("INSERT INTO study_group_exam_participants(run_id,user_key,public_name_snapshot,membership_epoch_snapshot,status,score) VALUES(?,?,?,1,'submitted',?)").run(row.id,owner,'대표',i%15);}
 const path=`?scope=history&groupId=${groupId}&day=2026-09-29`;const first=await call('owner@example.test',path);assert.equal(first.body.records.length,20);assert.ok(first.body.next);
 const params=new URLSearchParams({beforeAt:first.body.next.at,beforeId:first.body.next.id});const second=await call('owner@example.test',path+'&'+params);assert.equal(second.body.records.length,4);assert.equal(second.body.next,null);assert.equal(new Set([...first.body.records,...second.body.records].map((row:{id:string})=>row.id)).size,24);
}));
