import { startGoogleAuth } from "@backend/modules/auth/auth.service";
import { withApiErrorBoundary } from "@backend/common/http/api-response";

export const runtime = "edge";
export const dynamic = "force-dynamic";
export const GET = (request: Request) =>
  withApiErrorBoundary(request, () => startGoogleAuth(request), {
    code: "BACKEND_UNAVAILABLE",
    message: "서비스를 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  });
