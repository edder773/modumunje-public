import { useEffect, type Dispatch, type SetStateAction } from "react";
import { installRumObservers } from "../telemetry/study-telemetry";
import type { SaveStatusValue } from "./study-save-status";

type StateSetter<T> = Dispatch<SetStateAction<T>>;

export default function useStudyRuntimeEvents(
  setNotice: StateSetter<string>,
  setSaveStatus: StateSetter<SaveStatusValue>,
) {
  useEffect(() => installRumObservers(), []);

  useEffect(() => {
    const handleStorageFailure = () => {
      setSaveStatus("storage-fallback");
      setNotice("브라우저 저장 공간을 사용할 수 없어 이번 방문에서만 학습 상태가 유지됩니다.");
    };
    window.addEventListener("baeumzip:storage-failure", handleStorageFailure);
    return () => window.removeEventListener("baeumzip:storage-failure", handleStorageFailure);
  }, [setNotice, setSaveStatus]);

  useEffect(() => {
    const handleRetrying = () => {
      setNotice("응답이 지연되어 한 번 더 연결을 시도하고 있습니다.");
    };
    window.addEventListener("baeumzip:api-retrying", handleRetrying);
    return () => window.removeEventListener("baeumzip:api-retrying", handleRetrying);
  }, [setNotice]);

  useEffect(() => {
    const handleSlowRequest = () => {
      setNotice("연결이 평소보다 느립니다. 현재 화면을 유지한 채 기다리고 있습니다.");
    };
    window.addEventListener("baeumzip:api-slow", handleSlowRequest);
    return () => window.removeEventListener("baeumzip:api-slow", handleSlowRequest);
  }, [setNotice]);
}
