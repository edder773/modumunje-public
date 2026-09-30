import { automatedAnalyticsAgent } from "@shared/runtime/analytics-agent";
import { clientEventId } from "../persistence/client-event-id";
import type { ExamType } from "@shared/study/study-domain";
import type { Metric } from "web-vitals";

type ApiTimingDetail = {
  requestId?: string;
  route?: string;
  durationMs?: number;
  status?: number;
  retries?: number;
  cacheSource?: string;
  outcome?: string;
};

type TrackEventValues = {
  eventType: string;
  eventId?: string;
  examScope?: ExamType | "SW" | "GROUP_SKCT";
  subject?: string;
  questionId?: number;
  contentId?: string;
  answerResult?: "correct" | "incorrect";
  durationMs?: number;
  pagePath?: string;
  errorType?: string;
  impact?: string;
  message?: string;
  metricName?: string;
  metricValue?: number;
  apiRoute?: string;
  httpStatus?: number;
  retryCount?: number;
  cacheSource?: string;
  buildSha?: string;
};

let fallbackSessionId = "";

function browserFamily() {
  const agent = navigator.userAgent;
  if (/Edg\//u.test(agent)) return "Edge";
  if (/Firefox\//u.test(agent)) return "Firefox";
  if (/Chrome\//u.test(agent) && !/Edg\//u.test(agent)) return "Chrome";
  if (/Safari\//u.test(agent) && !/Chrome\//u.test(agent)) return "Safari";
  return "Other";
}

function anonymousSessionId() {
  const key = "sql-study-anonymous-session";
  const createdKey = `${key}:created-at`;
  try {
    const existing = window.localStorage.getItem(key);
    const createdAt = Number(window.localStorage.getItem(createdKey));
    if (existing && /^[a-zA-Z0-9_-]{12,80}$/u.test(existing)
      && createdAt > 0 && Date.now() - createdAt < 90 * 24 * 60 * 60_000) return existing;
    const created = clientEventId();
    window.localStorage.setItem(key, created);
    window.localStorage.setItem(createdKey, String(Date.now()));
    return created;
  } catch {
    fallbackSessionId ||= clientEventId();
    return fallbackSessionId;
  }
}

export function trackEvent(values: TrackEventValues) {
  if (typeof window === "undefined") return;
  if (automatedAnalyticsAgent(navigator.userAgent, navigator.webdriver)) return;
  if (navigator.doNotTrack === "1"
    || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl) return;
  const width = window.innerWidth;
  const deviceCategory = width <= 767 ? "mobile" : width <= 1023 ? "tablet" : "desktop";
  let referrerHost = "";
  try {
    referrerHost = document.referrer ? new URL(document.referrer).host : "";
  } catch {
    referrerHost = "";
  }
  void fetch("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    keepalive: true,
    body: JSON.stringify({
      ...values,
      eventId: values.eventId ?? clientEventId(),
      anonymousSessionId: anonymousSessionId(),
      pagePath: values.pagePath ?? window.location.pathname,
      referrerHost,
      deviceCategory,
      viewportWidth: width,
      browserFamily: browserFamily(),
    }),
  }).catch(() => undefined);
}

function sampled(rate: number) {
  return Math.random() < rate;
}

export function installRumObservers() {
  const navigationIsSampled = sampled(0.1);
  const navigationTraceId = clientEventId();
  const cleanups: Array<() => void> = [];
  const apiTimingListener = (event: Event) => {
    if (!navigationIsSampled) return;
    const detail = (event as CustomEvent<ApiTimingDetail>).detail ?? {};
    trackEvent({
      eventType: "api_timing",
      durationMs: Math.max(0, Math.round(Number(detail.durationMs) || 0)),
      apiRoute: String(detail.route ?? "/api/unknown").slice(0, 120),
      httpStatus: Number.isInteger(detail.status) ? detail.status : undefined,
      retryCount: Math.max(0, Math.min(1, Math.round(Number(detail.retries) || 0))),
      cacheSource: String(detail.cacheSource ?? "unknown").slice(0, 32),
      contentId: /^[a-f0-9]{32}$/u.test(detail.requestId ?? "") ? detail.requestId : navigationTraceId,
      subject: navigationTraceId,
      buildSha: __BAEUMZIP_BUILD_SHA__.slice(0, 40),
    });
  };
  window.addEventListener("baeumzip:api-timing", apiTimingListener);
  cleanups.push(() => window.removeEventListener("baeumzip:api-timing", apiTimingListener));

  if (navigationIsSampled) {
    let disposed = false;
    const reportMetric = (metric: Metric) => {
      if (disposed || !["CLS", "INP", "LCP", "TTFB"].includes(metric.name)) return;
      const connection = navigator as Navigator & {
        connection?: { effectiveType?: string };
      };
      trackEvent({
        eventType: "web_vital",
        metricName: metric.name,
        metricValue: metric.value,
        durationMs: Math.max(0, Math.round(metric.value)),
        contentId: navigationTraceId,
        cacheSource: metric.navigationType,
        subject: connection.connection?.effectiveType ?? "unknown-network",
        buildSha: __BAEUMZIP_BUILD_SHA__.slice(0, 40),
      });
    };
    void import("web-vitals")
      .then(({ onCLS, onINP, onLCP, onTTFB }) => {
        if (disposed) return;
        onCLS(reportMetric);
        onINP(reportMetric);
        onLCP(reportMetric);
        onTTFB(reportMetric);
      })
      .catch(() => undefined);
    cleanups.push(() => {
      disposed = true;
    });
  }

  return () => cleanups.forEach((cleanup) => cleanup());
}
