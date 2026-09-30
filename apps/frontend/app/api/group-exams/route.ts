import { GET as handleGroupExamGet, POST as handleGroupExamPost } from "@backend/modules/group-exams/group-exam.service";
import { withApiErrorBoundary } from "@backend/common/http/api-response";
import { withSiteIdentity } from "@frontend/server/auth/site-auth";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const failure = { code: "GROUP_EXAM_UNAVAILABLE", message: "그룹 SKCT 요청을 처리하지 못했습니다." };
export const GET = (request: Request) => withSiteIdentity(request, (authenticated) =>
  withApiErrorBoundary(authenticated, () => handleGroupExamGet(authenticated), failure));
export const POST = (request: Request) => withSiteIdentity(request, (authenticated) =>
  withApiErrorBoundary(authenticated, () => handleGroupExamPost(authenticated), failure));
