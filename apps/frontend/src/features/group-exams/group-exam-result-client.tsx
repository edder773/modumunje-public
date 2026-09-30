"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {groupExamApi} from "./group-exam-api";
import {QuestionRenderer} from "./group-exam-question-renderer";
import styles from "./group-exam.module.css";
type Row=Record<string,unknown>;
const indexes=(value:unknown):number[]=>Array.isArray(value)?value.filter((i):i is number=>Number.isInteger(i)):[];
export function GroupExamResultClient({runId}:{runId:string}){
 const [result,setResult]=useState<Row|null>(null);const [error,setError]=useState("");const [filter,setFilter]=useState<"all"|"wrong">("wrong");const [position,setPosition]=useState(0);
 useEffect(()=>{let active=true;groupExamApi(`/api/group-exams?scope=result&runId=${encodeURIComponent(runId)}`).then(body=>{if(active)setResult(body);}).catch(err=>{if(active)setError(err instanceof Error?err.message:"결과를 불러오지 못했습니다.");});return()=>{active=false;};},[runId]);
 const ranking=(result?.orderedResults??result?.ranking??[]) as Row[];
 const me=ranking.find(row=>row.self);const all=(result?.review??[]) as Row[];
 const reviews=filter==="wrong"?all.filter(row=>JSON.stringify(indexes(row.answer))!==JSON.stringify(indexes(row.correctAnswers))):all;
 const item=reviews[Math.min(position,Math.max(0,reviews.length-1))];
 const correct=Number(me?.correctCount??me?.score??0);const unanswered=Number(me?.unansweredCount??all.filter(row=>!indexes(row.answer).length).length);const wrong=Number(me?.incorrectCount??me?.wrongCount??0);
 return <main className={styles.page}>
  <header className={styles.hero}><div><p className={styles.eyebrow}>함께 푼 시험을 돌아보세요</p><h1>그룹 시험 결과</h1><p>{result?`${all.length}문항 · ${String((result.run as Row)?.completedAt??"").slice(0,10)}`:"결과를 불러오고 있습니다."}</p></div><Link className={styles.backLink} href="/groups">← 그룹 대기실</Link></header>
  {error&&<p className={styles.notice} role="alert">{error}</p>}
  {!result&&!error&&<p role="status">시험 결과를 불러오는 중입니다…</p>}
  {result&&<><section className={styles.resultSummary} aria-label="내 시험 결과"><div><span>정답률</span><strong>{all.length?Math.round(correct/all.length*100):0}<small>%</small></strong></div><div><span>정답</span><strong>{correct}<small>문항</small></strong></div><div><span>오답</span><strong>{wrong}<small>문항</small></strong></div><div><span>미응답</span><strong>{unanswered}<small>문항</small></strong></div></section>
  <section className={`${styles.card} ${styles.rankingCard}`}><h2>참가자 결과</h2><div className={styles.tableWrap}><table><thead><tr><th scope="col">순위</th><th scope="col">이름</th><th scope="col">정답</th><th scope="col">오답</th><th scope="col">미응답</th></tr></thead><tbody>{ranking.map((row,index)=><tr key={String(row.participantId??index)} className={row.self?styles.selfRow:undefined}><td>{String(row.rank)}</td><td>{String(row.publicName)}{row.self?" (나)":""}</td><td>{String(row.correctCount??row.score)}</td><td>{String(row.incorrectCount??row.wrongCount)}</td><td>{String(row.unansweredCount??"—")}</td></tr>)}</tbody></table></div></section>
  <section className={styles.reviewSection} aria-label="문항 복습"><div className={styles.reviewHeader}><h2>문제와 해설</h2><div className={styles.reviewFilters}><button aria-pressed={filter==="wrong"} onClick={()=>{setFilter("wrong");setPosition(0);}}>오답·미응답</button><button aria-pressed={filter==="all"} onClick={()=>{setFilter("all");setPosition(0);}}>전체 문항</button></div></div>
  {item?<><nav className={styles.reviewNumbers} aria-label="복습할 문항">{reviews.map((row,index)=><button key={String(row.position)} aria-label={`${Number(row.position)+1}번 문항 복습`} aria-current={index===position?"true":undefined} onClick={()=>setPosition(index)}>{Number(row.position)+1}</button>)}</nav>
  <article className={`${styles.card} ${styles.reviewQuestion}`}><div className={styles.reviewQuestionHeading}><h3>{Number(item.position)+1}번 문항 · {String(item.area)}</h3><span>{!indexes(item.answer).length?"미응답":JSON.stringify(indexes(item.answer))===JSON.stringify(indexes(item.correctAnswers))?"정답":"오답"}</span></div>
   <QuestionRenderer question={{prompt_snapshot:item.prompt,area_code_snapshot:item.area,asset_refs_snapshot_json:item.assets}}/>
   <ol className={styles.reviewChoices}>{(item.choices as unknown[]).map((choice,index)=>{const right=indexes(item.correctAnswers).includes(index),chosen=indexes(item.answer).includes(index);return <li key={index} className={`${right?styles.reviewCorrect:""} ${chosen&&!right?styles.reviewWrong:""}`}><span className={styles.choiceNumber}>{["①","②","③","④","⑤"][index]??index+1}</span><span>{String(choice).replace(/^[①②③④⑤]\s*/u,"")}</span><span className={styles.choiceFeedback}>{right?(chosen?"정답 · 내 선택":"정답"):chosen?"내 선택 · 오답":""}</span></li>;})}</ol>
   <section className={styles.explanation} aria-label="문항 해설"><h4>해설</h4><div className={styles.markdown}><ReactMarkdown remarkPlugins={[[remarkGfm,{singleTilde:false}]]}>{String(item.explanation)}</ReactMarkdown></div></section>
  </article><div className={styles.reviewNavigation}><button disabled={position===0} onClick={()=>setPosition(p=>p-1)}>← 이전 문항</button><span>{position+1} / {reviews.length}</span><button disabled={position>=reviews.length-1} onClick={()=>setPosition(p=>p+1)}>다음 문항 →</button></div></>:<p className={styles.card}>틀리거나 응답하지 않은 문항이 없습니다.</p>}
  </section></>}
 </main>;
}
