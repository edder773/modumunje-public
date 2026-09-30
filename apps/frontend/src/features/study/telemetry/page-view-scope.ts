import type { ExamType } from "@shared/study/study-domain";

export type PageViewScope = { prefix: string; examScope: ExamType | "SW" | "GROUP_SKCT" };

export function pageViewScope(pathname: string, scopes: readonly PageViewScope[]) {
  return scopes.find(({ prefix }) => pathname === prefix || pathname.startsWith(`${prefix}/`))?.examScope;
}
