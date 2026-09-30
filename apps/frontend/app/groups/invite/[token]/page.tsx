import type { Metadata } from "next";
import { requireSiteUser } from "@frontend/server/auth/site-auth";
import { InviteAcceptClient } from "@frontend/features/group-exams/invite-accept-client";
import { getRuntimeEnv } from "@backend/infrastructure/database";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "그룹 초대 | 모두의 문제집", robots: { index: false, follow: false } };
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  if (getRuntimeEnv().SKCT_GROUP_SERVICE_ENABLED !== "1") notFound();
  const { token } = await params;
  await requireSiteUser(`/groups/invite/${encodeURIComponent(token)}`);
  return <InviteAcceptClient token={token} />;
}
