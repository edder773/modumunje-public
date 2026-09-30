import { withPrivateDiagramDimensions } from "../private-diagrams/private-diagram-dimensions";
import { AUTHENTICATED_USER_EMAIL_HEADER } from "@shared/auth/authenticated-user";
import { response, string, integer, idempotencyKey, sha256, canonicalJson, rawInviteToken, parseAnswers, safeJson, payload, errorResponse } from "./group-exam-http";
import { withGroupMetrics, groupMetricPhase } from "@backend/common/observability/group-exam-metrics";
import { beginPreparedRunV2, createRunV2, GROUP_EXAM_COUNTDOWN_MS, v2Enabled, strictRepeatEnabled, v2Repository, maintainV2, currentV2, currentV2Fast, mutateV2, orderedResultV2 } from "./group-exam-v2.service";
import {
  isAdminRequest,
  normalizedEmail,
  learnerUserHash,
  authorizeLearnerRequest,
  authorizeAdminRequest,
  verifyAdminMutationRequest,
  verifyUserMutationRequest,
} from "@backend/common/auth/admin-auth";
import {
  buildQuestionTimeline,
  approvedSkctNew300Release,
  competitionRanks,
  GroupExamError,
  groupName,
  INVITE_TTL_MS,
  kstDateKey,
  orderQuestionsByArea,
  parseGroupExamSettings,
  parseStoredGroupExamSettings,
  publicGroupName,
  SKCT_AREAS,
  selectRunQuestionBundles,
  validateMemberLimit,
  validateQuestionCount,
  FINALIZER_LEASE_MS,
  type SkctArea,
} from "./domain/group-exam.domain";
import {
  GroupExamRepository,
  type ContentQuestionRow,
  type MutationIdempotency,
  type RunRow,
} from "./group-exam.repository";
import { GroupExamAdvanceRepository } from "./group-exam-advance.repository";
import { GroupExamPresenceRepository } from "./group-exam-presence.repository";
import { GroupExamLobbyRepository } from "./group-exam-lobby.repository";
import { PRESENCE_TTL_MS, PRESENCE_RECENT_MS, questionCount, publicSyncRun, publicCurrentPayload, readSyncBody, lobbyDetail } from "./group-exam-view.service";
import { GroupExamAdminRepository } from "./group-exam-admin.repository";

const TOKEN_PATTERN = /^[a-zA-Z0-9_-]{43}$/u;
const PRESENCE_SESSION_PATTERN = /^[a-zA-Z0-9:_-]{16,100}$/u;
const repository = new GroupExamRepository();
const advanceRepository = new GroupExamAdvanceRepository();
const presenceRepository = new GroupExamPresenceRepository();
const lobbyRepository = new GroupExamLobbyRepository();
const adminRepository = new GroupExamAdminRepository();

type JsonObject = Record<string, unknown>;

function enabled() {
  return repository.serviceEnabled();
}

function unavailable() {
  return response({
    code: "SKCT_GROUP_SERVICE_DISABLED",
    error: "그룹 SKCT 서비스가 아직 운영 환경에서 활성화되지 않았습니다.",
  }, 503);
}

async function idempotentMutation(
  request: Request,
  body: JsonObject,
  actorUserKey: string,
  action: string,
  digestPayload: unknown,
  responsePayload: unknown,
  responseStatus: number,
  timestamp: string,
  mutation: (idempotency: MutationIdempotency) => Promise<void>,
  prefetched?: { replay: { request_digest: string; execution_id: string; response_status: number; response_json: string } | null; verifiedMutation: boolean },
  committedResponse = false,
) {
  const key = idempotencyKey(request, body);
  const requestDigest = await sha256(canonicalJson(digestPayload));
  const replay = prefetched ? prefetched.replay : await repository.readIdempotent(actorUserKey, action, key);
  if (replay) {
    if (replay.request_digest !== requestDigest) {
      throw new GroupExamError(409, "멱등성 키가 다른 요청에 사용되었습니다.", "GROUP_IDEMPOTENCY_CONFLICT");
    }
    return response(safeJson(replay.response_json, {}), replay.response_status);
  }
  const idempotency: MutationIdempotency = {
    actorUserKey, action, key, requestDigest, executionId: crypto.randomUUID(),
    responseStatus, response: responsePayload, timestamp,
  };
  try {
    await mutation(idempotency);
    if (committedResponse || prefetched?.verifiedMutation) return response(idempotency.response, responseStatus);
    const persisted = await repository.readIdempotent(actorUserKey, action, key);
    if (persisted) {
      if (persisted.request_digest !== requestDigest) {
        throw new GroupExamError(409, "멱등성 키가 다른 요청에 사용되었습니다.", "GROUP_IDEMPOTENCY_CONFLICT");
      }
      return response(safeJson(persisted.response_json, {}), persisted.response_status);
    }
    throw new GroupExamError(409, "요청 조건이 변경되어 작업을 완료하지 못했습니다.", "GROUP_MUTATION_CONFLICT");
  } catch (error) {
    if (error instanceof GroupExamError) {
      if (idempotency.mutationAttempted) await repository.assertNoPublishedIdempotent(idempotency);
      const concurrent = await repository.readIdempotent(actorUserKey, action, key);
      if (concurrent) {
        if (concurrent.request_digest !== requestDigest) {
          throw new GroupExamError(409, "멱등성 키가 다른 요청에 사용되었습니다.", "GROUP_IDEMPOTENCY_CONFLICT");
        }
        return response(safeJson(concurrent.response_json, {}), concurrent.response_status);
      }
      throw error;
    }
    const concurrent = await repository.readIdempotent(actorUserKey, action, key);
    if (concurrent) {
      if (concurrent.request_digest !== requestDigest) {
        throw new GroupExamError(409, "멱등성 키가 다른 요청에 사용되었습니다.", "GROUP_IDEMPOTENCY_CONFLICT");
      }
      return response(safeJson(concurrent.response_json, {}), concurrent.response_status);
    }
    throw error;
  }
}

async function account(request: Request, createIfMissing = false) {
  const authorization = await authorizeLearnerRequest(request, { createIfMissing,
    respectMaintenance: request.method === "POST" });
  return authorization.ok ? authorization.account : authorization.response;
}


function releaseValue(release: Record<string, unknown>, key: string) {
  return string(release[key], `문제은행 ${key}`, 256);
}

function asSelectable(question: ContentQuestionRow) {
  return {
    uid: question.question_uid,
    area: question.area_code as SkctArea,
    dependencyGroupId: question.dependency_group_id,
  };
}

function publicRun(run: RunRow) {
  return {
    id: run.id,
    groupId: run.group_id,
    mode: run.mode,
    status: run.status,
    scheduledAt: run.scheduled_at_utc,
    actualStartedAt: run.actual_started_at_utc,
    questionCount: run.question_count_snapshot,
    participantCount: run.participant_count_snapshot,
    finalDeadlineAt: run.final_deadline_at_utc,
    revision: run.revision,
    createdAt: run.created_at,
    completedAt: run.completed_at,
    canceledAt: run.canceled_at,
  };
}


function replayedRun(run: RunRow, mode: RunRow["mode"], scheduled: Date) {
  const sameRequest = run.mode === mode && (mode === "immediate" || run.scheduled_at_utc === scheduled.toISOString());
  if (!sameRequest) throw new GroupExamError(409, "시작 요청 키가 다른 요청에 사용되었습니다.", "GROUP_IDEMPOTENCY_CONFLICT");
  return { run: publicRun(run), replayed: true };
}

async function createRun(request: Request, body: JsonObject, userKey: string) {
  const groupId = string(body.groupId, "그룹 ID");
  const mode = body.mode === "scheduled" ? "scheduled" : body.mode === "immediate" ? "immediate" : null;
  if (!mode) throw new GroupExamError(400, "시작 방식을 확인해 주세요.", "GROUP_RUN_MODE_INVALID");
  if (mode === "scheduled") throw new GroupExamError(410, "시험 예약 기능이 종료되었습니다. 지금 시작을 이용해 주세요.", "GROUP_SCHEDULE_REMOVED");
  const key = idempotencyKey(request, body);
  const requestId = `${groupId}:${key}`;
  const now = new Date();
  const countdownEndsAt = new Date(now.getTime()+GROUP_EXAM_COUNTDOWN_MS);
  const scheduled = now;
  const replay = await repository.findRunByRequestId(requestId);
  if (replay) return replayedRun(replay, mode, scheduled);
  const group = await repository.groupForOwner(groupId, userKey);
  if (!group) throw new GroupExamError(403, "그룹 대표만 시험을 시작하거나 예약할 수 있습니다.", "GROUP_OWNER_REQUIRED");

  for (const legacy of await repository.scheduledRunsForDeprecation(groupId)) await repository.deprecateScheduledRun(legacy,now.toISOString());
  if (await repository.activeRunForGroup(groupId)) {
    throw new GroupExamError(409, "이미 진행 중인 그룹 시험이 있습니다.", "GROUP_RUN_ACTIVE");
  }

  const activeRelease = await repository.activeRelease();
  if (!activeRelease) throw new GroupExamError(503, "활성화된 검증 SKCT 문제은행이 없습니다.", "SKCT_RELEASE_UNAVAILABLE");
  if (!approvedSkctNew300Release(activeRelease)) throw new GroupExamError(503, "신규 작성 문항 문제은행이 활성화되기 전입니다.", "SKCT_RELEASE_UNAVAILABLE");
  const eligible = await repository.eligibleQuestions(releaseValue(activeRelease, "id"));
  const count = questionCount(group as unknown as Record<string, unknown>);
  const settings = parseStoredGroupExamSettings(group.settings_json);
  if (settings.repeatPolicy === "forbid") throw new GroupExamError(409,"개인 진행 시험 생성이 비활성화되어 반복 금지 시험을 시작할 수 없습니다.","GROUP_V2_CREATION_DISABLED");
  const selectionSeed = crypto.randomUUID();
  const selectionAlgorithmVersion = count === 50 ? "bundle-sha256-area10-v2" : "bundle-sha256-v1";
  const selectionHistoryCutoffUtc = now.toISOString();
  const selectionAreaPolicy = count === 50
    ? "validated-release:ten-per-area:dependency-bundle:exact-count-v2"
    : "validated-release:any-area:dependency-bundle:exact-count-v1";
  const selectionSettingsSchemaVersion = 1;
  const selectable = eligible.map(asSelectable);
  const history = await repository.usedQuestionUids(groupId, selectionHistoryCutoffUtc);
  const selectionHistoryDigestSha256 = await sha256([...history].sort().join("\n"));
  const selectedQuestions = orderQuestionsByArea(await selectRunQuestionBundles(selectable, count, selectionSeed));
  const selectedIds = selectedQuestions.map((item) => item.uid);
  const byId = new Map(eligible.map((item) => [item.question_uid, item]));
  const selected = selectedIds.map((id) => byId.get(id)).filter((item): item is ContentQuestionRow => Boolean(item));
  if (selected.length !== count) throw new GroupExamError(409, "정확한 문제 구성을 만들 수 없습니다.", "GROUP_QUESTION_SELECTION_UNAVAILABLE");
  const selectionSnapshotDigestSha256 = await sha256(canonicalJson({
    sourceReleaseId: releaseValue(activeRelease, "id"),
    sourceReleaseSha256: releaseValue(activeRelease, "release_sha256"),
    selectedIds,
    selectionSeed,
    selectionAlgorithmVersion,
    selectionHistoryCutoffUtc,
    selectionHistoryDigestSha256,
    selectionAreaPolicy,
    selectionSettingsSchemaVersion,
    repeatPolicy: "allow",
    settings,
  }));

  const members = await repository.activeMembers(groupId);
  if (members.length === 0) {
    throw new GroupExamError(409, "현재 참여 가능한 그룹원이 없습니다.", "GROUP_PARTICIPANTS_INSUFFICIENT");
  }
  const timeline = buildQuestionTimeline(selected.map((item) => ({
        area: item.area_code as SkctArea,
        timeLimitSeconds: settings.areaSeconds[item.area_code as SkctArea],
      })), countdownEndsAt);
  const quotaDate = kstDateKey(scheduled);
  await repository.ensureBaseQuotaSlot(groupId, quotaDate, now.toISOString());
  const slot = await repository.availableQuotaSlot(groupId, quotaDate);
  if (!slot) throw new GroupExamError(409, "해당 날짜의 그룹 응시 횟수를 모두 사용했습니다.", "GROUP_DAILY_QUOTA_EXHAUSTED");

  const runId = crypto.randomUUID();
  const run: RunRow = {
    id: runId,
    group_id: groupId,
    start_request_id: requestId,
    mode,
    status: "running",
    scheduled_at_utc: null,
    actual_started_at_utc: countdownEndsAt.toISOString(),
    quota_date_key: quotaDate,
    quota_slot_no: slot.slot_no,
    question_count_snapshot: count,
    settings_snapshot_json: JSON.stringify({
      ...settings,
      selection: {
        algorithm: selectionAlgorithmVersion,
        seed: selectionSeed,
        repeatPolicy: "allow",
        repeatFallback: false,
        historyCutoffUtc: selectionHistoryCutoffUtc,
        historyDigestSha256: selectionHistoryDigestSha256,
        snapshotDigestSha256: selectionSnapshotDigestSha256,
        areaPolicy: selectionAreaPolicy,
        settingsSchemaVersion: selectionSettingsSchemaVersion,
        selectedQuestionUidsSha256: await sha256(selectedIds.join("\n")),
        areaCounts: Object.fromEntries(SKCT_AREAS.map((area) => [
          area, selected.filter((item) => item.area_code === area).length,
        ])),
      },
    }),
    source_release_id: releaseValue(activeRelease, "id"),
    source_release_sha256: releaseValue(activeRelease, "release_sha256"),
    participant_count_snapshot: members.length,
    final_deadline_at_utc: timeline?.finalDeadlineAt ?? null,
    lease_owner: null,
    lease_until: null,
    revision: 0,
    created_by_user_key: userKey,
    created_at: now.toISOString(),
    completed_at: null,
    canceled_at: null,
    failure_code: null,
  };
  let created = false;
  try {
    created = await repository.createRun({
      run,
      selectionMetadata: {
        algorithmVersion: selectionAlgorithmVersion,
        seed: selectionSeed,
        historyCutoffUtc: selectionHistoryCutoffUtc,
        historyDigestSha256: selectionHistoryDigestSha256,
        snapshotDigestSha256: selectionSnapshotDigestSha256,
        repeatPolicy: "allow",
        repeatFallback: false,
        areaPolicy: selectionAreaPolicy,
        settingsSchemaVersion: selectionSettingsSchemaVersion,
      },
      slotNo: slot.slot_no,
      questions: selected.map((item, position) => ({
        ...item,
        position,
        timeLimitSeconds: settings.areaSeconds[item.area_code as SkctArea],
        opensAt: timeline?.items[position]?.opensAt ?? null,
        deadlineAt: timeline?.items[position]?.deadlineAt ?? null,
      })),
      participants: members,
      timestamp: now.toISOString(),
      finalDeadlineAt: timeline?.finalDeadlineAt ?? null,
      startGuard: { sql: `EXISTS(SELECT 1 FROM skct_content_releases
        WHERE id=? AND status='active' AND schema_version=? AND release_sha256=?)`,
        values: [releaseValue(activeRelease,"id"), releaseValue(activeRelease,"schema_version"),
          releaseValue(activeRelease,"release_sha256")] },
    });
  } catch {
    const concurrent = await repository.findRunByRequestId(requestId);
    if (concurrent) return replayedRun(concurrent, mode, scheduled);
    throw new GroupExamError(409, "다른 시작 요청과 충돌했습니다. 상태를 새로고침해 주세요.", "GROUP_RUN_CONFLICT");
  }
  if (!created) {
    const concurrent = await repository.findRunByRequestId(requestId);
    if (concurrent) return replayedRun(concurrent, mode, scheduled);
    throw new GroupExamError(409, "다른 시작 요청과 충돌했습니다. 상태를 새로고침해 주세요.", "GROUP_RUN_CONFLICT");
  }
  return { run: publicRun(run), replayed: false };
}


async function getHandler(request: Request) {
  if (!enabled()) return unavailable();
  const authorization = await account(request);
  if (authorization instanceof Response) return authorization;
  const url = new URL(request.url);
  const scope = url.searchParams.get("scope") ?? "groups";
  try {
    if (scope === "groups") {
      return response({ ...await repository.listGroupsWithOwnedCount(authorization.userKey), capabilities: { personalProgress: v2Enabled(), strictRepeat: strictRepeatEnabled(), webSocket: true } });
    }
    if (scope === "lobby") {
      const now = new Date();
      const snapshot = await lobbyRepository.initial(authorization.userKey, kstDateKey(now), now.toISOString(),
        new Date(now.getTime() - PRESENCE_TTL_MS).toISOString(), new Date(now.getTime() - PRESENCE_RECENT_MS).toISOString());
      const selectedGroupId = String(snapshot.group?.id ?? "");
      const run = snapshot.run;
      const scheduled = run?.status === "running" || run?.status === "finalizing" ? null : snapshot.scheduled;
      const presenceVersion = await sha256(canonicalJson(snapshot.presence.map((item) => [item.membership_id, item.presence_state, item.online])));
      const sync = selectedGroupId ? {
        current: null, serverNow: now.toISOString(), groupId: selectedGroupId,
        stateVersion: `${String(snapshot.group?.revision)}:${run?.id ?? scheduled?.id ?? "idle"}:${run?.revision ?? 0}:${run?.status ?? "idle"}`,
        presenceVersion,
        phase: run && (run.status === "running" || run.status === "finalizing") ? run.status : scheduled ? "scheduled" : run?.status ?? "idle",
        run: publicSyncRun(run ?? null), scheduledRun: scheduled ? publicSyncRun(scheduled) : null,
        presence: snapshot.presence,
      } : null;
      return response({ groups: snapshot.groups, ownedActiveCount: snapshot.ownedActiveCount,
        capabilities: { personalProgress: v2Enabled(), strictRepeat: strictRepeatEnabled(), webSocket: true }, selectedGroupId,
        detail: snapshot.group ? { group: lobbyDetail(snapshot.group, snapshot.slots, snapshot.scheduled, now), members: snapshot.members } : null,
        sync });
    }
    if (scope === "group") {
      const groupId = string(url.searchParams.get("groupId"), "그룹 ID");
      const now = new Date();
      const snapshot = await lobbyRepository.detail(groupId, authorization.userKey, kstDateKey(now), now.toISOString());
      const group = snapshot.group;
      if (!group) throw new GroupExamError(404, "그룹을 찾을 수 없습니다.", "GROUP_NOT_FOUND");
      return response({
        group: lobbyDetail(group, snapshot.slots, snapshot.scheduled, now),
        members: snapshot.members,
      });
    }
    if (scope === "history") {
      const groupId=string(url.searchParams.get("groupId"),"그룹 ID");
      const day=url.searchParams.get("day");
      if(day && (!/^\d{4}-\d{2}-\d{2}$/u.test(day) || Number.isNaN(Date.parse(`${day}T12:00:00Z`)) || new Date(`${day}T12:00:00Z`).toISOString().slice(0,10)!==day))
        throw new GroupExamError(400,"날짜를 확인해 주세요.","GROUP_INPUT_INVALID");
      const beforeAt=url.searchParams.get("beforeAt"),beforeId=url.searchParams.get("beforeId");
      if(beforeAt && (!beforeId || Number.isNaN(Date.parse(beforeAt)))) throw new GroupExamError(400,"기록 위치를 확인해 주세요.","GROUP_INPUT_INVALID");
      const result=await repository.ownHistory(groupId,authorization.userKey,beforeAt ? {at:beforeAt,id:beforeId!}:null,day);
      if(!result.visible) throw new GroupExamError(404,"그룹을 찾을 수 없습니다.","GROUP_NOT_FOUND");
      const records=result.records.slice(0,20),last=records.at(-1);
      return response({records,next:result.records.length>20 && last ? {at:last.attempt_at,id:last.id}:null});
    }
    if (scope === "sync") {
      const groupId = string(url.searchParams.get("groupId"), "그룹 ID");
      return response(await readSyncBody(groupId, authorization.userKey, new Date(), url.searchParams.get("includeCurrent") === "1",
        url.searchParams.get("stateVersion") ?? undefined, url.searchParams.get("presenceVersion") ?? undefined, runGroupExamMaintenance));
    }
    if (scope === "invite") {
      const token = string(url.searchParams.get("token"), "초대 토큰");
      if (!TOKEN_PATTERN.test(token)) throw new GroupExamError(404, "유효한 초대가 아닙니다.", "GROUP_INVITE_INVALID");
      const invite = await repository.inviteByDigest(await sha256(token));
      if (!invite || invite.status !== "active" || Date.parse(invite.expires_at) <= Date.now()) {
        throw new GroupExamError(410, "초대가 만료되었거나 취소되었습니다.", "GROUP_INVITE_UNAVAILABLE");
      }
      const group = await repository.groupById(invite.group_id);
      if (!group || group.status !== "active") throw new GroupExamError(410, "초대받은 그룹을 이용할 수 없습니다.", "GROUP_INVITE_UNAVAILABLE");
      return response({ invite: { groupId: group.id, groupName: group.name, expiresAt: invite.expires_at } });
    }
    if (scope === "current") {
      const requestTime = new Date();
      const requestedRunId = url.searchParams.get("runId");
      if (requestedRunId) {
        const fast = await currentV2Fast(requestedRunId, authorization.userKey, requestTime);
        if (fast) return response(fast);
      }
      const requestedRun = requestedRunId ? await repository.runById(requestedRunId) : null;
      const groupId = requestedRun?.group_id ?? string(url.searchParams.get("groupId"), "그룹 ID");
      await groupMetricPhase("maintenance", () => runGroupExamMaintenance(requestTime, groupId));
      const run = requestedRun ?? await repository.activeRunForGroup(groupId);
      if (run && await v2Repository.contract(run.id)) return response(await currentV2(run, authorization.userKey, requestTime));
      const participant = run ? await repository.participant(run.id, authorization.userKey) : null;
      if (!run || !participant) {
        throw new GroupExamError(404, "현재 참여 가능한 시험이 없습니다.", "GROUP_RUN_NOT_FOUND");
      }
      return response(await publicCurrentPayload(run, authorization.userKey, requestTime));
    }

    if (scope === "result") {
      const runId = string(url.searchParams.get("runId"), "시험 ID");
      const [run, self, v2Contract] = await Promise.all([
        repository.runById(runId), repository.participant(runId, authorization.userKey), v2Repository.contract(runId),
      ]);
      if (!run || run.status !== "completed" || !self) {
        throw new GroupExamError(404, "공개된 결과를 찾을 수 없습니다.", "GROUP_RESULT_NOT_FOUND");
      }
      const stillMember = await repository.activeMembership(run.group_id, authorization.userKey);
      const [orderedResults, all, personalReview, questionStats] = await Promise.all([
        v2Contract ? orderedResultV2(runId, authorization.userKey, stillMember) : Promise.resolve(undefined),
        v2Contract ? Promise.resolve([]) : repository.resultParticipants(runId),
        repository.personalReview(runId, authorization.userKey),
        stillMember ? repository.questionStatistics(runId) : Promise.resolve([]),
      ]);
      const ranked = competitionRanks(all.map((item) => ({
        publicName: String(item.public_name_snapshot),
        score: Number(item.score ?? 0),
        wrongCount: Number(item.wrong_count ?? 0),
        wrongPositions: safeJson(String(item.wrong_positions_json), []),
        self: item.user_key === authorization.userKey,
      })));
      const ranking = stillMember ? ranked : ranked.filter((item) => item.self);
      const review = personalReview.map((item) => ({
        position: item.position,
        area: item.area_code_snapshot,
        prompt: item.prompt_snapshot,
        choices: safeJson(String(item.choices_snapshot_json), []),
        answer: safeJson(String(item.answer_json), []),
        correctAnswers: safeJson(String(item.correct_answers_snapshot_json), []),
        explanation: item.explanation_snapshot,
        assets: safeJson(String(item.asset_refs_snapshot_json), []),
      }));
      return response({ run: { id: run.id, groupId: run.group_id, completedAt: run.completed_at, questionCount:run.question_count_snapshot }, ranking, review, questionStats, ...(orderedResults ? { contractVersion: 2, orderedResults } : {}) });
    }
    throw new GroupExamError(404, "지원하지 않는 조회입니다.", "GROUP_SCOPE_INVALID");
  } catch (error) {
    return errorResponse(error, { phase: "read", operation: scope });
  }
}

async function postHandler(request: Request) {
  if (!enabled()) return unavailable();
  const mutationError = verifyUserMutationRequest(request);
  if (mutationError) return mutationError;
  let action = "unknown";
  try {
    const body = await payload(request);
    action = string(body.action, "작업", 40);
    let progressPreflight: Awaited<ReturnType<typeof v2Repository.progressMutationSnapshot>> | undefined;
    const email = normalizedEmail(request.headers.get(AUTHENTICATED_USER_EMAIL_HEADER));
    // HTTP withSiteIdentity and WS authenticatedCall verify the Google cookie
    // and replace the identity header on every request. The atomic fast path
    // checks the active account, maintenance, immutable participant roster,
    // running contract, both CAS revisions and deadlines before any write.
    if(action === "question-advance" && email){
      const runId=string(body.runId,"시험 ID"),position=integer(body.position,"문항 위치",0,499);
      const revision=integer(body.expectedProgressRevision,"진행 리비전"),key=idempotencyKey(request,body);
      const answers=body.answers===undefined ? undefined:parseAnswers(body.answers);
      const answerRevision=answers ? integer(body.expectedAnswerRevision,"답안 리비전"):undefined;
      const userKey=await learnerUserHash(email),now=new Date().toISOString();
      const requestDigest=await sha256(canonicalJson({runId,position,expectedProgressRevision:revision,answers:answers??null,expectedAnswerRevision:answerRevision??null}));
      const answerHash=answers ? await sha256(JSON.stringify(answers)):undefined;
      const result=await groupMetricPhase("advance",()=>advanceRepository.advance({runId,userKey,position,revision,answers,answerRevision,
        answerHash,admin:isAdminRequest(request),now,
        idempotency:{actorUserKey:userKey,action,key,requestDigest,executionId:crypto.randomUUID(),responseStatus:200,response:{},timestamp:now},
      }));
      if(result.account_status === "blocked") return response({code:"ACCOUNT_BLOCKED",error:"관리자에 의해 이용이 제한된 계정입니다."},403);
      if(result.maintenance && !isAdminRequest(request)) return response({error:"현재 유지보수 중입니다. 잠시 후 다시 이용해 주세요."},503);
      if(result.response_json){
        if(result.request_digest!==requestDigest) throw new GroupExamError(409,"멱등성 키가 다른 요청에 사용되었습니다.","GROUP_IDEMPOTENCY_CONFLICT");
        const acknowledged=safeJson(result.response_json,{}) as Record<string,unknown>;
        if(Array.isArray(acknowledged.publicQuestionWindow)) acknowledged.publicQuestionWindow=acknowledged.publicQuestionWindow.map((question:Record<string,unknown>)=>({
          ...question,asset_refs_snapshot_json:withPrivateDiagramDimensions(question.asset_refs_snapshot_json),
        }));
        return response(acknowledged);
      }
    }
    // This header is populated only by authenticated HTTP/WS ingress. Overlap
    // independent reads, but authorize every operation before using or returning
    // a snapshot, including blocked-account and maintenance checks.
    const prefetch = (action === "question-advance" || action === "run-submit") && email;
    let authorization: Awaited<ReturnType<typeof account>>;
    if (prefetch) {
      const runId = string(body.runId, "시험 ID");
      const key = idempotencyKey(request, body);
      const position = Number(body.position);
      const userKey = await learnerUserHash(email);
      [authorization, progressPreflight] = await Promise.all([
        account(request, true),
        groupMetricPhase("preflight", () => v2Repository.progressMutationSnapshot(runId, userKey, action, key,
          Number.isInteger(position) && position >= 0 && position < 500 ? position + 1 : 0)),
      ]);
    } else authorization = await account(request, true);
    if (authorization instanceof Response) return authorization;
    const now = new Date().toISOString();
    const userKey = authorization.userKey;

    if (action === "group-create") {
      const id = crypto.randomUUID();
      const name = groupName(body.name);
      const publicName = publicGroupName(body.publicName ?? authorization.displayName);
      const memberLimit = validateMemberLimit(body.memberLimit ?? 50);
      const parsedSettings = parseGroupExamSettings(body.settings);
      if (parsedSettings.repeatPolicy === "forbid" && !strictRepeatEnabled()) throw new GroupExamError(409, "반복 금지 출처 검증이 아직 활성화되지 않았습니다.", "GROUP_REPEAT_IDENTITY_UNVERIFIED");
      const settingsJson = JSON.stringify(parsedSettings);
      const result = { id, name, member_limit: memberLimit, admin_question_count_override: null,
        settings_json: settingsJson, status: "active", revision: 0, created_at: now, updated_at: now,
        public_name: publicName, membership_epoch: 1, member_status: "active", is_owner: 1,
        active_members: 1, reserved_invites: 0 };
      return await idempotentMutation(request, body, userKey, action,
        { name, publicName, memberLimit, settings: safeJson(settingsJson, {}) }, { group: result }, 201, now,
        async (idempotency) => { await repository.createGroup({
          id, name, ownerUserKey: userKey, ownerPublicId: crypto.randomUUID(), publicName,
          memberLimit, settingsJson, timestamp: now, idempotency,
        }); });
    }
    if (action === "presence-heartbeat") {
      const groupId = string(body.groupId, "그룹 ID");
      const sessionId = string(body.sessionId, "presence session", 100);
      if (!PRESENCE_SESSION_PATTERN.test(sessionId)) {
        throw new GroupExamError(400, "presence session 값을 확인해 주세요.", "GROUP_PRESENCE_INVALID");
      }
      const pageContext = body.pageContext === "exam" ? "exam" : body.pageContext === "lobby" ? "lobby" : null;
      if (!pageContext) throw new GroupExamError(400, "presence 화면 정보를 확인해 주세요.", "GROUP_PRESENCE_INVALID");
      const heartbeatAt = new Date();
      const updated = await presenceRepository.heartbeat({
        groupId, userKey, sessionId, pageContext, visible: body.visible !== false,
        timestamp: heartbeatAt.toISOString(),
        staleBefore: new Date(heartbeatAt.getTime() - 24 * 60 * 60_000).toISOString(),
      });
      if (!updated) throw new GroupExamError(404, "그룹을 찾을 수 없습니다.", "GROUP_NOT_FOUND");
      if (body.includeSync === true && pageContext === "lobby") {
        return response(await readSyncBody(groupId, userKey, heartbeatAt, false,
          typeof body.stateVersion === "string" ? body.stateVersion : undefined,
          typeof body.presenceVersion === "string" ? body.presenceVersion : undefined, runGroupExamMaintenance));
      }
      return response({ serverNow: heartbeatAt.toISOString(), expiresInSeconds: PRESENCE_TTL_MS / 1_000 });
    }
    if (action === "invite-create") {
      const groupId = string(body.groupId, "그룹 ID");
      const token = rawInviteToken();
      const inviteId = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
      const reusable = body.reusable === true;
      const result = { invite: { id: inviteId, token, expiresAt, reusable } };
      return await idempotentMutation(request, body, userKey, action, body.reusable === undefined ? { groupId } : { groupId, reusable }, result, 201, now, async (idempotency) => {
        const owner = await repository.groupForOwner(groupId, userKey);
        if (!owner) throw new GroupExamError(403, "그룹 대표만 초대할 수 있습니다.", "GROUP_OWNER_REQUIRED");
        const occupied = (await repository.activeMembers(groupId)).length + await repository.activeInviteCount(groupId, now);
        if (occupied >= owner.member_limit) throw new GroupExamError(409, "그룹 정원이 모두 예약되었습니다.", "GROUP_CAPACITY_FULL");
        const invite = await repository.createInvite({ reusable, id: inviteId, groupId, digest: await sha256(token), expiresAt, actorUserKey: userKey, timestamp: now, idempotency });
        if (!invite) throw new GroupExamError(409, "그룹 정원이 모두 예약되었거나 그룹 상태가 바뀌었습니다.", "GROUP_CAPACITY_FULL");
      }, undefined, true);
    }
    if (action === "invite-resend") {
      const inviteId = string(body.inviteId, "초대 ID");
      const token = rawInviteToken();
      const nextId = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
      const result = { invite: { id: nextId, token, expiresAt } };
      return await idempotentMutation(request, body, userKey, action, { inviteId }, result, 200, now, async (idempotency) => {
        const previous = await repository.inviteById(inviteId);
        if (!previous) throw new GroupExamError(404, "초대를 찾을 수 없습니다.", "GROUP_INVITE_NOT_FOUND");
        if (!await repository.groupForOwner(previous.group_id, userKey)) throw new GroupExamError(404, "초대를 찾을 수 없습니다.", "GROUP_INVITE_NOT_FOUND");
        const invite = await repository.rotateInvite({ previous, nextId, nextDigest: await sha256(token), expiresAt, actorUserKey: userKey, timestamp: now, idempotency });
        if (!invite) throw new GroupExamError(409, "이미 사용되거나 취소된 초대입니다.", "GROUP_INVITE_UNAVAILABLE");
      });
    }
    if (action === "invite-revoke") {
      const groupId = string(body.groupId, "그룹 ID");
      const inviteId = string(body.inviteId, "초대 ID");
      return await idempotentMutation(request, body, userKey, action, { groupId, inviteId }, { revoked: true }, 200, now, async (idempotency) => {
        if (!await repository.groupForOwner(groupId, userKey)) throw new GroupExamError(403, "그룹 대표만 초대를 취소할 수 있습니다.", "GROUP_OWNER_REQUIRED");
        if (!await repository.revokeInvite(inviteId, groupId, userKey, now, idempotency)) throw new GroupExamError(409, "이미 사용되거나 취소된 초대입니다.", "GROUP_INVITE_UNAVAILABLE");
      });
    }
    if (action === "invite-accept") {
      const token = string(body.token, "초대 토큰");
      if (!TOKEN_PATTERN.test(token)) throw new GroupExamError(404, "유효한 초대가 아닙니다.", "GROUP_INVITE_INVALID");
      const publicName = publicGroupName(body.publicName ?? authorization.displayName);
      const tokenDigest = await sha256(token);
      const result = { accepted: true, groupId: "" };
      return await idempotentMutation(request, body, userKey, action, { tokenDigest, publicName }, result, 200, now, async (idempotency) => {
        const invite = await repository.inviteByDigest(tokenDigest);
        if (!invite) throw new GroupExamError(410, "초대가 만료되었거나 이미 사용되었습니다.", "GROUP_INVITE_UNAVAILABLE");
        result.groupId = invite.group_id;
        idempotency.response = result;
        if (invite.status !== "active") throw new GroupExamError(410, "초대가 만료되었거나 이미 사용되었습니다.", "GROUP_INVITE_UNAVAILABLE");
        const existing = await repository.member(invite.group_id, userKey);
        if (existing?.status === "active") throw new GroupExamError(409, "이미 이 그룹에 참여하고 있습니다.", "GROUP_ALREADY_MEMBER");
        const accepted = await repository.acceptInvite({ invite, userKey, publicId: crypto.randomUUID(), publicName, timestamp: now, idempotency });
        if (!accepted.accepted) throw new GroupExamError(409, "초대를 수락할 수 없습니다. 만료 여부와 정원을 확인해 주세요.", "GROUP_INVITE_ACCEPT_CONFLICT");
      });
    }
    if (action === "settings-update") {
      const groupId = string(body.groupId, "그룹 ID");
      const expectedRevision = integer(body.expectedRevision, "리비전");
      const memberLimit = validateMemberLimit(body.memberLimit);
      const parsedSettings = parseGroupExamSettings(body.settings);
      if (parsedSettings.repeatPolicy === "forbid" && !strictRepeatEnabled()) throw new GroupExamError(409, "반복 금지 출처 검증이 아직 활성화되지 않았습니다.", "GROUP_REPEAT_IDENTITY_UNVERIFIED");
      const settingsJson = JSON.stringify(parsedSettings);
      return await idempotentMutation(request, body, userKey, action, { groupId, expectedRevision, memberLimit, settings: safeJson(settingsJson, {}) }, { updated: true, settings: {member_limit:memberLimit, settings_json:settingsJson, revision:expectedRevision + 1} }, 200, now, async (idempotency) => {
        const updated = await repository.updateGroupSettings({ groupId, actorUserKey: userKey, expectedRevision, memberLimit, settingsJson, timestamp: now, idempotency });
        if (!updated) throw new GroupExamError(409, "설정이 변경되었거나 예약 인원이 정원을 초과합니다.", "GROUP_REVISION_CONFLICT");
      }, undefined, true);
    }
    if (action === "member-kick") {
      const groupId = string(body.groupId, "그룹 ID");
      const targetMembershipId = string(body.targetMembershipId, "그룹원");
      return await idempotentMutation(request, body, userKey, action, { groupId, targetMembershipId }, { kicked: true }, 200, now, async (idempotency) => {
        if (!await repository.kickMember({ groupId, actorUserKey: userKey, targetMembershipId, timestamp: now, idempotency })) throw new GroupExamError(409, "그룹원을 내보낼 수 없습니다.", "GROUP_MEMBER_CHANGE_CONFLICT");
      });
    }
    if (action === "owner-transfer") {
      const groupId = string(body.groupId, "그룹 ID");
      const targetMembershipId = string(body.targetMembershipId, "새 대표");
      return await idempotentMutation(request, body, userKey, action, { groupId, targetMembershipId }, { transferred: true }, 200, now, async (idempotency) => {
        if (!await repository.transferOwner({ groupId, actorUserKey: userKey, targetMembershipId, timestamp: now, idempotency })) throw new GroupExamError(409, "대표를 이관할 수 없습니다.", "GROUP_OWNER_TRANSFER_CONFLICT");
      });
    }
    if (action === "member-name-update") {
      const groupId=string(body.groupId,"그룹 ID"),publicName=publicGroupName(body.publicName,"그룹 닉네임");
      return await idempotentMutation(request,body,userKey,action,{groupId,publicName},{publicName},200,now,async(idempotency)=>{
        const renamed=await repository.renameSelf({groupId,userKey,publicName,timestamp:now,idempotency});
        if(!renamed)
          throw new GroupExamError(404,"활성 그룹원 정보를 찾을 수 없습니다.","GROUP_MEMBER_NOT_FOUND");
        idempotency.response=renamed;
      },undefined,true);
    }
    if (action === "group-leave") {
      const groupId = string(body.groupId, "그룹 ID");
      return await idempotentMutation(request, body, userKey, action, { groupId }, { status: "left" }, 200, now, async (idempotency) => {
        const result = await repository.leaveGroup({ groupId, userKey, timestamp: now, idempotency });
        if (result === "transfer_required") throw new GroupExamError(409, "대표는 먼저 다른 그룹원에게 대표를 이관해야 합니다.", "GROUP_OWNER_TRANSFER_REQUIRED");
        if (result === "missing") throw new GroupExamError(404, "활성 그룹원 정보를 찾을 수 없습니다.", "GROUP_MEMBER_NOT_FOUND");
      });
    }
    if (action === "group-delete") {
      const groupId=string(body.groupId,"그룹 ID");
      const expectedRevision=integer(body.expectedRevision,"리비전");
      const confirmedName=groupName(body.confirmedName);
      return await idempotentMutation(request,body,userKey,action,{groupId,expectedRevision,confirmedName},{deleted:true,status:"archived"},200,now,async(idempotency)=>{
        if(!await repository.archiveGroup({groupId,actorUserKey:userKey,expectedRevision,confirmedName,timestamp:now,idempotency})) {
          throw new GroupExamError(409,"그룹 이름 또는 상태가 변경되었습니다. 새로고침 후 다시 확인해 주세요.","GROUP_DELETE_CONFLICT");
        }
      });
    }
    if (action === "run-ready") return response(await beginPreparedRunV2(string(body.runId,"시험 ID"),userKey));
    if (action === "run-start") return response(v2Enabled() ? await createRunV2(body, userKey, idempotencyKey(request, body)) : await createRun(request, body, userKey), 201);
    if (action === "run-cancel") {
      throw new GroupExamError(410,"시험 예약 기능이 종료되었습니다.","GROUP_SCHEDULE_REMOVED");
    }
    if (action === "answer-save") {
      const runId = string(body.runId, "시험 ID");
      const position = integer(body.position, "문항 위치", 0, 499);
      const answers = parseAnswers(body.answers);
      const operationId = string(body.operationId, "답안 작업 ID");
      const answerHash = await sha256(JSON.stringify(answers));
      const preflight = await v2Repository.answerMutationSnapshot(runId, userKey, operationId);
      const replay = preflight.operation;
      if (replay) {
        if (replay.run_id !== runId || replay.user_key !== userKey || replay.position !== position || replay.answer_hash !== answerHash) throw new GroupExamError(409, "답안 작업 ID가 다른 요청에 사용되었습니다.", "GROUP_ANSWER_OPERATION_CONFLICT");
        return response({ saved: true, revision: replay.result_revision, replayed: true });
      }
      if (preflight.contract) {
        try {
          return response(await mutateV2({ runId, userKey, action: "answer-save", position,
            expectedProgressRevision: integer(body.expectedProgressRevision, "진행 리비전"),
            answer: { answers, expectedRevision: integer(body.expectedRevision, "답안 리비전"), operationId, hash: answerHash }, now: new Date(now), preflight }));
        } catch (error) {
          // Both identical requests may miss the first lookup. The losing CAS must
          // replay the committed operation, never ask the client to apply it again.
          const concurrent = await repository.answerOperation(operationId);
          if (!concurrent) throw error;
          if (concurrent.run_id !== runId || concurrent.user_key !== userKey || concurrent.position !== position || concurrent.answer_hash !== answerHash) {
            throw new GroupExamError(409,"답안 작업 ID가 다른 요청에 사용되었습니다.","GROUP_ANSWER_OPERATION_CONFLICT");
          }
          return response({saved:true,revision:concurrent.result_revision,replayed:true});
        }
      }
      const saved = await repository.saveAnswer({ runId, userKey, position, answerJson: JSON.stringify(answers), answerHash, expectedRevision: integer(body.expectedRevision, "답안 리비전"), operationId, timestamp: now });
      if (!saved) throw new GroupExamError(409, "답안 마감 시간이 지났거나 다른 기기에서 답안이 변경되었습니다.", "GROUP_ANSWER_CONFLICT");
      const answer = await repository.answerForParticipant(runId, userKey, position);
      return response({ saved: true, revision: answer?.revision, replayed: false });
    }
    if (action === "question-advance" || action === "run-submit") {
      const mutationAction = action;
      const runId = string(body.runId, "시험 ID");
      const key = idempotencyKey(request, body);
      const candidatePosition = Number(body.position);
      const preflight = progressPreflight ?? await v2Repository.progressMutationSnapshot(runId, userKey, action, key,
        Number.isInteger(candidatePosition) && candidatePosition >= 0 && candidatePosition < 500 ? candidatePosition + 1 : 0);
      if (preflight.contract) {
        const position = integer(body.position, "문항 위치", 0, 499);
        const expectedProgressRevision = integer(body.expectedProgressRevision, "진행 리비전");
        const answers = body.answers === undefined ? undefined : parseAnswers(body.answers);
        const expectedAnswerRevision = answers ? integer(body.expectedAnswerRevision, "답안 리비전") : undefined;
        const digestPayload = { runId, position, expectedProgressRevision, answers: answers ?? null, expectedAnswerRevision: expectedAnswerRevision ?? null };
        const result = { submitted: mutationAction === "run-submit", advanced: mutationAction === "question-advance", resultAvailable: false };
        return await idempotentMutation(request, body, userKey, action, digestPayload, result, 200, now, async (idempotency) => {
          const answer = answers ? { answers, expectedRevision: expectedAnswerRevision!, operationId: crypto.randomUUID(), hash: await sha256(JSON.stringify(answers)) } : undefined;
          await groupMetricPhase("commit", () => mutateV2({ runId, userKey, action: mutationAction, position, expectedProgressRevision, idempotency, now: new Date(now), answer, preflight }));
        }, { replay: preflight.replay, verifiedMutation: true });
      }
      if (action === "question-advance") throw new GroupExamError(409, "이 시험은 기존 공통 시간표로 진행합니다.", "GROUP_LEGACY_TIMELINE");
      const legacyRun=await repository.runById(runId);
      if(!legacyRun||!legacyRun.actual_started_at_utc||Date.parse(legacyRun.actual_started_at_utc)>Date.parse(now))throw new GroupExamError(409,"카운트다운이 끝난 뒤 제출할 수 있습니다.","GROUP_COUNTDOWN_ACTIVE");
      const result = { submitted: true, resultsAvailableAfterDeadline: true };
      return await idempotentMutation(request, body, userKey, action, { runId }, result, 200, now, async (idempotency) => {
        if (!await repository.submitParticipant(runId, userKey, now, idempotency)) throw new GroupExamError(409, "제출할 수 있는 진행 중 시험이 없습니다.", "GROUP_SUBMIT_CONFLICT");
      });
    }
    throw new GroupExamError(404, "지원하지 않는 작업입니다.", "GROUP_ACTION_INVALID");
  } catch (error) {
    return errorResponse(error, { phase: "mutation", operation: action });
  }
}

export async function runGroupExamMaintenance(now = new Date(), groupId?: string) {
  if (!enabled()) return { activated: 0, finalized: 0, failed: 0 };
  const timestamp = now.toISOString();
  const activated = 0;
  let failed = 0;
  for (let batch = 0; batch < 4; batch += 1) {
    const scheduled = await repository.scheduledRunsForDeprecation(groupId);
    for (const run of scheduled) if (await repository.deprecateScheduledRun(run,timestamp)) failed += 1;
    if (scheduled.length < 25) break;
  }

  let finalized = 0;
  for (const run of await repository.runsReadyToFinalize(timestamp, groupId)) {
    const leaseOwner = crypto.randomUUID();
    if (!await repository.claimFinalization(run.id, leaseOwner, timestamp, new Date(now.getTime() + FINALIZER_LEASE_MS).toISOString())) continue;
    const rows = await repository.gradingRows(run.id);
    const byUser = new Map<string, { participantStatus: string; wrong: number[]; score: number }>();
    for (const row of rows) {
      const userKey = String(row.user_key);
      const result = byUser.get(userKey) ?? { participantStatus: String(row.participant_status), wrong: [], score: 0 };
      const correct = JSON.stringify(safeJson(String(row.correct_answers_snapshot_json), [])) === JSON.stringify(safeJson(String(row.answer_json), []));
      if (correct) result.score += 1;
      else result.wrong.push(Number(row.position));
      byUser.set(userKey, result);
    }
    const complete = await repository.completeFinalization({
      run,
      leaseOwner,
      participantResults: [...byUser.entries()].map(([userKey, item]) => ({
        userKey,
        status: item.participantStatus === "rostered" ? "no_show" : item.participantStatus === "submitted" ? "submitted" : "auto_submitted",
        score: item.score,
        wrongPositions: item.wrong,
      })),
      timestamp,
    });
    if (complete) finalized += 1;
  }
  const v2 = await maintainV2(now, groupId);
  return { activated: activated + v2.activated, finalized: finalized + v2.finalized, failed: failed + v2.failed };
}

export async function POST_ADMIN(request: Request) {
  if (!enabled()) return unavailable();
  const authorization = await authorizeAdminRequest(request);
  if (!authorization.ok) return authorization.response;
  const mutationError = verifyAdminMutationRequest(request);
  if (mutationError) return mutationError;
  try {
    const body = await payload(request);
    const action = string(body.action, "작업");
    const groupId = string(body.groupId, "그룹 ID");
    const expectedRevision = integer(body.expectedRevision, "그룹 revision", 0);
    const now = new Date().toISOString();
    if(action==="group-delete"){
      const confirmedName=groupName(body.confirmedName);
      return await idempotentMutation(request,body,authorization.identity.hash,action,{groupId,expectedRevision,confirmedName},{deleted:true,status:"archived"},200,now,async(idempotency)=>{
        if(!await adminRepository.archiveGroupAsAdmin({groupId,confirmedName,expectedRevision,actorHash:authorization.identity.hash,timestamp:now,idempotency}))throw new GroupExamError(409,"그룹 이름 또는 상태가 변경되었습니다. 새로고침 후 다시 확인해 주세요.","GROUP_ADMIN_REVISION_CONFLICT");
      });
    }
    if (action === "quota-grant") {
      const dateKey = string(body.dateKey, "KST 날짜", 10);
      if (!/^\d{4}-\d{2}-\d{2}$/u.test(dateKey)) throw new GroupExamError(400, "KST 날짜는 YYYY-MM-DD 형식이어야 합니다.", "GROUP_DATE_INVALID");
      const count = integer(body.count, "추가 횟수", 1, 100);
      const result = { granted: count, revision: expectedRevision + 1 };
      return await idempotentMutation(request, body, authorization.identity.hash, action, { groupId, dateKey, count, expectedRevision }, result, 200, now, async (idempotency) => {
        const group = await repository.groupById(groupId);
        if (!group || group.status !== "active") throw new GroupExamError(404, "그룹을 찾을 수 없습니다.", "GROUP_NOT_FOUND");
        if (!await adminRepository.grantQuota({ groupId, dateKey, count,
          idempotencyKey: `quota-grant:${groupId}:${dateKey}:${idempotency.key}`,
          actorHash: authorization.identity.hash, timestamp: now, idempotency,
          expectedRevision, auditAction: "skct_group_quota_granted",
        })) throw new GroupExamError(409, "다른 관리자가 먼저 그룹을 변경했습니다.", "GROUP_ADMIN_REVISION_CONFLICT");
      });
    }
    if (action === "question-count-set") {
      const count = validateQuestionCount(body.count);
      return await idempotentMutation(request, body, authorization.identity.hash, action, { groupId, count, expectedRevision }, { updated: true, count, revision: expectedRevision + 1 }, 200, now, async (idempotency) => {
        const group = await repository.groupById(groupId);
        if (!group || group.status !== "active") throw new GroupExamError(404, "그룹을 찾을 수 없습니다.", "GROUP_NOT_FOUND");
        if (!await adminRepository.setQuestionCountOverride(groupId, count, authorization.identity.hash, now, idempotency, expectedRevision, group.admin_question_count_override)) throw new GroupExamError(409, "다른 관리자가 먼저 그룹을 변경했습니다.", "GROUP_ADMIN_REVISION_CONFLICT");
      });
    }
    if (action === "question-count-reset") {
      return await idempotentMutation(request, body, authorization.identity.hash, action, { groupId, expectedRevision }, { updated: true, count: null, revision: expectedRevision + 1 }, 200, now, async (idempotency) => {
        const group = await repository.groupById(groupId);
        if (!group || group.status !== "active") throw new GroupExamError(404, "그룹을 찾을 수 없습니다.", "GROUP_NOT_FOUND");
        if (!await adminRepository.resetQuestionCountOverride(groupId, authorization.identity.hash, now, idempotency, expectedRevision, group.admin_question_count_override)) {
          throw new GroupExamError(409, "다른 관리자가 먼저 그룹을 변경했습니다.", "GROUP_ADMIN_REVISION_CONFLICT");
        }
      });
    }
    if (action === "quota-reset") {
      const dateKey = string(body.dateKey, "KST 날짜", 10);
      if (!/^\d{4}-\d{2}-\d{2}$/u.test(dateKey)) throw new GroupExamError(400, "KST 날짜는 YYYY-MM-DD 형식이어야 합니다.", "GROUP_DATE_INVALID");
      const count = integer(body.count ?? 1, "복구 횟수", 1, 100);
      return await idempotentMutation(request, body, authorization.identity.hash, action, { groupId, dateKey, count, expectedRevision }, { restored: count, revision: expectedRevision + 1 }, 200, now, async (idempotency) => {
        const group = await repository.groupById(groupId);
        if (!group || group.status !== "active") throw new GroupExamError(404, "그룹을 찾을 수 없습니다.", "GROUP_NOT_FOUND");
        if (!await adminRepository.grantQuota({ groupId, dateKey, count,
          idempotencyKey: `quota-reset:${groupId}:${dateKey}:${idempotency.key}`,
          actorHash: authorization.identity.hash, timestamp: now, idempotency,
          expectedRevision, auditAction: "skct_group_quota_reset",
        })) throw new GroupExamError(409, "다른 관리자가 먼저 그룹을 변경했습니다.", "GROUP_ADMIN_REVISION_CONFLICT");
      });
    }
    throw new GroupExamError(404, "지원하지 않는 관리자 작업입니다.", "GROUP_ADMIN_ACTION_INVALID");
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET_ADMIN(request: Request) {
  if (!enabled()) return unavailable();
  const authorization = await authorizeAdminRequest(request);
  if (!authorization.ok) return authorization.response;
  try {
    const url = new URL(request.url);
    const page = integer(url.searchParams.get("page") ?? 1, "페이지", 1, 10_000);
    const pageSize = integer(url.searchParams.get("pageSize") ?? 20, "페이지 크기", 1, 100);
    const total = await repository.adminGroupCount();
    const todayKst = kstDateKey(new Date());
    const groups = await repository.adminGroupPage((page - 1) * pageSize, pageSize, todayKst);
    const areaCounts = await repository.activeReleaseAreaCounts();
    return response({
      groups,
      bank: {
        areaCounts,
        perAreaTenReady: SKCT_AREAS.every((area) => Number(areaCounts.find((item) => item.area === area)?.eligible_count ?? 0) >= 10),
        policy: "5개 영역 각각 10문항은 검증된 콘텐츠가 모두 준비된 뒤 별도 활성화",
      },
      pagination: { page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)) },
      todayKst,
      serverNow: new Date().toISOString(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export const GET = (request: Request) => withGroupMetrics(() => getHandler(request));
export const POST = (request: Request) => withGroupMetrics(() => postHandler(request));
