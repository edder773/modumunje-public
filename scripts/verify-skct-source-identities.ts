/** Read-only canonical coverage gate. Run against the exact immutable source DB. */
import {DatabaseSync} from "node:sqlite";
import {writeFileSync} from "node:fs";
import {questionIdentity,digest} from "../apps/backend/src/modules/group-exams/domain/group-exam-v2.domain";
import type {ContentQuestionRow} from "../apps/backend/src/modules/group-exams/group-exam.repository";
const path=process.argv.find(x=>x.startsWith("--database="))?.slice(11);
const output=process.argv.find(x=>x.startsWith("--output="))?.slice(9);
if(!path)throw new Error("--database=<immutable local sqlite> is required");
const db=new DatabaseSync(path,{readOnly:true});
try {
 const release=db.prepare("SELECT id,release_sha256,eligible_count,quarantine_count FROM skct_content_releases WHERE status='active'").get();
 if(!release)throw new Error("active release missing");
 const questions=db.prepare("SELECT * FROM skct_question_public WHERE release_id=? AND eligibility='eligible' ORDER BY question_uid").all(String(release.id)) as ContentQuestionRow[];
 const rows=await Promise.all(questions.map(async q=>({uid:q.question_uid,area:q.area_code,dependency:q.dependency_group_id,identity:await questionIdentity(q)})));
 const bundleMembers=new Map<string,string[]>();for(const q of rows)if(q.dependency && q.identity)bundleMembers.set(q.dependency,[...(bundleMembers.get(q.dependency)??[]),q.identity.questionIdentity]);
 const bundles=await Promise.all([...bundleMembers].map(async([dependency,identities])=>({dependency,size:identities.length,bundleIdentity:await digest(["skct-bundle-v1",identities.sort()])})));
 const valid=rows.filter(q=>q.identity),unique=new Set(valid.map(q=>q.identity!.questionIdentity)).size;
 const report={kind:"read-only-source-identity-dry-run",release,identityVersion:1,coverage:valid.length/rows.length,total:rows.length,valid:valid.length,unique,collisions:valid.length-unique,
  areaCounts:Object.fromEntries([...new Set(rows.map(q=>q.area))].sort().map(a=>[a,rows.filter(q=>q.area===a).length])),bundles,
  result:valid.length===rows.length && unique===rows.length && rows.length===Number(release.eligible_count)?"PASS":"STOP",
  identityMaterial:"[skct-source-v1, NFC(contentSet), NFC(area), sorted complete [[NFC(sourceId),NFC(pageBlock)]...], questionNo]",
  provenancePolicy:"Every sourceRef requires valid SHA256; file SHA and jsonPointer are audit provenance, excluded from identity because source-file rebuilds and array positions may change. A new release requires operator re-review; no semantic equality inferred from text or release-local UID.",
  rows:rows.map(q=>({uid:q.uid,identity:q.identity?.questionIdentity,material:q.identity?.material}))};
 if(output)writeFileSync(output,JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify({...report,rows:undefined,bundles:bundles.length},null,2));if(report.result!=="PASS")process.exitCode=1;
}finally{db.close();}
