"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./admin-group-exams-section.module.css";

type Group = {
  id: string;
  name: string;
  status: string;
  member_limit: number;
  admin_question_count_override: number | null;
  effective_question_count: number;
  revision: number;
  owner_public_name: string | null;
  active_members: number;
  run_count: number;
  recent_run_status: string | null;
  recent_run_at: string | null;
  today_quota_total: number;
  today_quota_available: number;
  today_quota_reserved: number;
  today_quota_consumed: number;
};

type Page = { groups: Group[]; todayKst?: string; pagination: { page: number; pages: number; total: number }; bank?: { areaCounts?: Array<{ area: string; eligible_count: number }>; perAreaTenReady?: boolean; policy?: string } };

async function request(url: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  if (init?.method === "POST") {
    headers.set("content-type", "application/json");
    headers.set("x-sql-study-admin-request", "1");
  }
  if (performance.getEntriesByName("admin-group-entry-click", "mark").length) {
    performance.measure("admin-group-request-start", "admin-group-entry-click");
    performance.clearMarks("admin-group-entry-click");
  }
  const response = await fetch(url, { ...init, headers, cache: "no-store" });
  const body = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(String(body.error ?? body.message ?? "그룹 관리 요청에 실패했습니다."));
  return body;
}

export default function AdminGroupExamsSection({ onNotice }: { onNotice: (message: string, error?: boolean) => void }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [deleteNames,setDeleteNames]=useState<Record<string,string>>({});
  const onNoticeRef = useRef(onNotice);
  useEffect(() => { onNoticeRef.current = onNotice; }, [onNotice]);
  const load = useCallback(async () => {
    const result = await request(`/api/group-exams/admin?page=${page}&pageSize=20`);
    setData(result as unknown as Page);
  }, [page]);
  useEffect(() => {
    let active = true;
    void request(`/api/group-exams/admin?page=${page}&pageSize=20`)
      .then((result) => { if (active) { setData(result as unknown as Page); setLoading(false); } })
      .catch((error) => {
        if (active) {
          setLoading(false);
          onNoticeRef.current(error instanceof Error ? error.message : "그룹 목록을 불러오지 못했습니다.", true);
        }
      });
    return () => { active = false; };
  }, [page]);

  const changePage = (next: number) => {
    setData(null);
    setLoading(true);
    setPage(next);
  };

  async function mutate(groupId: string, action: string, values: Record<string, unknown> = {}) {
    const group = data?.groups.find((item) => item.id === groupId);
    if (!group) { onNotice("최신 그룹 상태를 먼저 불러와 주세요.", true); return; }
    setBusy(`${groupId}:${action}`);
    try {
      await request("/api/group-exams/admin", {
        method: "POST",
        body: JSON.stringify({ action, groupId, expectedRevision: group.revision, ...values, idempotencyKey: `${action}:${crypto.randomUUID()}` }),
      });
      await load();
      onNotice("그룹 SKCT 관리자 설정을 저장했습니다.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "관리자 설정을 저장하지 못했습니다.", true);
    } finally { setBusy(""); }
  }

  return <div className="admin-section-stack">
    <section className="admin-section-head"><div><span>GROUP SKCT</span><h2>그룹 시험 관리</h2><p>전체 그룹의 문항 수와 KST 일일 응시 횟수를 관리합니다. 시험 이력은 초기화하지 않습니다.</p></div></section>
    <section className={`admin-card ${styles.bank}`}><div><h3>문제은행 준비 상태</h3><p>{data?.bank?.policy}</p></div><span className={data?.bank?.perAreaTenReady?styles.ready:styles.blocked}>{data?.bank?.perAreaTenReady?"영역별 검증 완료":"검증 문항 부족"}</span><ul>{(data?.bank?.areaCounts ?? []).map((row) => <li key={row.area}><span>{row.area}</span><strong>{row.eligible_count}문항</strong></li>)}</ul></section>
    <section className={`admin-card ${styles.groups}`}>
      <div className="admin-table-head"><strong>그룹 목록</strong><span>{data?.pagination.total ?? 0}개 · {data?.todayKst ?? "KST 오늘"}</span></div>
      {loading && <p role="status">그룹 목록을 불러오는 중입니다.</p>}
      <ul className={styles.groupList}>{(!loading ? data?.groups ?? [] : []).map(group=><li key={group.id}><header><div><h3>{group.name}</h3><p>대표 {group.owner_public_name??"확인 불가"} · {group.status}</p></div><span>{group.active_members}/{group.member_limit}명</span></header><dl><div><dt>시험 기록</dt><dd>{group.run_count}회 · {group.recent_run_status??"기록 없음"}</dd></div><div><dt>오늘 횟수</dt><dd>가능 {group.today_quota_available} / 전체 {group.today_quota_total}</dd></div></dl><div className={styles.controls}><form onSubmit={(event)=>{event.preventDefault();const form=new FormData(event.currentTarget);void mutate(group.id,"question-count-set",{count:Number(form.get("count"))});}}><label>문항 수<input name="count" type="number" min={1} max={500} defaultValue={group.effective_question_count}/></label><button disabled={Boolean(busy)}>저장</button><button type="button" disabled={Boolean(busy)||group.admin_question_count_override===null} onClick={()=>void mutate(group.id,"question-count-reset")}>기본값</button></form><form onSubmit={(event)=>{event.preventDefault();const form=new FormData(event.currentTarget);void mutate(group.id,"quota-grant",{dateKey:form.get("dateKey"),count:Number(form.get("count"))});}}><label>KST 날짜<input name="dateKey" type="date" defaultValue={data?.todayKst??new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Seoul"}).format(new Date())} required/></label><label>추가 횟수<input name="count" type="number" min={1} max={100} defaultValue={1} required/></label><button disabled={Boolean(busy)}>추가</button><button type="button" disabled={Boolean(busy)} onClick={event=>{const form=event.currentTarget.form;if(!form?.reportValidity())return;const values=new FormData(form);void mutate(group.id,"quota-reset",{dateKey:values.get("dateKey"),count:Number(values.get("count"))});}}>사용 가능 횟수 복구</button></form></div><form className={styles.delete} onSubmit={event=>{event.preventDefault();void mutate(group.id,"group-delete",{confirmedName:deleteNames[group.id]??""});}}><p>삭제하면 활성 목록·멤버·초대를 보관 처리하고 시험 이력과 감사 기록은 유지합니다.</p><label>그룹 이름 확인<input value={deleteNames[group.id]??""} onChange={event=>setDeleteNames(value=>({...value,[group.id]:event.target.value}))}/></label><button disabled={Boolean(busy)||(deleteNames[group.id]??"")!==group.name}>그룹 삭제</button></form></li>)}</ul>
      {data && !loading && <div className="admin-pagination"><button disabled={page <= 1} onClick={() => changePage(page - 1)}>← 이전</button><span>{page} / {data.pagination.pages}</span><button disabled={page >= data.pagination.pages} onClick={() => changePage(page + 1)}>다음 →</button></div>}
    </section>
  </div>;
}
