import { GroupExamError } from "./group-exam.domain";
import type { ContentQuestionRow } from "../group-exam.repository";

export type TimePolicy = "carry_remaining" | "reset_to_base";
export type Progress = {
  run_id: string; user_key: string; participant_id: string; roster_position: number;
  current_position: number; current_opened_at_utc: string; current_deadline_at_utc: string;
  carried_ms: number; started_at_utc: string; connected_at_utc: string | null;
  finished_at_utc: string | null; terminal_status: "submitted" | "auto_submitted" | "no_show" | null;
  correct_count: number | null; incorrect_count: number | null; unanswered_count: number | null;
  revision: number; last_mutation_execution_id: string | null;
};
export type Identity = { questionIdentity: string; bundleIdentity: string; material: string };
export async function digest(value: unknown) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}
// Source ID + page block, unlike normalized line numbers/jsonPointer, survive release rebuilds.
// Enabling strict mode additionally requires an operator-reviewed complete identity dry-run.
export async function questionIdentity(question: ContentQuestionRow): Promise<Identity | null> {
  let refs: unknown;
  try { refs = JSON.parse(question.question_source_refs_json ?? "null"); } catch { return null; }
  const sources = refs && typeof refs === "object" ? (refs as { sourceRefs?: unknown }).sourceRefs : null;
  if (!Array.isArray(sources) || !sources.length || !question.content_set || typeof question.question_no !== "number" || !Number.isInteger(question.question_no) || question.question_no <= 0) return null;
  const stable: string[][] = [];
  for (const ref of sources) {
    if (!ref || typeof ref.sourceId !== "string" || !ref.sourceId || typeof ref.pageBlock !== "string" || !ref.pageBlock || !/^[a-f0-9]{64}$/u.test(ref.sourceSha256 ?? "")) return null;
    stable.push([ref.sourceId.normalize("NFC"), ref.pageBlock.normalize("NFC")]);
  }
  // Ordinal comparison avoids runtime locale/ICU differences across releases.
  stable.sort((a, b) => { const left=JSON.stringify(a),right=JSON.stringify(b); return left < right ? -1 : left > right ? 1 : 0; });
  const base = ["skct-source-v1", question.content_set.normalize("NFC"), question.area_code.normalize("NFC"), stable];
  return {
    questionIdentity: await digest([...base, question.question_no]),
    material: JSON.stringify([...base, question.question_no]),
    bundleIdentity: await digest([...base, question.dependency_group_id ? "dependency" : question.question_no]),
  };
}
export function advanceProgress(progress: Progress, baseMs: number | null, now: number, hardDeadline: number, policy: TimePolicy) {
  if (progress.finished_at_utc || now >= Date.parse(progress.current_deadline_at_utc)) {
    throw new GroupExamError(409, "문항 마감 시간이 지났습니다. 서버 상태를 확인해 주세요.", "GROUP_PROGRESS_CONFLICT");
  }
  if (baseMs === null) return { ...progress, finished_at_utc: new Date(now).toISOString(), terminal_status: "submitted" as const };
  const remaining = policy === "carry_remaining" ? Math.max(0, Date.parse(progress.current_deadline_at_utc) - now) : 0;
  const deadline = Math.min(hardDeadline, now + baseMs + remaining);
  return { ...progress, current_position: progress.current_position + 1,
    current_opened_at_utc: new Date(now).toISOString(), current_deadline_at_utc: new Date(deadline).toISOString(),
    carried_ms: Math.max(0, deadline - now - baseMs) };
}
export function reconcileProgress(progress: Progress, baseTimesMs: number[], now: number, hardDeadline: number) {
  let next = { ...progress };
  if (next.finished_at_utc) return next;
  if (!next.connected_at_utc && now >= hardDeadline) return { ...next, finished_at_utc: new Date(hardDeadline).toISOString(), terminal_status: "no_show" as const };
  while (now >= Date.parse(next.current_deadline_at_utc)) {
    const expired = Date.parse(next.current_deadline_at_utc);
    if (next.current_position + 1 >= baseTimesMs.length || expired >= hardDeadline) {
      next = { ...next, finished_at_utc: new Date(Math.min(expired, hardDeadline)).toISOString(), terminal_status: "auto_submitted" };
      break;
    }
    next = { ...next, current_position: next.current_position + 1,
      current_opened_at_utc: new Date(expired).toISOString(),
      current_deadline_at_utc: new Date(Math.min(hardDeadline, expired + baseTimesMs[next.current_position + 1])).toISOString(), carried_ms: 0 };
  }
  return next;
}
