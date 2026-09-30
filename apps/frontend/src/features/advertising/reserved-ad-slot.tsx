"use client";

import { useEffect, useSyncExternalStore, type CSSProperties } from "react";
import {
  AD_DELIVERY_POLICY,
  AD_PLACEMENTS,
  isAdPlacementAllowed,
  isLocalAdPreview,
  type AdPlacement,
} from "./ad-placement-policy";

const PREVIEW_STORAGE_KEY = "modumunje:local-ad-preview";
const PREVIEW_EVENT = "modumunje:ad-preview";

function subscribeToPreviewLocation(onChange: () => void) {
  if (process.env.NODE_ENV !== "development") return () => {};
  window.addEventListener("popstate", onChange);
  window.addEventListener("modumunje:learning-navigation", onChange);
  window.addEventListener(PREVIEW_EVENT, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener("modumunje:learning-navigation", onChange);
    window.removeEventListener(PREVIEW_EVENT, onChange);
  };
}

function getPreviewPath() {
  if (process.env.NODE_ENV !== "development" || typeof window === "undefined") return "";
  let flag = new URLSearchParams(window.location.search).get("ad_preview");
  // A tab-scoped development preference keeps previews visible through client routing.
  try { flag ??= window.sessionStorage.getItem(PREVIEW_STORAGE_KEY); } catch { /* Storage may be blocked. */ }
  if (!isLocalAdPreview({
    environment: process.env.NODE_ENV,
    hostname: window.location.hostname,
    search: `?ad_preview=${flag}`,
  })) return "";
  return window.location.pathname;
}

const getServerPreviewPath = () => "";

export function ReservedAdSlot({
  placement,
  suppressed = false,
}: {
  placement: AdPlacement;
  suppressed?: boolean;
}) {
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    if (!isLocalAdPreview({ environment: process.env.NODE_ENV, hostname: window.location.hostname, search: "?ad_preview=1" })) return;
    const flag = new URLSearchParams(window.location.search).get("ad_preview");
    if (flag !== "1" && flag !== "0") return;
    try { window.sessionStorage.setItem(PREVIEW_STORAGE_KEY, flag); } catch { /* URL preview still works. */ }
    window.dispatchEvent(new Event(PREVIEW_EVENT));
  }, []);
  const policy = AD_PLACEMENTS[placement];
  const previewPath = useSyncExternalStore(subscribeToPreviewLocation, getPreviewPath, getServerPreviewPath);
  const preview = process.env.NODE_ENV === "development"
    && !suppressed && isAdPlacementAllowed(placement, previewPath);
  const attributes = {
    "data-ad-format": policy.format,
    "data-ad-min-height": policy.minHeightPx,
    "data-ad-min-interactive-separation": policy.minInteractiveSeparationPx,
    "data-ad-min-viewport-width": policy.minViewportWidthPx,
    "data-ad-mode": AD_DELIVERY_POLICY.mode,
    "data-ad-placement": policy.id,
    "data-ad-route": policy.route,
  };

  // Local layout QA only: never a publisher request, ad unit, or clickable mock ad.
  if (preview) {
    return (
      <aside
        {...attributes}
        className="ad-placement-preview"
        data-ad-status="preview"
        aria-label="광고 위치 미리보기"
        style={{
          "--ad-min-height": `${policy.minHeightPx}px`,
          "--ad-interactive-separation": `${policy.minInteractiveSeparationPx}px`,
        } as CSSProperties}
      >
        <span className="ad-placement-label">광고</span>
        <div className="ad-placement-preview-space">
          <span>광고 위치 미리보기</span>
          <small>{policy.id} · 실제 광고는 표시되지 않습니다</small>
        </div>
      </aside>
    );
  }

  return (
    <span
      {...attributes}
      aria-hidden="true"
      data-ad-status={suppressed ? "suppressed" : AD_DELIVERY_POLICY.implementationStatus}
      hidden
    />
  );
}
