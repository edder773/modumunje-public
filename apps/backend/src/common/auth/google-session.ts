import { getRuntimeEnv } from "@backend/infrastructure/database";

const GOOGLE_SESSION_COOKIE = "__Host-baeumzip-google-session";
const GOOGLE_PENDING_COOKIE = "__Host-baeumzip-google-pending";
const LOCAL_GOOGLE_SESSION_COOKIE = "baeumzip-google-session";
const LOCAL_GOOGLE_PENDING_COOKIE = "baeumzip-google-pending";
// Keep privileged allowlist access short-lived without forcing a separate
// administrator token into the browser. Rotating the signing secret still
// invalidates every outstanding session immediately when needed.
const GOOGLE_SESSION_MAX_AGE = 24 * 60 * 60;
const GOOGLE_PENDING_MAX_AGE = 10 * 60;
const SESSION_VERSION = 1;

export type GoogleUser = {
  id: string;
  email: string;
  displayName: string;
  fullName: string | null;
};

type PendingGoogleOAuth = {
  state: string;
  codeVerifier: string;
  returnTo: string;
};

type GoogleSessionClaims = {
  v: number;
  sub: string;
  email: string;
  name: string;
  iat: number;
  exp: number;
};

type PendingGoogleOAuthClaims = {
  v: number;
  state: string;
  codeVerifier: string;
  returnTo: string;
  exp: number;
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function normalizedEmail(value: unknown) {
  return typeof value === "string"
    ? value.trim().toLocaleLowerCase("en-US")
    : "";
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/u, "");
}

function base64UrlToBytes(value: string) {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error("Invalid base64url value");
  const padded = value.replace(/-/gu, "+").replace(/_/gu, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function fixedTimeEqual(first: string, second: string) {
  if (first.length !== second.length) return false;
  let difference = 0;
  for (let index = 0; index < first.length; index += 1) {
    difference |= first.charCodeAt(index) ^ second.charCodeAt(index);
  }
  return difference === 0;
}

async function hmac(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    key,
    textEncoder.encode(value),
  )));
}

function sessionSecret() {
  return String(getRuntimeEnv().GOOGLE_AUTH_SESSION_SECRET ?? "").trim();
}

async function signedValue(payload: object) {
  const secret = sessionSecret();
  if (secret.length < 32) throw new Error("Google session secret is unavailable");
  const encoded = bytesToBase64Url(textEncoder.encode(JSON.stringify(payload)));
  return `${encoded}.${await hmac(encoded, secret)}`;
}

async function verifiedValue<T>(value: string): Promise<T | null> {
  const secret = sessionSecret();
  if (secret.length < 32 || value.length > 4096) return null;
  const [encoded, signature, ...extra] = value.split(".");
  if (!encoded || !signature || extra.length) return null;
  try {
    const expected = await hmac(encoded, secret);
    if (!fixedTimeEqual(signature, expected)) return null;
    return JSON.parse(textDecoder.decode(base64UrlToBytes(encoded))) as T;
  } catch {
    return null;
  }
}

function requestCookie(cookieHeader: string, names: string[]) {
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    if (names.includes(name)) return part.slice(separator + 1).trim();
  }
  return "";
}

function secureRequest(requestUrl: string) {
  return new URL(requestUrl).protocol === "https:";
}

function cookieName(requestUrl: string, secureName: string, localName: string) {
  return secureRequest(requestUrl) ? secureName : localName;
}

function serializeCookie(
  name: string,
  value: string,
  requestUrl: string,
  maxAge: number,
) {
  const secure = secureRequest(requestUrl);
  const attributes = [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (secure) attributes.push("Secure");
  if (maxAge === 0) attributes.push("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  return attributes.join("; ");
}

export function safeRelativeReturnPath(value: unknown) {
  const candidate = typeof value === "string" ? value : "/";
  if (!candidate.startsWith("/") || candidate.startsWith("//")) return "/";
  try {
    const url = new URL(candidate, "https://app.local");
    if (url.origin !== "https://app.local" || url.pathname.startsWith("//") || url.pathname.startsWith("/api/auth/")) {
      return "/";
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

export function googleSignInPath(returnTo: string) {
  return `/api/auth/google/start?return_to=${encodeURIComponent(safeRelativeReturnPath(returnTo))}`;
}

export function googleSignOutPath(returnTo = "/") {
  return `/api/auth/google/logout?return_to=${encodeURIComponent(safeRelativeReturnPath(returnTo))}`;
}

export function randomBase64Url(byteLength: number) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export async function sha256Base64Url(value: string) {
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    textEncoder.encode(value),
  )));
}

export async function createGoogleSessionValue(user: GoogleUser) {
  const issuedAt = Math.floor(Date.now() / 1000);
  return signedValue({
    v: SESSION_VERSION,
    sub: user.id,
    email: normalizedEmail(user.email),
    name: user.fullName ?? user.displayName,
    iat: issuedAt,
    exp: issuedAt + GOOGLE_SESSION_MAX_AGE,
  } satisfies GoogleSessionClaims);
}

export async function googleUserFromCookieHeader(cookieHeader: string) {
  const value = requestCookie(cookieHeader, [
    GOOGLE_SESSION_COOKIE,
    LOCAL_GOOGLE_SESSION_COOKIE,
  ]);
  if (!value) return null;
  const claims = await verifiedValue<GoogleSessionClaims>(value);
  const now = Math.floor(Date.now() / 1000);
  const email = normalizedEmail(claims?.email);
  if (
    claims?.v !== SESSION_VERSION
    || !claims.sub
    || !email
    || !Number.isSafeInteger(claims.iat)
    || !Number.isSafeInteger(claims.exp)
    || claims.iat > now + 60
    || claims.exp <= now
  ) return null;
  const fullName = typeof claims.name === "string" && claims.name.trim()
    ? claims.name.trim().slice(0, 160)
    : null;
  return {
    id: claims.sub.slice(0, 255),
    email,
    displayName: fullName ?? email,
    fullName,
  } satisfies GoogleUser;
}

export function googleUserFromRequest(request: Request) {
  return googleUserFromCookieHeader(request.headers.get("cookie") ?? "");
}

export function googleSessionCookie(value: string, requestUrl: string) {
  return serializeCookie(
    cookieName(requestUrl, GOOGLE_SESSION_COOKIE, LOCAL_GOOGLE_SESSION_COOKIE),
    value,
    requestUrl,
    GOOGLE_SESSION_MAX_AGE,
  );
}

export function clearGoogleSessionCookie(requestUrl: string) {
  return serializeCookie(
    cookieName(requestUrl, GOOGLE_SESSION_COOKIE, LOCAL_GOOGLE_SESSION_COOKIE),
    "",
    requestUrl,
    0,
  );
}

export async function createPendingGoogleOAuthValue(value: PendingGoogleOAuth) {
  return signedValue({
    v: SESSION_VERSION,
    state: value.state,
    codeVerifier: value.codeVerifier,
    returnTo: safeRelativeReturnPath(value.returnTo),
    exp: Math.floor(Date.now() / 1000) + GOOGLE_PENDING_MAX_AGE,
  } satisfies PendingGoogleOAuthClaims);
}

export async function pendingGoogleOAuthFromRequest(request: Request) {
  const value = requestCookie(request.headers.get("cookie") ?? "", [
    GOOGLE_PENDING_COOKIE,
    LOCAL_GOOGLE_PENDING_COOKIE,
  ]);
  if (!value) return null;
  const claims = await verifiedValue<PendingGoogleOAuthClaims>(value);
  if (
    claims?.v !== SESSION_VERSION
    || !claims.state
    || !claims.codeVerifier
    || claims.exp <= Math.floor(Date.now() / 1000)
  ) return null;
  return {
    state: claims.state,
    codeVerifier: claims.codeVerifier,
    returnTo: safeRelativeReturnPath(claims.returnTo),
  } satisfies PendingGoogleOAuth;
}

export function googlePendingCookie(value: string, requestUrl: string) {
  return serializeCookie(
    cookieName(requestUrl, GOOGLE_PENDING_COOKIE, LOCAL_GOOGLE_PENDING_COOKIE),
    value,
    requestUrl,
    GOOGLE_PENDING_MAX_AGE,
  );
}

export function clearGooglePendingCookie(requestUrl: string) {
  return serializeCookie(
    cookieName(requestUrl, GOOGLE_PENDING_COOKIE, LOCAL_GOOGLE_PENDING_COOKIE),
    "",
    requestUrl,
    0,
  );
}

export function googleOAuthStateMatches(first: string, second: string) {
  return fixedTimeEqual(first, second);
}
