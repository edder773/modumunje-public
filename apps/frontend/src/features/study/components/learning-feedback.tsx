import type { View } from "./study-screen-shared";

import type { SaveStatusValue } from "../model/study-save-status";

export type { SaveStatusValue } from "../model/study-save-status";

export function SaveStatus({ status, onRetry }: { status: SaveStatusValue; onRetry: () => void }) {
  if (status === "storage-fallback") {
    return <span className="save-status error" role="alert">이번 방문에서만 학습 상태가 유지됩니다.</span>;
  }
  if (status === "saving") return <span className="save-status" role="status">계정에 저장 중…</span>;
  if (status === "account-saved") return null;
  if (status === "local-saved") return <span className="save-status" role="status">이 브라우저에 저장됨</span>;
  return (
    <span className="save-status error" role="alert">
      <span>저장하지 못했습니다. 브라우저 저장이 차단된 경우 이번 방문에서만 학습 상태가 유지됩니다.</span>
      <button type="button" onClick={onRetry}>다시 시도</button>
    </span>
  );
}

export function LearningLoadingState({ view }: { view: View }) {
  const copy = view === "practice"
    ? ["문제 풀이를 준비하고 있습니다.", "선택한 과정의 문제 구성과 출제 범위를 확인하는 중입니다."]
    : view === "theory"
      ? ["이론 학습을 준비하고 있습니다.", "선택한 과정의 이론 목록과 학습 상태를 확인하는 중입니다."]
      : view === "mock"
        ? ["모의고사를 준비하고 있습니다.", "진행 중인 시험과 출제 구성을 확인하는 중입니다."]
        : view === "stats" || view === "wrong" || view === "incorrect"
          ? ["학습 기록을 불러오고 있습니다.", "풀이 기록과 북마크를 확인하는 중입니다."]
          : ["학습 공간을 불러오고 있습니다.", "과정 정보와 학습 현황을 확인하는 중입니다."];
  return (
    <section className="card learning-loading-state" role="status" aria-live="polite">
      <span className="loading-indicator" aria-hidden="true" />
      <div><strong>{copy[0]}</strong><p>{copy[1]}</p></div>
    </section>
  );
}

export function LearningLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <section className="card learning-load-error" role="alert">
      <div><strong>{message}</strong><p>연결 상태를 확인한 뒤 다시 불러와 주세요.</p></div>
      <button className="primary-button" type="button" onClick={onRetry}>다시 불러오기</button>
    </section>
  );
}

export function InlineLearningError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="inline-learning-error" role="alert">
      <div><strong>콘텐츠를 불러오지 못했습니다.</strong><p>{message}</p></div>
      {onRetry && <button className="outline-button" type="button" onClick={onRetry}>다시 시도</button>}
    </div>
  );
}

export function learnerSafeErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message.trim() : "";
  const safeMessage = message && /[가-힣]/u.test(message) && message.length <= 140 ? message : fallback;
  const requestId = error && typeof error === "object" && "requestId" in error
    ? String(error.requestId ?? "").replace(/[^a-zA-Z0-9_-]/gu, "").slice(0, 80)
    : "";
  return requestId ? `${safeMessage} (요청 ID: ${requestId})` : safeMessage;
}
