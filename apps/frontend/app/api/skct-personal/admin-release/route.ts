import { GET as handleGet, POST as handlePost } from "@backend/modules/skct-personal/skct-personal-release-admin";
import { withApiErrorBoundary } from "@backend/common/http/api-response";
import { withSiteIdentity } from "@frontend/server/auth/site-auth";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const failure = { code: "SKCT_PERSONAL_RELEASE_UNAVAILABLE", message: "개인학습 릴리스를 처리하지 못했습니다." };
export const GET = (request: Request) => withSiteIdentity(request, authenticated =>
  withApiErrorBoundary(authenticated, () => handleGet(authenticated), failure));
export const POST = (request: Request) => withSiteIdentity(request, authenticated =>
  withApiErrorBoundary(authenticated, () => handlePost(authenticated), failure));
