"use client";

import { type ChangeEvent, useRef, useState } from "react";
import { ADMIN_IMPORT_FILE_MAX_BYTES } from "@shared/admin/admin-transfer-limits.mjs";
import { apiAction } from "@frontend/features/admin/model/admin-api-client";
import {
  EXPECTED_SKCT_RELEASE,
  isExpectedSkctRelease,
  parseSkctBankActivationResult,
  parseSkctBankPreview,
  type SkctBankActivationResult,
  type SkctBankPreview,
} from "@frontend/features/admin/model/admin-skct-bank-activation";
import { formatBytes } from "./admin-ui";

type JsonRecord = Record<string, unknown>;

export default function AdminSkctBankActivation({
  onNotice,
}: {
  onNotice: (message: string, error?: boolean) => void;
}) {
  const [fileName, setFileName] = useState("");
  const [fileSize, setFileSize] = useState(0);
  const [bank, setBank] = useState<JsonRecord | null>(null);
  const [preview, setPreview] = useState<SkctBankPreview | null>(null);
  const [result, setResult] = useState<SkctBankActivationResult | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState<"preview" | "activate" | null>(null);
  const generation = useRef(0);
  const requestLocked = useRef(false);
  const exactRelease = preview ? isExpectedSkctRelease(preview) : false;

  function clearValidatedState() {
    setPreview(null);
    setResult(null);
    setConfirmed(false);
  }

  async function readBankFile(event: ChangeEvent<HTMLInputElement>) {
    const version = generation.current + 1;
    generation.current = version;
    clearValidatedState();
    setBank(null);
    setFileName("");
    setFileSize(0);
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > ADMIN_IMPORT_FILE_MAX_BYTES) {
      event.target.value = "";
      onNotice("SKCT 문제은행 JSON은 24MiB 이하여야 합니다.", true);
      return;
    }
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (generation.current !== version) return;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("JSON 최상위 값은 문제은행 객체여야 합니다.");
      }
      setBank(parsed as JsonRecord);
      setFileName(file.name);
      setFileSize(file.size);
      onNotice("SKCT 문제은행 파일을 읽었습니다. 서버 검증을 실행해 주세요.");
    } catch (error) {
      if (generation.current !== version) return;
      event.target.value = "";
      onNotice(error instanceof Error ? `JSON 파일을 읽지 못했습니다. ${error.message}` : "JSON 파일을 읽지 못했습니다.", true);
    }
  }

  async function validateBank() {
    if (!bank || requestLocked.current) return;
    const version = generation.current;
    requestLocked.current = true;
    setBusy("preview");
    clearValidatedState();
    try {
      const response = await apiAction<unknown>("skct-bank-preview", { bank });
      const validated = parseSkctBankPreview(response);
      if (generation.current !== version) return;
      setPreview(validated);
      const matches = isExpectedSkctRelease(validated);
      onNotice(matches
        ? "서버 검증과 운영 대상 release 대조를 완료했습니다."
        : "검증본이 현재 승인된 운영 release와 일치하지 않습니다.", !matches);
    } catch (error) {
      if (generation.current === version) {
        onNotice(error instanceof Error ? error.message : "SKCT 문제은행 검증 실패", true);
      }
    } finally {
      requestLocked.current = false;
      setBusy(null);
    }
  }

  async function activateBank() {
    if (!bank || !preview || !exactRelease || !confirmed || requestLocked.current) return;
    if (!window.confirm("표시된 release를 운영 문제은행으로 활성화할까요? 서버는 현재 schema에 맞는 최근 full backup을 다시 확인합니다.")) return;
    const version = generation.current;
    requestLocked.current = true;
    setBusy("activate");
    setResult(null);
    try {
      const response = await apiAction<unknown>("skct-bank-activate", {
        bank,
        confirmation: preview.confirmation,
      });
      const activated = parseSkctBankActivationResult(response);
      if (generation.current !== version) return;
      if (!isExpectedSkctRelease(activated)) throw new Error("활성화된 release가 승인된 운영 release와 일치하지 않습니다.");
      setResult(activated);
      setConfirmed(false);
      onNotice(activated.replayed
        ? "이미 활성화된 동일 release를 서버에서 다시 확인했습니다."
        : "SKCT 문제은행을 활성화하고 서버 readback을 확인했습니다.");
    } catch (error) {
      if (generation.current === version) {
        onNotice(error instanceof Error ? error.message : "SKCT 문제은행 활성화 실패", true);
      }
    } finally {
      requestLocked.current = false;
      setBusy(null);
    }
  }

  return (
    <section className="admin-card skct-bank-activation" aria-labelledby="skct-bank-activation-title">
      <div className="admin-card-head">
        <div>
          <span>SKCT RELEASE</span>
          <h3 id="skct-bank-activation-title">그룹 SKCT 문제은행 활성화</h3>
          <p>JSON 원문은 화면에 펼치지 않습니다. 서버가 출처·문항·정답·해설 hash를 검증한 요약만 확인합니다.</p>
        </div>
        <span className={result ? "admin-status success" : preview && !exactRelease ? "admin-status danger" : "admin-status muted"}>
          {result ? "활성 확인" : preview ? exactRelease ? "활성화 준비" : "대상 불일치" : "검증 전"}
        </span>
      </div>
      <div className="skct-bank-target" aria-label="승인된 운영 release">
        <strong>승인된 운영 release</strong>
        <span>{EXPECTED_SKCT_RELEASE.releaseId}</span>
        <code>{EXPECTED_SKCT_RELEASE.releaseSha256}</code>
        <span>{EXPECTED_SKCT_RELEASE.eligibleCount}문항 · 5개 영역 각 60문항 · 도식 {EXPECTED_SKCT_RELEASE.assetCount}개</span>
      </div>
      <label className="admin-file-input">
        <input type="file" accept=".json,application/json" disabled={busy !== null} onChange={(event) => void readBankFile(event)} />
        <span>{fileName ? `${fileName} · ${formatBytes(fileSize)}` : "SKCT 문제은행 JSON 파일 선택"}</span>
      </label>
      <button className="admin-button secondary" type="button" disabled={!bank || busy !== null} onClick={() => void validateBank()}>
        {busy === "preview" ? "서버 검증 중…" : "서버에서 검증하고 release 대조"}
      </button>
      <p className="admin-form-hint" aria-live="polite">
        {busy === "preview" ? "문제은행을 변경하지 않고 검증 중입니다." : busy === "activate" ? "백업 gate와 원자 활성화 결과를 확인 중입니다." : "파일을 다시 선택하면 이전 검증 결과는 즉시 무효화됩니다."}
      </p>
      {preview && <div className="skct-bank-summary">
        <div><strong>Release ID</strong><span>{preview.releaseId}</span></div>
        <div><strong>Release SHA-256</strong><code>{preview.releaseSha256}</code></div>
        <div><strong>사용 가능 / 격리</strong><span>{preview.eligibleCount} / {preview.quarantineCount}문항</span></div>
        <div><strong>도식</strong><span>{preview.assetCount}개</span></div>
        <div><strong>영역별 사용 가능</strong><span>{Object.entries(preview.areas).map(([area, count]) => `${area} ${count}`).join(" · ")}</span></div>
      </div>}
      {preview && !exactRelease && <div className="admin-warning-box" role="alert"><strong>운영 대상과 일치하지 않습니다.</strong><p>승인된 release ID와 SHA-256이 모두 일치하는 파일만 활성화할 수 있습니다.</p></div>}
      {preview && exactRelease && !result && <div className="skct-bank-confirm">
        <label className="admin-check"><input type="checkbox" checked={confirmed} disabled={busy !== null} onChange={(event) => setConfirmed(event.target.checked)} /><span>위 release ID와 SHA-256이 승인된 운영 대상과 정확히 일치함을 확인했습니다.</span></label>
        <button className="admin-button" type="button" disabled={!confirmed || busy !== null} onClick={() => void activateBank()}>{busy === "activate" ? "활성화 확인 중…" : "검증한 release 활성화"}</button>
      </div>}
      {result && <div className="admin-warning-box" role="status"><strong>서버 readback 완료</strong><p>{result.releaseId} · {result.releaseSha256}</p><p>{result.replayed ? "동일 release가 이미 활성 상태였습니다." : "원자 활성화와 감사 로그 기록을 완료했습니다."} 사용 가능 {result.eligibleCount}문항, 격리 {result.quarantineCount}문항입니다.</p></div>}
    </section>
  );
}
