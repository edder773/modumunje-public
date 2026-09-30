import { notFound } from "next/navigation";
import AdminPage from "@frontend/features/admin/pages/admin-page";
import {
  ADMIN_SECTIONS,
  type AdminSection,
} from "@frontend/features/admin/model/admin-sections";
import { loadAdminPageSession } from "@frontend/server/auth/page-session";

export const dynamic = "force-dynamic";

export default async function Page({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  if (!ADMIN_SECTIONS.includes(section as AdminSection) || section === "dashboard") {
    notFound();
  }
  const initialSection = section as AdminSection;
  const session = await loadAdminPageSession(`/admin/${initialSection}`);
  return <AdminPage initialSection={initialSection} session={session} />;
}
