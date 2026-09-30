import {GroupExamRepository,type MutationIdempotency} from "./group-exam.repository";
// This foreground path handles only a live, non-terminal v2 advance. Every
// authorization and timer/CAS guard is evaluated in the same atomic D1 batch.
// A miss delegates to the existing terminal/recovery path without any writes.
export class GroupExamAdvanceRepository extends GroupExamRepository {
 async advance(input:{runId:string;userKey:string;position:number;revision:number;answers?:number[];answerRevision?:number;admin:boolean;now:string;idempotency:MutationIdempotency;answerHash?:string}){
  const db=this.connection(),{runId,userKey,now,idempotency}=input,execution=idempotency.executionId;
  const epoch=(column:string)=>`CAST(ROUND((julianday(${column})-2440587.5)*86400000) AS INTEGER)`;
  const base=`(SELECT time_limit_seconds*1000 FROM study_group_exam_question_public WHERE run_id=p.run_id AND position=p.current_position+1)`;
  const hard=`(SELECT final_deadline_at_utc FROM study_group_exam_runs WHERE id=p.run_id)`;
  const carry=`CASE WHEN (SELECT advance_time_policy FROM study_group_exam_run_contract_v2 WHERE run_id=p.run_id)='carry_remaining' THEN ${epoch('p.current_deadline_at_utc')}-${epoch('?')} ELSE 0 END`;
  const deadline=`MIN(${epoch(hard)},${epoch('?')}+${base}+${carry})`;
  const guard="EXISTS(SELECT 1 FROM study_group_exam_participant_progress WHERE run_id=? AND user_key=? AND last_mutation_execution_id=?) AND NOT EXISTS(SELECT 1 FROM study_group_idempotency WHERE actor_user_key=? AND action=? AND idempotency_key=?)";
  const guardArgs=[runId,userKey,execution,userKey,idempotency.action,idempotency.key];
  const authorized=`EXISTS(SELECT 1 FROM user_accounts WHERE user_key=? AND status='active')
    AND (?=1 OR NOT EXISTS(SELECT 1 FROM site_settings WHERE key='maintenance_mode' AND value='true'))`;
  const statements=[db.prepare(`UPDATE study_group_exam_participant_progress AS p SET
    current_position=current_position+1,current_opened_at_utc=?,
    current_deadline_at_utc=strftime('%Y-%m-%dT%H:%M:%fZ',(${deadline})/1000.0,'unixepoch'),
    carried_ms=MAX(0,${deadline}-${epoch('?')}-${base}),
    connected_at_utc=COALESCE(connected_at_utc,?),revision=revision+1,last_mutation_execution_id=?
    WHERE run_id=? AND user_key=? AND revision=? AND current_position=? AND finished_at_utc IS NULL
      AND current_opened_at_utc<=? AND current_deadline_at_utc>?
      AND ${authorized}
      AND EXISTS(SELECT 1 FROM study_group_exam_runs r JOIN study_group_exam_run_contract_v2 c ON c.run_id=r.id
        WHERE r.id=p.run_id AND r.status='running' AND r.final_deadline_at_utc>?
          AND COALESCE(json_extract(c.selection_json,'$.countdownStatus'),'')<>'preparing')
      AND EXISTS(SELECT 1 FROM study_group_exam_participants frozen WHERE frozen.run_id=p.run_id AND frozen.user_key=p.user_key)
      AND EXISTS(SELECT 1 FROM study_group_exam_question_public WHERE run_id=p.run_id AND position=p.current_position+1)
      AND (? IS NULL OR COALESCE((SELECT revision FROM study_group_exam_answers WHERE run_id=p.run_id AND user_key=p.user_key AND position=p.current_position),0)=?)
      AND NOT EXISTS(SELECT 1 FROM study_group_idempotency WHERE actor_user_key=? AND action=? AND idempotency_key=?)`)
    .bind(now,now,now,now,now,now,now,execution,runId,userKey,input.revision,input.position,now,now,userKey,input.admin?1:0,now,
      input.answerRevision??null,input.answerRevision??null,userKey,idempotency.action,idempotency.key)];
  if(input.answers!==undefined){
   const operation=crypto.randomUUID();
   statements.push(db.prepare(`INSERT INTO study_group_exam_answers(run_id,user_key,position,answer_json,revision,last_client_operation_id,server_received_at_utc,updated_at)
    SELECT ?,?,?,?,?,?,?,? WHERE ${guard} ON CONFLICT(run_id,user_key,position) DO UPDATE SET answer_json=excluded.answer_json,revision=excluded.revision,last_client_operation_id=excluded.last_client_operation_id,server_received_at_utc=excluded.server_received_at_utc,updated_at=excluded.updated_at`)
    .bind(runId,userKey,input.position,JSON.stringify(input.answers),input.answerRevision!+1,operation,now,now,...guardArgs));
   statements.push(db.prepare(`INSERT INTO study_group_answer_operations(operation_id,run_id,user_key,position,answer_hash,result_revision,created_at) SELECT ?,?,?,?,?,?,? WHERE ${guard}`)
    .bind(operation,runId,userKey,input.position,input.answerHash!,input.answerRevision!+1,now,...guardArgs));
  }
  statements.push(db.prepare(`UPDATE study_group_exam_participants SET status='in_progress',last_mutation_execution_id=? WHERE run_id=? AND user_key=? AND ${guard}`).bind(execution,runId,userKey,...guardArgs));
  // Persist exactly the acknowledged public snapshot for identical retries;
  // secrets and peer answers are never selected by this transaction.
  const publicResponse=`SELECT json_object('saved',json('true'),'submitted',json('false'),'advanced',json('true'),
    'revision',?,'progressRevision',p.revision,'position',p.current_position,'deadlineAt',p.current_deadline_at_utc,
    'publicQuestionWindow',json_array(json_object('position',q.position,'source_question_uid',q.source_question_uid,
      'area_code_snapshot',q.area_code_snapshot,'prompt_snapshot',q.prompt_snapshot,
      'choices_snapshot_json',json(q.choices_snapshot_json),'asset_refs_snapshot_json',json(q.asset_refs_snapshot_json),
      'time_limit_seconds',q.time_limit_seconds,'opens_at_utc',p.current_opened_at_utc,'deadline_at_utc',p.current_deadline_at_utc,
      'answer_json',json(COALESCE(a.answer_json,'[]')),'answer_revision',COALESCE(a.revision,0),'content_set',i.content_set)))
    FROM study_group_exam_participant_progress p JOIN study_group_exam_question_public q ON q.run_id=p.run_id AND q.position=p.current_position
    LEFT JOIN study_group_exam_answers a ON a.run_id=p.run_id AND a.user_key=p.user_key AND a.position=q.position
    LEFT JOIN study_group_exam_question_identity_snapshot i ON i.run_id=q.run_id AND i.position=q.position
    WHERE p.run_id=? AND p.user_key=? AND p.last_mutation_execution_id=?`;
  statements.push(db.prepare(`INSERT INTO study_group_idempotency(actor_user_key,action,idempotency_key,request_digest,execution_id,response_status,response_json,created_at)
    SELECT ?,?,?,?,?,200,(${publicResponse}),? WHERE ${guard}`)
    .bind(userKey,idempotency.action,idempotency.key,idempotency.requestDigest,execution,input.answers!==undefined?input.answerRevision!+1:null,runId,userKey,execution,now,...guardArgs));
  statements.push(db.prepare(`SELECT
    (SELECT status FROM user_accounts WHERE user_key=?) AS account_status,
    EXISTS(SELECT 1 FROM site_settings WHERE key='maintenance_mode' AND value='true') AS maintenance,
    (SELECT request_digest FROM study_group_idempotency WHERE actor_user_key=? AND action=? AND idempotency_key=?) AS request_digest,
    (SELECT response_json FROM study_group_idempotency WHERE actor_user_key=? AND action=? AND idempotency_key=?) AS response_json`)
    .bind(userKey,userKey,idempotency.action,idempotency.key,userKey,idempotency.action,idempotency.key));
  const result=await db.batch(statements);
  return result.at(-1)!.results![0] as {account_status:string|null;maintenance:number;request_digest:string|null;response_json:string|null};
 }
}
