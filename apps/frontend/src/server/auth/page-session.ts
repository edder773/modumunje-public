import type {
  AdminPageSession,
  LearnerPageSession,
} from "@shared/auth/page-session";
import {
  applicationSignOutPath,
  getSiteUser,
  siteSignInPath,
  requireSiteUser,
  type SiteUser,
} from "@frontend/server/auth/site-auth";
import { AUTHENTICATED_USER_EMAIL_HEADER } from "@shared/auth/authenticated-user";
import type { StudyData } from "@frontend/features/study/components/study-screen-shared";
import {
  withSafeStudyQuestionDefaults,
  type StudyScope,
} from "@frontend/features/study/model/study-api-client";
import { parseLearningPath } from "@shared/study/learning-catalog";
import { isPublicLearningPath } from "@shared/study/learning-access";
import { isStudyApiPayload } from "@shared/study/study-api-contract.mjs";
import { getRuntimeEnv } from "@backend/infrastructure/database";
import { headers as nextHeaders } from "next/headers";
import { forbidden } from "next/navigation";

export type LearnerPageContext = {
  session: LearnerPageSession;
  initialData: StudyData | null;
  initialScope: StudyScope | null;
};

function learnerStudyRequest(initialPath: string) {
  const route = parseLearningPath(initialPath);
  if (!route || route.page === "field" || route.page === "home") return null;
  const scope: StudyScope = route.page === "theory"
      ? "theory"
      : route.page === "theories"
        ? "theories"
        : route.page === "question"
          ? "questions"
          : route.page === "practice"
            ? "practice-meta"
          : route.page === "mock-exam" && route.id !== "active"
            ? "mock-session"
            : route.page === "mock-exams" || route.page === "mock-exam"
              ? "mock"
              : "records";
  const search = new URLSearchParams({ scope });
  if (!["overview", "bootstrap"].includes(scope)) {
    search.set("exam", route.examType);
  }
  if (route?.page === "theory") search.set("id", String(route.id));
  if (route?.page === "question") search.set("ids", String(route.id));
  if (route?.page === "mock-exam" && route.id !== "active") search.set("id", route.id);
  if (scope === "records") {
    search.set("view", route?.page === "bookmarks"
      ? "bookmarks"
      : route?.page === "incorrect"
        ? "incorrect"
        : "stats");
  }
  return { scope, url: `https://baeumzip.internal/api/study?${search.toString()}` };
}

async function learnerSessionForUser(
  user: SiteUser,
  initialPath: string,
): Promise<LearnerPageSession> {
  const { isAdminEmail, learnerUserHash, readLearnerAccount } = await import(
    "@backend/common/auth/admin-auth"
  );
  const account = await readLearnerAccount(user.email);
  if (account?.status === "blocked") {
    return {
      status: "blocked",
      blockedReason: account.blockedReason ?? "",
      signOutPath: applicationSignOutPath("/"),
    };
  }
  return {
    status: "active",
    displayName: user.displayName,
    userKey: account?.userKey ?? await learnerUserHash(user.email),
    adminAccess: isAdminEmail(user.email),
    groupExamAccess: getRuntimeEnv().SKCT_GROUP_SERVICE_ENABLED === "1",
    signInPath: siteSignInPath(initialPath),
    signOutPath: applicationSignOutPath("/"),
  };
}

export async function loadLearnerPageContext(
  initialPath: string,
  returnTo = initialPath,
): Promise<LearnerPageContext> {
  const user = isPublicLearningPath(initialPath)
    ? await getSiteUser()
    : await requireSiteUser(returnTo);
  if (user && getRuntimeEnv().BAEUMZIP_E2E_CLIENT_BOOTSTRAP === "client-mocked") {
    const { isAdminEmail } = await import("@backend/common/auth/admin-auth");
    return {
      session: {
        status: "active",
        displayName: user.displayName,
        userKey: `e2e-${user.id}`,
        adminAccess: isAdminEmail(user.email),
        groupExamAccess: getRuntimeEnv().SKCT_GROUP_SERVICE_ENABLED === "1",
        signInPath: siteSignInPath(returnTo),
        signOutPath: applicationSignOutPath("/"),
      },
      initialData: null,
      initialScope: null,
    };
  }
  const requestDescriptor = learnerStudyRequest(initialPath);
  if (!requestDescriptor) {
    return {
      session: user
        ? await learnerSessionForUser(user, returnTo)
        : {
            status: "guest",
            displayName: "비로그인 학습",
            userKey: "guest-browser",
            signInPath: siteSignInPath(returnTo),
          },
      initialData: null,
      initialScope: null,
    };
  }

  const requestHeaders = new Headers();
  if (!user) requestHeaders.set("cookie", (await nextHeaders()).get("cookie") ?? "");
  if (user) requestHeaders.set(AUTHENTICATED_USER_EMAIL_HEADER, user.email);
  const { GET: readStudyData } = await import("@backend/modules/study/study.service");
  const response = await readStudyData(new Request(requestDescriptor.url, { headers: requestHeaders }));
  const payload: unknown = response.ok ? await response.json() : null;
  const initialData = isStudyApiPayload(requestDescriptor.scope, payload)
    ? withSafeStudyQuestionDefaults(payload as StudyData & Record<string, unknown>) as StudyData
    : null;

  if (!user) {
    return {
      session: {
        status: "guest",
        displayName: "비로그인 학습",
        userKey: "guest-browser",
        signInPath: siteSignInPath(returnTo),
      },
      initialData,
      initialScope: initialData ? requestDescriptor.scope : null,
    };
  }

  if (response.status === 403) {
    const { readLearnerAccount } = await import("@backend/common/auth/admin-auth");
    const account = await readLearnerAccount(user.email);
    if (account?.status === "blocked") {
      return {
        session: {
          status: "blocked",
          blockedReason: account.blockedReason ?? "",
            signOutPath: applicationSignOutPath("/"),
        },
        initialData: null,
        initialScope: null,
      };
    }
  }

  const { isAdminEmail, learnerUserHash } = await import("@backend/common/auth/admin-auth");
  return {
    session: {
      status: "active",
      displayName: user.displayName,
      userKey: await learnerUserHash(user.email),
      adminAccess: isAdminEmail(user.email),
      groupExamAccess: getRuntimeEnv().SKCT_GROUP_SERVICE_ENABLED === "1",
      signInPath: siteSignInPath(returnTo),
      signOutPath: applicationSignOutPath("/"),
    },
    initialData,
    initialScope: initialData ? requestDescriptor.scope : null,
  };
}

export async function loadAdminPageSession(
  returnTo: string,
): Promise<Extract<AdminPageSession, { status: "authorized" }>> {
  const user = await requireSiteUser(returnTo);
  const { isAdminEmail } = await import("@backend/common/auth/admin-auth");
  if (!isAdminEmail(user.email)) forbidden();

  return {
    status: "authorized",
    displayName: user.displayName,
    signOutPath: applicationSignOutPath("/"),
  };
}
