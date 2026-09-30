import type {Metadata} from "next";
import {notFound} from "next/navigation";
import {getRuntimeEnv} from "@backend/infrastructure/database";
import {requireSiteUser} from "@frontend/server/auth/site-auth";
import {GroupExamResultClient} from "@frontend/features/group-exams/group-exam-result-client";
export const dynamic="force-dynamic";
export const metadata:Metadata={title:"그룹 SKCT 결과 | 모두의 문제집",robots:{index:false,follow:false,noarchive:true}};
export default async function Page({params}:{params:Promise<{runId:string}>}){
 if(getRuntimeEnv().SKCT_GROUP_SERVICE_ENABLED!=="1")notFound();
 const {runId}=await params;await requireSiteUser(`/groups/results/${encodeURIComponent(runId)}`);
 return <GroupExamResultClient runId={runId}/>;
}
