/* eslint-disable @typescript-eslint/no-explicit-any -- synthetic JSON payloads are checked by concrete field and behavior assertions. */
import assert from 'node:assert/strict';
import test from 'node:test';
import type {SQLInputValue} from 'node:sqlite';
import {openSkctTestDatabase as openCanonicalTestDatabase} from './helpers/skct-test-database.mjs';
import {sqliteD1} from './helpers/sqlite-d1.mjs';
import {seedSyntheticPersonalBank} from './helpers/synthetic-personal-bank';
import {GET,POST} from '../apps/backend/src/modules/group-exams/group-exam.service';
import {personalGroupRelease,personalGroupQuestions} from '../apps/backend/src/modules/group-exams/group-exam-personal-bank';
import {v2Repository} from '../apps/backend/src/modules/group-exams/group-exam-v2.service';
const email='personal-group@example.test';let counter=0;
async function call(body:Record<string,unknown>|string){const method=typeof body==='string'?'GET':'POST';const r=new Request('https://example.test/api/group-exams'+(typeof body==='string'?body:''),{method,headers:{origin:'https://example.test','content-type':'application/json','x-sql-study-user-request':'1','x-baeumzip-authenticated-user-email':email},...(method==='POST'?{body:JSON.stringify({idempotencyKey:`personal-group-${++counter}`,...body as Record<string,unknown>})}:{})});const response=await (method==='GET'?GET(r):POST(r));return {status:response.status,body:await response.json() as any};}
test('group exams select from the active personal DB and seal correctly indexed answers',async()=>{
 const db=openCanonicalTestDatabase(process.cwd());const previous=globalThis.__BAEUMZIP_ENV__;
 globalThis.__BAEUMZIP_ENV__={DB:sqliteD1(db) as unknown as D1Database,SKCT_GROUP_SERVICE_ENABLED:'1',SKCT_GROUP_V2_ENABLED:'1',SKCT_GROUP_REPEAT_IDENTITY_VERIFIED:'1'};
 try{
  seedSyntheticPersonalBank(db);
  const release=await personalGroupRelease(globalThis.__BAEUMZIP_ENV__.DB!);assert.ok(release);
  const bank=await personalGroupQuestions(globalThis.__BAEUMZIP_ENV__.DB!,release.id);assert.equal(bank.length,300);
  assert.deepEqual(JSON.parse(bank[0].correct_answers_json),[1]);
  const created=await call({action:'group-create',name:'개인 DB 검증 그룹',publicName:'대표'});assert.equal(created.status,201,JSON.stringify(created));
  const groupId=created.body.group.id;db.prepare('UPDATE study_groups SET admin_question_count_override=50 WHERE id=?').run(groupId);
  const started=await call({action:'run-start',mode:'immediate',groupId});assert.equal(started.status,201,JSON.stringify(started));
  const runId=started.body.run.id;const run=(await v2Repository.runById(runId))!;assert.equal(run.source_release_id,release.id);
  const questions=await v2Repository.questionsForRun(runId);assert.equal(questions.length,50);
  assert.ok(questions.every(q=>q.prompt_snapshot.includes('개인학습 검증 문항')));
  assert.deepEqual(['언어이해','자료해석','창의수리','언어추리','수열추리'].map(area=>questions.filter(q=>q.area_code_snapshot===area).length),[10,10,10,10,10]);
  const publicState=await call(`?scope=current&runId=${runId}`);assert.equal(publicState.status,200);
  assert.doesNotMatch(JSON.stringify(publicState.body),/SYNTHETIC_PRIVATE_EXPLANATION|correct_answers|secret_hash/);
  db.prepare("UPDATE skct_personal_releases SET status='RETIRED' WHERE id='personal-synthetic'").run();
  const guard=v2Repository.startGuard(run);assert.equal(db.prepare(`SELECT ${guard.sql} AS allowed`).get(...guard.values as SQLInputValue[])?.allowed,0);
  assert.equal((await v2Repository.questionsForRun(runId))[0].prompt_snapshot,questions[0].prompt_snapshot);
 }finally{db.close();globalThis.__BAEUMZIP_ENV__=previous;}
});
