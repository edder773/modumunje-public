import {
  DELETE as handleAdminDelete,
  GET as handleAdminGet,
  PATCH as handleAdminPatch,
  POST as handleAdminPost,
} from "@backend/modules/admin/admin-request-handlers";
import { withApiErrorBoundary } from "@backend/common/http/api-response";
import { withSiteIdentity } from "@frontend/server/auth/site-auth";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const failure = {
  code: "ADMIN_API_UNAVAILABLE",
  message: "관리자 작업을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.",
};
const invokeAdmin = (request: Request, handler: (request: Request) => Promise<Response>) =>
  withSiteIdentity(request, (authenticated) => withApiErrorBoundary(
    authenticated, () => handler(authenticated), failure,
  ));
export const GET = (request: Request) => invokeAdmin(request, handleAdminGet);
export const POST = (request: Request) => invokeAdmin(request, handleAdminPost);
export const PATCH = (request: Request) => invokeAdmin(request, handleAdminPatch);
export const DELETE = (request: Request) => invokeAdmin(request, handleAdminDelete);
