"use client";

import { useEffect, useState } from "react";
import { apiAction } from "@frontend/features/admin/model/admin-api-client";
import {
  ErrorState,
  LoadingBlock,
  Modal,
  emptyLoad,
  formatDate,
  type JsonRecord,
  type LoadState,
} from "./admin-ui";

export type BackupItem = {
  id: string;
  backup_type: string;
  status: string;
  schema_version: string;
  app_version: string;
  includedData: string[];
  counts: Record<string, number>;
  checksum: string;
  byteSize: number;
  created_at: string;
  error_message: string;
  storageMode: "database" | "external";
  resumable?: boolean;
};

type RestorePreview = {
  metadata: JsonRecord;
  conflicts: Record<string, { incoming: number; existingIds: number }>;
  fullReplace: { ready: boolean; missingTables: string[] };
};

export default function AdminRestoreModal({
  backup,
  onClose,
  onRestored,
}: {
  backup: BackupItem;
  onClose: () => void;
  onRestored: () => Promise<void>;
}) {
  const [preview, setPreview] = useState<LoadState<RestorePreview>>(emptyLoad);
  const [mode, setMode] = useState("merge");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void apiAction<RestorePreview>("restore-preview", { backupId: backup.id })
      .then((data) => setPreview({ loading: false, error: "", data }))
      .catch((failure) => setPreview({
        loading: false,
        error: failure instanceof Error ? failure.message : "검증 실패",
        data: null,
      }));
  }, [backup.id]);

  async function restore() {
    if (!window.confirm("복원 직전에 현재 전체 데이터가 자동 백업됩니다. 계속할까요?")) return;
    setBusy(true);
    setError("");
    try {
      await apiAction("restore-run", {
        backupId: backup.id,
        mode,
        confirmation,
      });
      await onRestored();
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "복원 실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="백업 복원" onClose={onClose} wide>
      {preview.loading
        ? <LoadingBlock label="백업 형식과 무결성을 검증하는 중입니다." />
        : preview.error
          ? <ErrorState message={preview.error} onRetry={() => window.location.reload()} />
          : preview.data && (
            <div className="restore-preview">
              <div className="admin-warning-box">
                <strong>복원 안전장치</strong>
                <p>현재 상태 자동 백업 → 원자적 일괄 적용 → 테이블별 건수 검증 순서로 처리합니다. 인증 비밀키는 복원 대상이 아닙니다.</p>
                {backup.schema_version === "admin-4" && <p>이 백업에 포함된 이론 진도는 종료된 기능이므로 복원하지 않습니다.</p>}
              </div>
              <section>
                <h3>백업 정보</h3>
                <dl>
                  <div><dt>생성 시각</dt><dd>{formatDate(preview.data.metadata.generatedAt)}</dd></div>
                  <div><dt>스키마 버전</dt><dd>{String(preview.data.metadata.schemaVersion)}</dd></div>
                  <div><dt>무결성 검증</dt><dd>통과</dd></div>
                </dl>
              </section>
              {!preview.data.fullReplace.ready && (
                <div className="admin-warning-box">
                  <strong>전체 교체 불가</strong>
                  <p>현재 보호 범위보다 오래된 백업입니다. 병합 복원만 사용할 수 있으며, 누락 테이블은 {preview.data.fullReplace.missingTables.join(", ")}입니다.</p>
                </div>
              )}
              <section>
                <h3>데이터 및 충돌 미리보기</h3>
                <div className="restore-table-list">
                  {Object.entries(preview.data.conflicts).map(([table, counts]) => (
                    <div key={table}>
                      <strong>{table}</strong>
                      <span>포함 {counts.incoming}건</span>
                      <span>동일 ID {counts.existingIds}건</span>
                    </div>
                  ))}
                </div>
              </section>
              <label>
                복원 방식
                <select value={mode} onChange={(event) => setMode(event.target.value)}>
                  <option value="merge">기존 데이터에 병합</option>
                  <option value="content-only">문제·이론만 병합</option>
                  <option value="settings-only">설정만 복원</option>
                  <option value="full-replace" disabled={!preview.data.fullReplace.ready}>전체 데이터 교체</option>
                </select>
              </label>
              {mode === "full-replace" && (
                <label className="danger-field">
                  확인 문구 입력
                  <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="전체 데이터를 복원합니다" />
                  <small>정확히 “전체 데이터를 복원합니다”를 입력해야 실행됩니다.</small>
                </label>
              )}
              {error && <p className="admin-form-error">{error}</p>}
              <footer className="admin-form-actions">
                <button className="admin-button secondary" type="button" onClick={onClose}>취소</button>
                <button
                  className="admin-button danger"
                  type="button"
                  disabled={busy || (mode === "full-replace" && confirmation !== "전체 데이터를 복원합니다")}
                  onClick={() => void restore()}
                >
                  {busy ? "복원 중…" : "검증된 백업 복원"}
                </button>
              </footer>
            </div>
          )}
    </Modal>
  );
}
