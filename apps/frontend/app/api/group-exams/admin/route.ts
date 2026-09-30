import { GET_ADMIN as handleGroupExamAdminGet, POST_ADMIN as handleGroupExamAdminPost } from "@backend/modules/group-exams/group-exam.service";
import { withApiErrorBoundary } from "@backend/common/http/api-response";
import { withSiteIdentity } from "@frontend/server/auth/site-auth";

export const runtime = "edge";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => withSiteIdentity(request, (authenticated) =>
  withApiErrorBoundary(authenticated, () => handleGroupExamAdminGet(authenticated), {
    code: "GROUP_EXAM_ADMIN_UNAVAILABLE",
    message: "그룹 SKCT 관리자 요청을 처리하지 못했습니다.",
  }));
export const POST = (request: Request) => withSiteIdentity(request, (authenticated) =>
  withApiErrorBoundary(authenticated, () => handleGroupExamAdminPost(authenticated), {
    code: "GROUP_EXAM_ADMIN_UNAVAILABLE",
    message: "그룹 SKCT 관리자 요청을 처리하지 못했습니다.",
  }));
