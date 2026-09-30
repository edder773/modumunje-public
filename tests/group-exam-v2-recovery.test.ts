import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync,readdirSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import test from "node:test";
import {openCanonicalTestDatabase} from "./helpers/canonical-database.mjs";
import {sqliteD1} from "./helpers/sqlite-d1.mjs";

import {GROUP_OWNER_SLOT_RECOVERY_SQL} from "../packages/shared/src/admin/group-owner-slot-recovery.mjs";

function insertGroups(db:DatabaseSync,count:number,prefix="old") {
 for(let i=0;i<count;i++) db.prepare("INSERT INTO study_groups(id,name,owner_user_key,member_limit,settings_json,status) VALUES(?,?,'owner',50,'{}','active')").run(`${prefix}-${i}`,`그룹 ${i}`);
}
test("0560 preflight rolls back >3 owners; backfill has exactly one slot per active group",()=>{
 const db=new DatabaseSync(":memory:");try {
 for(const name of readdirSync("apps/backend/drizzle").filter(n=>n.endsWith(".sql") && n<"0560").sort())db.exec(readFileSync(`apps/backend/drizzle/${name}`,"utf8"));
 insertGroups(db,4);const sql=readFileSync("apps/backend/drizzle/0560_skct_personal_progress.sql","utf8");
 db.exec("BEGIN");assert.throws(()=>db.exec(sql),/CHECK constraint/u);db.exec("ROLLBACK");assert.equal(db.prepare("SELECT migration_version FROM app_schema_state").get()?.migration_version,"0559");
 assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='study_group_owner_slots'").get()?.n,0);
 db.prepare("UPDATE study_groups SET status='archived' WHERE id='old-3'").run();db.exec("BEGIN");db.exec(sql);db.exec("COMMIT");
 assert.equal(db.prepare("SELECT COUNT(*) n FROM study_group_owner_slots").get()?.n,3);assert.equal(db.prepare("SELECT COUNT(*) n FROM study_groups g LEFT JOIN study_group_owner_slots s ON s.group_id=g.id WHERE g.status='active' AND s.group_id IS NULL").get()?.n,0);
 assert.match(JSON.stringify(db.prepare("EXPLAIN QUERY PLAN SELECT * FROM study_group_exam_participant_progress WHERE run_id=? AND finished_at_utc IS NULL AND current_deadline_at_utc<=?").all("r","now")),/study_group_progress_due_idx/u);
 }finally{db.close();}
});
test("admin-6 restore derives owner slots atomically; over-cap restore changes zero domain rows; admin-7 keeps slots",async()=>{
 Object.assign(globalThis,{__BAEUMZIP_APP_VERSION__:"test"});
 const {restoreBackup,validateBackupEnvelope}=await import("../apps/backend/src/modules/admin/admin-backup-use-cases");
 const db=openCanonicalTestDatabase(process.cwd());const previous=globalThis.__BAEUMZIP_ENV__;globalThis.__BAEUMZIP_ENV__={DB:sqliteD1(db) as unknown as D1Database};try {
 insertGroups(db,3);const groups=db.prepare("SELECT * FROM study_groups").all().map((r:Record<string,unknown>)=>({...r}));db.exec("DELETE FROM study_groups");
 const envelope=async(rows:typeof groups)=>{const data={study_groups:rows};const metadata={backupVersion:"1",schemaVersion:"admin-6",appVersion:"test",type:"full",source:"manual",generatedAt:new Date().toISOString(),includedData:["study_groups"],counts:{study_groups:rows.length}};return validateBackupEnvelope({metadata:{...metadata,checksum:createHash("sha256").update(JSON.stringify({metadata,data})).digest("hex")},data});};
 await restoreBackup({email:"admin@example.test",hash:"test"},await envelope(groups),"merge","",{skipSafetyBackup:true});
 assert.equal(db.prepare("SELECT COUNT(*) n FROM study_group_owner_slots").get()?.n,3);
 const before=db.prepare("SELECT * FROM study_groups ORDER BY id").all();const slots=db.prepare("SELECT * FROM study_group_owner_slots ORDER BY group_id").all();
 await assert.rejects(restoreBackup({email:"admin@example.test",hash:"test"},await envelope([...groups,{...groups[0],id:"fourth"}]),"merge","",{skipSafetyBackup:true}),/NOT NULL|study_group_owner_slots/u);
 assert.deepEqual(db.prepare("SELECT * FROM study_groups ORDER BY id").all(),before);assert.deepEqual(db.prepare("SELECT * FROM study_group_owner_slots ORDER BY group_id").all(),slots);
 db.exec("BEGIN");for(const sql of GROUP_OWNER_SLOT_RECOVERY_SQL)db.exec(sql);db.exec("COMMIT");assert.deepEqual(db.prepare("SELECT * FROM study_group_owner_slots ORDER BY group_id").all(),slots);
 }finally{globalThis.__BAEUMZIP_ENV__=previous;db.close();}
});
