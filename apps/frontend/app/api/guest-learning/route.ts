import { POST as handleGuestLearningPost } from "@backend/modules/auth/guest-learning.service";
import { withApiErrorBoundary } from "@backend/common/http/api-response";

export const runtime = "edge";
export const POST = (request: Request) => withApiErrorBoundary(request, () => handleGuestLearningPost(request), {
  code: "GUEST_SESSION_UNAVAILABLE", message: "학습을 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.",
});
