"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { pageViewScope, type PageViewScope } from "./page-view-scope";
import { trackEvent } from "./study-telemetry";

// Module state suppresses duplicate mounts, but not a genuine later navigation.
let lastPath = "";
export default function PageViewTracker({ scopes }: { scopes: readonly PageViewScope[] }) {
  const pathname = usePathname();
  useEffect(() => {
    const report = () => {
      const rawPath = window.location.pathname;
      const path = /^\/groups\/exams\/[^/]+$/u.test(rawPath) ? "/groups/exams/[runId]" : rawPath;
      if (path === lastPath) return;
      lastPath = path;
      if (/^\/(?:admin|api|login)(?:\/|$)/u.test(path)) return;
      trackEvent({ eventType: "page_view", pagePath: path,
        examScope: pageViewScope(path, scopes) });
    };
    report();
    window.addEventListener("popstate", report);
    window.addEventListener("modumunje:learning-navigation", report);
    return () => {
      window.removeEventListener("popstate", report);
      window.removeEventListener("modumunje:learning-navigation", report);
    };
  }, [pathname, scopes]);
  return null;
}
