import {
  authorizeLearnerRequest,
  isAdminRequest,
  learnerUserHash,
  normalizedEmail,
} from "@backend/common/auth/admin-auth";
import { AUTHENTICATED_USER_EMAIL_HEADER } from "@shared/auth/authenticated-user";
import { StudyRequestError } from "./study-attempt.service";
import type { StudyRepository } from "./study.repository";
import { publicSiteSettingsFromRows } from "./study-site-settings-cache";
import { authorizeLearningSession } from "@backend/common/auth/guest-learning-session";

export const PRACTICE_FEEDBACK_ACTIONS = new Set([
  "attempt",
  "short-answer",
  "self-assessment",
  "question-feedback",
]);

type MutationAuthorization = {
  ok: false;
  response: Response;
} | {
  ok: true;
  key: string;
  context?: Awaited<ReturnType<StudyRepository["findPracticeMutationContext"]>>;
  site?: ReturnType<typeof publicSiteSettingsFromRows>;
};

export async function authorizeStudyMutation(
  request: Request,
  payload: Record<string, unknown>,
  action: string,
  repository: StudyRepository,
): Promise<MutationAuthorization> {
  const email = normalizedEmail(request.headers.get(AUTHENTICATED_USER_EMAIL_HEADER));
  if (!email && (PRACTICE_FEEDBACK_ACTIONS.has(action) || ["exam-start", "exam-save", "exam-submit"].includes(action))) {
    const guest = await authorizeLearningSession(request);
    return guest.ok ? { ok: true, key: guest.account.userKey } : guest;
  }
  if (!PRACTICE_FEEDBACK_ACTIONS.has(action)) {
    const authorization = await authorizeLearnerRequest(request, {
      createIfMissing: true,
      touchLogin: action === "account-touch",
      respectMaintenance: true,
      displayName: typeof payload.displayName === "string" ? payload.displayName : undefined,
    });
    return authorization.ok
      ? { ok: true, key: authorization.account.userKey }
      : { ok: false, response: authorization.response };
  }
  if (!email) {
    return {
      ok: false,
      response: Response.json({ error: "로그인이 필요합니다." }, { status: 401 }),
    };
  }
  const questionId = Number(payload.questionId);
  if (!Number.isInteger(questionId) || questionId < 1) {
    throw new StudyRequestError(400, "유효한 문항이 필요합니다.");
  }
  const key = await learnerUserHash(email);
  const adminBypassMaintenance = isAdminRequest(request);
  const context = await repository.findPracticeMutationContext(email, key, questionId, adminBypassMaintenance);
  if (context.account?.status === "blocked") {
    return {
      ok: false,
      response: Response.json({
        error: "관리자에 의해 이용이 제한된 계정입니다.",
        code: "ACCOUNT_BLOCKED",
      }, { status: 403 }),
    };
  }
  const site = publicSiteSettingsFromRows(context.siteSettings);
  if (site.maintenanceMode && !adminBypassMaintenance) {
    return {
      ok: false,
      response: Response.json({ error: "현재 유지보수 중입니다. 잠시 후 다시 이용해 주세요." }, { status: 503 }),
    };
  }
  if (!context.account) throw new Error("학습자 계정을 준비하지 못했습니다.");
  return {
    ok: true,
    key,
    context,
    site,
  };
}
