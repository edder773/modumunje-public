import { withPrivateDiagramDimensions } from "../private-diagrams/private-diagram-dimensions";
import { DEFAULT_GROUP_QUESTION_COUNT, GroupExamError, approvedSkctNew300Release, parseStoredGroupExamSettings, buildQuestionTimeline, selectRunQuestionBundles,
  kstDateKey, orderQuestionsByArea, type SkctArea } from "./domain/group-exam.domain";
import { advanceProgress, reconcileProgress, questionIdentity, digest, type Progress } from "./domain/group-exam-v2.domain";
import { GroupExamV2Repository, type ContractV2, type SelectedV2 } from "./group-exam-v2.repository";
import type { RunRow, MutationIdempotency } from "./group-exam.repository";

export const v2Repository = new GroupExamV2Repository();
export const v2Enabled = () => v2Repository.v2Enabled();
export const strictRepeatEnabled = () => v2Repository.strictRepeatEnabled();
const json = (text: unknown, fallback: unknown = []) => { try { return JSON.parse(String(text)); } catch { return fallback; } };
export const GROUP_EXAM_COUNTDOWN_MS = 5_000;

const publicQuestion = (question: Record<string, unknown>) => ({
  ...question,
  choices_snapshot_json: json(question.choices_snapshot_json),
  asset_refs_snapshot_json: withPrivateDiagramDimensions(json(question.asset_refs_snapshot_json)),
  answer_json: json(question.answer_json),
});

export async function selectV2Questions(run: RunRow, contract: ContractV2, timestamp: string) {
  const bank = await v2Repository.eligibleQuestions(run.source_release_id);
  const mapped = await Promise.all(bank.map(async q => ({ ...q, identity: await questionIdentity(q) })));
  const bundles = new Map<string, typeof mapped>();
  for (const q of mapped) if (q.dependency_group_id) bundles.set(q.dependency_group_id,[...(bundles.get(q.dependency_group_id) ?? []),q]);
  for (const bundle of bundles.values()) {
    if (bundle.every(q=>q.identity)) {
      const bundleIdentity = await digest(["skct-bundle-v1",bundle.map(q=>q.identity!.questionIdentity).sort()]);
      for (const q of bundle) q.identity!.bundleIdentity = bundleIdentity;
    }
  }
  const excluded = new Set((await v2Repository.claims(run.group_id)).map(x => x.question_identity));
  if (contract.repeat_policy === "forbid") {
    // The capability flag gates new strict settings/runs. Persisted strict scheduled runs
    // still drain after flags turn off; their immutable policy is never downgraded.
    if (mapped.some(q => !q.identity) || new Set(mapped.map(q=>q.identity?.questionIdentity)).size !== mapped.length) {
      throw new GroupExamError(409,"반복 금지에 필요한 문항 출처 확인이 완료되지 않았습니다.","GROUP_REPEAT_IDENTITY_UNVERIFIED");
    }
    for(const question of await v2Repository.historicalQuestions(run.group_id)) {
      const identity = await questionIdentity(question);
      if (!identity) throw new GroupExamError(409,"과거 출제 이력을 확인할 수 없어 반복 금지 시험을 시작할 수 없습니다.","GROUP_REPEAT_HISTORY_UNVERIFIED");
      excluded.add(identity.questionIdentity);
    }
  }
  const blockedBundles = new Set(mapped.filter(q=>q.identity && excluded.has(q.identity.questionIdentity)).map(q=>q.dependency_group_id).filter(Boolean));
  const candidates = contract.repeat_policy === "allow" ? mapped : mapped.filter(q => q.identity && !excluded.has(q.identity.questionIdentity) && (!q.dependency_group_id || !blockedBundles.has(q.dependency_group_id)));
  const seed = crypto.randomUUID();
  const chosen = orderQuestionsByArea(await selectRunQuestionBundles(candidates.map(q=>({ uid:q.question_uid,area:q.area_code as SkctArea,dependencyGroupId:q.dependency_group_id })),run.question_count_snapshot,seed));
  const settings = parseStoredGroupExamSettings(run.settings_snapshot_json);
  const byId=new Map(candidates.map(q=>[q.question_uid,q]));
  const selected:SelectedV2[]=chosen.map((item,position)=>({ ...byId.get(item.uid)!, position,timeLimitSeconds:settings.areaSeconds[item.area] }));
  contract.selection_json=JSON.stringify({ algorithm:run.question_count_snapshot===50 ? "source-identity-bundle-area10-v3" : "source-identity-bundle-v2", selectionStatus:"selected", identityVersion:1, repeatPolicy:contract.repeat_policy, seed, historyCutoffUtc:timestamp, historyDigest:await digest([...excluded].sort()),
    snapshotDigest:await digest(selected.map(q=>[q.question_uid,q.question_hash,q.identity])), releaseSha256:run.source_release_sha256, repeatFallback:false });
  return selected;
}

export async function createRunV2(body:Record<string,unknown>, userKey:string, key:string, now=new Date()) {
  const preparationStarted = performance.now();
  const groupId=String(body.groupId ?? "");
  const mode=body.mode;
  if(mode==="scheduled") throw new GroupExamError(410,"시험 예약 기능이 종료되었습니다. 지금 시작을 이용해 주세요.","GROUP_SCHEDULE_REMOVED");
  if(mode!=="immediate") throw new GroupExamError(400,"시작 방식을 확인해 주세요.","GROUP_RUN_MODE_INVALID");
  const scheduled=now;
  const requestId=`${groupId}:${key}`;
  const replay=await v2Repository.findRunByRequestId(requestId);
  if(replay) {
    if(replay.mode!==mode) throw new GroupExamError(409,"시작 요청 키가 다른 요청에 사용되었습니다.","GROUP_IDEMPOTENCY_CONFLICT");
    if(body.waitForView!==true)await v2Repository.recoverPreparedRun(replay, now);
    return {run:publicRunV2((await v2Repository.runById(replay.id))!),current:await currentV2Fast(replay.id,userKey,now),replayed:true};
  }
  const group=await v2Repository.groupForOwner(groupId,userKey);
  if(!group) throw new GroupExamError(403,"그룹 대표만 시험을 시작할 수 있습니다.","GROUP_OWNER_REQUIRED");
  const settings=parseStoredGroupExamSettings(group.settings_json);
  if(settings.repeatPolicy==="forbid" && !strictRepeatEnabled()) throw new GroupExamError(409,"반복 금지 출처 검증이 아직 활성화되지 않았습니다.","GROUP_REPEAT_IDENTITY_UNVERIFIED");
  for(const legacy of await v2Repository.scheduledRunsForDeprecation(groupId)) await v2Repository.deprecateScheduledRun(legacy,now.toISOString());
  if(await v2Repository.activeRunForGroup(groupId)) throw new GroupExamError(409,"이미 진행 중인 시험이 있습니다.","GROUP_RUN_ACTIVE");
  await v2Repository.ensureBaseQuotaSlot(groupId,kstDateKey(now),now.toISOString());
  const slot=await v2Repository.availableQuotaSlot(groupId,kstDateKey(now));
  if(!slot) throw new GroupExamError(409,"오늘 응시 횟수를 모두 사용했습니다.","GROUP_DAILY_QUOTA_EXHAUSTED");
  const release=await v2Repository.activeRelease();
  if(!release) throw new GroupExamError(503,"활성 검증 문제은행이 없습니다.","SKCT_RELEASE_UNAVAILABLE");
  if(!approvedSkctNew300Release(release)) throw new GroupExamError(503,"신규 작성 문항 문제은행이 활성화되기 전입니다.","SKCT_RELEASE_UNAVAILABLE");
  const timestamp=now.toISOString();
  const members=await v2Repository.activeMembers(groupId);
  if(!members.length) throw new GroupExamError(409,"참가자가 없습니다.","GROUP_PARTICIPANTS_INSUFFICIENT");
  const countdownEndsAt=new Date(now.getTime()+60_000);
  const actualStartTimestamp=countdownEndsAt.toISOString();
  const run:RunRow={id:crypto.randomUUID(),group_id:groupId,start_request_id:requestId,mode,status:"running",
    scheduled_at_utc:null,actual_started_at_utc:actualStartTimestamp,
    quota_date_key:kstDateKey(scheduled),quota_slot_no:0,question_count_snapshot:group.admin_question_count_override ?? DEFAULT_GROUP_QUESTION_COUNT,
    settings_snapshot_json:JSON.stringify(settings),source_release_id:String(release.id),source_release_sha256:String(release.release_sha256),
    participant_count_snapshot:members.length,final_deadline_at_utc:null,lease_owner:null,lease_until:null,revision:0,created_by_user_key:userKey,
    created_at:timestamp,completed_at:null,canceled_at:null,failure_code:null};
  const contract:ContractV2={run_id:run.id,advance_time_policy:settings.advanceTimePolicy ?? "carry_remaining",repeat_policy:settings.repeatPolicy,selection_json:JSON.stringify({algorithm:"source-identity-bundle-v2",selectionStatus:"pending_activation",identityVersion:1,repeatPolicy:settings.repeatPolicy,releaseSha256:run.source_release_sha256,repeatFallback:false})};
  const selected=await selectV2Questions(run,contract,timestamp);
  contract.selection_json=JSON.stringify({...JSON.parse(contract.selection_json),countdownStatus:"preparing"});
  const timeline=buildQuestionTimeline(selected.map(q=>({area:q.area_code as SkctArea,timeLimitSeconds:q.timeLimitSeconds})),countdownEndsAt);
  run.final_deadline_at_utc=timeline?.finalDeadlineAt ?? null;
  run.quota_slot_no=slot.slot_no;
  try {
    const created=await v2Repository.createRun({run,slotNo:slot.slot_no,questions:selected.map(q=>({...q,opensAt:timeline?.items[q.position].opensAt ?? null,deadlineAt:timeline?.items[q.position].deadlineAt ?? null})),
      participants:members,timestamp,finalDeadlineAt:run.final_deadline_at_utc,
      startGuard:v2Repository.startGuard(run,members),
      selectionMetadata:null,
      additionalStatements:[v2Repository.contractStatement(contract,timestamp),...v2Repository.startStatements(run,contract,selected,members,actualStartTimestamp,"EXISTS(SELECT 1 FROM study_group_exam_runs WHERE id=?)",[run.id])],
    });
    if(!created) throw new Error("start conflict");
  } catch {
    const concurrent=await v2Repository.findRunByRequestId(requestId);
    if(concurrent) {
      if(concurrent.mode!==mode) throw new GroupExamError(409,"시작 요청 키가 다른 요청에 사용되었습니다.","GROUP_IDEMPOTENCY_CONFLICT");
      return {run:publicRunV2(concurrent),replayed:true};
    }
    throw new GroupExamError(409,"다른 시작 요청과 충돌했습니다. 다시 확인해 주세요.","GROUP_RUN_CONFLICT");
  }
  if(body.waitForView===true)return {run:publicRunV2(run),current:{serverNow:new Date(now.getTime()+Math.ceil(performance.now()-preparationStarted)).toISOString(),phase:"preparing",canBegin:true,participantStatus:"in_progress",run:publicRunV2(run),question:null,publicQuestionWindow:[]},replayed:false};
  const readyAt = new Date(now.getTime() + Math.ceil(performance.now() - preparationStarted));
  const startAt = new Date(readyAt.getTime() + GROUP_EXAM_COUNTDOWN_MS);
  const readyTimeline = buildQuestionTimeline(selected.map(q=>({area:q.area_code as SkctArea,timeLimitSeconds:q.timeLimitSeconds})),startAt)!;
  const armed = await v2Repository.armPreparedRun(run, startAt.toISOString(), readyTimeline.finalDeadlineAt, readyTimeline.items);
  if (!armed) throw new GroupExamError(409,"시험 준비 상태를 확인하지 못했습니다. 다시 시도해 주세요.","GROUP_RUN_CONFLICT");
  run.actual_started_at_utc=startAt.toISOString();run.final_deadline_at_utc=readyTimeline.finalDeadlineAt;run.revision+=1;
  const current = {serverNow:new Date(now.getTime()+Math.ceil(performance.now()-preparationStarted)).toISOString(),phase:"countdown",countdownEndsAt:run.actual_started_at_utc,
    participantStatus:"in_progress",run:publicRunV2(run),question:null,publicQuestionWindow:[],
    progress:{position:0,revision:0,openedAt:run.actual_started_at_utc,deadlineAt:readyTimeline.items[0].deadlineAt,finishedAt:null,policy:contract.advance_time_policy}};
  return {run:publicRunV2(run),current,replayed:false};
}
export async function beginPreparedRunV2(runId:string,userKey:string) {
  const snapshot=await v2Repository.preparationSnapshot(runId);const {run,contract,questions}=snapshot;
  if(!run||run.created_by_user_key!==userKey)throw new GroupExamError(403,"시험을 시작한 대표만 준비를 완료할 수 있습니다.","GROUP_OWNER_REQUIRED");
  if(!contract)throw new GroupExamError(409,"시험 정보를 다시 확인해 주세요.","GROUP_RUN_CONFLICT");
  if(JSON.parse(contract.selection_json).countdownStatus!=="preparing")return {current:await currentV2Fast(runId,userKey,new Date())};
  const startAt=new Date(Date.now()+GROUP_EXAM_COUNTDOWN_MS);let cursor=startAt.getTime();
  const items=questions.map(question=>{const opensAt=new Date(cursor).toISOString();cursor+=question.time_limit_seconds*1000;return {opensAt,deadlineAt:new Date(cursor).toISOString()};});
  if(!items.length)throw new GroupExamError(409,"시험 문항을 준비하지 못했습니다.","GROUP_RUN_CONFLICT");
  const finalDeadline=new Date(cursor).toISOString();
  if(!await v2Repository.armPreparedRun(run,startAt.toISOString(),finalDeadline,items))return {current:await currentV2Fast(runId,userKey,new Date())};
  run.actual_started_at_utc=startAt.toISOString();run.final_deadline_at_utc=finalDeadline;run.revision+=1;
  return {current:{serverNow:new Date().toISOString(),phase:"countdown",countdownEndsAt:startAt.toISOString(),participantStatus:"in_progress",run:publicRunV2(run),question:null,publicQuestionWindow:[],progress:{position:0,revision:0,openedAt:startAt.toISOString(),deadlineAt:items[0].deadlineAt,finishedAt:null,policy:contract.advance_time_policy}}};
}
export function publicRunV2(run:RunRow) {
  return {id:run.id,groupId:run.group_id,mode:run.mode,status:run.status,scheduledAt:run.scheduled_at_utc,actualStartedAt:run.actual_started_at_utc,
    questionCount:run.question_count_snapshot,participantCount:run.participant_count_snapshot,finalDeadlineAt:run.final_deadline_at_utc,revision:run.revision,contractVersion:2};
}
export async function reconcileV2(run:RunRow, now:Date, onlyUserKey?:string) {
  if(run.status!=="running") return;
  const progress=onlyUserKey ? [await v2Repository.progress(run.id,onlyUserKey)].filter((p):p is Progress=>Boolean(p)) : await v2Repository.progressRows(run.id);
  if(!progress.some(p=>!p.finished_at_utc && Date.parse(p.current_deadline_at_utc)<=now.getTime())) return;
  const times=(await v2Repository.questionsForRun(run.id)).map(q=>q.time_limit_seconds*1000);
  for(const p of progress) await v2Repository.reconcileCAS(p,reconcileProgress(p,times,now.getTime(),Date.parse(run.final_deadline_at_utc!)));
}
export async function finalizeV2(run:RunRow, now:Date) {
  const execution=crypto.randomUUID();
  if(!await v2Repository.claimV2Finalization(run.id,execution,now.toISOString(),new Date(now.getTime()+30_000).toISOString())) return false;
  const byUser=new Map<string,{userKey:string;correct:number;incorrect:number;unanswered:number;wrong:number[]}>();
  for(const row of await v2Repository.gradingRows(run.id)) {
    const userKey=String(row.user_key);
    const result=byUser.get(userKey) ?? {userKey,correct:0,incorrect:0,unanswered:0,wrong:[]};
    const answer=json(row.answer_json) as unknown[];
    if(!answer.length) result.unanswered++;
    else if(JSON.stringify(answer)===JSON.stringify(json(row.correct_answers_snapshot_json))) result.correct++;
    else {result.incorrect++;result.wrong.push(Number(row.position));}
    byUser.set(userKey,result);
  }
  return v2Repository.completeV2(run,execution,now.toISOString(),[...byUser.values()]);
}
export async function maintainV2(now=new Date(),groupId?:string) {
  const activated=0;
  let finalized=0,failed=0;
  for(const run of await v2Repository.dueV2(now.toISOString(),groupId)) {
    const contract=await v2Repository.contract(run.id);
    if(run.status==="running"&&json(contract?.selection_json,{})?.countdownStatus==="preparing"){await v2Repository.recoverPreparedRun(run,now);continue;}
    if(run.status==="scheduled") {
      if(await v2Repository.deprecateScheduledRun(run,now.toISOString())) failed++;
    } else {
      await reconcileV2(run,now);
      if(await finalizeV2(run,now)) finalized++;
    }
  }
  return {activated,finalized,failed};
}
type PublicCurrentV2 = {
 serverNow:string;participantStatus:string;canBegin:boolean;run:ReturnType<typeof publicRunV2>;phase:string;
 countdownEndsAt?:string|null;question:Record<string,unknown>|null;publicQuestionWindow:Record<string,unknown>[];
 progress?:{revision:number;position:number;carriedMs:number;openedAt:string;deadlineAt:string;finishedAt:string|null;policy:ContractV2["advance_time_policy"]};
};
export async function currentV2(run:RunRow,userKey:string,now:Date):Promise<PublicCurrentV2|null> {
  const contract=(await v2Repository.contract(run.id))!;
  if(run.status==="running"&&json(contract.selection_json,{})?.countdownStatus==="preparing")return currentV2Fast(run.id,userKey,now);
  let progress=await v2Repository.progress(run.id,userKey);
  if(!progress) throw new GroupExamError(404,"현재 참여 가능한 시험이 없습니다.","GROUP_RUN_NOT_FOUND");
  await reconcileV2(run,now,userKey);
  if (!progress.connected_at_utc) await v2Repository.markConnected(run.id,userKey,now.toISOString());
  progress=(await v2Repository.progress(run.id,userKey))!;
  if (progress.finished_at_utc) await finalizeV2(run,now);
  const latest=(await v2Repository.runById(run.id))!;
  const countdownEndsAt=latest.actual_started_at_utc;
  const inCountdown=latest.status==="running" && countdownEndsAt !== null && now.getTime()<Date.parse(countdownEndsAt);
  const window=latest.status==="running" && !inCountdown && Date.parse(progress.current_opened_at_utc)<=now.getTime() ? await v2Repository.publicWindow(run.id,userKey,progress.current_position):[];
  const question=window[0] ?? null;
  return {serverNow:now.toISOString(),participantStatus:progress.terminal_status ?? "in_progress",canBegin:latest.created_by_user_key===userKey,run:publicRunV2(latest),
    phase:inCountdown && json(contract.selection_json,{})?.countdownStatus === "preparing" ? "preparing" : inCountdown ? "countdown" : latest.status,
    countdownEndsAt,
    progress:{revision:progress.revision,position:progress.current_position,carriedMs:progress.carried_ms,openedAt:progress.current_opened_at_utc,deadlineAt:progress.current_deadline_at_utc,finishedAt:progress.finished_at_utc,policy:contract.advance_time_policy},
    question:question ? publicQuestion(question):null,
    publicQuestionWindow:window.map(publicQuestion)};
}
export async function currentV2Fast(runId:string,userKey:string,now:Date):Promise<PublicCurrentV2|null> {
  const snapshot=await v2Repository.currentSnapshot(runId,userKey,now.toISOString());
  if(!snapshot.contract) return null;
  const {run,progress,contract}=snapshot;
  if(!run || !progress) throw new GroupExamError(404,"현재 참여 가능한 시험이 없습니다.","GROUP_RUN_NOT_FOUND");
  if(run.status==="running"&&json(contract.selection_json,{})?.countdownStatus==="preparing") {
    if(run.actual_started_at_utc&&Date.parse(run.actual_started_at_utc)<=now.getTime()) {
      await v2Repository.recoverPreparedRun(run,now);
      return currentV2Fast(runId,userKey,now);
    }
    return {serverNow:now.toISOString(),phase:"preparing",canBegin:run.created_by_user_key===userKey,
      participantStatus:"in_progress",run:publicRunV2(run),question:null,publicQuestionWindow:[]};
  }
  if((run.status==="running" && run.final_deadline_at_utc && Date.parse(run.final_deadline_at_utc)<=now.getTime())
    || (run.status==="running" && !progress.finished_at_utc && Date.parse(progress.current_deadline_at_utc)<=now.getTime())
    || (run.status==="running" && progress.finished_at_utc)) {
    await reconcileV2(run,now,userKey);
    if(progress.finished_at_utc || (run.final_deadline_at_utc && Date.parse(run.final_deadline_at_utc)<=now.getTime())) await finalizeV2(run,now);
    return currentV2(run,userKey,now);
  }
  const countdownEndsAt=run.actual_started_at_utc;
  const inCountdown=run.status==="running" && countdownEndsAt!==null && now.getTime()<Date.parse(countdownEndsAt);
  const window=run.status==="running" && !inCountdown && !progress.finished_at_utc
    && Date.parse(progress.current_opened_at_utc)<=now.getTime() ? snapshot.window : [];
  const question=window[0] ?? null;
  return {serverNow:now.toISOString(),participantStatus:progress.terminal_status ?? "in_progress",canBegin:run.created_by_user_key===userKey,run:publicRunV2(run),
    phase:inCountdown && json(contract.selection_json,{})?.countdownStatus === "preparing" ? "preparing" : inCountdown ? "countdown" : run.status,countdownEndsAt,
    progress:{revision:progress.revision,position:progress.current_position,carriedMs:progress.carried_ms,openedAt:progress.current_opened_at_utc,
      deadlineAt:progress.current_deadline_at_utc,finishedAt:progress.finished_at_utc,policy:contract.advance_time_policy},
    question:question ? publicQuestion(question):null,publicQuestionWindow:window.map(publicQuestion)};
}
export async function mutateV2(input:{runId:string;userKey:string;action:"answer-save"|"question-advance"|"run-submit";position:number;expectedProgressRevision:number;
  answer?:{answers:number[];expectedRevision:number;operationId:string;hash:string}; idempotency?:MutationIdempotency;now:Date;
  preflight?:{run:RunRow|null;progress:Progress|null;contract:ContractV2|null;window:Record<string,unknown>[];nextTimeLimit?:number|null}}) {
  const run=input.preflight ? input.preflight.run : await v2Repository.runById(input.runId);
  const before=input.preflight ? input.preflight.progress : await v2Repository.progress(input.runId,input.userKey);
  const contract=input.preflight ? input.preflight.contract : await v2Repository.contract(input.runId);
  if(!run || !before || !contract || run.status!=="running" || before.finished_at_utc || before.revision!==input.expectedProgressRevision) throw new GroupExamError(409,"시험 진행 상태가 변경되었습니다. 다시 확인해 주세요.","GROUP_PROGRESS_CONFLICT");
  if(json(contract.selection_json,{})?.countdownStatus==="preparing")throw new GroupExamError(409,"시험 준비가 끝난 뒤 응시할 수 있습니다.","GROUP_COUNTDOWN_ACTIVE");
  let after=before;
  if(input.action==="question-advance") {
    const nextSeconds=input.preflight ? input.preflight.nextTimeLimit : (await v2Repository.questionsForRun(input.runId))[before.current_position+1]?.time_limit_seconds;
    after=advanceProgress(before,nextSeconds ? nextSeconds*1000 : null,input.now.getTime(),Date.parse(run.final_deadline_at_utc!),contract.advance_time_policy);
  } else if(input.action==="run-submit") after={...before,finished_at_utc:input.now.toISOString(),terminal_status:"submitted"};
  const queriedWindow=!after.finished_at_utc && Date.parse(after.current_opened_at_utc)<=input.now.getTime()
    ? input.preflight ? input.preflight.window : await v2Repository.publicWindow(input.runId,input.userKey,after.current_position) : [];
  const window=queriedWindow.map((row,index)=>index===0?{...row,opens_at_utc:after.current_opened_at_utc,deadline_at_utc:after.current_deadline_at_utc}:row);
  if (input.idempotency) input.idempotency.response = {submitted:Boolean(after.finished_at_utc),advanced:input.action === "question-advance",saved:true,
    revision:input.answer ? input.answer.expectedRevision+1:undefined,progressRevision:before.revision+1,position:after.current_position,
    deadlineAt:after.current_deadline_at_utc,publicQuestionWindow:window.map(publicQuestion)};
  const mutation=await v2Repository.mutateProgress({before,after,timestamp:input.now.toISOString(),position:input.position,expectedProgressRevision:input.expectedProgressRevision,
    answer:input.answer,idempotency:input.idempotency});
  if(!mutation.saved) throw new GroupExamError(409,"마감 시간이 지났거나 다른 화면에서 상태를 변경했습니다.","GROUP_PROGRESS_CONFLICT");
  // A non-terminal answer/advance cannot make the run finalizable. Avoid two
  // group-wide D1 round trips on the foreground path; the terminal mutation,
  // current/deadline reconciliation, and maintenance still own finalization.
  if (after.finished_at_utc && mutation.needsReconcile && !mutation.finalized) {
    await reconcileV2(run,input.now);
    await finalizeV2(run,input.now);
  }
  return {saved:true,revision:input.answer ? input.answer.expectedRevision+1:undefined,progressRevision:before.revision+1,
    position:after.current_position,deadlineAt:after.current_deadline_at_utc,submitted:Boolean(after.finished_at_utc),
    publicQuestionWindow:window.map(publicQuestion)};
}
export async function orderedResultV2(runId:string,userKey:string,stillMember:boolean) {
  const all=await v2Repository.orderedResults(runId);
  let previous:number|null=null,rank=0;
  return all.map((p,index)=>{
    if(p.correct_count!==previous) rank=index+1;
    previous=p.correct_count;
    return {order:index+1,rank,participantId:p.participant_id,publicName:p.public_name_snapshot,self:p.user_key===userKey,status:p.terminal_status,
      totalElapsedMs:p.terminal_status==="no_show" ? null:Date.parse(p.finished_at_utc!)-Date.parse(p.started_at_utc),
      correctCount:p.correct_count,incorrectCount:p.incorrect_count,unansweredCount:p.unanswered_count};
  }).filter(p=>stillMember || p.self);
}
