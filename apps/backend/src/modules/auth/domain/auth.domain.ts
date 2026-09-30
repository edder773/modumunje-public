export const GOOGLE_AUTHORIZATION_ENDPOINT =
  "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const GOOGLE_USERINFO_ENDPOINT =
  "https://openidconnect.googleapis.com/v1/userinfo";

export type GoogleOAuthConfiguration = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export type GoogleTokenResponse = {
  access_token?: unknown;
  token_type?: unknown;
};

export type GoogleUserInfoResponse = {
  sub?: unknown;
  email?: unknown;
  email_verified?: unknown;
  name?: unknown;
};
