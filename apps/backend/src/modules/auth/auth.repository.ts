import { ensureLearnerAccount } from "@backend/common/auth/admin-auth";
import { getRuntimeEnv } from "@backend/infrastructure/database";
import type { GoogleOAuthConfiguration } from "./domain/auth.domain";

export class AuthRepository {
  configuration(): GoogleOAuthConfiguration | null {
    const env = getRuntimeEnv();
    const clientId = String(env.GOOGLE_CLIENT_ID ?? "").trim();
    const clientSecret = String(env.GOOGLE_CLIENT_SECRET ?? "").trim();
    const redirectUri = String(env.GOOGLE_OAUTH_REDIRECT_URI ?? "").trim();
    const sessionSecret = String(env.GOOGLE_AUTH_SESSION_SECRET ?? "").trim();
    if (!clientId || !clientSecret || !redirectUri || sessionSecret.length < 32) return null;
    try {
      const url = new URL(redirectUri);
      const localHttp = url.protocol === "http:"
        && ["localhost", "127.0.0.1"].includes(url.hostname);
      if ((url.protocol !== "https:" && !localHttp)
        || url.pathname !== "/api/auth/google/callback") return null;
    } catch {
      return null;
    }
    return { clientId, clientSecret, redirectUri };
  }

  ensureLearner(email: string, displayName: string) {
    return ensureLearnerAccount(email, displayName, true);
  }
}
