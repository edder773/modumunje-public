"use client";

import {
  useCallback,
  useEffect,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  learningPath,
  type LearningRoute,
} from "@shared/study/learning-catalog";
import { isReleasedExamType } from "@shared/study/study-domain";

type PoppedLearningRoute = {
  path: string;
  revision: number;
  route: LearningRoute | null;
};

export function hiddenQuestionRouteFromHistory(state: unknown): LearningRoute | null {
  if (!state || typeof state !== "object") return null;
  const candidate = (state as { learningRoute?: unknown }).learningRoute;
  if (!candidate || typeof candidate !== "object") return null;
  const route = candidate as { page?: unknown; examType?: unknown; id?: unknown };
  if (route.page !== "question") return null;
  if (!isReleasedExamType(route.examType)) return null;
  const id = Number(route.id);
  if (!Number.isInteger(id) || id <= 0) return null;
  return { examType: route.examType, page: "question", id };
}

export function currentHiddenQuestionRoute() {
  return hiddenQuestionRouteFromHistory(window.history.state);
}

export function useLearningRouter() {
  const router = useRouter();
  const pathname = usePathname();
  const [poppedRoute, setPoppedRoute] = useState<PoppedLearningRoute | null>(null);

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      setPoppedRoute((previous) => ({
        path: window.location.pathname,
        revision: (previous?.revision ?? 0) + 1,
        route: hiddenQuestionRouteFromHistory(event.state),
      }));
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const writeLearningUrl = useCallback((
    route: LearningRoute,
    mode: "push" | "replace" = "push",
    strategy: "router" | "client" = "client",
  ) => {
    const path = learningPath(route);
    if (strategy === "client") {
      const state = { ...window.history.state, learningRoute: route };
      if (window.location.pathname === path) {
        window.history.replaceState(state, "", path);
        return;
      }
      if (mode === "push") window.history.pushState(state, "", path);
      else window.history.replaceState(state, "", path);
      window.dispatchEvent(new Event("modumunje:learning-navigation"));
      return;
    }
    if (window.location.pathname === path) {
      router.replace(path, { scroll: false });
      return;
    }
    router[mode === "push" ? "push" : "replace"](path, { scroll: false });
  }, [router]);

  const pushLearningRoot = useCallback(() => {
    if (window.location.pathname !== "/") router.push("/", { scroll: false });
  }, [router]);

  return {
    pathname,
    poppedRoute: poppedRoute?.path === pathname ? poppedRoute : null,
    pushLearningRoot,
    writeLearningUrl,
  };
}
