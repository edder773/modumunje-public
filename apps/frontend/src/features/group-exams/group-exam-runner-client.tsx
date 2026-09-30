"use client";

import {useCallback,useEffect,useRef,useState,useSyncExternalStore} from "react";
import {useRouter} from "next/navigation";
import {takeGroupExamStart} from "./group-exam-start-state";
import {QuestionRenderer} from "./group-exam-question-renderer";
import {groupExamApi as api,GroupApiError} from "./group-exam-api";
import {claimQueue,deleteDraft,deleteQueue,deleteQueueIfMatch,getQueue,loadDraft,payloadDigest,putQueue,releaseQueue,saveDraft,type QueuedGroupExamMutation} from "./group-exam-queue";
import { connectGroupSocket, type GroupSocketStatus } from "./group-exam-socket";
import SkctExamTools from "@frontend/features/study/components/skct-personal/skct-exam-tools";
import styles from "./group-exam.module.css";

type Json=Record<string,unknown>;
type Current={canBegin?:boolean;serverNow:string;phase:string;countdownEndsAt?:string;participantStatus:string;run:Json;progress?:Json;question:Json|null;publicQuestionWindow?:Json[]};
const key=(prefix:string)=>`${prefix}:${crypto.randomUUID()}`;

function subscribeOnline(notify:()=>void){
  window.addEventListener("online",notify);
  window.addEventListener("offline",notify);
  return ()=>{window.removeEventListener("online",notify);window.removeEventListener("offline",notify);};
}
const readOnline=()=>navigator.onLine;
const readServerOnline=()=>true;

export function GroupExamRunnerClient({runId}:{runId:string}){
  const router=useRouter();
  const owner=useRef(crypto.randomUUID());
  const leaseTimer=useRef(0);
  const loadPromise=useRef<Promise<Current>|null>(null);
  const loadSequence=useRef(0);
  const appliedSequence=useRef(0);
  const countdownRefreshNotBefore=useRef(0);
  const countdownArmed=useRef(false);
  const beginning=useRef(false);
  const advanceView=useRef<{position:number;started:number}|null>(null);
  const [current,setCurrent]=useState<Current|null>(null);
  const [display,setDisplay]=useState<Json|null>(null);
  const [answers,setAnswers]=useState<number[]>([]);
  const [status,setStatus]=useState<"loading"|"countdown"|"ready"|"syncing"|"retry"|"complete"|"error">("loading");
  const [message,setMessage]=useState("시험 상태를 확인하고 있습니다.");
  const [countdownRemaining,setCountdownRemaining]=useState(5);
  const [questionRemaining,setQuestionRemaining]=useState(0);
  const [timerAnnouncement,setTimerAnnouncement]=useState("");
  const [offset,setOffset]=useState(0);
  const [pending,setPending]=useState<QueuedGroupExamMutation|null>(null);
  const [socketStatus,setSocketStatus]=useState<GroupSocketStatus>("connecting");
  const pendingRef=useRef(false);pendingRef.current=Boolean(pending)||status==="syncing";
  const online=useSyncExternalStore(subscribeOnline,readOnline,readServerOnline);
  const heading=useRef<HTMLHeadingElement>(null);
  const channel=useRef<BroadcastChannel|null>(null);

  const adopt=useCallback(async(body:Current)=>{
    if(body.phase==="preparing"&&countdownArmed.current)return;
    if(body.phase==="countdown")countdownArmed.current=true;
    setCurrent(body);setOffset(Date.parse(body.serverNow)-Date.now());
    if(body.phase==="preparing"){setDisplay(null);setStatus("loading");setMessage("시험을 준비하고 있습니다…");return;}
    if(body.phase==="countdown"){setDisplay(null);setStatus("countdown");setMessage("모든 참가자가 같은 시각에 시작합니다.");return;}
    if(["submitted","auto_submitted","no_show"].includes(body.participantStatus)||body.run.status==="completed"){setDisplay(null);setStatus("complete");setMessage("응시가 끝났습니다. 그룹 시험이 모두 끝나면 대기실에서 결과를 확인할 수 있습니다.");return;}
    setDisplay(body.question);setStatus("ready");setMessage("답안을 선택한 뒤 다음 문항으로 이동하세요.");
    const position=Number(body.question?.position??-1);
    const draft=position>=0?await loadDraft(runId,position).catch(()=>null):null;
    setAnswers(draft??(body.question?.answer_json as number[]|undefined)??[]);
  },[runId]);

  useEffect(()=>{
    if(current?.phase!=="preparing"||!current.canBegin||beginning.current)return;
    beginning.current=true;
    void api("/api/group-exams",{method:"POST",body:JSON.stringify({action:"run-ready",runId,idempotencyKey:`ready:${runId}`})}).then(body=>adopt(body.current as Current)).catch(()=>{setStatus("retry");setMessage("시험 준비를 완료하지 못했습니다. 다시 불러와 주세요.");}).finally(()=>{beginning.current=false;});
  },[adopt,current,runId]);

  const load=useCallback((force=false)=>{
    if(loadPromise.current&&!force)return loadPromise.current;
    const sequence=++loadSequence.current;const started=performance.now();
    const request=(async()=>{const body=await api(`/api/group-exams?scope=current&runId=${encodeURIComponent(runId)}`) as Current;if(sequence>=appliedSequence.current&&(force||!pendingRef.current)){await adopt(body);appliedSequence.current=sequence;window.dispatchEvent(new CustomEvent("group-exam-interaction",{detail:{kind:"current-load",durationMs:performance.now()-started}}));}return body;})();
    loadPromise.current=request;const clear=()=>{if(loadPromise.current===request)loadPromise.current=null;};request.then(clear,clear);return request;
  },[adopt,runId]);
  const markReadbackUnavailable=useCallback(()=>{setPending(null);setDisplay(null);setStatus("retry");setMessage("답안은 저장됐지만 다음 문항을 불러오지 못했습니다. 다시 불러와 주세요.");},[]);

  const flush=useCallback(async function flushQueuedMutation(item:QueuedGroupExamMutation):Promise<void>{
    if(!navigator.onLine){setStatus("retry");setMessage("오프라인입니다. 선택은 이 기기에 보관되며 전송 전까지 저장되지 않습니다.");return;}
    const claimed=await claimQueue(item.queueId,owner.current);
    if(!claimed){
      const stored=(await getQueue(runId)).find(row=>row.queueId===item.queueId);
      if(!stored){setPending(null);await load().catch(()=>undefined);return;}
      if(stored.state==="conflict"){setPending(stored);setStatus("retry");setMessage("다른 화면에서 응시 상태가 변경되었습니다. 다시 시도하거나 최신 문항을 불러와 주세요.");return;}
      setPending(stored);setStatus("syncing");setMessage("다른 화면에서 답안을 저장하고 있습니다. 잠시만 기다려 주세요.");
      window.clearTimeout(leaseTimer.current);
      const delay=Math.max(250,Math.min(30_000,(stored.leaseUntil??Date.now()+1_000)-Date.now()+100));
      leaseTimer.current=window.setTimeout(()=>{void getQueue(runId).then(rows=>{const next=rows.find(row=>row.queueId===item.queueId);if(next)void flushQueuedMutation(next);else void load();});},delay);
      return;
    }
    setPending(claimed);setStatus("syncing");setMessage("답안을 저장하고 있습니다…");
    const started=performance.now();
    let result:Json;
    try{result=await api("/api/group-exams",{method:"POST",headers:{"idempotency-key":claimed.idempotencyKey},body:JSON.stringify(claimed.body)});}catch(error){
      const conflict=error instanceof GroupApiError&&error.status===409;
      await releaseQueue(claimed.queueId,conflict?"conflict":"pending");
      if(conflict)await load(true).catch(()=>undefined);
      setPending({...claimed,state:conflict?"conflict":"pending"});setStatus("retry");
      setMessage(conflict?"다른 탭이나 서버에서 진행 상태가 바뀌었습니다. 현재 선택은 보관했습니다. 서버 문항으로 돌아왔습니다.":"연결이 끊겨 저장 여부를 확인하지 못했습니다. 다시 시도해 주세요.");
      return;
    }
    appliedSequence.current=++loadSequence.current;
    const windowRows=(result.publicQuestionWindow as Json[]|undefined)??[];
    const question=windowRows[0]??null;
    const directAdvance=claimed.attemptCount===1&&claimed.action==="question-advance"&&!result.submitted;
    // Show only the acknowledged next snapshot. Keep further mutation and
    // answer editing disabled until durable queue cleanup and draft adoption.
    if(directAdvance){
      setCurrent(value=>value?{...value,question,publicQuestionWindow:windowRows,progress:{...value.progress,position:result.position,revision:result.progressRevision,deadlineAt:result.deadlineAt}}:value);
      setDisplay(question);setAnswers((question?.answer_json as number[]|undefined)??[]);
    }
    const nextDraft=directAdvance&&question?loadDraft(runId,Number(question.position)).catch(()=>null):Promise.resolve(null);
    const [draft]=await Promise.all([nextDraft,deleteQueue(claimed.queueId).catch(()=>undefined),deleteDraft(runId,Number(claimed.body.position)).catch(()=>undefined)]);
    pendingRef.current=false;setPending(null);channel.current?.postMessage({kind:"ack",queueId:claimed.queueId,idempotencyKey:claimed.idempotencyKey,payloadDigest:claimed.payloadDigest});
    window.dispatchEvent(new CustomEvent("group-exam-interaction",{detail:{kind:"ack",durationMs:performance.now()-started,attempts:claimed.attemptCount}}));
    if(claimed.attemptCount>1||claimed.action==="answer-save"){
      try{await load();setMessage(claimed.attemptCount>1?"✓ 답안을 저장했습니다.":"✓ 답안을 저장했습니다.");}catch{markReadbackUnavailable();}
      return;
    }
    if(Boolean(result.submitted)){setDisplay(null);setStatus("complete");setMessage("✓ 답안을 제출했습니다. 모든 참가자의 응시가 끝나면 결과를 확인할 수 있습니다.");void load().catch(()=>undefined);return;}
    setCurrent(value=>value?{...value,question,publicQuestionWindow:windowRows,progress:{...value.progress,position:result.position,revision:result.progressRevision,deadlineAt:result.deadlineAt}}:value);
    setDisplay(question);setAnswers(draft??(question?.answer_json as number[]|undefined)??[]);setStatus("ready");setMessage("✓ 답안을 저장했습니다.");
  },[load,markReadbackUnavailable,runId]);

  useEffect(()=>{
    const on=()=>{void getQueue(runId).then(async items=>{if(items[0])await flush(items[0]);else await load();});};
    window.addEventListener("online",on);
    channel.current=new BroadcastChannel(`group-exam:${runId}`);
    channel.current.onmessage=(event)=>{
      const data=event.data as {kind?:string;queueId?:string;idempotencyKey?:string;payloadDigest?:string};
      if(data.kind!=="ack"||!data.queueId||!data.idempotencyKey||!data.payloadDigest)return;
      void deleteQueueIfMatch(data.queueId,data.idempotencyKey,data.payloadDigest).then(async outcome=>{
        if(outcome==="mismatch"){
          const stored=(await getQueue(runId)).find(row=>row.queueId===data.queueId)??null;
          try{await load();}catch{setDisplay(null);}setPending(stored);setStatus("retry");setMessage("다른 화면에서 응시 상태가 변경되었습니다. 현재 선택은 보관했습니다.");return;
        }
        setPending(value=>value?.queueId===data.queueId&&value?.idempotencyKey===data.idempotencyKey?null:value);
        try{await load();}catch{markReadbackUnavailable();}
      }).catch(()=>markReadbackUnavailable());
    };
    const seed=takeGroupExamStart(runId) as Current | undefined;
    const initial=seed?adopt(seed).then(()=>seed):load();
    void initial.then(()=>getQueue(runId)).then(items=>items[0]&&flush(items[0])).catch(error=>{setStatus("error");setMessage(error instanceof Error?error.message:"시험을 불러오지 못했습니다.");});
    return()=>{window.clearTimeout(leaseTimer.current);window.removeEventListener("online",on);channel.current?.close();};
  },[adopt,flush,load,markReadbackUnavailable,runId]);

  useEffect(()=>{
    if(status!=="countdown"||!current?.countdownEndsAt)return;
    let requested=false;let failures=0;let retryTimer=0;
    const tick=()=>{const value=Math.max(0,Math.ceil((Date.parse(String(current.countdownEndsAt))-(Date.now()+offset))/1000));setCountdownRemaining(value);if(value===0&&!requested&&Date.now()>=countdownRefreshNotBefore.current){requested=true;countdownRefreshNotBefore.current=Date.now()+1_000;void load().catch(()=>{failures+=1;setMessage("시작 시각이 지났습니다. 서버 상태를 다시 확인하고 있습니다.");const delay=Math.min(8_000,1_000*(2**failures));countdownRefreshNotBefore.current=Date.now()+delay;retryTimer=window.setTimeout(()=>{requested=false;},delay);});}};
    tick();const timer=window.setInterval(tick,200);return()=>{window.clearInterval(timer);window.clearTimeout(retryTimer);};
  },[current?.countdownEndsAt,load,offset,status]);

  useEffect(()=>connectGroupSocket({runId,onStatus:setSocketStatus,onReady:body=>{if(!pendingRef.current)void adopt(body as Current);},onInvalidate:()=>{
    if(!pendingRef.current)void load().catch(()=>undefined);
  }}),[adopt,load,runId]);

  const deadlineAt=String(current?.progress?.deadlineAt??display?.deadline_at_utc??"");
  useEffect(()=>{
    if(!display||!["ready","syncing"].includes(status)||!deadlineAt)return;
    let refreshed=false;
    const tick=()=>{
      const seconds=Math.max(0,Math.ceil((Date.parse(deadlineAt)-(Date.now()+offset))/1_000));
      setQuestionRemaining(seconds);
      if(seconds===10||seconds===5)setTimerAnnouncement(`남은 시간 ${seconds}초`);
      if(seconds===0){setTimerAnnouncement("제한시간이 끝났습니다. 다음 문항을 불러옵니다.");if(!refreshed&&!pendingRef.current){refreshed=true;window.setTimeout(()=>{if(!pendingRef.current)void load();},150);}}
    };
    tick();const timer=window.setInterval(tick,250);return()=>window.clearInterval(timer);
  },[deadlineAt,display,load,offset,status]);

  useEffect(()=>{
    const refresh=()=>{if(document.visibilityState==="visible"&&!pending&&status!=="syncing")void load().catch(()=>undefined);};
    const visibility=()=>{if(document.visibilityState==="visible")refresh();};
    let stopped=false;let timer=0;const cycle=async()=>{if(stopped)return;if(document.visibilityState==="visible"&&!pending&&status!=="syncing")await load().catch(()=>undefined);if(!stopped)timer=window.setTimeout(cycle,15_000);};timer=window.setTimeout(cycle,15_000);
    window.addEventListener("focus",refresh);document.addEventListener("visibilitychange",visibility);
    return()=>{stopped=true;window.clearTimeout(timer);window.removeEventListener("focus",refresh);document.removeEventListener("visibilitychange",visibility);};
  },[load,pending,status]);
  const displayPosition=display?.position;
  useEffect(()=>{if(displayPosition!==undefined){const frame=requestAnimationFrame(()=>{
    heading.current?.focus();
    if(advanceView.current?.position===Number(displayPosition)){
      window.dispatchEvent(new CustomEvent("group-exam-interaction",{detail:{kind:"next-view",durationMs:performance.now()-advanceView.current.started}}));advanceView.current=null;
    }
  });return()=>cancelAnimationFrame(frame);}},[displayPosition]);

  async function advance(submit=false){
    if(!current||!display||pending||status==="syncing"||!online)return;
    const position=Number(display.position);advanceView.current={position:position+1,started:performance.now()};const isV2=Number(current.run.contractVersion)===2;
    const action:QueuedGroupExamMutation["action"]=isV2?(submit?"run-submit":"question-advance"):(submit?"run-submit":"answer-save");
    const idempotencyKey=key(action);const queueId=`${runId}:${position}:${action}`;
    const body=isV2
      ?{action,runId,position,answers,expectedAnswerRevision:Number(display.answer_revision??0),expectedProgressRevision:Number(current.progress?.revision??0),idempotencyKey}
      :action==="answer-save"
        ?{action,runId,position,answers,expectedRevision:Number(display.answer_revision??0),operationId:idempotencyKey,idempotencyKey}
        :{action,runId,position,idempotencyKey};
    // Competitive exams reveal the next question only after the server starts
    // that question's clock and acknowledges the saved answer.
    pendingRef.current=true;setStatus("syncing");
    setMessage(submit?"제출을 확인 중입니다.":isV2?"답안을 저장하고 다음 문항을 불러옵니다…":"답안을 저장하고 있습니다…");
    try{
      const item:QueuedGroupExamMutation={queueId,runId,idempotencyKey,action,body,payloadDigest:await payloadDigest(body),createdAt:Date.now(),attemptCount:0,state:"pending"};
      const queued=await putQueue(item);
      if(queued.conflict){setDisplay(current.question);setPending(queued.item);setStatus("retry");setMessage("다른 화면에서 답안을 변경했습니다. 다시 시도하거나 최신 문항을 불러와 주세요.");return;}
      setPending(queued.item);await flush(queued.item);
    }catch{setDisplay(current.question);setStatus("retry");setMessage("이 기기에 전송 작업을 보관하지 못했습니다. 다시 시도해 주세요.");}
  }

  async function retryPending(){if(!pending)return;await releaseQueue(pending.queueId,"pending");const item=(await getQueue(runId)).find(row=>row.queueId===pending.queueId);if(item)await flush(item);}
  async function discardPending(){if(!pending||!window.confirm("최신 문항으로 돌아가시겠습니까? 현재 선택은 이 기기에 보관됩니다."))return;await deleteQueue(pending.queueId);setPending(null);await load();}

  const choices=(display?.choices_snapshot_json as unknown[]|undefined)??[];
  const isV2=Number(current?.run.contractVersion)===2;
  return <main className={styles.examOnly}>
    <header className={styles.examOnlyHeader}>
      <div><p className={styles.eyebrow}>그룹 SKCT 모의시험</p><strong>{String(current?.run.groupName??"동시 모의시험")}</strong></div>
      <div className={styles.examConnection}><span>{socketStatus === "connected" ? "● 실시간 연결" : online ? "연결 복구 중" : "오프라인"}</span><button className={styles.secondary} onClick={()=>router.push("/groups")}>대기실</button></div>
    </header><p className={styles.runnerStatus} role="status" aria-live="polite">{message}</p>
    {status==="countdown"&&<section className={styles.countdown} aria-labelledby="countdown-title"><h1 id="countdown-title">시험 시작</h1><strong aria-live="assertive">{countdownRemaining||"시작"}</strong><p>모든 참가자가 함께 시작합니다.</p></section>}
    {display&&<>
      <section className={styles.examToolbar} aria-label="시험 진행 상황">
        <div><span className={styles.eyebrow}>{String(display.area_code_snapshot)}</span><strong>{Number(display.position)+1}<small> / {String(current?.run.questionCount)}문항</small></strong></div>
        <div className={styles.examProgress}><progress max={Number(current?.run.questionCount??1)} value={Number(display.position)} aria-label="완료한 문항"/><span>이전 문항으로 돌아갈 수 없습니다.</span></div>
        <div className={`${styles.examTimer} ${questionRemaining <= 10 ? styles.timerUrgent : ""}`}><span>현재 문항 남은 시간</span><strong>{`${Math.floor(questionRemaining/60).toString().padStart(2,"0")}:${(questionRemaining%60).toString().padStart(2,"0")}`}</strong></div>
      </section>
      <div className={styles.examWorkspace}>
        <section className={styles.runnerQuestion} aria-labelledby="runner-question-title">
          <p className="sr-only" role="status" aria-live="polite">{timerAnnouncement}</p>
          <h1 ref={heading} tabIndex={-1} id="runner-question-title">{Number(display.position)+1}번 문항</h1>
          <QuestionRenderer question={display}/>
          <fieldset><legend>답안 선택</legend>{choices.map((choice,index)=><label key={index} className={styles.choice}>
            <input type="radio" disabled={status==="syncing"} name={`answer-${String(display.position)}`} checked={answers[0]===index} onChange={()=>{setAnswers([index]);void saveDraft(runId,Number(display.position),[index]);}}/>
            <span className={styles.choiceNumber} aria-hidden="true">{["①","②","③","④","⑤"][index]??index+1}</span><span>{String(choice).replace(/^[①②③④⑤]\s*/u,"")}</span>
          </label>)}</fieldset>
          <div className={styles.runnerActions}>{isV2?<button disabled={!online||Boolean(pending)||status==="syncing"||answers.length===0} onClick={()=>void advance(Number(display.position)+1===Number(current?.run.questionCount))}>{Number(display.position)+1===Number(current?.run.questionCount)?"답안 제출":"다음 문항 →"}</button>:<><button disabled={!online||Boolean(pending)||status==="syncing"||answers.length===0} onClick={()=>void advance(false)}>답안 저장</button><button className={styles.secondary} disabled={!online||Boolean(pending)||status==="syncing"} onClick={()=>void advance(true)}>응시 완료</button></>}{status==="retry"&&pending&&<button className={styles.secondary} onClick={()=>void retryPending()}>다시 시도</button>}{status==="retry"&&pending&&<button className={styles.secondary} onClick={()=>void discardPending()}>최신 문항으로 돌아가기</button>}{status==="retry"&&!pending&&<button className={styles.secondary} onClick={()=>void load()}>다시 불러오기</button>}</div>
        </section>
        <SkctExamTools memoKey={`${runId}:${String(display.position)}`}/>
      </div>
    </>}
    {!display&&status!=="countdown"&&<section className={styles.countdown}><h1>{status==="complete"?"응시 완료":"시험 상태 확인"}</h1><p>{message}</p>{status==="retry"&&!pending&&<button onClick={()=>void load().catch(()=>markReadbackUnavailable())}>다시 불러오기</button>}{status==="complete"&&<><button disabled={current?.run.status!=="completed"} onClick={()=>router.push(`/groups/results/${encodeURIComponent(runId)}`)}>결과 보기</button><button className={styles.secondary} onClick={()=>router.push("/groups")}>그룹 대기실</button></>}</section>}
  </main>;
}
