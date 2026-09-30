"use client";
import { useState } from "react";
import "./skct-exam-tools.css";
export default function SkctExamTools() {
  const [memo,setMemo] = useState("");
  const [display,setDisplay] = useState("0");
  const [base,setBase] = useState<number | null>(null);
  const [operator,setOperator] = useState("");
  const [replace,setReplace] = useState(false);
  function key(value: string) {
    if (value === "C") { setDisplay("0"); setBase(null); setOperator(""); setReplace(false); return; }
    if (["+","−","×","÷","="].includes(value)) {
      let result = Number(display);
      if (base !== null && operator && !replace) result = operator === "+" ? base+result : operator === "−" ? base-result : operator === "×" ? base*result : base/result;
      const text = Number.isFinite(result) ? String(Number(result.toPrecision(12))) : "오류";
      setDisplay(text); setReplace(true); setBase(value === "=" ? null : Number.isFinite(result) ? result : 0);
      setOperator(value === "=" ? "" : value); return;
    }
    setDisplay(previous => {
      const current = replace || previous === "오류" ? "0" : previous;
      if (value === "." && current.includes(".")) return current;
      return value === "." ? current+value : current === "0" ? value : (current+value).slice(0,16);
    });
    setReplace(false);
  }
  return <aside className="skct-exam-tools" aria-label="풀이 도구">
    <details className="card skct-tool" open><summary>풀이 메모</summary>
      <label htmlFor="skct-scratchpad" className="sr-only">풀이 메모</label>
      <textarea id="skct-scratchpad" value={memo} onChange={event => setMemo(event.target.value)} placeholder="조건과 계산 과정을 정리하세요." rows={7} />
      <button className="secondary-button" type="button" onClick={() => setMemo("")}>메모 지우기</button></details>
    <details className="card skct-tool"><summary>계산기</summary>
      <output className="skct-calculator-display" aria-live="polite">{display}</output>
      <div className="skct-calculator-keys">{["7","8","9","÷","4","5","6","×","1","2","3","−","C","0",".","+","="].map(value =>
        <button className="secondary-button" type="button" key={value} onClick={() => key(value)}>{value}</button>)}</div></details>
  </aside>;
}
