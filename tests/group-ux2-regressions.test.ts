/* eslint-disable @typescript-eslint/no-explicit-any -- synthetic API contracts use concrete assertions. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {openSkctTestDatabase} from './helpers/skct-test-database.mjs';
import {sqliteD1} from './helpers/sqlite-d1.mjs';
import {seedSyntheticPersonalBank} from './helpers/synthetic-personal-bank';
import {GET,POST} from '../apps/backend/src/modules/group-exams/group-exam.service';
import {learnerUserHash} from '../apps/backend/src/common/auth/admin-auth';
import {splitGroupQuestionPrompt} from '../apps/frontend/src/features/group-exams/group-exam-question-parts';
async function call(email:string,body:Record<string,unknown>|string){const read=typeof body==='string';const r=await(read?GET:POST)(new Request('https://example.test/api/group-exams'+(read?body:''),{method:read?'GET':'POST',headers:{origin:'https://example.test','content-type':'application/json','x-sql-study-user-request':'1','x-baeumzip-authenticated-user-email':email},...(!read?{body:JSON.stringify({idempotencyKey:crypto.randomUUID(),...body as Record<string,unknown>})}:{})}));return {status:r.status,body:await r.json() as any};}
async function fixture(work:(db:ReturnType<typeof openSkctTestDatabase>,groupId:string,runId:string)=>Promise<void>){const db=openSkctTestDatabase(process.cwd()),before=globalThis.__BAEUMZIP_ENV__;globalThis.__BAEUMZIP_ENV__={DB:sqliteD1(db) as unknown as D1Database,SKCT_GROUP_SERVICE_ENABLED:'1',SKCT_GROUP_V2_ENABLED:'1',SKCT_GROUP_REPEAT_IDENTITY_VERIFIED:'1'};try{seedSyntheticPersonalBank(db);const group=await call('owner@example.test',{action:'group-create',name:'화면 검증',publicName:'대표'});const groupId=group.body.group.id;const invite=await call('owner@example.test',{action:'invite-create',groupId});await call('peer@example.test',{action:'invite-accept',token:invite.body.invite.token,publicName:'참가자'});const start=await call('owner@example.test',{action:'run-start',groupId,mode:'immediate'});assert.equal(start.status,201);const runId=start.body.run.id;const now=Date.now();db.prepare('UPDATE study_group_exam_runs SET actual_started_at_utc=?,final_deadline_at_utc=? WHERE id=?').run(new Date(now-1000).toISOString(),new Date(now+900000).toISOString(),runId);db.prepare('UPDATE study_group_exam_participant_progress SET current_opened_at_utc=?,current_deadline_at_utc=? WHERE run_id=?').run(new Date(now-1000).toISOString(),new Date(now+40000).toISOString(),runId);await work(db,groupId,runId);}finally{db.close();globalThis.__BAEUMZIP_ENV__=before;}}

test('separates instructions from introductory sentences and preserves ranges, conditions, tables and explicit sections',()=>{
 assert.deepEqual(splitGroupQuestionPrompt('A~E는 각각 1~5의 순서이다. 다음 조건을 모두 만족할 때 반드시 참인 것은?\n\nA는 B보다 앞선다.\nC는 D보다 앞선다.'),{stimulus:'A~E는 각각 1~5의 순서이다.\n\nA는 B보다 앞선다.\nC는 D보다 앞선다.',instruction:'다음 조건을 모두 만족할 때 반드시 참인 것은?'});
 assert.deepEqual(splitGroupQuestionPrompt('## 자료\n| 항목 | 값 |\n|---|---|\n| A | 1~5 |\n\n## 문제\n윗글에서 적절한 것은?'),{stimulus:'| 항목 | 값 |\n|---|---|\n| A | 1~5 |',instruction:'윗글에서 적절한 것은?'});
 assert.deepEqual(splitGroupQuestionPrompt('## 질문\n옳은 것을 고르시오.\n## 조건\nA~E의 순서는 1~5이다.'),{stimulus:'A~E의 순서는 1~5이다.',instruction:'옳은 것을 고르시오.'});
 assert.equal(splitGroupQuestionPrompt('문장 속 물음표? 뒤의 자료는 지문에 속한다.').instruction,'');
});

test('commits a guarded non-terminal advance in one D1 round trip and preserves authorization, CAS and idempotency',()=>fixture(async(db,_groupId,runId)=>{
 const raw=sqliteD1(db);let active=0,maximum=0;const spans:Array<{start:number;end:number}>=[];
 async function trip<T>(work:()=>Promise<T>):Promise<T>{const span={start:performance.now(),end:0};spans.push(span);active++;maximum=Math.max(maximum,active);await new Promise(r=>setTimeout(r,100));try{return await work();}finally{span.end=performance.now();active--;}}
 const delayed={prepare(sql:string){const statement=raw.prepare(sql);const wrap:any={bind(...values:any[]){statement.bind(...values);return wrap;},all:()=>trip(()=>statement.all()),run:()=>trip(()=>statement.run()),first:(column?:string)=>trip(()=>statement.first(column)),raw:()=>trip(()=>statement.raw()),_statement:statement};return wrap;},batch:(statements:any[])=>trip(()=>raw.batch(statements.map(s=>s._statement)))};
 globalThis.__BAEUMZIP_ENV__!.DB=delayed as unknown as D1Database;
 const advance={action:'question-advance',runId,position:0,answers:[1],expectedAnswerRevision:0,expectedProgressRevision:0,idempotencyKey:'overlap-advance-test'};
 const began=performance.now();const result=await call('owner@example.test',advance);const elapsedMs=performance.now()-began;
 assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.body.position,1);assert.equal(maximum,1);assert.equal(spans.length,1);assert.ok(elapsedMs<180);assert.doesNotMatch(JSON.stringify(result.body),/correct_answers|SYNTHETIC_PRIVATE_EXPLANATION/);
 console.log(JSON.stringify({case:'100ms_per_D1_trip',elapsedMs,serialD1Ms:spans.reduce((sum,s)=>sum+s.end-s.start,0),D1RoundTrips:spans.length}));
 assert.deepEqual((await call('owner@example.test',advance)).body,result.body);
 assert.equal((await call('owner@example.test',{...advance,idempotencyKey:'stale-progress-test'})).status,409);
 const owner=await learnerUserHash('owner@example.test');const progressBefore=db.prepare('SELECT * FROM study_group_exam_participant_progress WHERE run_id=? AND user_key=?').get(runId,owner);
 db.prepare("UPDATE user_accounts SET status='blocked' WHERE user_key=?").run(owner);const denied=await call('owner@example.test',{...advance,position:1,expectedProgressRevision:1,idempotencyKey:'blocked-progress-test'});assert.equal(denied.status,403);assert.equal(denied.body.publicQuestionWindow,undefined);assert.deepEqual(db.prepare('SELECT * FROM study_group_exam_participant_progress WHERE run_id=? AND user_key=?').get(runId,owner),progressBefore);
 db.prepare("UPDATE user_accounts SET status='active' WHERE user_key=?").run(owner);db.prepare("INSERT INTO site_settings(key,value,value_type,updated_by_hash,updated_at) VALUES('maintenance_mode','true','boolean','test',CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value='true'").run();assert.equal((await call('owner@example.test',{...advance,position:1,expectedProgressRevision:1,idempotencyKey:'maintenance-progress-test'})).status,503);assert.deepEqual(db.prepare('SELECT * FROM study_group_exam_participant_progress WHERE run_id=? AND user_key=?').get(runId,owner),progressBefore);
}));

test('completed results expose only aggregate per-question accuracy to current participating members',()=>fixture(async(db,groupId,runId)=>{
 assert.equal((await call('owner@example.test',`?scope=result&runId=${runId}`)).status,404);
 const owner=await learnerUserHash('owner@example.test'),peer=await learnerUserHash('peer@example.test');const now=new Date().toISOString();
 for(const [user,position,answer] of [[owner,0,'[1]'],[peer,0,'[0]'],[owner,1,'[1]']] as const)db.prepare('INSERT INTO study_group_exam_answers(run_id,user_key,position,answer_json,revision,last_client_operation_id,server_received_at_utc,updated_at) VALUES(?,?,?,?,1,?,?,?)').run(runId,user,position,answer,crypto.randomUUID(),now,now);
 db.prepare("UPDATE study_group_exam_runs SET status='completed',completed_at=? WHERE id=?").run(now,runId);db.prepare("UPDATE study_group_exam_participants SET status='submitted' WHERE run_id=?").run(runId);db.prepare("UPDATE study_group_exam_participant_progress SET terminal_status='submitted',finished_at_utc=? WHERE run_id=?").run(now,runId);
 const result=await call('owner@example.test',`?scope=result&runId=${runId}`);assert.equal(result.status,200);assert.deepEqual(result.body.questionStats.slice(0,2),[{position:0,participantCount:2,correctCount:1,unansweredCount:0},{position:1,participantCount:2,correctCount:1,unansweredCount:1}]);assert.doesNotMatch(JSON.stringify(result.body.questionStats),/user_key|answer_json|participant_id/);
 assert.equal((await call('outsider@example.test',`?scope=result&runId=${runId}`)).status,404);
 db.prepare("UPDATE study_group_members SET status='left' WHERE group_id=? AND user_key=?").run(groupId,owner);const former=await call('owner@example.test',`?scope=result&runId=${runId}`);assert.equal(former.status,200);assert.deepEqual(former.body.questionStats,[]);assert.equal(former.body.orderedResults.length,1);assert.equal(former.body.orderedResults[0].self,true);
}));
