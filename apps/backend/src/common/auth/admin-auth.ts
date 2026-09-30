import { getD1, getRuntimeEnv } from "@backend/infrastructure/database";
import { AUTHENTICATED_USER_EMAIL_HEADER } from "@shared/auth/authenticated-user";
import { metricPhase } from "@backend/common/observability/d1-metrics";
import { readLearnerRequestContext } from "./learner-request-context";

export const ADMIN_REQUEST_HEADER = "x-sql-study-admin-request";

export type AdminIdentity = {
  email: string;
  hash: string;
};

export type AdminAuthorization =
  | { ok: true; identity: AdminIdentity }
  | { ok: false; response: Response };

export type LearnerAccount = {
  userKey: string;
  email: string;
  displayName: string;
  status: "active" | "blocked";
  blockedReason: string;
};

export type LearnerAuthorization =
  | { ok: true; account: LearnerAccount }
  | { ok: false; response: Response };

export type LearnerAccountRow = {
  user_key: string;
  email: string;
  display_name: string;
  status: "active" | "blocked";
  blocked_reason: string;
};

export function authorizePrefetchedLearner(
  email: string,
  userKey: string | null,
  row: LearnerAccountRow | null,
): LearnerAuthorization {
  if (!email || !userKey) {
    return { ok: false, response: Response.json({ error: "로그인이 필요합니다." }, { status: 401 }) };
  }
  const account: LearnerAccount = row
    ? { userKey: row.user_key, email: row.email, displayName: row.display_name,
      status: row.status, blockedReason: row.blocked_reason }
    : { userKey, email, displayName: email, status: "active", blockedReason: "" };
  if (account.status === "blocked") {
    return { ok: false, response: Response.json({
      error: "관리자에 의해 이용이 제한된 계정입니다.", code: "ACCOUNT_BLOCKED",
    }, { status: 403 }) };
  }
  return { ok: true, account };
}

export function normalizedEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLocaleLowerCase("en-US") : "";
}

export function isAdminEmail(value: unknown) {
  const configured = normalizedEmail(getRuntimeEnv().ADMIN_EMAIL);
  return Boolean(configured) && normalizedEmail(value) === configured;
}

export async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function adminUserHash(email: string) {
  return sha256(`sql-study-admin:${normalizedEmail(email)}`);
}

export async function learnerUserHash(email: string) {
  return sha256(`sql-study-user:${normalizedEmail(email)}`);
}

export async function authenticatedLearnerKey(request: Request) {
  const email = normalizedEmail(request.headers.get(AUTHENTICATED_USER_EMAIL_HEADER));
  return email ? learnerUserHash(email) : null;
}

export async function readLearnerAccount(emailValue: string): Promise<LearnerAccount | null> {
  const email = normalizedEmail(emailValue);
  if (!email) return null;
  const userKey = await learnerUserHash(email);
  const current = await getD1().prepare(`
    SELECT user_key, email, display_name, status, blocked_reason
    FROM user_accounts
    WHERE user_key = ?
  `).bind(userKey).first<LearnerAccountRow>();
  if (!current) return null;
  return {
    userKey: current.user_key,
    email: current.email,
    displayName: current.display_name,
    status: current.status,
    blockedReason: current.blocked_reason,
  };
}

export async function ensureLearnerAccount(
  emailValue: string,
  displayNameValue = "",
  touchLogin = false,
): Promise<LearnerAccount> {
  const email = normalizedEmail(emailValue);
  if (!email) throw new Error("로그인이 필요합니다.");
  const userKey = await learnerUserHash(email);
  const displayName = displayNameValue.trim().slice(0, 160) || email;
  const timestamp = new Date().toISOString();
  const account = await getD1().prepare(`
    INSERT INTO user_accounts (
      user_key, email, display_name, status, created_at, last_login_at, updated_at
    ) VALUES (?, ?, ?, 'active', ?, ?, ?)
    ON CONFLICT(user_key) DO UPDATE SET
      email = excluded.email,
      display_name = excluded.display_name,
      last_login_at = CASE WHEN ? = 1 THEN excluded.last_login_at ELSE user_accounts.last_login_at END,
      updated_at = excluded.updated_at
    RETURNING
      user_key AS userKey,
      email,
      display_name AS displayName,
      status,
      blocked_reason AS blockedReason
  `).bind(
    userKey,
    email,
    displayName,
    timestamp,
    timestamp,
    timestamp,
    touchLogin ? 1 : 0,
  ).first<LearnerAccount>();
  if (!account) throw new Error("학습자 계정을 준비하지 못했습니다.");
  return account;
}

export async function authorizeLearnerRequest(
  request: Request,
  options: { createIfMissing?: boolean; touchLogin?: boolean; displayName?: string; respectMaintenance?: boolean } = {},
): Promise<LearnerAuthorization> {
  const {email,userKey}=await metricPhase("auth",async () => {
    const email=normalizedEmail(request.headers.get(AUTHENTICATED_USER_EMAIL_HEADER));
    return {email,userKey:email ? await learnerUserHash(email) : null};
  });
  if (!email) {
    return {
      ok: false,
      response: Response.json({ error: "로그인이 필요합니다." }, { status: 401 }),
    };
  }
  const context=await readLearnerRequestContext(getD1(),userKey,{includeRevision:true});
  const prefetched=await metricPhase("auth",async () => authorizePrefetchedLearner(email,userKey,context.accountRow));
  if (!prefetched.ok) return prefetched;
  if (options.respectMaintenance && !isAdminRequest(request)
    && context.siteRows.some(row => row.key === "maintenance_mode" && row.value === "true")) {
    return { ok:false, response:Response.json({ error:"현재 유지보수 중입니다. 잠시 후 다시 이용해 주세요." }, { status:503 }) };
  }
  const existing=context.accountRow ? prefetched.account : null;
  const account = existing
    ? options.touchLogin
      ? await ensureLearnerAccount(email, options.displayName ?? existing.displayName, true)
      : existing
    : options.createIfMissing
      ? await ensureLearnerAccount(email, options.displayName ?? email, Boolean(options.touchLogin))
      : {
          userKey: userKey!,
          email,
          displayName: email,
          status: "active" as const,
          blockedReason: "",
        };
  if (account.status === "blocked") {
    return {
      ok: false,
      response: Response.json(
        {
          error: "관리자에 의해 이용이 제한된 계정입니다.",
          code: "ACCOUNT_BLOCKED",
        },
        { status: 403 },
      ),
    };
  }
  return { ok: true, account };
}

export const USER_REQUEST_HEADER = "x-sql-study-user-request";

export function verifyUserMutationRequest(request: Request) {
  if (request.headers.get(USER_REQUEST_HEADER) !== "1") {
    return Response.json(
      { error: "사용자 변경 요청을 확인할 수 없습니다." },
      { status: 403 },
    );
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json(
      { error: "허용되지 않은 요청 출처입니다." },
      { status: 403 },
    );
  }
  return null;
}

export async function authorizeAdminRequest(
  request: Request,
): Promise<AdminAuthorization> {
  const configured = normalizedEmail(getRuntimeEnv().ADMIN_EMAIL);
  if (!configured) {
    return {
      ok: false,
      response: Response.json(
        { error: "관리자 계정이 서버에 구성되지 않았습니다." },
        { status: 503 },
      ),
    };
  }

  const email = normalizedEmail(request.headers.get(AUTHENTICATED_USER_EMAIL_HEADER));
  if (email === configured) {
    return {
      ok: true,
      identity: {
        email,
        hash: await adminUserHash(email),
      },
    };
  }
  if (!email) {
    return {
      ok: false,
      response: Response.json(
        { error: "로그인이 필요합니다." },
        { status: 401 },
      ),
    };
  }
  return {
    ok: false,
    response: Response.json(
      { error: "관리자 권한이 없습니다." },
      { status: 403 },
    ),
  };
}

/**
 * A non-simple custom header prevents a cross-origin form from mutating admin
 * data. When the browser supplies Origin it must also match the request origin.
 */
export function verifyAdminMutationRequest(request: Request) {
  if (request.headers.get(ADMIN_REQUEST_HEADER) !== "1") {
    return Response.json(
      { error: "관리자 변경 요청을 확인할 수 없습니다." },
      { status: 403 },
    );
  }

  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json(
      { error: "허용되지 않은 요청 출처입니다." },
      { status: 403 },
    );
  }
  return null;
}

export function isAdminRequest(request: Request) {
  return isAdminEmail(request.headers.get(AUTHENTICATED_USER_EMAIL_HEADER));
}
