import { POST as handleEventsPost } from "@backend/modules/events/events.service";
import { withApiErrorBoundary } from "@backend/common/http/api-response";
import { withSiteIdentity } from "@frontend/server/auth/site-auth";

export const runtime = "edge";
export const dynamic = "force-dynamic";
export const POST = (request: Request) =>
  withSiteIdentity(request, (authenticatedRequest) =>
    withApiErrorBoundary(authenticatedRequest, () => handleEventsPost(authenticatedRequest), {
      code: "BACKEND_UNAVAILABLE",
      message: "서비스를 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    }), { allowAnonymous: true });
