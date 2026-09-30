import { loadAdminPageSession } from "@frontend/server/auth/page-session";
import SkctPersonalAdmin from "@frontend/features/study/components/skct-personal/skct-personal-admin";

export const dynamic = "force-dynamic";
export default async function Page() {
  const session = await loadAdminPageSession("/admin/skct-personal");
  return <SkctPersonalAdmin displayName={session.displayName} signOutPath={session.signOutPath} />;
}
