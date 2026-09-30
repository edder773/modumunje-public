"use client";

import { useEffect, useRef, useState } from "react";
import SignOutForm from "@frontend/features/auth/sign-out-form";
import "./skct-personal.css";

type Aggregate = { unit_id: string; mode: string; attempts: number; item_events: number;
  elapsed_seconds: number; finalized_items: number; answered_items: number };
type Audit = { release_id: string; event_type: string; actor: string; evidence_sha256: string | null; created_at: string };
type ItemLog = { cursor: number; attempt_id: string; user_key: string; unit_id: string; mode: string;
  position: number; source_item_id: string; selected_index: number | null; finalized_at: string | null;
  elapsed_seconds: number; is_correct: number | null };
type Release = { releaseId: string; contentSha256: string; status: string;
  verified: boolean; counts: Record<string, number> };
type Package = { releaseId: string; contentSha256: string; rows: unknown[] };
const releaseUrl = "/api/skct-personal/admin-release";
async function releaseRequest(body?: Record<string, unknown>): Promise<Release> {
  const response = await fetch(releaseUrl, body ? { method:"POST", credentials:"same-origin",cache:"no-store",
    headers:{ "content-type":"application/json","x-sql-study-admin-request":"1" },body:JSON.stringify(body) } :
    { credentials:"same-origin",cache:"no-store" });
  const result = await response.json() as Release & { error?: string };
  if (!response.ok) throw new Error(result.error ?? "릴리스 요청에 실패했습니다.");
  return result;
}

async function read(view: string, cursor?: number, days?: "30" | "90" | "all") {
  const url = `/api/skct-personal?view=${view}${cursor ? `&cursor=${cursor}` : ""}${days ? `&days=${days}` : ""}`;
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "관리자 집계를 불러오지 못했습니다.");
  return data;
}

export default function SkctPersonalAdmin({ displayName, signOutPath }: { displayName: string; signOutPath: string }) {
  const [aggregates, setAggregates] = useState<Aggregate[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [items, setItems] = useState<ItemLog[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<boolean | "import" | "activate" | "retire">(false);
  const [days, setDays] = useState<"30" | "90" | "all">("30");
  const [release, setRelease] = useState<Release | null>(null);
  const [importProgress, setImportProgress] = useState(0);
  const importFile = useRef<HTMLInputElement>(null);
  const [retireConfirmation, setRetireConfirmation] = useState("");
  useEffect(() => {
    let live = true;
    void Promise.all([read("admin"), read("admin-items"), releaseRequest()]).then(([summary, logs, releaseStatus]) => {
      if (!live) return;
      setAggregates(summary.aggregates); setAudit(summary.audit); setItems(logs.items); setCursor(logs.nextCursor);
      setRelease(releaseStatus);
    }).catch(error => { if (live) setMessage(error instanceof Error ? error.message : "집계를 불러오지 못했습니다."); });
    return () => { live = false; };
  }, []);
  async function more() {
    if (!cursor || busy) return;
    setBusy(true);
    try { const data = await read("admin-items",cursor); setItems(previous => [...previous,...data.items]); setCursor(data.nextCursor); }
    catch (error) { setMessage(error instanceof Error ? error.message : "로그를 불러오지 못했습니다."); }
    finally { setBusy(false); }
  }
  async function changeDays(value: "30" | "90" | "all") {
    setDays(value); setBusy(true); setMessage("");
    try { const data = await read("admin", undefined, value); setAggregates(data.aggregates); setAudit(data.audit); }
    catch (error) { setMessage(error instanceof Error ? error.message : "집계를 불러오지 못했습니다."); }
    finally { setBusy(false); }
  }
  async function importRelease() {
    const file = importFile.current?.files?.[0];
    if (!file || busy) return;
    setBusy("import"); setMessage(""); setImportProgress(0);
    try {
      if (file.size > 3_000_000) throw new Error("패키지 크기가 허용 범위를 넘었습니다.");
      const data: unknown = JSON.parse(await file.text());
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("패키지 형식이 올바르지 않습니다.");
      const contents = data as Package;
      if (contents.releaseId !== release?.releaseId || contents.contentSha256 !== release.contentSha256 ||
          !Array.isArray(contents.rows) || contents.rows.length !== 300)
        throw new Error("승인된 300문항 패키지와 일치하지 않습니다.");
      const identity = { releaseId: contents.releaseId, contentSha256: contents.contentSha256 };
      await releaseRequest({ action:"prepare",...identity });
      // D1 binds 21 columns per item across two inserts. Five items stay well below its
      // 100-bind statement cap and keep each request bounded for the Edge worker.
      for (let start=0; start<contents.rows.length; start+=5) {
        await releaseRequest({ action:"batch",...identity,rows:contents.rows.slice(start,start+5) });
        setImportProgress(Math.min(300,start+5));
      }
      const checked = await releaseRequest();
      setRelease(checked);
      if (!checked.verified) throw new Error("서버에서 300문항 검증이 완료되지 않았습니다.");
      setMessage("300문항이 STAGED로 등록되고 서버 내용·출처 검증을 통과했습니다. 활성화는 별도 버튼으로 진행합니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "등록에 실패했습니다. 같은 파일로 재시도할 수 있습니다.");
      try { setRelease(await releaseRequest()); } catch { /* Preserve the actionable import error. */ }
    } finally {
      if (importFile.current) importFile.current.value = "";
      setBusy(false);
    }
  }
  async function activateRelease() {
    if (!release?.verified || release.status !== "STAGED" || busy) return;
    setBusy("activate"); setMessage("");
    try {
      await releaseRequest({ action:"activate",releaseId:release.releaseId,contentSha256:release.contentSha256 });
      const checked = await releaseRequest();
      setRelease(checked);
      setMessage(checked.status === "ACTIVE" && checked.verified ? "개인학습 300문항이 활성화됐습니다." : "활성 상태를 확인하지 못했습니다.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "활성화에 실패했습니다."); }
    finally { setBusy(false); }
  }
  async function retireRelease() {
    if (!release || release.status !== "ACTIVE" || retireConfirmation !== release.releaseId || busy) return;
    setBusy("retire"); setMessage("");
    try {
      await releaseRequest({ action:"retire",releaseId:release.releaseId,
        contentSha256:release.contentSha256,confirmation:retireConfirmation });
      setRelease(await releaseRequest());
      setMessage("신규 개인학습 릴리스를 중단했습니다. 기존 학습 기록은 보존됩니다.");
      setRetireConfirmation("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "릴리스 중단에 실패했습니다."); }
    finally { setBusy(false); }
  }
  return <main className="skct-personal skct-admin" id="main-content">
    <a className="skip-link" href="#skct-admin-summary">집계로 건너뛰기</a>
    <p><a href="/admin">관리자 홈</a> · <a href="/learn/skct-personal">SKCT 개인학습</a> · {displayName} <SignOutForm action={signOutPath} /></p>
    <h1>SKCT 개인학습 관리자 기록</h1>
    <p>이 화면은 개인학습 시도의 문항별 저장 시간과 집계를 조회합니다. 그룹 SKCT 기록과 분리됩니다.</p>
    {message && <p role="alert">{message}</p>}
    <section aria-labelledby="skct-admin-release-title"><h2 id="skct-admin-release-title">개인학습 300문항 등록</h2>
      <p>비공개 검증 패키지를 선택하면 5문항씩 자동 저장합니다. 중단 후 같은 파일로 재시도해도 기존 문항을 덮어쓰지 않습니다.</p>
      <p>릴리스 {release?.releaseId ?? "조회 중"} · 상태 {release?.status ?? "조회 중"} · 서버 검증 {release?.verified ? "완료" : "대기"}</p>
      <p>단원별 등록: {Object.entries(release?.counts ?? {}).map(([unit,count]) => `${unit} ${count}/60`).join(" · ")}</p>
      <label>비공개 관리자 패키지 (.json) <input ref={importFile} type="file" accept=".json,application/json" disabled={Boolean(busy) || release?.status === "ACTIVE"}/></label>
      <button type="button" disabled={Boolean(busy) || !release || release.status === "ACTIVE"} onClick={() => void importRelease()}>패키지 등록·검증</button>
      {busy === "import" && <p role="status">등록 중: {importProgress}/300문항</p>}
      <button type="button" disabled={Boolean(busy) || !release?.verified || release.status !== "STAGED"} onClick={() => void activateRelease()}>검증된 300문항 활성화</button>
      {release?.status === "ACTIVE" && <div><p>문항 공개를 중단해도 기존 풀이 기록은 유지됩니다.</p>
        <label>중단 확인용 릴리스 ID <input value={retireConfirmation} onChange={event => setRetireConfirmation(event.target.value)} disabled={Boolean(busy)} /></label>
        <button type="button" disabled={Boolean(busy) || retireConfirmation !== release.releaseId} onClick={() => void retireRelease()}>신규 개인학습 릴리스 중단</button>
      </div>}
    </section>
    <section id="skct-admin-summary" aria-labelledby="skct-admin-summary-title"><h2 id="skct-admin-summary-title">영역별 집계</h2>
      <label>집계 기간 <select value={days} disabled={Boolean(busy)} onChange={event => void changeDays(event.target.value as "30" | "90" | "all")}>
        <option value="30">최근 30일</option><option value="90">최근 90일</option><option value="all">전체 기간</option>
      </select></label>
      <div className="skct-admin-scroll"><table><thead><tr><th scope="col">영역</th><th scope="col">방식</th><th scope="col">시도</th>
        <th scope="col">문항 기록</th><th scope="col">답한 문항</th><th scope="col">완료 문항</th><th scope="col">기록된 초</th></tr></thead>
        <tbody>{aggregates.map(row => <tr key={`${row.unit_id}-${row.mode}`}><td>{row.unit_id}</td><td>{row.mode}</td>
          <td>{row.attempts}</td><td>{row.item_events}</td><td>{row.answered_items}</td><td>{row.finalized_items}</td><td>{row.elapsed_seconds}</td></tr>)}</tbody></table></div>
    </section>
    <section aria-labelledby="skct-admin-log-title"><h2 id="skct-admin-log-title">문항별 기록</h2>
      <div className="skct-admin-scroll"><table><thead><tr><th scope="col">시도 ID</th><th scope="col">영역</th><th scope="col">문항</th>
        <th scope="col">저장된 답</th><th scope="col">풀이 초</th><th scope="col">완료</th></tr></thead>
        <tbody>{items.map(row => <tr key={row.cursor}><td>{row.attempt_id}</td><td>{row.unit_id}</td>
          <td>{row.position} · {row.source_item_id}</td><td>{row.selected_index ?? "미응답"}</td>
          <td>{row.elapsed_seconds}</td><td>{row.finalized_at ? "완료" : "진행 중"}</td></tr>)}</tbody></table></div>
      {cursor && <button type="button" disabled={Boolean(busy)} onClick={() => void more()}>이전 기록 더 보기</button>}
    </section>
    <section aria-labelledby="skct-admin-audit-title"><h2 id="skct-admin-audit-title">릴리스 감사</h2>
      <ul>{audit.map((row,index) => <li key={`${row.release_id}-${index}`}>{row.created_at} · {row.release_id} · {row.event_type} · {row.actor}</li>)}</ul>
    </section>
  </main>;
}
