import type { Metadata } from "next";
import { requireSiteUser } from "@frontend/server/auth/site-auth";
import { GroupExamClient } from "@frontend/features/group-exams/group-exam-client";
import { getRuntimeEnv } from "@backend/infrastructure/database";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "그룹 SKCT | 모두의 문제집", robots: { index: false, follow: false } };
export default async function Page() {
  if (getRuntimeEnv().SKCT_GROUP_SERVICE_ENABLED !== "1") notFound();
  await requireSiteUser("/groups");
  return <GroupExamClient />;
}
