import StudyApp from "@frontend/features/study/components/study-app";
import SignOutForm from "@frontend/features/auth/sign-out-form";
import LearningCatalogHome from "@frontend/features/study/components/catalog/catalog-home";
import { CATALOG_FIELD_CARDS } from "@frontend/features/study/components/catalog/catalog-fields";
import CatalogPageShell from "@frontend/features/study/components/catalog/catalog-page-shell";
import type { LearnerPageSession } from "@shared/auth/page-session";
import type { StudyData } from "../components/study-screen-shared";
import type { StudyScope } from "../model/study-api-client";

export default function LearnerPage({
  initialPath,
  session,
  initialData,
  initialScope,
  authError = false,
  catalogFilters,
}: {
  initialPath: string;
  session: LearnerPageSession;
  initialData: StudyData | null;
  initialScope: StudyScope | null;
  authError?: boolean;
  catalogFilters?: { query?: string; fieldId?: string; page?: number };
}) {
  if (initialPath === "/" && session.status !== "blocked") {
    const isAuthenticated = session.status === "active";
    return (
      <CatalogPageShell
        displayName={session.displayName}
        signInPath={session.signInPath}
        signOutPath={isAuthenticated ? session.signOutPath : ""}
        isAuthenticated={isAuthenticated}
        adminAccess={session.status === "active" && session.adminAccess}
        groupExamAccess={session.status === "active" && session.groupExamAccess}
      >
        <LearningCatalogHome authError={authError} isAuthenticated={isAuthenticated} fields={CATALOG_FIELD_CARDS} filters={catalogFilters} />
      </CatalogPageShell>
    );
  }
  if (session.status === "guest") {
    return (
      <StudyApp
        displayName={session.displayName}
        userKeyHash={session.userKey}
        signInPath={session.signInPath}
        signOutPath=""
        isAuthenticated={false}
        adminAccess={false}
        groupExamAccess={false}
        initialPath={initialPath}
        initialData={initialData}
        initialScope={initialScope}
        rootCatalog={<LearningCatalogHome authError={authError} isAuthenticated={false} fields={CATALOG_FIELD_CARDS} filters={catalogFilters} />}
      />
    );
  }
  if (session.status === "blocked") {
    return (
      <main className="login-page">
        <section className="blocked-account-card">
          <span className="login-mark" aria-hidden="true" />
          <p className="section-kicker">계정 접근 안내</p>
          <h1>이 계정은 현재 이용할 수 없습니다.</h1>
          <p>
            운영 정책에 따라 접근이 제한되었습니다.
            {session.blockedReason ? ` 사유: ${session.blockedReason}` : ""}
          </p>
          <SignOutForm action={session.signOutPath} buttonClassName="primary-button" />
        </section>
      </main>
    );
  }
  return (
    <StudyApp
      displayName={session.displayName}
      userKeyHash={session.userKey}
      signInPath={session.signInPath}
      signOutPath={session.signOutPath}
      isAuthenticated
      adminAccess={session.adminAccess}
      groupExamAccess={session.groupExamAccess}
      initialPath={initialPath}
      initialData={initialData}
      initialScope={initialScope}
      rootCatalog={<LearningCatalogHome authError={authError} isAuthenticated fields={CATALOG_FIELD_CARDS} filters={catalogFilters} />}
    />
  );
}
