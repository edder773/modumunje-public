import AdminPage from "@frontend/features/admin/pages/admin-page";
import { loadAdminPageSession } from "@frontend/server/auth/page-session";

export const dynamic = "force-dynamic";

export default async function Page() {
  const session = await loadAdminPageSession("/admin/");
  return <AdminPage initialSection="dashboard" session={session} />;
}
