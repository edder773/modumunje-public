/** Reproducible local SQLite/API measurement. No production latency claim. */
import { writeFileSync } from "node:fs";
import { openCanonicalDatabase } from "./lib/canonical-database.mjs";
import { sqliteD1 } from "../tests/helpers/sqlite-d1.mjs";
import { GET, POST } from "../apps/backend/src/modules/group-exams/group-exam.service";
import { learnerUserHash } from "../apps/backend/src/common/auth/admin-auth";

const optimized=process.argv.includes("--optimized");
const output=process.argv.find(x=>x.startsWith("--output="))?.slice(9);
const profiles=[];
for(const participants of [1,10,50]) {
 const db=openCanonicalDatabase(process.cwd());globalThis.__BAEUMZIP_ENV__={DB:sqliteD1(db) as unknown as D1Database,SKCT_GROUP_SERVICE_ENABLED:"1"};
 const email="measurement@example.test",origin="https://example.test",stamp=new Date().toISOString();
 const r=await POST(new Request(origin+"/api/group-exams",{method:"POST",headers:{origin,"content-type":"application/json","x-sql-study-user-request":"1","x-baeumzip-authenticated-user-email":email},body:JSON.stringify({action:"group-create",name:"합성 성능 그룹",publicName:"합성 대표",idempotencyKey:"measurement-create"})}));
 const body=await r.json() as {group:{id:string}};const groupId=body.group.id;const userKey=await learnerUserHash(email);
 db.prepare(`INSERT INTO skct_content_releases(id,status,dataset,schema_version,completed_folder_id,json_file_id,json_sha256,md_file_id,md_sha256,license_note,manifest_json,normalized_count,eligible_count,quarantine_count,release_sha256)
 VALUES('measure','active','synthetic','test','folder','json',?,'md',?,'','{}',1,1,0,?)`).run("a".repeat(64),"b".repeat(64),"c".repeat(64));
 db.prepare(`INSERT INTO study_group_exam_runs(id,group_id,start_request_id,mode,status,actual_started_at_utc,quota_date_key,quota_slot_no,question_count_snapshot,settings_snapshot_json,source_release_id,source_release_sha256,participant_count_snapshot,final_deadline_at_utc,created_by_user_key)
 VALUES('measure-run',?,'measure-start','immediate','running',?,'2026-09-21',1,1,'{}','measure',?,?,?,?)`).run(groupId,stamp,"c".repeat(64),participants,new Date(Date.now()+3_600_000).toISOString(),userKey);
 db.prepare("INSERT INTO study_group_active_runs VALUES(?,'measure-run',?)").run(groupId,stamp);
 db.prepare(`INSERT INTO study_group_exam_question_public(run_id,position,source_question_uid,area_code_snapshot,prompt_snapshot,choices_snapshot_json,asset_refs_snapshot_json,time_limit_seconds,opens_at_utc,deadline_at_utc,snapshot_hash)
 VALUES('measure-run',0,'q1','언어이해','합성 지문','["A","B"]','[]',3600,?,?,'hash')`).run(stamp,new Date(Date.now()+3_600_000).toISOString());
 for(let i=0;i<participants;i++) {
  const key=i===0?userKey:`synthetic-${i}`;
  if(i) db.prepare("INSERT INTO study_group_members(group_id,user_key,public_id,public_name,status) VALUES(?,?,?,?,'active')").run(groupId,key,key,"합성 참가자");
  db.prepare("INSERT INTO study_group_exam_participants(run_id,user_key,public_name_snapshot,membership_epoch_snapshot,status) VALUES('measure-run',?,'합성 참가자',1,'rostered')").run(key);
 }
 const samples:number[]=[],ops:number[]=[],bytes:number[]=[];
 for(let i=0;i<110;i++) {
  const started=performance.now();let operations=0,payloadBytes=0;
  for(const scope of optimized?["sync"]:["sync","groups","current"]) {
    const response=await GET(new Request(`${origin}/api/group-exams?scope=${scope}&groupId=${groupId}`,{headers:{"x-baeumzip-authenticated-user-email":email}}));
    if(response.status!==200) throw new Error(`measurement ${scope}: ${response.status}`);
    operations+=Number(response.headers.get("X-Group-DB-Ops"));payloadBytes+=Number(response.headers.get("X-Group-Payload-Bytes"));await response.arrayBuffer();
  }
  if(i>=10){samples.push(performance.now()-started);ops.push(operations);bytes.push(payloadBytes);}
 }
 samples.sort((a,b)=>a-b);const percentile=(p:number)=>Number(samples[Math.ceil(samples.length*p)-1].toFixed(3));
 profiles.push({participants,phase:"running",visibility:"visible",n:samples.length,p50Ms:percentile(.5),p95Ms:percentile(.95),p99Ms:percentile(.99),meanD1Ops:ops.reduce((a,b)=>a+b)/ops.length,meanPayloadBytes:bytes.reduce((a,b)=>a+b)/bytes.length});db.close();
}
const report={environment:"local Node SQLite, synthetic API requests; no network/browser/Cloudflare latency",optimized,profiles,limitations:["p99 is diagnostic for n=100, not a production percentile","local D1 adapter has no rows_read/duration metadata","10 groups x 50 concurrent clients, hidden tabs, backlogs, production load remain deployment gates"]};
if(output)writeFileSync(output,JSON.stringify(report,null,2));else process.stdout.write(JSON.stringify(report,null,2));
