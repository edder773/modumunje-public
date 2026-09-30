import crypto from "node:crypto";

export const LOCAL_E2E_GOOGLE_SESSION_SECRET =
  "baeumzip-local-e2e-google-session-secret-v1";

export const LOCAL_E2E_ADMIN_EMAIL = "admin@example.test";

type LocalGoogleSessionUser = {
  id?: string;
  email?: string;
  name?: string;
};

export function createLocalGoogleSessionValue(user: LocalGoogleSessionUser = {}) {
  const now = Math.floor(Date.now() / 1000);
  const encoded = Buffer.from(JSON.stringify({
    v: 1,
    sub: user.id ?? "playwright-user",
    email: user.email ?? "learner@example.test",
    name: user.name ?? "Playwright Learner",
    iat: now,
    exp: now + 60 * 60,
  })).toString("base64url");
  const signature = crypto
    .createHmac("sha256", LOCAL_E2E_GOOGLE_SESSION_SECRET)
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${signature}`;
}

export function createLocalGoogleStorageState(user: LocalGoogleSessionUser = {}) {
  return {
    cookies: [{
      name: "baeumzip-google-session",
      value: createLocalGoogleSessionValue(user),
      domain: "127.0.0.1",
      path: "/",
      expires: Math.floor(Date.now() / 1000) + 60 * 60,
      httpOnly: true,
      secure: false,
      sameSite: "Lax" as const,
    }],
    origins: [],
  };
}

export function createLocalAdminGoogleStorageState() {
  return createLocalGoogleStorageState({
    id: "playwright-admin",
    email: LOCAL_E2E_ADMIN_EMAIL,
    name: "Playwright Administrator",
  });
}
