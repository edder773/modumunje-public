import { PERSONAL_GROUP_PREFIX, PERSONAL_GROUP_SCHEMA } from "./group-exam-personal-bank";
import { getRuntimeEnv } from "@backend/infrastructure/database";
import { APPROVED_SKCT_NEW300_GROUP_RELEASE } from "./domain/group-exam.domain";
import { GroupExamRepository, type ContentQuestionRow, type MemberRow, type MutationIdempotency, type RunRow } from "./group-exam.repository";
import { type Identity, type Progress, type TimePolicy } from "./domain/group-exam-v2.domain";

export type ContractV2 = { run_id: string; advance_time_policy: TimePolicy; repeat_policy: "allow" | "forbid"; selection_json: string };
export type SelectedV2 = ContentQuestionRow & { identity: Identity | null; timeLimitSeconds: number; position: number };
const rows = <T>(result: D1Result<T>) => result.results ?? [];

export class GroupExamV2Repository extends GroupExamRepository {
  v2Enabled() { return getRuntimeEnv().SKCT_GROUP_V2_ENABLED === "1"; }
  strictRepeatEnabled() { return this.v2Enabled() && getRuntimeEnv().SKCT_GROUP_REPEAT_IDENTITY_VERIFIED === "1"; }
  // Freeze exactly the membership read for selection; a join/leave/kick between the read
  // and the atomic batch must retry before consuming a quota or a repeat claim.
  startGuard(run: RunRow, members?: MemberRow[]) {
    const personal = run.source_release_id.startsWith(PERSONAL_GROUP_PREFIX);
    const sql = `EXISTS(SELECT 1 FROM skct_content_releases WHERE id=? AND status='active'
      AND schema_version=? AND release_sha256=? AND release_sha256=?)
      AND EXISTS(SELECT 1 FROM study_groups WHERE id=? AND status='active')${personal ? `
      AND EXISTS(SELECT 1 FROM skct_personal_releases source JOIN skct_content_releases mirror
        ON json_extract(mirror.manifest_json,'$.personalReleaseId')=source.id
        WHERE mirror.id=? AND source.status='ACTIVE' AND source.item_count=300
          AND json_extract(mirror.manifest_json,'$.personalContentSha256')=source.content_sha256)` : ""}`;
    const values: unknown[] = [run.source_release_id,personal ? PERSONAL_GROUP_SCHEMA : APPROVED_SKCT_NEW300_GROUP_RELEASE.schema,
      personal ? run.source_release_sha256 : APPROVED_SKCT_NEW300_GROUP_RELEASE.sha256,run.source_release_sha256,run.group_id,...(personal ? [run.source_release_id] : [])];
    if (!members) return {sql,values};
    return {sql: `${sql} AND (SELECT COUNT(*) FROM study_group_members WHERE group_id=? AND status='active')=?
      AND NOT EXISTS(SELECT 1 FROM json_each(?) expected WHERE NOT EXISTS(
        SELECT 1 FROM study_group_members m WHERE m.group_id=? AND m.status='active'
        AND m.user_key=json_extract(expected.value,'$.key') AND m.membership_epoch=json_extract(expected.value,'$.epoch')
        AND m.public_name=json_extract(expected.value,'$.name')))`,
      values: [...values,run.group_id,members.length,JSON.stringify(members.map(m=>({key:m.user_key,epoch:m.membership_epoch,name:m.public_name}))),run.group_id]};
  }
  contract(runId: string) {
    return this.connection().prepare("SELECT * FROM study_group_exam_run_contract_v2 WHERE run_id = ?").bind(runId).first<ContractV2>();
  }
  progress(runId: string, userKey: string) {
    return this.connection().prepare("SELECT * FROM study_group_exam_participant_progress WHERE run_id = ? AND user_key = ?").bind(runId, userKey).first<Progress>();
  }
  async progressRows(runId: string) {
    return rows(await this.connection().prepare("SELECT * FROM study_group_exam_participant_progress WHERE run_id = ? ORDER BY roster_position").bind(runId).all<Progress>());
  }
  async historicalQuestions(groupId: string) {
    return rows(await this.connection().prepare(`SELECT DISTINCT p.* FROM study_group_exam_runs r
      JOIN study_group_exam_question_public q ON q.run_id = r.id
      LEFT JOIN skct_question_public p ON p.release_id = r.source_release_id AND p.question_uid = q.source_question_uid
      WHERE r.group_id = ? AND r.actual_started_at_utc IS NOT NULL`).bind(groupId).all<ContentQuestionRow>());
  }
  async claims(groupId: string) {
    return rows(await this.connection().prepare("SELECT question_identity FROM study_group_exam_repeat_claims WHERE group_id = ?").bind(groupId).all<{ question_identity: string }>());
  }
  private insert(table: string, values: Record<string, unknown>, guard: string, guardValues: unknown[], ignore = false) {
    return this.connection().prepare(`INSERT ${ignore ? "OR IGNORE" : ""} INTO ${table} (${Object.keys(values).join(",")})
      SELECT ${Object.keys(values).map(() => "?").join(",")} WHERE ${guard}`).bind(...Object.values(values), ...guardValues);
  }
  startStatements(run: RunRow, contract: ContractV2, questions: SelectedV2[], participants: MemberRow[], timestamp: string, guard: string, guardValues: unknown[], includeQuestions = false) {
    const result: D1PreparedStatement[] = [];
    questions.forEach((q) => {
      if (includeQuestions) {
        result.push(this.insert("study_group_exam_question_public", {
          run_id: run.id, position: q.position, source_question_uid: q.question_uid, area_code_snapshot: q.area_code,
          prompt_snapshot: q.prompt_md, choices_snapshot_json: q.choices_json, asset_refs_snapshot_json: q.asset_refs_json,
          dependency_group_id_snapshot: q.dependency_group_id, time_limit_seconds: q.timeLimitSeconds,
          opens_at_utc: null, deadline_at_utc: null, snapshot_hash: q.question_hash,
        }, guard, guardValues));
        result.push(this.insert("study_group_exam_question_secret", {
          run_id: run.id, position: q.position, correct_answers_snapshot_json: q.correct_answers_json,
          explanation_snapshot: q.explanation_md, secret_hash: q.secret_hash,
        }, guard, guardValues));
      }
      if (q.identity) {
        result.push(this.insert("skct_question_identity", { release_id: q.release_id, question_uid: q.question_uid,
          question_identity: q.identity.questionIdentity, bundle_identity: q.identity.bundleIdentity, identity_material_json: q.identity.material, identity_version: 1 }, guard, guardValues, true));
        result.push(this.insert("study_group_exam_question_identity_snapshot", { run_id: run.id, position: q.position,
          question_identity: q.identity.questionIdentity, bundle_identity: q.identity.bundleIdentity, content_set: q.content_set ?? "" }, guard, guardValues));
        result.push(this.insert("study_group_exam_repeat_claims", { group_id: run.group_id, question_identity: q.identity.questionIdentity, run_id: run.id }, guard, guardValues, contract.repeat_policy === "allow"));
      }
    });
    participants.forEach((member, position) => {
      if (includeQuestions) result.push(this.insert("study_group_exam_participants", { run_id: run.id, user_key: member.user_key,
        public_name_snapshot: member.public_name, membership_epoch_snapshot: member.membership_epoch, status: "rostered" }, guard, guardValues));
      result.push(this.insert("study_group_exam_participant_progress", {
        run_id: run.id, user_key: member.user_key, participant_id: crypto.randomUUID(), roster_position: position,
        current_position: 0, current_opened_at_utc: timestamp,
        current_deadline_at_utc: new Date(Date.parse(timestamp) + questions[0].timeLimitSeconds * 1000).toISOString(),
        started_at_utc: timestamp,
      }, guard, guardValues));
    });
    return result;
  }
  contractStatement(contract: ContractV2, timestamp: string) {
    return this.insert("study_group_exam_run_contract_v2", { ...contract, created_at: timestamp }, "EXISTS(SELECT 1 FROM study_group_exam_runs WHERE id = ?)", [contract.run_id]);
  }
  async activateV2(run: RunRow, contract: ContractV2, questions: SelectedV2[], participants: MemberRow[], timestamp: string, finalDeadline: string) {
    const execution = crypto.randomUUID();
    const guard = "EXISTS(SELECT 1 FROM study_group_exam_runs WHERE id = ? AND status = 'running' AND lease_owner = ?)";
    const args = [run.id, execution];
    const startGuard = this.startGuard(run,participants);
    const statements = [this.connection().prepare(`UPDATE study_group_exam_runs SET status='running', actual_started_at_utc=?,
      final_deadline_at_utc=?, participant_count_snapshot=?, lease_owner=?, revision=revision+1
      WHERE id=? AND status='scheduled' AND scheduled_at_utc <= ?
        AND EXISTS(SELECT 1 FROM study_groups g WHERE g.id=study_group_exam_runs.group_id AND g.status='active')
        AND NOT EXISTS(SELECT 1 FROM study_group_active_runs WHERE group_id=?)
        AND (${startGuard.sql})`).bind(timestamp, finalDeadline, participants.length, execution, run.id, timestamp, run.group_id,...startGuard.values),
      ...this.startStatements(run, contract, questions, participants, timestamp, guard, args, true),
      this.insert("study_group_active_runs", { group_id: run.group_id, run_id: run.id, updated_at: timestamp }, guard, args),
      this.connection().prepare(`UPDATE study_group_quota_slots SET status='consumed',revision=revision+1,updated_at=? WHERE reserved_run_id=? AND status='reserved' AND ${guard}`).bind(timestamp, run.id, ...args),
      this.insert("study_group_quota_events", { id: crypto.randomUUID(), idempotency_key: `${run.start_request_id}:consume`, group_id: run.group_id,
        date_key: run.quota_date_key, slot_no: run.quota_slot_no, run_id: run.id, event_type: "consume", actor_user_key: run.created_by_user_key, created_at: timestamp }, guard, args),
      this.connection().prepare(`UPDATE study_group_exam_run_contract_v2 SET selection_json=? WHERE run_id=? AND ${guard}`).bind(contract.selection_json, run.id, ...args),
      this.connection().prepare("UPDATE study_group_exam_runs SET lease_owner=NULL WHERE id=? AND lease_owner=?").bind(...args),
    ];
    const result = await this.connection().batch(statements);
    return Number(result[0].meta.changes) > 0;
  }
  async dueV2(timestamp: string, groupId?: string) {
    return rows(await this.connection().prepare(`SELECT r.* FROM study_group_exam_runs r JOIN study_group_exam_run_contract_v2 v ON v.run_id=r.id
      WHERE r.status IN ('scheduled','running','finalizing') AND (? IS NULL OR r.group_id=?)
      AND (r.status <> 'scheduled' OR r.scheduled_at_utc <= ?) ORDER BY r.created_at LIMIT 25`).bind(groupId ?? null, groupId ?? null, timestamp).all<RunRow>());
  }
  async markConnected(runId: string, userKey: string, timestamp: string) {
    await this.connection().prepare(`UPDATE study_group_exam_participant_progress SET connected_at_utc=COALESCE(connected_at_utc,?)
      WHERE run_id=? AND user_key=? AND connected_at_utc IS NULL AND finished_at_utc IS NULL
      AND EXISTS(SELECT 1 FROM study_group_exam_runs WHERE id=? AND status='running' AND final_deadline_at_utc > ?)`)
      .bind(timestamp, runId, userKey, runId, timestamp).run();
  }
  async currentSnapshot(runId: string, userKey: string, timestamp: string) {
    const db = this.connection();
    const [connection, run, contract, progress, window] = await db.batch([
      db.prepare(`UPDATE study_group_exam_participant_progress SET connected_at_utc=?
        WHERE run_id=? AND user_key=? AND connected_at_utc IS NULL AND finished_at_utc IS NULL
        AND EXISTS(SELECT 1 FROM study_group_exam_runs WHERE id=? AND status='running' AND final_deadline_at_utc>?)`)
        .bind(timestamp,runId,userKey,runId,timestamp),
      db.prepare("SELECT * FROM study_group_exam_runs WHERE id=?").bind(runId),
      db.prepare("SELECT * FROM study_group_exam_run_contract_v2 WHERE run_id=?").bind(runId),
      db.prepare("SELECT * FROM study_group_exam_participant_progress WHERE run_id=? AND user_key=?").bind(runId,userKey),
      db.prepare(`SELECT q.position,q.source_question_uid,q.area_code_snapshot,q.prompt_snapshot,
        q.choices_snapshot_json,q.asset_refs_snapshot_json,q.time_limit_seconds,
        p.current_opened_at_utc AS opens_at_utc,p.current_deadline_at_utc AS deadline_at_utc,
        a.answer_json,COALESCE(a.revision,0) AS answer_revision,i.content_set
        FROM study_group_exam_participant_progress p
        JOIN study_group_exam_question_public q ON q.run_id=p.run_id AND q.position=p.current_position
        LEFT JOIN study_group_exam_answers a ON a.run_id=q.run_id AND a.user_key=p.user_key AND a.position=q.position
        LEFT JOIN study_group_exam_question_identity_snapshot i ON i.run_id=q.run_id AND i.position=q.position
        WHERE p.run_id=? AND p.user_key=? AND p.finished_at_utc IS NULL`).bind(runId,userKey),
    ]);
    return {
      connectedNow: Number(connection.meta.changes ?? 0) > 0,
      run: rows(run as D1Result<RunRow>)[0] ?? null,
      contract: rows(contract as D1Result<ContractV2>)[0] ?? null,
      progress: rows(progress as D1Result<Progress>)[0] ?? null,
      window: rows(window as D1Result<Record<string, unknown>>),
    };
  }
  async answerMutationSnapshot(runId: string, userKey: string, operationId: string) {
    const db = this.connection();
    const [operation, run, contract, progress, window] = await db.batch([
      db.prepare("SELECT * FROM study_group_answer_operations WHERE operation_id=?").bind(operationId),
      db.prepare("SELECT * FROM study_group_exam_runs WHERE id=?").bind(runId),
      db.prepare("SELECT * FROM study_group_exam_run_contract_v2 WHERE run_id=?").bind(runId),
      db.prepare("SELECT * FROM study_group_exam_participant_progress WHERE run_id=? AND user_key=?").bind(runId,userKey),
      db.prepare(`SELECT q.position,q.source_question_uid,q.area_code_snapshot,q.prompt_snapshot,
        q.choices_snapshot_json,q.asset_refs_snapshot_json,q.time_limit_seconds,
        p.current_opened_at_utc AS opens_at_utc,p.current_deadline_at_utc AS deadline_at_utc,
        a.answer_json,COALESCE(a.revision,0) AS answer_revision,i.content_set
        FROM study_group_exam_participant_progress p
        JOIN study_group_exam_question_public q ON q.run_id=p.run_id AND q.position=p.current_position
        LEFT JOIN study_group_exam_answers a ON a.run_id=q.run_id AND a.user_key=p.user_key AND a.position=q.position
        LEFT JOIN study_group_exam_question_identity_snapshot i ON i.run_id=q.run_id AND i.position=q.position
        WHERE p.run_id=? AND p.user_key=? AND p.finished_at_utc IS NULL`).bind(runId,userKey),
    ]);
    return {
      operation: rows(operation as D1Result<Record<string, unknown>>)[0] ?? null,
      run: rows(run as D1Result<RunRow>)[0] ?? null,
      contract: rows(contract as D1Result<ContractV2>)[0] ?? null,
      progress: rows(progress as D1Result<Progress>)[0] ?? null,
      window: rows(window as D1Result<Record<string, unknown>>),
    };
  }
  async progressMutationSnapshot(runId: string, userKey: string, action: string, key: string, nextPosition: number) {
    const db = this.connection();
    const [replay, run, contract, progress, nextQuestion] = await db.batch([
      db.prepare(`SELECT request_digest,execution_id,response_status,response_json FROM study_group_idempotency
        WHERE actor_user_key=? AND action=? AND idempotency_key=?`).bind(userKey,action,key),
      db.prepare("SELECT * FROM study_group_exam_runs WHERE id=?").bind(runId),
      db.prepare("SELECT * FROM study_group_exam_run_contract_v2 WHERE run_id=?").bind(runId),
      db.prepare("SELECT * FROM study_group_exam_participant_progress WHERE run_id=? AND user_key=?").bind(runId,userKey),
      db.prepare(`SELECT q.position,q.source_question_uid,q.area_code_snapshot,q.prompt_snapshot,
        q.choices_snapshot_json,q.asset_refs_snapshot_json,q.time_limit_seconds,
        q.opens_at_utc,q.deadline_at_utc,NULL AS answer_json,0 AS answer_revision,i.content_set
        FROM study_group_exam_participant_progress p
        JOIN study_group_exam_question_public q ON q.run_id=p.run_id AND q.position=?
        LEFT JOIN study_group_exam_question_identity_snapshot i ON i.run_id=q.run_id AND i.position=q.position
        WHERE p.run_id=? AND p.user_key=?`).bind(nextPosition,runId,userKey),
    ]);
    const next = rows(nextQuestion as D1Result<Record<string, unknown>>)[0] ?? null;
    return {
      replay: rows(replay as D1Result<{request_digest:string;execution_id:string;response_status:number;response_json:string}>)[0] ?? null,
      run: rows(run as D1Result<RunRow>)[0] ?? null,
      contract: rows(contract as D1Result<ContractV2>)[0] ?? null,
      progress: rows(progress as D1Result<Progress>)[0] ?? null,
      window: next ? [next] : [],
      nextTimeLimit: next ? Number(next.time_limit_seconds) : null,
    };
  }
  async reconcileCAS(before: Progress, after: Progress) {
    if (JSON.stringify(before) === JSON.stringify(after)) return false;
    const result = await this.connection().prepare(`UPDATE study_group_exam_participant_progress SET current_position=?,current_opened_at_utc=?,
      current_deadline_at_utc=?,carried_ms=?,finished_at_utc=?,terminal_status=?,revision=revision+1
      WHERE run_id=? AND user_key=? AND revision=? AND finished_at_utc IS NULL
      AND connected_at_utc IS ? AND EXISTS(SELECT 1 FROM study_group_exam_runs WHERE id=? AND status='running')`)
      .bind(after.current_position, after.current_opened_at_utc, after.current_deadline_at_utc, after.carried_ms, after.finished_at_utc, after.terminal_status,
        before.run_id, before.user_key, before.revision, before.connected_at_utc, before.run_id).run();
    return Number(result.meta.changes) > 0;
  }
  async publicCurrent(runId: string, userKey: string) {
    return this.connection().prepare(`SELECT q.position,q.source_question_uid,q.area_code_snapshot,q.prompt_snapshot,q.choices_snapshot_json,q.asset_refs_snapshot_json,
      q.time_limit_seconds,p.current_opened_at_utc AS opens_at_utc,p.current_deadline_at_utc AS deadline_at_utc,
      a.answer_json,COALESCE(a.revision,0) AS answer_revision,i.content_set
      FROM study_group_exam_participant_progress p JOIN study_group_exam_question_public q ON q.run_id=p.run_id AND q.position=p.current_position
      LEFT JOIN study_group_exam_answers a ON a.run_id=q.run_id AND a.user_key=p.user_key AND a.position=q.position
      LEFT JOIN study_group_exam_question_identity_snapshot i ON i.run_id=q.run_id AND i.position=q.position
      WHERE p.run_id=? AND p.user_key=? AND p.finished_at_utc IS NULL`).bind(runId,userKey).first<Record<string,unknown>>();
  }
  async publicWindow(runId: string, userKey: string, startPosition: number) {
    return rows(await this.connection().prepare(`SELECT q.position,q.source_question_uid,q.area_code_snapshot,q.prompt_snapshot,
      q.choices_snapshot_json,q.asset_refs_snapshot_json,q.time_limit_seconds,
      CASE WHEN q.position=p.current_position THEN p.current_opened_at_utc ELSE q.opens_at_utc END AS opens_at_utc,
      CASE WHEN q.position=p.current_position THEN p.current_deadline_at_utc ELSE q.deadline_at_utc END AS deadline_at_utc,
      CASE WHEN q.position=p.current_position THEN a.answer_json ELSE NULL END AS answer_json,
      CASE WHEN q.position=p.current_position THEN COALESCE(a.revision,0) ELSE 0 END AS answer_revision,
      i.content_set
      FROM study_group_exam_participant_progress p
      JOIN study_group_exam_question_public q ON q.run_id=p.run_id
        AND q.position=?
      LEFT JOIN study_group_exam_answers a ON a.run_id=q.run_id AND a.user_key=p.user_key AND a.position=q.position
      LEFT JOIN study_group_exam_question_identity_snapshot i ON i.run_id=q.run_id AND i.position=q.position
      WHERE p.run_id=? AND p.user_key=? AND p.finished_at_utc IS NULL
      ORDER BY q.position`).bind(startPosition,runId,userKey).all<Record<string,unknown>>());
  }
  async mutateProgress(input: { before: Progress; after: Progress; timestamp: string; position: number; expectedProgressRevision: number;
    answer?: { answers: number[]; expectedRevision: number; operationId: string; hash: string }; idempotency?: MutationIdempotency }) {
    const { before, after, timestamp, answer } = input;
    if (input.idempotency) input.idempotency.mutationAttempted = true;
    const execution = input.idempotency?.executionId ?? crypto.randomUUID();
    const guard = "EXISTS(SELECT 1 FROM study_group_exam_participant_progress WHERE run_id=? AND user_key=? AND last_mutation_execution_id=?)";
    const args = [before.run_id, before.user_key, execution];
    const statements = [this.connection().prepare(`UPDATE study_group_exam_participant_progress SET current_position=?,current_opened_at_utc=?,current_deadline_at_utc=?,
      carried_ms=?,finished_at_utc=?,terminal_status=?,connected_at_utc=COALESCE(connected_at_utc,?),revision=revision+1,last_mutation_execution_id=?
      WHERE run_id=? AND user_key=? AND revision=? AND current_position=? AND finished_at_utc IS NULL
      AND current_opened_at_utc <= ? AND current_deadline_at_utc > ?
      AND EXISTS(SELECT 1 FROM study_group_exam_runs WHERE id=? AND status='running' AND final_deadline_at_utc > ?)
      AND (? IS NULL OR COALESCE((SELECT revision FROM study_group_exam_answers WHERE run_id=? AND user_key=? AND position=?),0)=?)`)
      .bind(after.current_position,after.current_opened_at_utc,after.current_deadline_at_utc,after.carried_ms,after.finished_at_utc,after.terminal_status,timestamp,execution,
        before.run_id,before.user_key,input.expectedProgressRevision,input.position,timestamp,timestamp,before.run_id,timestamp,
        answer?.expectedRevision ?? null,before.run_id,before.user_key,input.position,answer?.expectedRevision ?? null)];
    if (answer) {
      statements.push(this.connection().prepare(`INSERT INTO study_group_exam_answers(run_id,user_key,position,answer_json,revision,last_client_operation_id,server_received_at_utc,updated_at)
        SELECT ?,?,?,?,?,?,?,? WHERE ${guard} ON CONFLICT(run_id,user_key,position) DO UPDATE SET answer_json=excluded.answer_json,revision=excluded.revision,
        last_client_operation_id=excluded.last_client_operation_id,server_received_at_utc=excluded.server_received_at_utc,updated_at=excluded.updated_at`)
        .bind(before.run_id,before.user_key,input.position,JSON.stringify(answer.answers),answer.expectedRevision+1,answer.operationId,timestamp,timestamp,...args));
      statements.push(this.insert("study_group_answer_operations", { operation_id:answer.operationId,run_id:before.run_id,user_key:before.user_key,position:input.position,
        answer_hash:answer.hash,result_revision:answer.expectedRevision+1,created_at:timestamp },guard,args));
    }
    statements.push(this.connection().prepare(`UPDATE study_group_exam_participants SET status=?,submitted_at=?,last_mutation_execution_id=? WHERE run_id=? AND user_key=? AND ${guard}`)
      .bind(after.terminal_status ?? "in_progress",after.finished_at_utc,execution,before.run_id,before.user_key,...args));
    if (input.idempotency) statements.push(this.idempotencyStatementWhen(input.idempotency,input.idempotency.response,guard,args));
    if (after.finished_at_utc) {
      // Read the peer's latest row within this batch. A peer may answer or move
      // after the HTTP preflight; its stale revision must not decide its timer.
      // An accepted submit is strictly before the run's hard deadline. At or
      // after that boundary the owner CAS rejects and maintenance owns no-show.
      statements.push(this.connection().prepare(`WITH candidates AS (
        SELECT p.run_id,p.user_key,p.current_position AS old_position,p.current_opened_at_utc AS old_opened,
          p.current_deadline_at_utc AS base_deadline,r.final_deadline_at_utc AS hard_deadline,
          r.question_count_snapshot,q.position,q.time_limit_seconds,
          SUM(CASE WHEN q.position=p.current_position THEN 0 ELSE q.time_limit_seconds END)
            OVER(PARTITION BY p.run_id,p.user_key ORDER BY q.position
              ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS elapsed_seconds
        FROM study_group_exam_participant_progress p
        JOIN study_group_exam_runs r ON r.id=p.run_id AND r.status='running'
        JOIN study_group_exam_question_public q ON q.run_id=p.run_id AND q.position>=p.current_position
        WHERE p.run_id=? AND p.user_key<>? AND p.finished_at_utc IS NULL AND p.current_deadline_at_utc<=?
      ), timed AS (
        SELECT *,MIN(hard_deadline,
          strftime('%Y-%m-%dT%H:%M:%S',base_deadline,printf('+%d seconds',elapsed_seconds))
          || substr(base_deadline,20)) AS candidate_deadline,
          CASE WHEN position=old_position THEN old_opened ELSE MIN(hard_deadline,
            strftime('%Y-%m-%dT%H:%M:%S',base_deadline,
              printf('+%d seconds',elapsed_seconds-time_limit_seconds)) || substr(base_deadline,20)) END AS candidate_opened
        FROM candidates
      ), stops AS (
        SELECT *,ROW_NUMBER() OVER(PARTITION BY run_id,user_key ORDER BY position) AS stop_order
        FROM timed WHERE candidate_deadline>? OR candidate_deadline>=hard_deadline
          OR position=question_count_snapshot-1
      )
      UPDATE study_group_exam_participant_progress AS p SET
        current_position=s.position,current_opened_at_utc=s.candidate_opened,
        current_deadline_at_utc=s.candidate_deadline,
        carried_ms=CASE WHEN s.position=p.current_position THEN p.carried_ms ELSE 0 END,
        finished_at_utc=CASE WHEN s.candidate_deadline<=? THEN s.candidate_deadline ELSE NULL END,
        terminal_status=CASE WHEN s.candidate_deadline<=? THEN 'auto_submitted' ELSE p.terminal_status END,
        revision=revision+1
      FROM stops AS s WHERE s.stop_order=1 AND p.run_id=s.run_id AND p.user_key=s.user_key
        AND p.finished_at_utc IS NULL AND ${guard}`)
        .bind(before.run_id,before.user_key,timestamp,timestamp,timestamp,timestamp,...args));
    }
    let terminalClaimIndex = -1;
    if (after.finished_at_utc) {
      // The final submit and its scoring share one D1 transaction. Only the
      // submit that leaves every frozen participant finished can claim the run.
      terminalClaimIndex = statements.length;
      const finalGuard = "EXISTS(SELECT 1 FROM study_group_exam_runs WHERE id=? AND status='finalizing' AND lease_owner=?)";
      const finalArgs = [before.run_id, execution];
      statements.push(this.connection().prepare(`UPDATE study_group_exam_runs SET status='finalizing',lease_owner=?,lease_until=?,revision=revision+1
        WHERE id=? AND status='running' AND participant_count_snapshot>0
        AND participant_count_snapshot=(SELECT COUNT(*) FROM study_group_exam_participant_progress WHERE run_id=?)
        AND NOT EXISTS(SELECT 1 FROM study_group_exam_participant_progress WHERE run_id=? AND finished_at_utc IS NULL)
        AND EXISTS(SELECT 1 FROM study_group_exam_participant_progress WHERE run_id=? AND user_key=? AND last_mutation_execution_id=?)`)
        .bind(execution,new Date(Date.parse(timestamp)+30_000).toISOString(),before.run_id,before.run_id,before.run_id,
          before.run_id,before.user_key,execution));
      const gradeRows = `FROM study_group_exam_question_public q
        JOIN study_group_exam_question_secret s ON s.run_id=q.run_id AND s.position=q.position
        LEFT JOIN study_group_exam_answers a ON a.run_id=q.run_id AND a.user_key=p.user_key AND a.position=q.position
        WHERE q.run_id=p.run_id`;
      statements.push(this.connection().prepare(`UPDATE study_group_exam_participant_progress AS p SET
        correct_count=(SELECT COALESCE(SUM(CASE WHEN COALESCE(json_array_length(a.answer_json),0)>0
          AND json(a.answer_json)=json(s.correct_answers_snapshot_json) THEN 1 ELSE 0 END),0) ${gradeRows}),
        incorrect_count=(SELECT COALESCE(SUM(CASE WHEN COALESCE(json_array_length(a.answer_json),0)>0
          AND json(a.answer_json)<>json(s.correct_answers_snapshot_json) THEN 1 ELSE 0 END),0) ${gradeRows}),
        unanswered_count=(SELECT COALESCE(SUM(CASE WHEN COALESCE(json_array_length(a.answer_json),0)=0 THEN 1 ELSE 0 END),0) ${gradeRows})
        WHERE p.run_id=? AND ${finalGuard}`).bind(before.run_id,...finalArgs));
      statements.push(this.connection().prepare(`UPDATE study_group_exam_participants AS p SET
        status=(SELECT x.terminal_status FROM study_group_exam_participant_progress x WHERE x.run_id=p.run_id AND x.user_key=p.user_key),
        submitted_at=(SELECT x.finished_at_utc FROM study_group_exam_participant_progress x WHERE x.run_id=p.run_id AND x.user_key=p.user_key),
        score=(SELECT x.correct_count FROM study_group_exam_participant_progress x WHERE x.run_id=p.run_id AND x.user_key=p.user_key),
        wrong_count=(SELECT x.incorrect_count FROM study_group_exam_participant_progress x WHERE x.run_id=p.run_id AND x.user_key=p.user_key),
        wrong_positions_json=(SELECT json_group_array(position) FROM (
          SELECT q.position AS position FROM study_group_exam_question_public q
          JOIN study_group_exam_question_secret s ON s.run_id=q.run_id AND s.position=q.position
          JOIN study_group_exam_answers a ON a.run_id=q.run_id AND a.user_key=p.user_key AND a.position=q.position
          WHERE q.run_id=p.run_id AND json_array_length(a.answer_json)>0
            AND json(a.answer_json)<>json(s.correct_answers_snapshot_json)
          ORDER BY q.position))
        WHERE p.run_id=? AND ${finalGuard}`).bind(before.run_id,...finalArgs));
      statements.push(this.connection().prepare(`UPDATE study_group_exam_runs SET status='completed',completed_at=?,revision=revision+1,
        lease_owner=NULL,lease_until=NULL WHERE id=? AND status='finalizing' AND lease_owner=?`)
        .bind(timestamp,before.run_id,execution));
      statements.push(this.connection().prepare("DELETE FROM study_group_active_runs WHERE run_id=? AND EXISTS(SELECT 1 FROM study_group_exam_runs WHERE id=? AND status='completed')")
        .bind(before.run_id,before.run_id));
      statements.push(this.connection().prepare(`SELECT COUNT(*) AS count FROM study_group_exam_participant_progress
        WHERE run_id=? AND finished_at_utc IS NULL AND current_deadline_at_utc<=?`).bind(before.run_id,timestamp));
    }
    const result = await this.connection().batch(statements);
    return { saved:Number(result[0].meta.changes)>0,
      finalized:terminalClaimIndex>=0 && Number(result[terminalClaimIndex+3].meta.changes)>0,
      needsReconcile:terminalClaimIndex>=0 && Number(rows(result.at(-1) as D1Result<{count:number}>)[0]?.count ?? 0)>0 };
  }
  async claimV2Finalization(runId: string, execution: string, timestamp: string, leaseUntil: string) {
    const result = await this.connection().prepare(`UPDATE study_group_exam_runs SET status='finalizing',lease_owner=?,lease_until=?,revision=revision+1
      WHERE id=? AND (status='running' OR (status='finalizing' AND lease_until < ?))
      AND EXISTS(SELECT 1 FROM study_group_exam_run_contract_v2 WHERE run_id=?)
      AND participant_count_snapshot > 0
      AND participant_count_snapshot=(SELECT COUNT(*) FROM study_group_exam_participant_progress WHERE run_id=?)
      AND NOT EXISTS(SELECT 1 FROM study_group_exam_participant_progress WHERE run_id=? AND finished_at_utc IS NULL)`)
      .bind(execution,leaseUntil,runId,timestamp,runId,runId,runId).run();
    return Number(result.meta.changes)>0;
  }
  async completeV2(run: RunRow, execution: string, timestamp: string, results: Array<{ userKey:string; correct:number; incorrect:number; unanswered:number; wrong:number[] }>) {
    const guard = "EXISTS(SELECT 1 FROM study_group_exam_runs WHERE id=? AND status='finalizing' AND lease_owner=?)";
    const statements: D1PreparedStatement[] = [];
    for(const row of results) {
      statements.push(this.connection().prepare(`UPDATE study_group_exam_participant_progress SET correct_count=?,incorrect_count=?,unanswered_count=? WHERE run_id=? AND user_key=? AND ${guard}`)
        .bind(row.correct,row.incorrect,row.unanswered,run.id,row.userKey,run.id,execution));
      statements.push(this.connection().prepare(`UPDATE study_group_exam_participants SET status=(SELECT terminal_status FROM study_group_exam_participant_progress WHERE run_id=? AND user_key=?),
        submitted_at=(SELECT finished_at_utc FROM study_group_exam_participant_progress WHERE run_id=? AND user_key=?),score=?,wrong_count=?,wrong_positions_json=? WHERE run_id=? AND user_key=? AND ${guard}`)
        .bind(run.id,row.userKey,run.id,row.userKey,row.correct,row.incorrect,JSON.stringify(row.wrong),run.id,row.userKey,run.id,execution));
    }
    statements.push(this.connection().prepare(`UPDATE study_group_exam_runs SET status='completed',completed_at=?,revision=revision+1,lease_owner=NULL,lease_until=NULL WHERE id=? AND status='finalizing' AND lease_owner=?`).bind(timestamp,run.id,execution));
    statements.push(this.connection().prepare("DELETE FROM study_group_active_runs WHERE run_id=? AND EXISTS(SELECT 1 FROM study_group_exam_runs WHERE id=? AND status='completed')").bind(run.id,run.id));
    const result=await this.connection().batch(statements);
    return Number(result.at(-2)?.meta.changes)>0;
  }
  async orderedResults(runId: string) {
    return rows(await this.connection().prepare(`SELECT x.*,p.public_name_snapshot FROM study_group_exam_participant_progress x
      JOIN study_group_exam_participants p ON p.run_id=x.run_id AND p.user_key=x.user_key
      WHERE x.run_id=? ORDER BY x.correct_count DESC,x.roster_position ASC`).bind(runId).all<Progress & {public_name_snapshot:string}>());
  }
}
