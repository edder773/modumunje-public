import { claimGuestExamResults } from "@backend/common/auth/guest-learning-session";
import { isAdminEmail } from "@backend/common/auth/admin-auth";
import {
  clearGooglePendingCookie,
  clearGoogleSessionCookie,
  createGoogleSessionValue,
  createPendingGoogleOAuthValue,
  googleOAuthStateMatches,
  googlePendingCookie,
  googleSessionCookie,
  pendingGoogleOAuthFromRequest,
  randomBase64Url,
  safeRelativeReturnPath,
  sha256Base64Url,
} from "@backend/common/auth/google-session";
import { AuthRepository } from "./auth.repository";
import {
  GOOGLE_AUTHORIZATION_ENDPOINT,
  GOOGLE_TOKEN_ENDPOINT,
  GOOGLE_USERINFO_ENDPOINT,
  type GoogleOAuthConfiguration,
  type GoogleTokenResponse,
  type GoogleUserInfoResponse,
} from "./domain/auth.domain";

function noStoreHeaders() {
  return {
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  };
}

function redirectResponse(location: string, cookies: string[] = [], status = 302) {
  const headers = new Headers({ ...noStoreHeaders(), Location: location });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status, headers });
}

function unavailableResponse() {
  return Response.json(
    { error: "Google 로그인이 아직 준비되지 않았습니다." },
    { status: 503, headers: noStoreHeaders() },
  );
}

function failureRedirect(
  request: Request,
  configuration: GoogleOAuthConfiguration,
  errorCode: string,
) {
  const origin = new URL(configuration.redirectUri).origin;
  const location = new URL("/", origin);
  location.searchParams.set("auth_error", errorCode);
  return redirectResponse(location.toString(), [clearGooglePendingCookie(request.url)]);
}

async function readJson<T>(response: Response): Promise<T | null> {
  try {
    const value: unknown = await response.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as T
      : null;
  } catch {
    return null;
  }
}

const authRepository = new AuthRepository();
const GOOGLE_OAUTH_RESPONSE_BUDGET_MS = 10_000;

export async function startGoogleAuth(
  request: Request,
  repository = authRepository,
) {
    const configuration = repository.configuration();
    if (!configuration) return unavailableResponse();
    const requestUrl = new URL(request.url);
    const callbackOrigin = new URL(configuration.redirectUri).origin;
    const returnTo = safeRelativeReturnPath(requestUrl.searchParams.get("return_to"));
    if (requestUrl.origin !== callbackOrigin) {
      const canonicalStart = new URL("/api/auth/google/start", callbackOrigin);
      canonicalStart.searchParams.set("return_to", returnTo);
      return redirectResponse(canonicalStart.toString());
    }

    const state = randomBase64Url(32);
    const codeVerifier = randomBase64Url(64);
    const pendingValue = await createPendingGoogleOAuthValue({ state, codeVerifier, returnTo });
    const authorizationUrl = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
    authorizationUrl.search = new URLSearchParams({
      client_id: configuration.clientId,
      redirect_uri: configuration.redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state,
      code_challenge: await sha256Base64Url(codeVerifier),
      code_challenge_method: "S256",
      access_type: "online",
      prompt: "select_account",
    }).toString();
    return redirectResponse(authorizationUrl.toString(), [
      googlePendingCookie(pendingValue, request.url),
    ]);
}

export async function completeGoogleAuth(
  request: Request,
  repository = authRepository,
) {
    const configuration = repository.configuration();
    if (!configuration) return unavailableResponse();
    const url = new URL(request.url);
    if (url.searchParams.has("error")) {
      return failureRedirect(request, configuration, "google_cancelled");
    }
    const code = url.searchParams.get("code") ?? "";
    const state = url.searchParams.get("state") ?? "";
    const pending = await pendingGoogleOAuthFromRequest(request);
    if (!code || !state || !pending || !googleOAuthStateMatches(state, pending.state)) {
      return failureRedirect(request, configuration, "google_state_invalid");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GOOGLE_OAUTH_RESPONSE_BUDGET_MS);
    try {
      const tokenResponse = await fetch(GOOGLE_TOKEN_ENDPOINT, {
        signal: controller.signal,
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          code,
          client_id: configuration.clientId,
          client_secret: configuration.clientSecret,
          redirect_uri: configuration.redirectUri,
          grant_type: "authorization_code",
          code_verifier: pending.codeVerifier,
        }),
      });
      const token = await readJson<GoogleTokenResponse>(tokenResponse);
      controller.signal.throwIfAborted();
      if (
        !tokenResponse.ok
        || typeof token?.access_token !== "string"
        || token.token_type !== "Bearer"
      ) return failureRedirect(request, configuration, "google_token_failed");

      const userInfoResponse = await fetch(GOOGLE_USERINFO_ENDPOINT, {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token.access_token}`,
        },
      });
      const userInfo = await readJson<GoogleUserInfoResponse>(userInfoResponse);
      controller.signal.throwIfAborted();
      const email = typeof userInfo?.email === "string"
        ? userInfo.email.trim().toLowerCase()
        : "";
      const id = typeof userInfo?.sub === "string" ? userInfo.sub.trim() : "";
      const fullName = typeof userInfo?.name === "string"
        ? userInfo.name.trim().slice(0, 160)
        : "";
      if (!userInfoResponse.ok || !id || !email || userInfo?.email_verified !== true) {
        return failureRedirect(request, configuration, "google_identity_failed");
      }

      const account = await repository.ensureLearner(email, fullName || email);
      if (account?.status === "active") await claimGuestExamResults(request, account.userKey, isAdminEmail(email));
      controller.signal.throwIfAborted();
      const sessionValue = await createGoogleSessionValue({
        id,
        email,
        displayName: fullName || email,
        fullName: fullName || null,
      });
      controller.signal.throwIfAborted();
      const location = new URL(pending.returnTo, new URL(configuration.redirectUri).origin);
      return redirectResponse(location.toString(), [
        clearGooglePendingCookie(request.url),
        googleSessionCookie(sessionValue, request.url),
      ]);
    } catch {
      return failureRedirect(request, configuration, "google_unavailable");
    } finally {
      clearTimeout(timeout);
    }
}

export async function logoutGoogleAuth(
  request: Request,
  repository = authRepository,
) {
    if (request.method !== "POST") {
      return new Response(null, { status: 405, headers: { Allow: "POST" } });
    }
    const requestOrigin = new URL(request.url).origin;
    if (request.headers.get("origin") !== requestOrigin) {
      return Response.json(
        { error: "허용되지 않은 요청 출처입니다." },
        { status: 403, headers: noStoreHeaders() },
      );
    }
    const configuration = repository.configuration();
    const requestUrl = new URL(request.url);
    const origin = configuration
      ? new URL(configuration.redirectUri).origin
      : requestUrl.origin;
    const returnTo = safeRelativeReturnPath(requestUrl.searchParams.get("return_to"));
    return redirectResponse(new URL(returnTo, origin).toString(), [
      clearGoogleSessionCookie(request.url),
      clearGooglePendingCookie(request.url),
    ], 303);
}
