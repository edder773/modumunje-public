import type {Metadata} from "next";
import {notFound} from "next/navigation";
import {getRuntimeEnv} from "@backend/infrastructure/database";
import {requireSiteUser} from "@frontend/server/auth/site-auth";
import {GroupExamRunnerClient} from "@frontend/features/group-exams/group-exam-runner-client";

export const dynamic="force-dynamic";
export const metadata:Metadata={title:"그룹 SKCT 시험 | 모두의 문제집",robots:{index:false,follow:false,noarchive:true}};

export default async function Page({params}:{params:Promise<{runId:string}>}){
  if(getRuntimeEnv().SKCT_GROUP_SERVICE_ENABLED!=="1")notFound();
  const {runId}=await params;
  await requireSiteUser(`/groups/exams/${encodeURIComponent(runId)}`);
  return <GroupExamRunnerClient runId={runId}/>;
}
