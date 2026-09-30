"use client";

import { useRef, useState } from "react";
import { apiAction, apiGet } from "../model/admin-api-client";
import { Modal, formatDate } from "./admin-ui";
import { SELF_LEARNING_RESET_CONFIRMATION, SELF_LEARNING_RESET_LABELS, type SelfLearningResetPreview, type SelfLearningResetResult } from "@shared/admin/self-learning-reset";

export default function AdminSelfLearningReset({ onReset }: { onReset: () => Promise<void> }) {
  const [preview, setPreview] = useState<SelfLearningResetPreview | null>(null);
  const [result, setResult] = useState<SelfLearningResetResult | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState("");
  async function inspect() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setResult(null);
    setConfirmation("");
    setAcknowledged(false);
    try { setPreview(await apiGet<SelfLearningResetPreview>("self-learning-reset", undefined, { bypassCache: true })); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "기록 조회 실패"); }
    finally { lock.current = false; setBusy(false); }
  }
  async function reset() {
    if (!preview || result || lock.current || !acknowledged || confirmation !== SELF_LEARNING_RESET_CONFIRMATION) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const completed = await apiAction<SelfLearningResetResult>("self-learning-reset", { resetId: preview.resetId, confirmation, acknowledged });
      setResult(completed);
      await onReset();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "초기화 실패"); }
    finally { lock.current = false; setBusy(false); }
  }
  return <section className="admin-card admin-padded-card">
    <div className="admin-card-head"><div><h3>관리자 본인 학습 기록 초기화</h3><p>현재 로그인한 관리자 계정의 서버 저장 풀이·채점·모의고사 기록만 삭제합니다.</p></div><button type="button" className="admin-button danger" disabled={busy} onClick={() => void inspect()}>내 기록 초기화 범위 확인</button></div>
    <p>다른 사용자, 문제·이론, 계정·설정, 북마크, 제보, 방문 통계, 백업은 보존합니다. 비회원 기기 기록과 소유자를 확정할 수 없는 공용 기록도 보존합니다.</p>
    {error && !preview && <p role="alert">{error}</p>}
    {preview && <Modal title="관리자 본인 학습 기록 초기화" onClose={() => { if (!lock.current) setPreview(null); }}>
      <div className="member-access-modal">
        <p>대상 계정: <strong>{preview.email}</strong></p>
        <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>기록 종류</th><th>{result ? "삭제한 기록" : "현재 기록"}</th></tr></thead><tbody>{Object.entries(SELF_LEARNING_RESET_LABELS).map(([key, label]) => <tr key={key}><td>{label}</td><td>{(result?.deleted ?? preview.counts)[key as keyof typeof preview.counts].toLocaleString()}건</td></tr>)}</tbody></table></div>
        {result ? <p role="status">{formatDate(result.completedAt)} 초기화 완료. 다른 사용자·콘텐츠·북마크·백업은 보존했습니다. 학습 화면은 새로 열어 주세요.</p> : <>
          <p>실행 시점의 본인 기록 전체를 삭제합니다. 진행 중인 모의고사와 저장 답안도 포함되며, 이 화면에서 되돌릴 수 없습니다. 기존 백업은 삭제하지 않습니다.</p>
          <label className="admin-check"><input type="checkbox" checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.target.checked)} /> 다른 학습 화면을 모두 닫았으며, 삭제 범위와 복구 제한을 확인했습니다.</label>
          <label>확인 문구<input value={confirmation} disabled={busy} autoComplete="off" placeholder={SELF_LEARNING_RESET_CONFIRMATION} onChange={event => setConfirmation(event.target.value)} /></label>
        </>}
        {error && <p role="alert">{error} 응답이 끊겼다면 같은 확인창에서 재시도해 결과를 확인할 수 있습니다.</p>}
        <div className="admin-row-actions"><button type="button" disabled={busy} onClick={() => setPreview(null)}>{result ? "닫기" : "취소"}</button>{!result && <button type="button" className="danger" disabled={busy || !acknowledged || confirmation !== SELF_LEARNING_RESET_CONFIRMATION} onClick={() => void reset()}>{busy ? "초기화 중…" : "내 기록 영구 삭제"}</button>}</div>
      </div>
    </Modal>}
  </section>;
}
