import { metricPhase } from "@backend/common/observability/d1-metrics";
import { headers as nextHeaders } from "next/headers";
import { redirect } from "next/navigation";
import {
  googleSignInPath,
  googleSignOutPath,
  googleUserFromCookieHeader,
  googleUserFromRequest,
  type GoogleUser,
} from "@backend/common/auth/google-session";
import { loginNoticePath } from "@shared/auth/login-navigation";
import { AUTHENTICATED_USER_EMAIL_HEADER } from "@shared/auth/authenticated-user";

export type SiteUser = GoogleUser;

export function siteSignInPath(returnTo: string) {
  return googleSignInPath(returnTo);
}

export function applicationSignOutPath(returnTo = "/") {
  return googleSignOutPath(returnTo);
}

export async function getSiteUser(): Promise<SiteUser | null> {
  const requestHeaders = await nextHeaders();
  return metricPhase("identity", () => googleUserFromCookieHeader(requestHeaders.get("cookie") ?? ""));
}

export async function requireSiteUser(returnTo: string): Promise<SiteUser> {
  const user = await getSiteUser();
  if (user) return user;
  redirect(loginNoticePath(returnTo));
}

export async function withSiteIdentity(
  request: Request,
  handler: (authenticatedRequest: Request) => Promise<Response>,
  options: { allowAnonymous?: boolean } = {},
) {
  const user = await metricPhase("identity", () => googleUserFromRequest(request));
  request.headers.delete(AUTHENTICATED_USER_EMAIL_HEADER);
  if (!user && !options.allowAnonymous) {
    return Response.json(
      {
        code: "AUTHENTICATION_REQUIRED",
        error: "로그인이 필요합니다.",
      },
      {
        status: 401,
        headers: {
          "Cache-Control": "no-store",
          Vary: "Cookie",
        },
      },
    );
  }
  if (user) request.headers.set(AUTHENTICATED_USER_EMAIL_HEADER, user.email);
  return handler(request);
}
