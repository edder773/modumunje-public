import {
  DELETE as handleStudyDelete,
  GET as handleStudyGet,
  PATCH as handleStudyPatch,
  POST as handleStudyPost,
} from "@backend/modules/study/study.service";
import { withApiErrorBoundary } from "@backend/common/http/api-response";
import { withSiteIdentity } from "@frontend/server/auth/site-auth";
import { isPublicStudyScope } from "@shared/study/learning-access";

export const runtime = "edge";
const studyReadFailure = {
  code: "STUDY_READ_UNAVAILABLE",
  message: "학습 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
};
const studyWriteFailure = {
  code: "STUDY_WRITE_UNAVAILABLE",
  message: "학습 상태를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
};
export const GET = (request: Request) =>
  withSiteIdentity(request, (authenticated) => withApiErrorBoundary(
    authenticated, () => handleStudyGet(authenticated), studyReadFailure,
  ), { allowAnonymous: isPublicStudyScope(new URL(request.url).searchParams.get("scope")) });
export const POST = (request: Request) =>
  withSiteIdentity(request, (authenticated) => withApiErrorBoundary(
    authenticated, () => handleStudyPost(authenticated), studyWriteFailure,
  ));
export const PATCH = (request: Request) =>
  withSiteIdentity(request, (authenticated) => withApiErrorBoundary(
    authenticated, () => handleStudyPatch(), studyWriteFailure,
  ));
export const DELETE = (request: Request) =>
  withSiteIdentity(request, (authenticated) => withApiErrorBoundary(
    authenticated, () => handleStudyDelete(), studyWriteFailure,
  ));
