import { GET as handleGet, POST as handlePost } from "@backend/modules/skct-personal/skct-personal.service";
import { withApiErrorBoundary } from "@backend/common/http/api-response";
import { withSiteIdentity } from "@frontend/server/auth/site-auth";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const failure = { code: "SKCT_PERSONAL_UNAVAILABLE", message: "SKCT 개인학습 요청을 처리하지 못했습니다." };

export const GET = (request: Request) => withSiteIdentity(request, authenticated =>
  withApiErrorBoundary(authenticated, () => handleGet(authenticated), failure),
{ allowAnonymous: new URL(request.url).searchParams.get("view") === "home" });
export const POST = (request: Request) => withSiteIdentity(request, authenticated =>
  withApiErrorBoundary(authenticated, () => handlePost(authenticated), failure));
