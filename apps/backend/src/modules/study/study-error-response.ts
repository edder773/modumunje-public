import { StudyRequestError } from "./study-attempt.service";
import { apiErrorResponse } from "@backend/common/http/api-response";

export function studyErrorResponse(request: Request, error: unknown, requestId?: string) {
  if (error instanceof StudyRequestError) {
    return apiErrorResponse(request, {
      status: error.status,
      code: error.code,
      message: error.publicMessage,
      requestId,
    });
  }
  return apiErrorResponse(request, {
    status: 500,
    code: "STUDY_REQUEST_FAILED",
    message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    requestId,
  });
}
