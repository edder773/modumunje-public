"use client";

import { useState, type ChangeEvent } from "react";
import { apiAction } from "@frontend/features/admin/model/admin-api-client";

const MAX_PACKAGE_BYTES = 4 * 1024 * 1024;

type RepairPreview = {
  packageSha256: string;
  releaseVersion: string;
  backupId: string;
  backupCreatedAt: string;
  changedTheories: number;
  questionCount: number;
  theoryCount: number;
  before: { questions: string; theories: string };
  after: { questions: string; theories: string };
  confirmation: string;
};
type RepairStatus = {
  state: "target-present" | "baseline-present" | "unverified";
  packageSha256: string;
  theoryChecksum: string;
  questionChecksum: string;
  auditReceiptId: string | null;
};

export default function AdminTheoryContentRepair({ onNotice }: {
  onNotice: (message: string, error?: boolean) => void;
}) {
  const [repairPackage, setRepairPackage] = useState<unknown>(null);
  const [preview, setPreview] = useState<RepairPreview | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(false);
  const [uncertain, setUncertain] = useState(false);

  async function selectPackage(event: ChangeEvent<HTMLInputElement>) {
    setRepairPackage(null);
    setPreview(null);
    setConfirmation("");
    setFinished(false);
    setUncertain(false);
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_PACKAGE_BYTES) {
      onNotice("이론 복구 패키지는 4 MiB 이하여야 합니다.", true);
      return;
    }
    try {
      const parsed: unknown = JSON.parse(await file.text());
      setRepairPackage(parsed);
    } catch {
      onNotice("복구 패키지를 JSON으로 읽을 수 없습니다.", true);
    }
  }

  async function verify() {
    if (!repairPackage || busy) return;
    setBusy(true);
    setPreview(null);
    setConfirmation("");
    try {
      const result = await apiAction<RepairPreview>("theory-content-repair-preview", { repairPackage });
      setPreview(result);
      onNotice("복구 범위·전체 체크섬·최신 전체 백업 매니페스트가 일치합니다. 백업의 독립 복원 검증도 확인한 뒤 실행하세요.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "복구 검증 실패", true);
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    if (!repairPackage || !preview || confirmation !== preview.confirmation || busy || finished || uncertain) return;
    setBusy(true);
    try {
      const result = await apiAction<{ repaired: number; theoryChecksum: string; questionChecksum: string }>(
        "theory-content-repair-run",
        { repairPackage, previewSha256: preview.packageSha256, confirmation },
      );
      if (result.repaired !== preview.changedTheories
        || result.theoryChecksum !== preview.after.theories
        || result.questionChecksum !== preview.after.questions) {
        throw new Error("복구 응답의 사후 체크섬을 확인할 수 없습니다. 재실행하지 말고 전체 백업을 보존해 주세요.");
      }
      setFinished(true);
      setUncertain(false);
      setRepairPackage(null);
      setPreview(null);
      onNotice(`이론 본문 ${result.repaired}건의 공백을 복구하고 전체 콘텐츠 체크섬을 확인했습니다.`);
    } catch (error) {
      setUncertain(true);
      try {
        await checkStatus(repairPackage, preview);
      } catch {
        onNotice(`${error instanceof Error ? error.message : "복구 응답을 확인하지 못했습니다."} 현재 DB 상태를 확인하기 전에는 재실행하지 마세요.`, true);
      }
    } finally {
      setBusy(false);
    }
  }

  async function checkStatus(currentPackage: unknown, reviewed: RepairPreview) {
    const status = await apiAction<RepairStatus>("theory-content-repair-status", {
      repairPackage: currentPackage, previewSha256: reviewed.packageSha256,
    });
    if (status.packageSha256 !== reviewed.packageSha256) throw new Error("상태 확인 패키지가 다릅니다.");
    if (status.state === "target-present"
      && status.theoryChecksum === reviewed.after.theories
      && status.questionChecksum === reviewed.after.questions) {
      setFinished(true);
      setUncertain(false);
      setRepairPackage(null);
      setPreview(null);
      onNotice(status.auditReceiptId
        ? `응답이 유실됐지만 목표 콘텐츠 체크섬과 관리자 감사 영수증 ${status.auditReceiptId.slice(0, 8)}을 확인했습니다.`
        : "응답이 유실됐지만 목표 콘텐츠 체크섬을 확인했습니다. 감사 영수증은 확인되지 않아 수행 주체는 별도 점검이 필요합니다.");
      return;
    }
    onNotice(status.state === "baseline-present"
      ? "아직 기존 콘텐츠가 확인됩니다. 요청이 처리 중일 수 있으니 잠시 후 상태를 다시 확인하세요. 자동 재실행은 하지 않습니다."
      : "현재 콘텐츠가 복구 전후 어느 검토 상태에도 일치하지 않습니다. 전체 백업을 보존하고 조사해 주세요.", true);
  }

  async function recheckStatus() {
    if (!repairPackage || !preview || busy) return;
    setBusy(true);
    try { await checkStatus(repairPackage, preview); }
    catch (error) { onNotice(error instanceof Error ? error.message : "상태 확인 실패", true); }
    finally { setBusy(false); }
  }

  return <section className="admin-card admin-padded-card" aria-labelledby="theory-content-repair-title">
    <h3 id="theory-content-repair-title">검토된 이론 공백 복구</h3>
    <p>과거 정규화로 공백이 바뀐 이론 106건만 복구합니다. 최신 2시간 이내의 완료된 전체 백업과 현재 콘텐츠 체크섬이 일치해야 진행할 수 있습니다. 백업의 독립 복원 검증은 운영자가 별도로 확인해야 합니다. 다른 문제·이론과 학습 기록은 바꾸지 않습니다.</p>
    <label>검토된 복구 패키지 <input type="file" accept="application/json,.json" disabled={busy || finished} onChange={(event) => void selectPackage(event)} /></label>
    <button className="admin-button secondary" type="button" disabled={!repairPackage || busy || finished} onClick={() => void verify()}>{busy ? "검증 중…" : "패키지·백업 검증"}</button>
    {preview && !finished && <div className="admin-padded-card" role="status">
      <p>활성 릴리스: <code>{preview.releaseVersion}</code> · 변경 대상: {preview.changedTheories}건 · 전체 문제 {preview.questionCount}건 · 이론 {preview.theoryCount}건</p>
      <p>선행 전체 백업: <code>{preview.backupId}</code> · 생성: {preview.backupCreatedAt}</p>
      <p>패키지 SHA-256: <code>{preview.packageSha256}</code></p>
      <p>현재 이론 SHA-256: <code>{preview.before.theories}</code></p>
      <p>복구 후 이론 SHA-256: <code>{preview.after.theories}</code></p>
      <p>유지할 문제 SHA-256: <code>{preview.after.questions}</code></p>
      <label>실행 확인 문구 <input type="text" autoComplete="off" spellCheck={false} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
      <p>정확히 입력: <code>{preview.confirmation}</code></p>
      <button className="admin-button danger" type="button" disabled={busy || uncertain || confirmation !== preview.confirmation} onClick={() => void run()}>{busy ? "복구·검증 중…" : "106건 복구 실행"}</button>
      {uncertain && <button className="admin-button secondary" type="button" disabled={busy} onClick={() => void recheckStatus()}>읽기 전용으로 복구 상태 다시 확인</button>}
    </div>}
    {finished && <p role="status">복구와 전체 콘텐츠 체크섬 확인이 완료됐습니다. 같은 패키지는 다시 실행할 수 없습니다.</p>}
  </section>;
}
