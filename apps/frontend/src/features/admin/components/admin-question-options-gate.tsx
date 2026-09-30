"use client";

import { type ReactNode, useEffect, useState } from "react";
import { apiGet, invalidateAdminGetCache } from "../model/admin-api-client";
import { ErrorState, LoadingBlock, Modal, emptyLoad, type LoadState } from "./admin-ui";

type OptionsResource = "options" | "sw-options";
type QuestionOptions = { theories: unknown[] };

export async function loadAdminQuestionOptions<T extends QuestionOptions>(resource: OptionsResource): Promise<T> {
  const data = await apiGet<T>(resource);
  const object = data as unknown as Record<string, unknown>;
  const valid = data && Array.isArray(data.theories) && data.theories.every(item => {
    if (!item || typeof item !== "object") return false;
    const theory = item as Record<string, unknown>;
    return typeof theory.id === "number" && Number.isSafeInteger(theory.id) && theory.id > 0
      && ["title", "category", "topic", ...(resource === "options" ? ["exam_scope"] : ["subject_group_id", "subject_id"])].every(key => typeof theory[key] === "string");
  }) && (resource !== "options" || (Array.isArray(object.categories) && object.categories.every(item =>
    item && typeof item === "object" && typeof item.category === "string" && typeof item.topic === "string")));
  if (!valid) {
    invalidateAdminGetCache({ resource });
    throw new Error("문제 편집에 필요한 이론·분류 정보를 불러오지 못했습니다. 다시 시도해 주세요.");
  }
  return data;
}

// Mount the form only after its options arrive, so initial selections are valid.
// Closing the dialog also prevents an earlier request from reopening its editor.
export function AdminQuestionOptionsGate<T extends QuestionOptions>({ resource, onClose, children }: {
  resource: OptionsResource;
  onClose: () => void;
  children: (options: T) => ReactNode;
}) {
  const [state, setState] = useState<LoadState<T>>(emptyLoad);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setState(emptyLoad());
      void loadAdminQuestionOptions<T>(resource).then(data => {
        if (active) setState({ loading: false, error: "", data });
      }).catch(error => {
        if (active) setState({ loading: false, error: error instanceof Error ? error.message : "편집 정보를 불러오지 못했습니다.", data: null });
      });
    }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [resource, attempt]);
  if (state.data) return children(state.data);
  return <Modal title="문제 편집 준비" onClose={onClose} wide>
    {state.error ? <ErrorState message={state.error} onRetry={() => setAttempt(value => value + 1)} /> : <LoadingBlock label="이론·분류 정보를 불러오는 중입니다." />}
  </Modal>;
}
