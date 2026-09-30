import AdminApp from "@frontend/features/admin/components/admin-app";
import type { AdminSection } from "@frontend/features/admin/model/admin-sections";
import type { AdminPageSession } from "@shared/auth/page-session";

export default async function AdminPage({
  initialSection,
  session,
}: {
  initialSection: AdminSection;
  session: Extract<AdminPageSession, { status: "authorized" }>;
}) {
  return (
    <AdminApp
      key={initialSection}
      initialSection={initialSection}
      displayName={session.displayName}
      signOutPath={session.signOutPath}
    />
  );
}
