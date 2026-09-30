import { isPublicGuideSlug } from "../public-content/public-guide-links";

export const AD_DELIVERY_POLICY = {
  mode: "manual-only",
  implementationStatus: "reserved-only",
  maxSlotsPerPage: { mobile: 1, desktop: 2 },
} as const;

export const AD_PLACEMENTS = {
  catalogFooter: {
    id: "catalog-footer",
    route: "/",
    format: "responsive-horizontal",
    minHeightPx: 100,
    minInteractiveSeparationPx: 64,
    minViewportWidthPx: 0,
  },
  guideFooter: {
    id: "guide-footer",
    route: "/guides/[course]",
    format: "responsive-horizontal",
    minHeightPx: 100,
    minInteractiveSeparationPx: 64,
    minViewportWidthPx: 0,
  },
  guideSidebar: {
    id: "guide-sidebar",
    route: "/guides/[course]",
    format: "rectangle",
    minHeightPx: 250,
    minInteractiveSeparationPx: 64,
    minViewportWidthPx: 1280,
  },
  practiceFooter: {
    id: "practice-footer",
    route: "registered-practice-routes",
    format: "responsive-horizontal",
    minHeightPx: 100,
    minInteractiveSeparationPx: 96,
    minViewportWidthPx: 0,
  },
} as const;

export type AdPlacement = keyof typeof AD_PLACEMENTS;

export const AD_FREE_ROUTE_PREFIXES = [
  "/admin",
  "/api",
] as const;

export const AD_FREE_ROUTES = ["/privacy", "/about", "/guides"] as const;

// Deliberate per-course opt-in; a future course is not monetized automatically.
export const AD_PRACTICE_COURSE_PATHS = [
  "/learn/sql/sqld",
  "/learn/sql/sqlp",
  "/learn/data-architecture/dasp",
  "/learn/data-architecture/dap",
  "/learn/big-data-analysis/bae-written",
  "/learn/information-processing/ipe-written",
  "/learn/information-processing/ipe-practical",
] as const;

// Explicit allowlist: new routes do not automatically acquire advertising.
export function isAdPlacementAllowed(placement: AdPlacement, pathname: string) {
  if (placement === "catalogFooter") return pathname === "/";
  if (placement === "practiceFooter") {
    if (pathname === "/learn/software-major/practice") return true;
    if (/^\/learn\/big-data-analysis\/bae-practical\/type-[123]$/u.test(pathname)) return true;
    return AD_PRACTICE_COURSE_PATHS.some(base => pathname === `${base}/practice`
      || (pathname.startsWith(`${base}/questions/`) && /^[1-9]\d*$/u.test(pathname.slice(`${base}/questions/`.length))));
  }
  if (placement !== "guideFooter" && placement !== "guideSidebar") return false;
  const match = /^\/guides\/([^/]+)\/?$/u.exec(pathname);
  return Boolean(match && isPublicGuideSlug(match[1]));
}

export function isLocalAdPreview({
  environment,
  hostname,
  search,
}: { environment: string | undefined; hostname: string; search: string }) {
  return environment === "development"
    && ["localhost", "127.0.0.1", "[::1]"].includes(hostname)
    && new URLSearchParams(search).get("ad_preview") === "1";
}

export const AD_FREE_INTERACTION_SURFACES = [
  "practice-setup",
  "practice-result",
  "mock-exam-setup",
  "mock-exam-question",
  "mock-exam-result",
  "question-and-answer-controls",
  "bookmark-review",
  "theory-reader",
  "learning-records",
] as const;
