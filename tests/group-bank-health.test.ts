import assert from 'node:assert/strict';
import test from 'node:test';
import {openSkctTestDatabase} from './helpers/skct-test-database.mjs';
import {sqliteD1} from './helpers/sqlite-d1.mjs';
import {seedSyntheticPersonalBank} from './helpers/synthetic-personal-bank';
import {HealthRepository} from '../apps/backend/src/modules/health/health.repository';
import {personalGroupRelease,personalGroupQuestions} from '../apps/backend/src/modules/group-exams/group-exam-personal-bank';
async function fixture(work:(db:ReturnType<typeof openSkctTestDatabase>,repo:HealthRepository)=>Promise<void>){
 const db=openSkctTestDatabase(process.cwd()),previous=globalThis.__BAEUMZIP_ENV__;
 globalThis.__BAEUMZIP_ENV__={DB:sqliteD1(db) as unknown as D1Database};
 try{seedSyntheticPersonalBank(db);await work(db,new HealthRepository());}finally{db.close();globalThis.__BAEUMZIP_ENV__=previous;}
}
test('health follows the personal bank while retained legacy release mirrors remain active',()=>fixture(async(db,repo)=>{
 const release=(await personalGroupRelease(globalThis.__BAEUMZIP_ENV__!.DB!))!;
 await personalGroupQuestions(globalThis.__BAEUMZIP_ENV__!.DB!,release.id);
 db.prepare(`INSERT INTO skct_content_releases(id,status,dataset,schema_version,completed_folder_id,json_file_id,json_sha256,md_file_id,md_sha256,release_sha256,manifest_json,normalized_count,eligible_count,quarantine_count)
   SELECT 'synthetic-legacy-active',status,dataset,schema_version,completed_folder_id,json_file_id,json_sha256,md_file_id,md_sha256,?,manifest_json,normalized_count,eligible_count,quarantine_count FROM skct_content_releases WHERE id=?`).run("f".repeat(64),release.id);
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM skct_content_releases WHERE status='active'").get()?.n,2);
 const ready=await repo.readGroupExamReadiness();assert.equal(ready.ready,true);assert.equal(ready.releaseId,'personal-synthetic');assert.equal(ready.selectableCount,300);
}));
test('health still rejects a missing personal answer',()=>fixture(async(db,repo)=>{
 assert.equal((await repo.readGroupExamReadiness()).ready,true);
 // Simulate damaged input in this isolated synthetic SQLite fixture only.
 db.exec('DROP TRIGGER skct_personal_secret_immutable_delete');
 db.prepare("DELETE FROM skct_personal_secret_items WHERE source_item_id='U01_TOY_1'").run();assert.equal((await repo.readGroupExamReadiness()).ready,false);
}));
test('health rejects an unbalanced personal bank even when all 300 answers exist',()=>fixture(async(db,repo)=>{
 db.exec('DROP TRIGGER skct_personal_public_immutable_update');
 db.prepare("UPDATE skct_personal_public_items SET unit_id='U02' WHERE source_item_id='U01_TOY_2'").run();
 const ready=await repo.readGroupExamReadiness();assert.equal(ready.selectableCount,300);assert.equal(ready.ready,false);
}));
