import {
  GET as handleSwStudyGet,
  POST as handleSwStudyPost,
} from "@backend/modules/sw-study/sw-study.service";
import { withSiteIdentity } from "@frontend/server/auth/site-auth";
import { isPublicSwStudyView } from "@shared/study/learning-access";

export const runtime = "edge";
export const GET = (request: Request) =>
  withSiteIdentity(request, handleSwStudyGet, {
    allowAnonymous: isPublicSwStudyView(new URL(request.url).searchParams.get("view")),
  });
export const POST = (request: Request) =>
  withSiteIdentity(request, handleSwStudyPost);
