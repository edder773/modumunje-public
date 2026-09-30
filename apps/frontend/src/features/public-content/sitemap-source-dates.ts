import type { PublicGuideSlug } from "@frontend/features/public-content/public-guide-links";

// Editorial dates are changed only with the corresponding page content.
// The source paths and revisions for these dates are recorded in the sitemap evidence report.
export const SITEMAP_SOURCE_DATES = {
  home: "2026-09-29",
  guidesIndex: "2026-09-29",
  about: "2026-09-21",
  privacy: "2026-09-30",
  courseHome: "2026-09-19",
  theoryDirectory: "2026-09-21",
  swFieldHome: "2026-09-29",
  swTheoryDirectory: "2026-09-29",
  localPracticeHome: "2026-09-19",
} as const;

export const GUIDE_SOURCE_DATES: Record<PublicGuideSlug,string> = {
  "skct-personal": "2026-09-29",
  sqld: "2026-09-29",
  sqlp: "2026-09-21",
  dasp: "2026-09-21",
  dap: "2026-09-21",
  "big-data-analysis": "2026-09-21",
  "big-data-practical": "2026-09-21",
  "ipe-written": "2026-09-21",
  "ipe-practical": "2026-09-29",
  "ise-written": "2026-09-21",
  "software-major": "2026-09-21",
};
