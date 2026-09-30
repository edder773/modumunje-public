import { getRuntimeEnv } from "@backend/infrastructure/database";
import {
  createPracticeFeedbackAuthorization,
  feedbackRevealDecision,
  verifyPracticeFeedbackAuthorization,
} from "@shared/study/exam-feedback-authorization.mjs";

type FeedbackEngine = "sql" | "sw";
type BlockingExamItem = { id?: string; status?: string } | null | undefined;

function authorizationSecret() {
  return String(getRuntimeEnv().GOOGLE_AUTH_SESSION_SECRET ?? "").trim();
}

export function issuePracticeFeedbackAuthorization(
  userKey: string,
  engine: FeedbackEngine,
  questionId: number | string,
  contextId = "",
) {
  return createPracticeFeedbackAuthorization({
    secret: authorizationSecret(),
    userKey,
    engine,
    questionId,
    contextId,
  }) as Promise<string>;
}

export async function decidePracticeFeedbackAccess(input: {
  userKey: string;
  engine: FeedbackEngine;
  questionId: number | string;
  authorization: unknown;
  contextId?: string;
  blockingExamItem?: BlockingExamItem;
}) {
  const authorizationValid = await verifyPracticeFeedbackAuthorization({
    secret: authorizationSecret(),
    authorization: String(input.authorization ?? ""),
    userKey: input.userKey,
    engine: input.engine,
    questionId: input.questionId,
    contextId: input.contextId ?? "",
  });
  return feedbackRevealDecision({
    activity: "practice",
    authorizationValid,
    session: input.blockingExamItem
      ? {
          ownerMatches: true,
          containsQuestion: true,
          status: input.blockingExamItem.status,
        }
      : null,
  }) as { allowed: boolean; reason: string };
}
