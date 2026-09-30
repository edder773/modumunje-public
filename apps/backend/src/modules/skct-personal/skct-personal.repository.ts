import { getD1 } from "@backend/infrastructure/database";
import { learnerContextPlan, readLearnerRequestContext } from "@backend/common/auth/learner-request-context";

export type Row = Record<string, unknown>;
export type Attempt = {
  id: string; user_key: string; release_id: string; unit_id: string; mode: "practice" | "mock";
  status: "in_progress" | "submitted"; revision: number; active_position: number | null;
  active_since: string | null; started_at: string; submitted_at: string | null;
  last_operation_id: string | null; last_operation_digest: string | null;
};
export type Item = {
  position: number; source_item_id: string; public_json: string; selected_index: number | null;
  finalized_at: string | null; elapsed_seconds: number; last_operation_id: string | null;
  last_operation_digest: string | null;
};
export type SecretItem = {
  position: number; answer_index: number; explanation: string; distractor_explanations_json: string;
};
export type Snapshot = { attempt: Attempt | null; items: Item[]; secretRows: SecretItem[] };

const rows = <T>(result: D1Result<unknown>) => (result.results ?? []) as T[];
const changes = (result: D1Result<unknown>) => Number(result.meta.changes ?? 0);
const attemptSql = `SELECT * FROM skct_personal_attempts WHERE id=? AND user_key=?`;
const itemsSql = `SELECT ai.position,ai.source_item_id,ai.selected_index,ai.finalized_at,
  ai.elapsed_seconds,ai.last_operation_id,ai.last_operation_digest,p.public_json
  FROM skct_personal_attempt_items ai JOIN skct_personal_public_items p
    ON p.release_id=ai.release_id AND p.source_item_id=ai.source_item_id
  WHERE ai.attempt_id=? AND EXISTS(SELECT 1 FROM skct_personal_attempts a WHERE a.id=ai.attempt_id AND a.user_key=?)
  ORDER BY ai.position`;
const secretsSql = `SELECT ai.position,s.answer_index,s.explanation,s.distractor_explanations_json
  FROM skct_personal_attempt_items ai JOIN skct_personal_secret_items s
    ON s.release_id=ai.release_id AND s.source_item_id=ai.source_item_id
  JOIN skct_personal_attempts a ON a.id=ai.attempt_id
  WHERE ai.attempt_id=? AND a.user_key=? AND
    ((a.mode='mock' AND a.status='submitted') OR (a.mode='practice' AND ai.finalized_at IS NOT NULL))`;
export async function readAccount(key: string) {
  return (await readLearnerRequestContext(getD1(),key,{includeRevision:true})).accountRow;
}
export function snapshotStatements(id: string, key: string) {
  const db = getD1();
  return [db.prepare(attemptSql).bind(id,key), db.prepare(itemsSql).bind(id,key), db.prepare(secretsSql).bind(id,key)];
}
export function snapshotResults(results: D1Result<unknown>[], offset: number): Snapshot {
  return { attempt: rows<Attempt>(results[offset])[0] ?? null,
    items: rows<Item>(results[offset+1]), secretRows: rows<SecretItem>(results[offset+2]) };
}
export async function readHome(key: string) {
  const db=getD1();
  const plan=learnerContextPlan(db,key,{includeRevision:true});
  const result=await db.batch([...plan.statements,
    db.prepare("SELECT id FROM skct_personal_releases WHERE status='ACTIVE' AND item_count=300 LIMIT 1")]);
  return { ...plan.parse(result), release: rows<{id:string}>(result[plan.statements.length])[0] ?? null };
}
export async function readRecords(key: string, before: [string,string] | null) {
  const db=getD1();
  const plan=learnerContextPlan(db,key,{includeRevision:true});
  const result=await db.batch([...plan.statements, recordsStatement(key,before)]);
  return { ...plan.parse(result), records: rows<Row>(result[plan.statements.length]) };
}
export async function readOwnedSnapshot(id: string,key: string) {
  const db=getD1();
  const plan=learnerContextPlan(db,key,{includeRevision:true});
  const result=await db.batch([...plan.statements,...snapshotStatements(id,key)]);
  return { ...plan.parse(result), snapshot: snapshotResults(result,plan.statements.length) };
}
export async function readStart(key: string, unitId: string, mode: Attempt["mode"], count: number) {
  const db=getD1();
  const plan=learnerContextPlan(db,key,{includeRevision:true});
  const result=await db.batch([...plan.statements,
    db.prepare("SELECT * FROM skct_personal_attempts WHERE user_key=? AND unit_id=? AND mode=? AND status='in_progress' LIMIT 1").bind(key,unitId,mode),
    db.prepare("SELECT id FROM skct_personal_releases WHERE status='ACTIVE' AND item_count=300 LIMIT 1"),
    db.prepare(`SELECT p.source_item_id FROM skct_personal_public_items p
      WHERE p.release_id=(SELECT id FROM skct_personal_releases WHERE status='ACTIVE' AND item_count=300 LIMIT 1)
        AND p.unit_id=?
      ORDER BY (SELECT COUNT(*) FROM skct_personal_attempt_items ai JOIN skct_personal_attempts a ON a.id=ai.attempt_id
        WHERE a.user_key=? AND ai.source_item_id=p.source_item_id),p.source_batch,p.source_ordinal LIMIT ?`)
      .bind(unitId,key,count)]);
  const offset=plan.statements.length;
  return { ...plan.parse(result), existing: rows<Attempt>(result[offset])[0] ?? null,
    release: rows<{id:string}>(result[offset+1])[0] ?? null, selected: rows<{source_item_id:string}>(result[offset+2]) };
}
export async function readConcurrentStart(key: string, unitId: string, mode: Attempt["mode"]) {
  const db=getD1();
  const openId="(SELECT id FROM skct_personal_attempts WHERE user_key=? AND unit_id=? AND mode=? AND status='in_progress' LIMIT 1)";
  const result=await db.batch([
    db.prepare("SELECT * FROM skct_personal_attempts WHERE user_key=? AND unit_id=? AND mode=? AND status='in_progress' LIMIT 1")
      .bind(key,unitId,mode),
    db.prepare(itemsSql.replace("ai.attempt_id=?",`ai.attempt_id=${openId}`)).bind(key,unitId,mode,key),
    db.prepare(secretsSql.replace("ai.attempt_id=?",`ai.attempt_id=${openId}`)).bind(key,unitId,mode,key),
  ]);
  return snapshotResults(result,0);
}
export async function readMutation(key: string,id: string, includeAppend: boolean) {
  const db=getD1();
  const plan=learnerContextPlan(db,key,{includeRevision:true});
  const appendQuery=db.prepare(`SELECT p.source_item_id FROM skct_personal_public_items p
      JOIN skct_personal_attempts a ON a.release_id=p.release_id AND a.unit_id=p.unit_id
      WHERE a.id=? AND a.user_key=?
      ORDER BY (SELECT COUNT(*) FROM skct_personal_attempt_items ai
        WHERE ai.attempt_id=a.id AND ai.source_item_id=p.source_item_id),
        (SELECT COUNT(*) FROM skct_personal_attempt_items ai JOIN skct_personal_attempts prior ON prior.id=ai.attempt_id
          WHERE prior.user_key=? AND ai.source_item_id=p.source_item_id),p.source_batch,p.source_ordinal LIMIT 5`)
      .bind(id,key,key);
  const result=await db.batch([...plan.statements,...snapshotStatements(id,key),
    ...(includeAppend ? [appendQuery] : [])]);
  const offset=plan.statements.length;
  return { ...plan.parse(result), snapshot: snapshotResults(result,offset),
    appendSelection: includeAppend ? rows<{source_item_id:string}>(result[offset+3]) : [] };
}

export async function activeRelease() {
  return getD1().prepare("SELECT id FROM skct_personal_releases WHERE status='ACTIVE' AND item_count=300 LIMIT 1")
    .first<{ id: string }>();
}

export async function ownedAttempt(id: string, userKey: string) {
  return getD1().prepare("SELECT * FROM skct_personal_attempts WHERE id=? AND user_key=?")
    .bind(id, userKey).first<Attempt>();
}

export async function readAttemptItems(attempt: Attempt) {
  const db = getD1();
  const items = rows<Item>(await db.prepare(`SELECT ai.position,ai.source_item_id,ai.selected_index,ai.finalized_at,
      ai.elapsed_seconds,ai.last_operation_id,ai.last_operation_digest,p.public_json
    FROM skct_personal_attempt_items ai JOIN skct_personal_public_items p
      ON p.release_id=ai.release_id AND p.source_item_id=ai.source_item_id
    WHERE ai.attempt_id=? ORDER BY ai.position`).bind(attempt.id).all<Item>());
  const visible = items.some(item => attempt.mode === "mock"
    ? attempt.status === "submitted" : Boolean(item.finalized_at));
  const secretRows = visible ? rows<SecretItem>(await db.prepare(`SELECT ai.position,s.answer_index,s.explanation,s.distractor_explanations_json
    FROM skct_personal_attempt_items ai JOIN skct_personal_secret_items s
      ON s.release_id=ai.release_id AND s.source_item_id=ai.source_item_id
    WHERE ai.attempt_id=? AND (EXISTS(SELECT 1 FROM skct_personal_attempts a WHERE a.id=ai.attempt_id
      AND a.mode='mock' AND a.status='submitted')
      OR EXISTS(SELECT 1 FROM skct_personal_attempts a WHERE a.id=ai.attempt_id AND a.mode='practice' AND ai.finalized_at IS NOT NULL))`)
    .bind(attempt.id).all<SecretItem>()) : [];
  return { items, secretRows };
}

export async function listAdminItems(cursor: number) {
  return rows<Row>(await getD1().prepare(`SELECT ai.rowid AS cursor,a.id AS attempt_id,a.user_key,
    a.release_id,a.unit_id,a.mode,a.status,ai.position,ai.source_item_id,ai.selected_index,
    ai.finalized_at,ai.elapsed_seconds,a.started_at,a.submitted_at,
    CASE WHEN ai.finalized_at IS NULL THEN NULL WHEN ai.selected_index=s.answer_index THEN 1 ELSE 0 END AS is_correct
    FROM skct_personal_attempt_items ai JOIN skct_personal_attempts a ON a.id=ai.attempt_id
    JOIN skct_personal_secret_items s ON s.release_id=ai.release_id AND s.source_item_id=ai.source_item_id
    WHERE (?=0 OR ai.rowid<?) ORDER BY ai.rowid DESC LIMIT 101`).bind(cursor, cursor).all<Row>());
}

export async function readAdminOverview(since: string | null) {
  const aggregatesQuery = getD1().prepare(`SELECT a.unit_id,a.mode,COUNT(DISTINCT a.id) AS attempts,
    COUNT(ai.position) AS item_events,COALESCE(SUM(ai.elapsed_seconds),0) AS elapsed_seconds,
    SUM(CASE WHEN ai.finalized_at IS NOT NULL THEN 1 ELSE 0 END) AS finalized_items,
    SUM(CASE WHEN ai.selected_index IS NOT NULL THEN 1 ELSE 0 END) AS answered_items
    FROM skct_personal_attempts a JOIN skct_personal_attempt_items ai ON ai.attempt_id=a.id
    ${since ? "WHERE a.started_at>=?" : ""}
    GROUP BY a.unit_id,a.mode ORDER BY a.unit_id,a.mode`);
  const aggregates = rows(await (since ? aggregatesQuery.bind(since) : aggregatesQuery).all<Row>());
  const audit = rows(await getD1().prepare("SELECT release_id,event_type,actor,evidence_sha256,created_at FROM skct_personal_release_audit ORDER BY created_at DESC LIMIT 50").all<Row>());
  return { aggregates, audit };
}

export async function listRecords(key: string, before: [string, string] | null) {
  return rows<Row>(await recordsStatement(key,before).all<Row>());
}
function recordsStatement(key: string, before: [string, string] | null) {
  return getD1().prepare(`SELECT a.id,a.release_id,a.unit_id,a.mode,a.status,a.started_at,a.submitted_at,
    COUNT(ai.position) AS question_count,SUM(CASE WHEN ai.selected_index IS NOT NULL THEN 1 ELSE 0 END) AS answered_count,
    SUM(CASE WHEN ai.finalized_at IS NOT NULL THEN 1 ELSE 0 END) AS finalized_count,
    COALESCE(SUM(ai.elapsed_seconds),0) AS elapsed_seconds,
    SUM(CASE WHEN ai.selected_index IS NOT NULL AND ai.finalized_at IS NOT NULL AND ai.selected_index=s.answer_index THEN 1 ELSE 0 END) AS correct_count
    FROM skct_personal_attempts a JOIN skct_personal_attempt_items ai ON ai.attempt_id=a.id
    JOIN skct_personal_secret_items s ON s.release_id=ai.release_id AND s.source_item_id=ai.source_item_id
    WHERE a.user_key=? AND (? IS NULL OR a.started_at<? OR (a.started_at=? AND a.id<?))
    GROUP BY a.id ORDER BY a.started_at DESC,a.id DESC LIMIT 101`)
    .bind(key,before?.[0] ?? null,before?.[0] ?? null,before?.[0] ?? null,before?.[1] ?? null);
}

export async function findInProgressAttempt(key: string, unitId: string, mode: Attempt["mode"]) {
  return getD1().prepare("SELECT * FROM skct_personal_attempts WHERE user_key=? AND unit_id=? AND mode=? AND status='in_progress' LIMIT 1")
    .bind(key, unitId, mode).first<Attempt>();
}

export async function selectAttemptQuestions(releaseId: string, unitId: string, key: string, count: number) {
  return rows(await getD1().prepare(`SELECT p.source_item_id FROM skct_personal_public_items p
    WHERE p.release_id=? AND p.unit_id=?
    ORDER BY (SELECT COUNT(*) FROM skct_personal_attempt_items ai JOIN skct_personal_attempts a ON a.id=ai.attempt_id
      WHERE a.user_key=? AND ai.source_item_id=p.source_item_id),p.source_batch,p.source_ordinal
    LIMIT ?`).bind(releaseId, unitId, key, count).all<{ source_item_id: string }>());
}

export async function selectAppendQuestions(attempt: Attempt, count: number) {
  return rows(await getD1().prepare(`SELECT p.source_item_id FROM skct_personal_public_items p
    WHERE p.release_id=? AND p.unit_id=?
    ORDER BY (SELECT COUNT(*) FROM skct_personal_attempt_items ai
      WHERE ai.attempt_id=? AND ai.source_item_id=p.source_item_id),
      (SELECT COUNT(*) FROM skct_personal_attempt_items ai
        JOIN skct_personal_attempts a ON a.id=ai.attempt_id
        WHERE a.user_key=? AND ai.source_item_id=p.source_item_id),
      p.source_batch,p.source_ordinal LIMIT ?`)
    .bind(attempt.release_id, attempt.unit_id, attempt.id, attempt.user_key, count)
    .all<{ source_item_id: string }>());
}

export async function appendPracticeBatch(attempt: Attempt, lastPosition: number,
  selected: Array<{ source_item_id: string }>, operationId: string, operationDigest: string) {
  const db = getD1();
  const nextPosition = lastPosition + 1;
  const statements = [db.prepare(`UPDATE skct_personal_attempts
    SET active_position=?,active_since=CURRENT_TIMESTAMP,revision=revision+1,
      last_operation_id=?,last_operation_digest=?
    WHERE id=? AND user_key=? AND mode='practice' AND status='in_progress' AND revision=?
      AND NOT EXISTS(SELECT 1 FROM skct_personal_attempt_items WHERE attempt_id=? AND finalized_at IS NULL)
      AND (SELECT MAX(position) FROM skct_personal_attempt_items WHERE attempt_id=?)=?`)
    .bind(nextPosition,operationId,operationDigest,attempt.id,attempt.user_key,attempt.revision,
      attempt.id,attempt.id,lastPosition),
  ...selected.map((row,index) => db.prepare(`INSERT INTO skct_personal_attempt_items(attempt_id,release_id,position,source_item_id)
    SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM skct_personal_attempts
      WHERE id=? AND user_key=? AND revision=? AND last_operation_id=?)`)
    .bind(attempt.id,attempt.release_id,nextPosition+index,row.source_item_id,
      attempt.id,attempt.user_key,attempt.revision+1,operationId))];
  const results = await db.batch([...statements,...snapshotStatements(attempt.id,attempt.user_key)]);
  return { committed: changes(results[0]) === 1 && results.slice(1,statements.length).every(result => changes(result) === 1),
    snapshot: snapshotResults(results,statements.length) };
}

export async function finishPractice(attempt: Attempt, operationId: string, operationDigest: string) {
  const db = getD1();
  const statements = [db.prepare(`UPDATE skct_personal_attempt_items
    SET elapsed_seconds=elapsed_seconds+MIN(30,MAX(0,CAST((julianday('now')-julianday((SELECT active_since FROM skct_personal_attempts WHERE id=?)))*86400 AS integer)))
    WHERE attempt_id=? AND position=(SELECT active_position FROM skct_personal_attempts WHERE id=?)
      AND (SELECT active_since FROM skct_personal_attempts WHERE id=?) IS NOT NULL
      AND EXISTS(SELECT 1 FROM skct_personal_attempts WHERE id=? AND user_key=? AND mode='practice'
        AND status='in_progress' AND revision=?)`)
    .bind(attempt.id,attempt.id,attempt.id,attempt.id,attempt.id,attempt.user_key,attempt.revision),
  db.prepare(`UPDATE skct_personal_attempts SET status='submitted',submitted_at=CURRENT_TIMESTAMP,
    active_position=NULL,active_since=NULL,revision=revision+1,last_operation_id=?,last_operation_digest=?
    WHERE id=? AND user_key=? AND mode='practice' AND status='in_progress' AND revision=?`)
    .bind(operationId,operationDigest,attempt.id,attempt.user_key,attempt.revision)];
  const results = await db.batch([...statements,...snapshotStatements(attempt.id,attempt.user_key)]);
  return { committed: changes(results[1]) === 1, snapshot: snapshotResults(results,statements.length) };
}

export async function commitCheckpoint(attempt: Attempt, input: {
  activePosition: number | null;
  answers: Array<{ position: number; choiceIndex: number }>;
  times: Array<{ position: number; seconds: number }>;
  operationId: string; operationDigest: string;
}) {
  const { activePosition, answers, times, operationId, operationDigest } = input;
  const db = getD1();
  const statements = [db.prepare(`UPDATE skct_personal_attempts
    SET active_position=?,active_since=CASE WHEN ? IS NULL THEN NULL ELSE CURRENT_TIMESTAMP END,
      revision=revision+1,last_operation_id=?,last_operation_digest=?
    WHERE id=? AND user_key=? AND mode='mock' AND status='in_progress' AND revision=?`)
    .bind(activePosition,activePosition,operationId,operationDigest,
      attempt.id,attempt.user_key,attempt.revision),
  ...answers.map(row => db.prepare(`UPDATE skct_personal_attempt_items SET selected_index=?
    WHERE attempt_id=? AND position=? AND finalized_at IS NULL AND EXISTS
      (SELECT 1 FROM skct_personal_attempts WHERE id=? AND user_key=? AND revision=? AND last_operation_id=?)`)
    .bind(row.choiceIndex,attempt.id,row.position,attempt.id,attempt.user_key,attempt.revision+1,operationId)),
  ...times.map(row => db.prepare(`UPDATE skct_personal_attempt_items SET elapsed_seconds=elapsed_seconds+?
    WHERE attempt_id=? AND position=? AND finalized_at IS NULL AND EXISTS
      (SELECT 1 FROM skct_personal_attempts WHERE id=? AND user_key=? AND revision=? AND last_operation_id=?)`)
    .bind(row.seconds,attempt.id,row.position,attempt.id,attempt.user_key,attempt.revision+1,operationId))];
  const results = await db.batch([...statements,...snapshotStatements(attempt.id,attempt.user_key)]);
  return { committed: changes(results[0]) === 1 && results.slice(1,statements.length).every(result => changes(result) === 1),
    snapshot: snapshotResults(results,statements.length) };
}

export async function insertAttempt(id: string, key: string, releaseId: string, unitId: string,
  mode: Attempt["mode"], selected: Array<{ source_item_id: string }>) {
  const db = getD1();
  const statements = [db.prepare(`INSERT INTO skct_personal_attempts(id,user_key,release_id,unit_id,mode,status,active_position,active_since)
    VALUES(?,?,?,?,?,'in_progress',1,CURRENT_TIMESTAMP)`).bind(id,key,releaseId,unitId,mode),
    ...selected.map((row, index) => db.prepare(`INSERT INTO skct_personal_attempt_items(attempt_id,release_id,position,source_item_id)
      VALUES(?,?,?,?)`).bind(id,releaseId,index+1,row.source_item_id))];
  const results=await db.batch([...statements,...snapshotStatements(id,key)]);
  return snapshotResults(results,statements.length);
}

export async function commitMutation(input: {
  action: "focus" | "pause" | "answer" | "save" | "submit";
  key: string; id: string; revision: number; position: number | null; choice: number | null;
  operationId: string; operationDigest: string; mode: Attempt["mode"]; continuousPractice?: boolean;
}) {
  const { action, key, id, revision, position, choice, operationId, operationDigest: opDigest, mode, continuousPractice } = input;
  const db = getD1();
  const guard = "EXISTS(SELECT 1 FROM skct_personal_attempts a WHERE a.id=? AND a.user_key=? AND a.status='in_progress' AND a.revision=?)";
  let statements: D1PreparedStatement[];
  if (action === "focus" && position !== null) {
    statements = [
      db.prepare(`UPDATE skct_personal_attempt_items SET elapsed_seconds=elapsed_seconds+MIN(30,MAX(0,CAST((julianday('now')-julianday((SELECT active_since FROM skct_personal_attempts WHERE id=?)))*86400 AS integer)))
        WHERE attempt_id=? AND position=(SELECT active_position FROM skct_personal_attempts WHERE id=?)
          AND (SELECT active_since FROM skct_personal_attempts WHERE id=?) IS NOT NULL AND ${guard}
          AND EXISTS(SELECT 1 FROM skct_personal_attempt_items target
            WHERE target.attempt_id=? AND target.position=? AND target.finalized_at IS NULL)`)
        .bind(id,id,id,id,id,key,revision,id,position),
      db.prepare(`UPDATE skct_personal_attempts SET active_position=?,active_since=CURRENT_TIMESTAMP,revision=revision+1,last_operation_id=?,last_operation_digest=?
        WHERE id=? AND user_key=? AND status='in_progress' AND revision=? AND EXISTS
          (SELECT 1 FROM skct_personal_attempt_items ai WHERE ai.attempt_id=? AND ai.position=? AND ai.finalized_at IS NULL)`)
        .bind(position,operationId,opDigest,id,key,revision,id,position),
    ];
  } else if (action === "pause") {
    statements = [
      db.prepare(`UPDATE skct_personal_attempt_items SET elapsed_seconds=elapsed_seconds+MIN(30,MAX(0,CAST((julianday('now')-julianday((SELECT active_since FROM skct_personal_attempts WHERE id=?)))*86400 AS integer)))
        WHERE attempt_id=? AND position=(SELECT active_position FROM skct_personal_attempts WHERE id=?)
          AND (SELECT active_since FROM skct_personal_attempts WHERE id=?) IS NOT NULL AND ${guard}`)
        .bind(id,id,id,id,id,key,revision),
      db.prepare(`UPDATE skct_personal_attempts SET active_since=NULL,revision=revision+1,last_operation_id=?,last_operation_digest=?
        WHERE id=? AND user_key=? AND status='in_progress' AND revision=?`)
        .bind(operationId,opDigest,id,key,revision),
    ];
  } else if (action === "answer" && mode === "practice" && position !== null && choice !== null) {
    statements = [
      db.prepare(`UPDATE skct_personal_attempt_items SET selected_index=?,finalized_at=CURRENT_TIMESTAMP,last_operation_id=?,last_operation_digest=?,
        elapsed_seconds=elapsed_seconds+CASE WHEN (SELECT active_position FROM skct_personal_attempts WHERE id=?)=position
          THEN COALESCE(MIN(30,MAX(0,CAST((julianday('now')-julianday((SELECT active_since FROM skct_personal_attempts WHERE id=?)))*86400 AS integer))),0) ELSE 0 END
        WHERE attempt_id=? AND position=? AND finalized_at IS NULL AND ${guard}`)
        .bind(choice,operationId,opDigest,id,id,id,position,id,key,revision),
      db.prepare(`UPDATE skct_personal_attempts SET revision=revision+1,active_position=NULL,active_since=NULL,
        status=CASE WHEN ?=0 AND NOT EXISTS(SELECT 1 FROM skct_personal_attempt_items ai WHERE ai.attempt_id=? AND ai.finalized_at IS NULL)
          THEN 'submitted' ELSE 'in_progress' END,
        submitted_at=CASE WHEN ?=0 AND NOT EXISTS(SELECT 1 FROM skct_personal_attempt_items ai WHERE ai.attempt_id=? AND ai.finalized_at IS NULL)
          THEN CURRENT_TIMESTAMP ELSE NULL END,
        last_operation_id=?,last_operation_digest=?
        WHERE id=? AND user_key=? AND status='in_progress' AND revision=? AND EXISTS
          (SELECT 1 FROM skct_personal_attempt_items WHERE attempt_id=? AND position=? AND last_operation_id=?)`)
        .bind(continuousPractice ? 1 : 0,id,continuousPractice ? 1 : 0,id,
          operationId,opDigest,id,key,revision,id,position,operationId),
    ];
  } else if (action === "save" && mode === "mock" && position !== null && choice !== null) {
    statements = [
      db.prepare(`UPDATE skct_personal_attempt_items SET selected_index=?,last_operation_id=?,last_operation_digest=?
        WHERE attempt_id=? AND position=? AND ${guard}`)
        .bind(choice,operationId,opDigest,id,position,id,key,revision),
      db.prepare(`UPDATE skct_personal_attempts SET revision=revision+1,last_operation_id=?,last_operation_digest=?
        WHERE id=? AND user_key=? AND status='in_progress' AND revision=? AND EXISTS
          (SELECT 1 FROM skct_personal_attempt_items WHERE attempt_id=? AND position=? AND last_operation_id=?)`)
        .bind(operationId,opDigest,id,key,revision,id,position,operationId),
    ];
  } else if (action === "submit" && mode === "mock") {
    statements = [
      db.prepare(`UPDATE skct_personal_attempt_items SET elapsed_seconds=elapsed_seconds+MIN(30,MAX(0,CAST((julianday('now')-julianday((SELECT active_since FROM skct_personal_attempts WHERE id=?)))*86400 AS integer)))
        WHERE attempt_id=? AND position=(SELECT active_position FROM skct_personal_attempts WHERE id=?)
          AND (SELECT active_since FROM skct_personal_attempts WHERE id=?) IS NOT NULL AND ${guard}`)
        .bind(id,id,id,id,id,key,revision),
      db.prepare(`UPDATE skct_personal_attempts SET status='submitted',submitted_at=CURRENT_TIMESTAMP,revision=revision+1,
        active_position=NULL,active_since=NULL,last_operation_id=?,last_operation_digest=?
        WHERE id=? AND user_key=? AND status='in_progress' AND revision=?`)
        .bind(operationId,opDigest,id,key,revision),
      db.prepare(`UPDATE skct_personal_attempt_items SET finalized_at=CURRENT_TIMESTAMP WHERE attempt_id=? AND
        EXISTS(SELECT 1 FROM skct_personal_attempts a WHERE a.id=? AND a.user_key=? AND a.status='submitted' AND a.last_operation_id=?)`)
        .bind(id,id,key,operationId),
    ];
  } else throw new Error("Unsupported SKCT personal mutation");
  const results = await db.batch([...statements,...snapshotStatements(id,key)]);
  return { committed: changes(results[action === "submit" ? 1 : statements.length - 1]) > 0,
    snapshot: snapshotResults(results,statements.length) };
}
