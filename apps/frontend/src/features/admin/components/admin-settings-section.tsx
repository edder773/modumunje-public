"use client";

import { FormEvent, useEffect, useState } from "react";
import { apiAction, apiGet } from "@frontend/features/admin/model/admin-api-client";
import {
  EXAM_CONFIGS,
  EXAM_TYPES,
  RELEASED_EXAM_TYPES,
  examDisplayName,
  isReleasedExamType,
  type ExamType,
} from "@shared/study/study-domain";

type LoadState<T> = {
  loading: boolean;
  error: string;
  data: T | null;
};

type SettingsData = {
  values: {
    site_notice: string;
    maintenance_mode: boolean;
    default_exam_mode: ExamType;
    ai_grading_enabled: boolean;
    ai_grading_max_retries: number;
    analytics_enabled: boolean;
    analytics_retention_days: number;
    backup_retention_count: number;
    auto_backup_enabled: boolean;
  };
};

function initialLoad<T>(): LoadState<T> {
  return { loading: true, error: "", data: null };
}

export default function AdminSettingsSection({
  onNotice,
}: {
  onNotice: (message: string, error?: boolean) => void;
}) {
  const [state, setState] = useState<LoadState<SettingsData>>(initialLoad);
  const [form, setForm] = useState<SettingsData["values"] | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setState((previous) => ({ ...previous, loading: true, error: "" }));
    try {
      const data = await apiGet<SettingsData>("settings");
      setState({ loading: false, error: "", data });
      setForm(data.values);
    } catch (error) {
      setState({
        loading: false,
        error: error instanceof Error ? error.message : "조회 실패",
        data: null,
      });
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  function update<K extends keyof SettingsData["values"]>(key: K, value: SettingsData["values"][K]) {
    setForm((previous) => previous ? { ...previous, [key]: value } : previous);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    if (form.maintenance_mode && !window.confirm(
      "유지보수 모드를 켜면 일반 사용자의 학습 기록 저장이 일시 중지됩니다. 계속할까요?",
    )) return;
    setBusy(true);
    try {
      const editableValues = {
        site_notice: form.site_notice,
        maintenance_mode: form.maintenance_mode,
        default_exam_mode: form.default_exam_mode,
        analytics_enabled: form.analytics_enabled,
        analytics_retention_days: form.analytics_retention_days,
        backup_retention_count: form.backup_retention_count,
        auto_backup_enabled: form.auto_backup_enabled,
      };
      const result = await apiAction<{ values: SettingsData["values"] }>("settings-update", {
        values: editableValues,
      });
      setForm(result.values);
      onNotice("사이트 설정을 저장하고 감사 로그에 기록했습니다.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "설정 저장 실패", true);
    } finally {
      setBusy(false);
    }
  }

  if (state.loading && !form) {
    return <div className="admin-loading" role="status">데이터를 불러오는 중입니다.</div>;
  }
  if (state.error && !form) {
    return (
      <div className="admin-error-state" role="alert">
        <strong>데이터를 불러오지 못했습니다.</strong>
        <p>{state.error}</p>
        <button className="admin-button secondary" type="button" onClick={() => void refresh()}>다시 시도</button>
      </div>
    );
  }
  if (!form) return null;

  return (
    <form className="admin-section-stack" onSubmit={save}>
      <section className="admin-section-head">
        <div><span>SITE POLICY</span><h2>사이트 설정</h2><p>일반 운영 설정만 관리하며 API 키와 비밀 환경변수는 화면에 노출하지 않습니다.</p></div>
        <button className="admin-button" disabled={busy}>{busy ? "저장 중…" : "변경사항 저장"}</button>
      </section>
      <section className="admin-settings-grid">
        <article className="admin-card">
          <h3>공지 및 이용 상태</h3>
          <label>사이트 공지<textarea rows={5} maxLength={800} value={form.site_notice} onChange={(event) => update("site_notice", event.target.value)} placeholder="비워 두면 공지를 표시하지 않습니다." /></label>
          <label className="admin-switch"><input type="checkbox" checked={form.maintenance_mode} onChange={(event) => update("maintenance_mode", event.target.checked)} /><span /><strong>유지보수 모드<small>일반 사용자의 저장 작업을 일시 중지합니다.</small></strong></label>
          <label>기본 시험 모드<select value={form.default_exam_mode} onChange={(event) => { if (isReleasedExamType(event.target.value)) update("default_exam_mode", event.target.value); }}>{RELEASED_EXAM_TYPES.map((examType) => <option value={examType} key={examType}>{examDisplayName(examType)}</option>)}</select></label>
        </article>
        <article className="admin-card"><h3>실기형·서술형 채점 방식</h3><div className="admin-warning-box"><strong>과정별 학습용 채점</strong><p>정보처리기사 실기는 등록된 정답과 항목별 기준으로 자동 채점합니다. 그 밖의 실기형·서술형 문항은 학습자가 평가 기준·모범답안·해설과 자신의 답안을 비교해 예상 점수를 기록합니다. 모의고사 점수는 각 과정의 학습용 배점으로 환산합니다.</p></div></article>
        <article className="admin-card"><h3>방문 통계</h3><label className="admin-switch"><input type="checkbox" checked={form.analytics_enabled} onChange={(event) => update("analytics_enabled", event.target.checked)} /><span /><strong>익명 통계 수집<small>원본 IP·정밀 위치·답안 전문은 수집하지 않습니다.</small></strong></label><label>원본 이벤트 보관 기간<input type="number" min={7} max={730} value={form.analytics_retention_days} onChange={(event) => update("analytics_retention_days", Number(event.target.value))} /><small>7~730일, 기간이 지난 원본 이벤트는 저장 시 정리됩니다.</small></label></article>
        <article className="admin-card"><h3>백업 정책</h3><label>백업 보관 개수<input type="number" min={2} max={50} value={form.backup_retention_count} onChange={(event) => update("backup_retention_count", Number(event.target.value))} /></label><label className="admin-switch"><input type="checkbox" checked={form.auto_backup_enabled} onChange={(event) => update("auto_backup_enabled", event.target.checked)} /><span /><strong>자동 백업<small>자동 백업 사용 여부를 설정합니다. 예약 백업은 별도의 실행 설정과 성공 확인이 필요합니다.</small></strong></label></article>
      </section>
      <section className="admin-card official-config"><div><span>READ ONLY</span><h3>학습 모의고사 구성</h3><p>문항 수·시간·학습용 판정 기준입니다. 이 화면에서는 변경할 수 없습니다. 실제 시험은 주관기관의 공고를 확인하세요.</p></div><div>{EXAM_TYPES.map((examType) => { const config = EXAM_CONFIGS[examType]; if (!config) return <article key={examType}><strong>{examDisplayName(examType)}</strong><span>준비 중</span><small>문항 구성과 채점 기준은 자료 검토 후 설정합니다.</small></article>; const objectiveCount = Object.values(config.objectiveCounts).reduce<number>((total, count) => total + Number(count ?? 0), 0); return <article key={examType}><strong>{examDisplayName(examType)}</strong><span>{config.totalQuestions}문항 · {config.durationMinutes}분 · 합격 {config.passingScore}점</span><small>객관식 {objectiveCount}문항{config.descriptiveCount ? ` · 실기형·서술형 ${config.descriptiveCount}문항` : ""} · 과목 과락 {config.subjectMinimumRate}%{config.practicalMinimumRate ? ` · 실기 과락 ${config.practicalMinimumRate}%` : ""}</small></article>; })}</div></section>
    </form>
  );
}
