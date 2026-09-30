import { parseLocalPracticePath } from "./local-practice";
import { parsePreparingLearningPath } from "./preparing-courses";
import { parseLearningPath, type LearningRoute } from "./learning-catalog";
import { isPublicLearningRoute } from "./learning-route-access";
export { isPublicLearningRoute } from "./learning-route-access";

/** Public availability does not make private exam URLs search landing pages. */
export function isIndexableLearningRoute(route: LearningRoute | null): boolean {
  if (!route) return false;
  if (route.page === "field") return route.fieldId === "software-major"
    ? !route.section || ["home", "theories"].includes(route.section)
    : route.section === "theories";
  return ["home", "theories", "theory"].includes(route.page);
}

export function isPublicLearningPath(pathname: string): boolean {
  // Course introductions stay public, but practical workbooks require sign-in.
  return pathname === "/" || pathname === "/learn/skct-personal" || parsePreparingLearningPath(pathname) !== null || parseLocalPracticePath(pathname)?.section === "home" || isPublicLearningRoute(parseLearningPath(pathname));
}

export function isIndexableLearningPath(pathname: string): boolean {
  const local = parseLocalPracticePath(pathname);
  return pathname === "/" || (local ? local.section === "home" : isIndexableLearningRoute(parseLearningPath(pathname)));
}

export function isTheoryReadingRoute(route: LearningRoute): boolean {
  return route.page === "theories" || route.page === "theory"
    || (route.page === "field" && route.section === "theories");
}

export function isPublicStudyScope(scope: string | null): boolean {
  return scope !== null && ["shell", "overview", "bootstrap", "theories", "theory"].includes(scope);
}

export function isPublicSwStudyView(view: string | null): boolean {
  return ["summary", "theories", "theory"].includes(view ?? "summary");
}
