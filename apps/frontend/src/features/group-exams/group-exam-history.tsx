"use client";
import Link from "next/link";
import {useEffect,useRef,useState} from "react";
import {groupExamApi as api} from "./group-exam-api";
import styles from "./group-exam.module.css";
type RecordRow={id:string;status:string;created_at:string;attempt_at?:string;actual_started_at_utc:string|null;participant_status:string;score:number|null;question_count_snapshot:number};
type Cursor={at:string;id:string};
const dayOf=(date:string)=>new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Seoul"}).format(new Date(date));
export function MyExamHistory({groupId,refreshKey}:{groupId:string;refreshKey:string}){
 const [records,setRecords]=useState<RecordRow[]>([]),[day,setDay]=useState(""),[next,setNext]=useState<Cursor|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState("");
 const sequence=useRef(0),morePending=useRef(false);
 useEffect(()=>{let active=true;const request=++sequence.current;
  const params=new URLSearchParams({scope:"history",groupId,...(day?{day}:{})});
  void api(`/api/group-exams?${params}`).then(body=>{if(active&&request===sequence.current){setError("");setRecords((body.records??[]) as RecordRow[]);setNext((body.next??null) as Cursor|null);}}).catch(()=>{if(active)setError("응시 기록을 불러오지 못했습니다.");}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[groupId,day,refreshKey]);
 function changeDay(value:string){setDay(value);setLoading(true);setError("");setRecords([]);setNext(null);}
 async function more(){if(!next||morePending.current)return;morePending.current=true;setLoading(true);setError("");const request=sequence.current;
  try{const params=new URLSearchParams({scope:"history",groupId,beforeAt:next.at,beforeId:next.id,...(day?{day}:{})});const body=await api(`/api/group-exams?${params}`);if(request===sequence.current){setRecords(rows=>[...rows,...(body.records as RecordRow[])]);setNext((body.next??null) as Cursor|null);}}catch{if(request===sequence.current)setError("이전 기록을 불러오지 못했습니다.");}finally{morePending.current=false;if(request===sequence.current)setLoading(false);}}
 const dates=[...new Set(records.map(row=>dayOf(row.attempt_at??row.actual_started_at_utc??row.created_at)))];
 return <section className={styles.examHistory} aria-label="날짜별 내 응시 기록"><div className={styles.historyHeader}><h3>날짜별 응시 기록</h3><label>응시 날짜<input type="date" value={day} onChange={event=>changeDay(event.target.value)} /></label>{day&&<button className={styles.secondary} onClick={()=>changeDay("")}>전체 날짜</button>}</div>
  {loading&&!records.length?<p role="status">응시 기록을 불러오는 중입니다.</p>:!error&&!records.length?<p>{day?"이 날짜에는 응시 기록이 없습니다.":"아직 응시 기록이 없습니다. 시험을 마치면 날짜별로 결과를 확인할 수 있습니다."}</p>:null}
  {dates.map(date=><div key={date} className={styles.historyDay}><h4>{new Date(`${date}T12:00:00+09:00`).toLocaleDateString("ko-KR",{timeZone:"Asia/Seoul",year:"numeric",month:"long",day:"numeric",weekday:"short"})}</h4><ul>{records.filter(row=>dayOf(row.attempt_at??row.actual_started_at_utc??row.created_at)===date).map(row=><li key={row.id}><div><strong>{new Date(row.actual_started_at_utc??row.created_at).toLocaleTimeString("ko-KR",{timeZone:"Asia/Seoul",hour:"2-digit",minute:"2-digit"})}</strong><p>{row.question_count_snapshot}문항 · {row.status==="completed" ? `${row.score??0}개 정답` : row.status==="running" ? ["submitted","auto_submitted","no_show"].includes(row.participant_status)?"제출 완료 · 다른 참가자 응시 중":"응시 중" : row.status==="finalizing" ? "채점 중" : "시험 취소"}</p></div>{row.status==="completed"?<Link className={styles.historyLink} href={`/groups/results/${encodeURIComponent(row.id)}`}>결과 보기 →</Link>:row.status==="running"&&["rostered","in_progress"].includes(row.participant_status)?<Link className={styles.historyLink} href={`/groups/exams/${encodeURIComponent(row.id)}`}>이어 풀기 →</Link>:null}</li>)}</ul></div>)}
  {error&&<p role="alert">{error}</p>}{next&&<button className={styles.secondary} disabled={loading} onClick={()=>void more()}>{loading?"불러오는 중…":"이전 기록 더 보기"}</button>}
 </section>;
}
