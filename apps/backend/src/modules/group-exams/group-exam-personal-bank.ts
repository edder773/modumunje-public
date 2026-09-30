import { protectSkctQuestionAssets } from "@backend/modules/private-diagrams/private-diagrams.service";
import { SKCT_MOCK_UNITS } from "@shared/study/skct-personal-exam";
async function digest(value:unknown) {
  const hash=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,"0")).join("");
}
import type { ContentQuestionRow } from "./group-exam-read.repository";
export const PERSONAL_GROUP_SCHEMA = "baeumzip.skct-personal-group.v1";
export const PERSONAL_GROUP_PREFIX = "skct-personal-group-";
const areas = ["언어이해","자료해석","창의수리","언어추리","수열추리"];
type PersonalRelease = { id:string; content_sha256:string; item_count:number };
export async function personalGroupRelease(db:D1Database) {
  const source = await db.prepare("SELECT id,content_sha256,item_count FROM skct_personal_releases WHERE status='ACTIVE' AND item_count=300 LIMIT 1").first<PersonalRelease>();
  if (!source) return null;
  const sha = await digest([PERSONAL_GROUP_SCHEMA,source.id,source.content_sha256]);
  return {id:PERSONAL_GROUP_PREFIX+sha.slice(0,24),status:"active",schema_version:PERSONAL_GROUP_SCHEMA,
    release_sha256:sha,normalized_count:300,eligible_count:300,manifest_json:JSON.stringify({origin:"personal-db",
      personalReleaseId:source.id,personalContentSha256:source.content_sha256})};
}
export function isPersonalGroupRelease(release:Record<string,unknown> | null) {
  return Boolean(release && String(release.id).startsWith(PERSONAL_GROUP_PREFIX) && release.schema_version === PERSONAL_GROUP_SCHEMA
    && release.status === "active" && /^[a-f0-9]{64}$/u.test(String(release.release_sha256)));
}
function parse(text:unknown,fallback:unknown) { try {return JSON.parse(String(text));} catch {return fallback;} }
export async function personalGroupQuestions(db:D1Database,releaseId:string):Promise<ContentQuestionRow[]> {
  const release = await personalGroupRelease(db);
  if (!release || release.id !== releaseId) return [];
  const source = JSON.parse(release.manifest_json) as {personalReleaseId:string;personalContentSha256:string};
  const result = await db.prepare(`SELECT p.*,s.answer_index,s.explanation,s.secret_sha256
    FROM skct_personal_public_items p JOIN skct_personal_secret_items s
      ON s.release_id=p.release_id AND s.source_item_id=p.source_item_id WHERE p.release_id=?
    ORDER BY p.unit_id,p.source_batch,p.source_ordinal`).bind(source.personalReleaseId).all<Record<string,unknown>>();
  const bank = (result.results ?? []).map(row => {
    const q = protectSkctQuestionAssets(JSON.parse(String(row.public_json))) as Record<string,unknown>;
    const conditions = Array.isArray(q.conditions) ? q.conditions.join("\n\n") : "";
    const judgments = parse(JSON.stringify(q.judgmentItems),[]);
    const judgmentText = Array.isArray(judgments) ? judgments.map(item=>`${item.label ?? ""} ${item.text ?? ""}`).join("\n\n")
      : judgments && typeof judgments === "object" ? Object.entries(judgments).map(([label,value])=>`${label} ${value}`).join("\n\n") : "";
    const prompt = [q.question,q.passage,q.stimulus,q.insertionSentence ? `삽입 문장: ${q.insertionSentence}` : "",conditions,judgmentText]
      .filter(Boolean).join("\n\n").replace(/!\[[^\]]*\]\(assets\/[^)]*\.svg\)/gu,"").trim();
    const refs = {sourceRefs:[{sourceId:`personal:${row.source_archive_sha256}:${row.source_file}`,sourceSha256:row.source_file_sha256,pageBlock:row.source_item_id}]};
    return {release_id:releaseId,question_uid:String(row.source_item_id),content_set:`personal:${row.source_batch}`,
      area_code:areas[SKCT_MOCK_UNITS.indexOf(String(row.unit_id) as typeof SKCT_MOCK_UNITS[number])],question_no:Number(row.source_ordinal),
      prompt_md:prompt,choices_json:JSON.stringify(q.displayChoices),dependency_group_id:null,
      asset_refs_json:JSON.stringify((Array.isArray(q.assetUrls) ? q.assetUrls : []).map((url,index)=>({url,
        alt:Array.isArray(q.assetDescriptions) ? q.assetDescriptions[index] : undefined}))),
      question_source_refs_json:JSON.stringify(refs),question_hash:String(row.public_sha256),
      correct_answers_json:JSON.stringify([Number(row.answer_index)-1]),explanation_md:String(row.explanation),secret_hash:String(row.secret_sha256)};
  });
  if (bank.length !== 300 || new Set(bank.map(q=>q.question_uid)).size !== 300 || areas.some(area=>bank.filter(q=>q.area_code===area).length!==60)) return [];
  // Preserve immutable group snapshots and identity FKs without a separate source bank.
  // The mirror is derived only from the active personal DB release, never from archives.
  const existing = await db.prepare("SELECT COUNT(*) AS n FROM skct_question_public WHERE release_id=?").bind(releaseId).first<{n:number}>();
  if (existing?.n !== 300) {
    await db.prepare(`INSERT OR IGNORE INTO skct_content_releases(id,status,dataset,schema_version,completed_folder_id,
      json_file_id,json_sha256,md_file_id,md_sha256,manifest_json,normalized_count,eligible_count,release_sha256)
      VALUES(?,'validated','개인학습 DB 연결',?,'personal-db','personal-db',?,'personal-db',?,?,300,300,?)`)
      .bind(releaseId,PERSONAL_GROUP_SCHEMA,source.personalContentSha256,source.personalContentSha256,release.manifest_json,release.release_sha256).run();
    for (let offset=0;offset<bank.length;offset+=25) {
      const data=JSON.stringify(bank.slice(offset,offset+25));
      await db.batch([
        db.prepare(`INSERT OR IGNORE INTO skct_question_public(release_id,question_uid,content_set,area_code,question_no,
          prompt_md,choices_json,dependency_group_id,asset_refs_json,question_source_refs_json,question_hash,eligibility)
          SELECT json_extract(value,'$.release_id'),json_extract(value,'$.question_uid'),json_extract(value,'$.content_set'),
            json_extract(value,'$.area_code'),json_extract(value,'$.question_no'),json_extract(value,'$.prompt_md'),
            json_extract(value,'$.choices_json'),NULL,json_extract(value,'$.asset_refs_json'),
            json_extract(value,'$.question_source_refs_json'),json_extract(value,'$.question_hash'),'eligible' FROM json_each(?)`).bind(data),
        db.prepare(`INSERT OR IGNORE INTO skct_question_secret(release_id,question_uid,correct_answers_json,explanation_md,secret_hash)
          SELECT json_extract(value,'$.release_id'),json_extract(value,'$.question_uid'),json_extract(value,'$.correct_answers_json'),
            json_extract(value,'$.explanation_md'),json_extract(value,'$.secret_hash') FROM json_each(?)`).bind(data),
      ]);
    }
  }
  await db.prepare(`UPDATE skct_content_releases SET status='active' WHERE id=?
      AND (SELECT COUNT(*) FROM skct_question_public WHERE release_id=?)=300
      AND (SELECT COUNT(*) FROM skct_question_secret WHERE release_id=?)=300`).bind(releaseId,releaseId,releaseId).run();
  return bank;
}
