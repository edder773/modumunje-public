import type { DatabaseSync } from "node:sqlite";
export function seedSyntheticPersonalBank(db:DatabaseSync){
  db.prepare("INSERT INTO skct_personal_releases(id,status,content_sha256,item_count) VALUES('personal-synthetic','ACTIVE',?,300)").run("a".repeat(64));
  const pub=db.prepare(`INSERT INTO skct_personal_public_items(release_id,source_item_id,unit_id,source_batch,source_archive_sha256,
    source_file,source_file_sha256,source_ordinal,source_schema_version,public_json,public_sha256,asset_refs_json)
    VALUES('personal-synthetic',?,?,'B01',?,'synthetic.json',?,?,'1.0',?,?,'[]')`);
  const sec=db.prepare(`INSERT INTO skct_personal_secret_items(release_id,source_item_id,answer_index,raw_answer_json,explanation,
    distractor_explanations_json,source_raw_json,normalization_version,secret_sha256)
    VALUES('personal-synthetic',?,2,'"②"','SYNTHETIC_PRIVATE_EXPLANATION','{}','{}','synthetic',?)`);
  for(const unit of ['U01','U02','U03','U04','U05'])for(let n=1;n<=60;n++){
    const id=`${unit}_TOY_${n}`;
    pub.run(id,unit,'b'.repeat(64),'c'.repeat(64),n,JSON.stringify({sourceItemId:id,unitId:unit,
      question:`개인학습 검증 문항 ${id}`,passage:'검증용으로 생성한 지문입니다. 운영 콘텐츠와 무관합니다.',
      displayChoices:['① 첫 번째 보기','② 정답 검증용 보기','③ 세 번째 보기','④ 네 번째 보기','⑤ 다섯 번째 보기'],assetUrls:[]}), 'd'.repeat(64));
    sec.run(id,'e'.repeat(64));
  }
}
