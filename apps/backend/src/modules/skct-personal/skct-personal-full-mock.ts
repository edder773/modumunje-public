import { getD1 } from "@backend/infrastructure/database";
import { SKCT_MOCK_SECTION_QUESTIONS, SKCT_MOCK_SECTION_SECONDS, SKCT_MOCK_BREAK_SECONDS,
  SKCT_MOCK_QUESTION_COUNT, type SkctFullMock } from "@shared/study/skct-personal-exam";
import { snapshotStatements, snapshotResults, type Attempt } from "./skct-personal.repository";

export function initialFullMock(now = Date.now()): SkctFullMock {
  return { sectionIndex: 0, phase: "answering", sectionDeadlineAt: new Date(now+SKCT_MOCK_SECTION_SECONDS*1000).toISOString(),
    breakUntil: null, serverNow: new Date(now).toISOString() };
}
export function fullMockState(attempt: Attempt): SkctFullMock | null {
  if (!attempt.full_mock_json) return null;
  const state = JSON.parse(attempt.full_mock_json) as SkctFullMock;
  return { ...state, serverNow: new Date().toISOString() };
}
export function fullMockExpired(state: SkctFullMock, now: number) {
  return state.phase === "answering" && now >= Date.parse(state.sectionDeadlineAt!)
    || state.phase === "break" && now >= Date.parse(state.breakUntil!);
}

// The server clock and the attempt CAS are authoritative. A passed question is immutable;
// only a completed exam can disclose answers. Reconnection consumes expired sections.
export async function commitFullMockStep(attempt: Attempt, input: {
  action: "advance" | "sync-exam" | "submit"; choice: number | null;
  operationId: string; operationDigest: string; now?: number;
}) {
  const now = input.now ?? Date.now();
  const state = fullMockState(attempt)!;
  let next = { ...state };
  const oldPosition = attempt.active_position ?? SKCT_MOCK_QUESTION_COUNT;
  let nextPosition = oldPosition;
  let finalizeThrough = oldPosition-1;
  let acceptChoice = false;
  let passedSections = false;
  function closeSection(closedAt: number) {
    finalizeThrough = (next.sectionIndex+1)*SKCT_MOCK_SECTION_QUESTIONS;
    if (next.sectionIndex === 4) {
      next = { ...next, phase: "completed", sectionDeadlineAt: null, breakUntil: null };
      nextPosition = SKCT_MOCK_QUESTION_COUNT;
    } else {
      next = { ...next, sectionIndex: next.sectionIndex+1, phase: "break", sectionDeadlineAt: null,
        breakUntil: new Date(closedAt+SKCT_MOCK_BREAK_SECONDS*1000).toISOString() };
      nextPosition = next.sectionIndex*SKCT_MOCK_SECTION_QUESTIONS+1;
    }
  }
  while (fullMockExpired(next,now)) {
    passedSections = true;
    if (next.phase === "answering") closeSection(Date.parse(next.sectionDeadlineAt!));
    else next = { ...next, phase: "answering", sectionDeadlineAt:
      new Date(Date.parse(next.breakUntil!)+SKCT_MOCK_SECTION_SECONDS*1000).toISOString(), breakUntil: null };
  }
  if (input.action === "submit") {
    next = { ...next, phase: "completed", sectionDeadlineAt: null, breakUntil: null };
    finalizeThrough = SKCT_MOCK_QUESTION_COUNT;
    nextPosition = SKCT_MOCK_QUESTION_COUNT;
    acceptChoice = !passedSections && state.phase === "answering";
  } else if (input.action === "advance" && !passedSections && next.phase === "answering") {
    acceptChoice = true;
    finalizeThrough = oldPosition;
    nextPosition = oldPosition+1;
    if (oldPosition % SKCT_MOCK_SECTION_QUESTIONS === 0) closeSection(now);
  }
  next.serverNow = new Date(now).toISOString();
  const completed = next.phase === "completed";
  const db = getD1();
  const guard = "EXISTS(SELECT 1 FROM skct_personal_attempts WHERE id=? AND user_key=? AND revision=? AND last_operation_id=?)";
  const guardValues = [attempt.id,attempt.user_key,attempt.revision+1,input.operationId];
  const statements = [db.prepare(`UPDATE skct_personal_attempts SET full_mock_json=?,
    active_position=?,active_since=?,status=?,submitted_at=CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END,
    revision=revision+1,last_operation_id=?,last_operation_digest=?
    WHERE id=? AND user_key=? AND mode='mock' AND status='in_progress' AND revision=?`)
    .bind(JSON.stringify(next),completed ? null : nextPosition,next.phase === "answering" ? new Date(now).toISOString() : null,
      completed ? "submitted" : "in_progress",completed ? 1 : 0,input.operationId,input.operationDigest,
      attempt.id,attempt.user_key,attempt.revision)];
  if (acceptChoice && input.choice !== null) statements.push(db.prepare(`UPDATE skct_personal_attempt_items
    SET selected_index=? WHERE attempt_id=? AND position=? AND finalized_at IS NULL AND ${guard}`)
    .bind(input.choice,attempt.id,oldPosition,...guardValues));
  if (finalizeThrough >= oldPosition) statements.push(db.prepare(`UPDATE skct_personal_attempt_items
    SET finalized_at=CURRENT_TIMESTAMP WHERE attempt_id=? AND position BETWEEN ? AND ?
      AND finalized_at IS NULL AND ${guard}`).bind(attempt.id,oldPosition,finalizeThrough,...guardValues));
  const result = await db.batch([...statements,...snapshotStatements(attempt.id,attempt.user_key)]);
  return { committed: Number(result[0].meta.changes) === 1, snapshot: snapshotResults(result,statements.length) };
}
