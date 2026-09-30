import { withPrivateDiagramDimensions } from "../private-diagrams/private-diagram-dimensions";
import { groupMetricPhase } from "@backend/common/observability/group-exam-metrics";
import { canonicalJson, safeJson, sha256 } from "./group-exam-http";
import { currentV2, v2Repository } from "./group-exam-v2.service";
import { DEFAULT_GROUP_QUESTION_COUNT, GroupExamError, kstDateKey, nextKstMidnight, validateQuestionCount } from "./domain/group-exam.domain";
import { GroupExamRepository, type RunRow } from "./group-exam.repository";

export const PRESENCE_TTL_MS = 60_000;
export const PRESENCE_RECENT_MS = 5 * 60_000;
const repository = new GroupExamRepository();

export function questionCount(group: Record<string, unknown>) {
  return validateQuestionCount(group.admin_question_count_override ?? DEFAULT_GROUP_QUESTION_COUNT);
}

export function publicSyncRun(run: RunRow | null) {
  if (!run) return null;
  return {
    id: run.id,
    groupId: run.group_id,
    phase: run.status,
    scheduledAt: run.scheduled_at_utc,
    actualStartedAt: run.actual_started_at_utc,
    finalDeadlineAt: run.final_deadline_at_utc,
    questionCount: run.question_count_snapshot,
    participantCount: run.participant_count_snapshot,
    revision: run.revision,
    resultAvailable: run.status === "completed",
  };
}

export async function publicCurrentPayload(run: RunRow, userKey: string, now: Date) {
  if (await v2Repository.contract(run.id)) return currentV2(run,userKey,now);
  const participant = await repository.participant(run.id,userKey);
  const question = await repository.currentPublicQuestion(run.id,userKey,now.toISOString());
  const countdownEndsAt=run.actual_started_at_utc;
  const inCountdown=run.status==="running"&&countdownEndsAt!==null&&now.getTime()<Date.parse(countdownEndsAt);
  return {serverNow:now.toISOString(),participantStatus:participant?.status,phase:inCountdown?"countdown":run.status,countdownEndsAt,
    run:{id:run.id,status:run.status,finalDeadlineAt:run.final_deadline_at_utc,questionCount:run.question_count_snapshot},
    question:question ? {...question,choices_snapshot_json:safeJson(String(question.choices_snapshot_json),[]),asset_refs_snapshot_json:withPrivateDiagramDimensions(safeJson(String(question.asset_refs_snapshot_json),[])),answer_json:safeJson(String(question.answer_json ?? "[]"),[])} : null};
}

export async function readSyncBody(groupId: string, userKey: string, now: Date, includeCurrent: boolean, knownState: string | undefined, knownPresence: string | undefined, maintenance: (now: Date, groupId: string) => Promise<unknown>) {
  const onlineCutoff = new Date(now.getTime() - PRESENCE_TTL_MS).toISOString();
  const recentCutoff = new Date(now.getTime() - PRESENCE_RECENT_MS).toISOString();
  let snapshot = await repository.syncSnapshot(groupId, userKey, now.toISOString(), onlineCutoff, recentCutoff);
  if (snapshot.group && (snapshot.dueScheduled || (snapshot.run && snapshot.run.status !== "completed" && !snapshot.run.has_v2_contract))) {
    await groupMetricPhase("maintenance", () => maintenance(now, groupId));
    snapshot = await repository.syncSnapshot(groupId, userKey, now.toISOString(), onlineCutoff, recentCutoff);
  }
  const { group, presence } = snapshot;
  const run = snapshot.run;
  if (!group) {
    if (!run?.has_v2_contract) throw new GroupExamError(404, "그룹을 찾을 수 없습니다.", "GROUP_NOT_FOUND");
    const current = includeCurrent ? await currentV2(run, userKey, now) : null;
    return { serverNow: current?.serverNow ?? now.toISOString(), groupId, phase: run.status,
      run: publicSyncRun(run), presence: [], current };
  }
  const scheduled = run?.status === "running" || run?.status === "finalizing" ? null : snapshot.scheduled;
  const stateVersion = `${String(group.revision)}:${run?.id ?? scheduled?.id ?? "idle"}:${run?.revision ?? 0}:${run?.status ?? "idle"}`;
  const presenceVersion = await sha256(canonicalJson(presence.map((item) => [item.membership_id, item.presence_state, item.online])));
  if (!includeCurrent && knownState === stateVersion) {
    return { unchanged: true, serverNow: now.toISOString(), groupId, stateVersion, presenceVersion,
      ...(knownPresence === presenceVersion ? {} : { presence }) };
  }
  const current = includeCurrent && run && (run.status === "running" || run.status === "finalizing")
    ? await publicCurrentPayload(run, userKey, now) : null;
  return { current, serverNow: now.toISOString(), groupId, stateVersion, presenceVersion,
    phase: run && (run.status === "running" || run.status === "finalizing") ? run.status : scheduled ? "scheduled" : run?.status ?? "idle",
    run: publicSyncRun(run ?? null), scheduledRun: scheduled ? publicSyncRun(scheduled) : null, presence };
}

export function lobbyDetail(group: Record<string, unknown>, slots: Record<string, unknown>[], scheduled: RunRow | null, now: Date) {
  const dateKey = kstDateKey(now);
  const hasBase = slots.some((slot) => slot.source === "base");
  const virtualBase = hasBase ? 0 : 1;
  return { ...group, lobby: {
    serverNow: now.toISOString(), quotaDateKey: dateKey,
    quotaTotal: slots.length + virtualBase,
    quotaRemaining: slots.filter((slot) => slot.status === "available").length + virtualBase,
    nextQuotaResetAt: nextKstMidnight(now), effectiveQuestionCount: questionCount(group),
    questionCountAdminSet: group.admin_question_count_override !== null,
    scheduledRun: scheduled ? { id: scheduled.id, scheduledAt: scheduled.scheduled_at_utc } : null,
  } };
}
