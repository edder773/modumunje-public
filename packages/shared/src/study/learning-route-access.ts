import type { LearningRoute } from "./learning-catalog";

/** Catalogs and theory stay public; solving, exams and records require sign-in. */
export function isPublicLearningRoute(route: LearningRoute | null): boolean {
  if (!route) return false;
  if (route.page === "field") {
    return !route.section || ["home", "theories"].includes(route.section);
  }
  return ["home", "theories", "theory"].includes(route.page);
}
