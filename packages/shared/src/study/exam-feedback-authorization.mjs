const AUTHORIZATION_VERSION = 1;
const AUTHORIZATION_AUDIENCE = "baeumzip:practice-feedback";
const AUTHORIZATION_TTL_SECONDS = 30 * 60;
const MAX_AUTHORIZATION_BYTES = 2_048;

const PROTECTED_FEEDBACK_FIELDS = new Set([
  "correctAnswer",
  "correctAnswers",
  "explanation",
  "answerKey",
  "gradingCriteria",
  "scoringCriteria",
  "requiredConcepts",
  "acceptableAlternatives",
  "deductionConditions",
  "errorConditions",
]);

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/u, "");
}

function base64UrlToBytes(value) {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error("invalid base64url value");
  const padded = value.replace(/-/gu, "+").replace(/_/gu, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function fixedTimeEqual(first, second) {
  if (first.length !== second.length) return false;
  let difference = 0;
  for (let index = 0; index < first.length; index += 1) {
    difference |= first.charCodeAt(index) ^ second.charCodeAt(index);
  }
  return difference === 0;
}

async function sha256Base64Url(value) {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

async function hmacBase64Url(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

function normalizedAuthorizationInput(input) {
  const secret = String(input?.secret ?? "").trim();
  const userKey = String(input?.userKey ?? "").trim();
  const engine = input?.engine === "sql" || input?.engine === "sw" ? input.engine : "";
  const questionId = String(input?.questionId ?? "").trim();
  const contextId = String(input?.contextId ?? "").trim();
  if (secret.length < 32 || !userKey || !engine || !questionId || questionId.length > 64
    || contextId.length > 100) {
    throw new TypeError("invalid practice feedback authorization input");
  }
  return { secret, userKey, engine, questionId, contextId };
}

export async function createPracticeFeedbackAuthorization(input) {
  const normalized = normalizedAuthorizationInput(input);
  const issuedAt = Math.floor(Number(input?.now ?? Date.now()) / 1_000);
  const claims = {
    v: AUTHORIZATION_VERSION,
    aud: AUTHORIZATION_AUDIENCE,
    eng: normalized.engine,
    qid: normalized.questionId,
    ctx: normalized.contextId,
    sub: await sha256Base64Url(normalized.userKey),
    iat: issuedAt,
    exp: issuedAt + AUTHORIZATION_TTL_SECONDS,
  };
  const encoded = bytesToBase64Url(textEncoder.encode(JSON.stringify(claims)));
  return `${encoded}.${await hmacBase64Url(encoded, normalized.secret)}`;
}

export async function verifyPracticeFeedbackAuthorization(input) {
  let normalized;
  try {
    normalized = normalizedAuthorizationInput(input);
  } catch {
    return false;
  }
  const authorization = String(input?.authorization ?? "").trim();
  if (!authorization || textEncoder.encode(authorization).byteLength > MAX_AUTHORIZATION_BYTES) return false;
  const [encoded, signature, ...extra] = authorization.split(".");
  if (!encoded || !signature || extra.length) return false;
  try {
    const expected = await hmacBase64Url(encoded, normalized.secret);
    if (!fixedTimeEqual(signature, expected)) return false;
    const claims = JSON.parse(textDecoder.decode(base64UrlToBytes(encoded)));
    const currentTime = Math.floor(Number(input?.now ?? Date.now()) / 1_000);
    return claims?.v === AUTHORIZATION_VERSION
      && claims.aud === AUTHORIZATION_AUDIENCE
      && claims.eng === normalized.engine
      && claims.qid === normalized.questionId
      && claims.ctx === normalized.contextId
      && claims.sub === await sha256Base64Url(normalized.userKey)
      && Number.isSafeInteger(claims.iat)
      && Number.isSafeInteger(claims.exp)
      && claims.iat <= currentTime + 60
      && claims.exp > currentTime
      && claims.exp - claims.iat === AUTHORIZATION_TTL_SECONDS;
  } catch {
    return false;
  }
}

export function feedbackRevealDecision(input) {
  const session = input?.session ?? null;
  if (input?.activity === "practice") {
    if (session?.ownerMatches === true
      && session?.containsQuestion === true
      && session.status !== "submitted") {
      return { allowed: false, reason: "EXAM_FEEDBACK_NOT_RELEASED" };
    }
    return input?.authorizationValid === true
      ? { allowed: true, reason: "PRACTICE_FEEDBACK_AUTHORIZED" }
      : { allowed: false, reason: "PRACTICE_FEEDBACK_AUTHORIZATION_REQUIRED" };
  }
  if (input?.activity === "exam") {
    if (!session) return { allowed: false, reason: "EXAM_SESSION_REQUIRED" };
    if (session.ownerMatches !== true) return { allowed: false, reason: "EXAM_SESSION_OWNER_REQUIRED" };
    if (session.containsQuestion !== true) return { allowed: false, reason: "EXAM_SESSION_ITEM_REQUIRED" };
    return session.status === "submitted"
      ? { allowed: true, reason: "EXAM_FEEDBACK_RELEASED" }
      : { allowed: false, reason: "EXAM_FEEDBACK_NOT_RELEASED" };
  }
  return { allowed: false, reason: "FEEDBACK_ACTIVITY_INVALID" };
}

export function releasedFeedbackProjection(feedback, released) {
  if (!feedback || typeof feedback !== "object" || Array.isArray(feedback)) return {};
  if (released) return { ...feedback };
  return Object.fromEntries(
    Object.entries(feedback).filter(([field]) => !PROTECTED_FEEDBACK_FIELDS.has(field)),
  );
}
