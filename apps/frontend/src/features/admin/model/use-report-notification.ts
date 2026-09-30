"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiRequestError } from "@frontend/shared/api/request-json";
import { apiGet } from "./admin-api-client";

export function useReportNotification() {
  const [newCount, setNewCount] = useState(0);
  const requestVersion = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    try {
      const data = await apiGet<{ newCount: number }>("report-notification", undefined, { bypassCache: true });
      if (version === requestVersion.current && Number.isSafeInteger(data.newCount) && data.newCount >= 0) {
        setNewCount(data.newCount);
      }
    } catch (error) {
      if (version === requestVersion.current && error instanceof ApiRequestError && (error.status === 401 || error.status === 403)) {
        setNewCount(0);
      }
    }
  }, []);

  useEffect(() => {
    const refreshVisible = () => {
      if (document.visibilityState !== "hidden") void refresh();
    };
    const initial = window.setTimeout(refreshVisible, 0);
    const interval = window.setInterval(refreshVisible, 60_000);
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      requestVersion.current += 1;
      window.clearTimeout(initial);
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [refresh]);

  return { newCount, refresh };
}
