import { allowSubmissionAnalytics } from "../events/guest-mock-submission-sql";
import {
  SwStudyRepository,
  type SwQuestionDeliveryRow,
  type SwQuestionRow,
  type SwTheoryRow,
} from "./sw-study.repository";
import {
  normalizeExplanationMarkdown,
  normalizeMarkdownProse,
} from "@shared/content/content-format.mjs";
import {
  SW_CURRICULUM_SUBJECT_IDS,
  swCurriculumQuestionProfile,
} from "@shared/study/sw-curriculum-contract.mjs";
import {
  apiErrorResponse,
  withApiErrorBoundary,
} from "@backend/common/http/api-response";
import {
  authorizeLearnerRequest,
  authorizePrefetchedLearner,
  authenticatedLearnerKey,
  learnerUserHash,
  normalizedEmail,
  verifyUserMutationRequest,
} from "@backend/common/auth/admin-auth";
import { readRuntimeLearnerRequestContext } from "@backend/common/auth/learner-request-context";
import { metricPhase } from "@backend/common/observability/d1-metrics";
import {
  readSharedPublicResponse,
  storeSharedPublicResponse,
} from "@backend/common/http/shared-response-cache";
import { SW_SESSION_QUESTION_LIMIT, validateSwStudyMutationRequest } from "@shared/study/study-mutation-contract.mjs";
import {
  readBoundedJsonBody,
  RequestBodyError,
} from "@shared/http/bounded-json-body.mjs";
import {
  decidePracticeFeedbackAccess,
  issuePracticeFeedbackAuthorization,
} from "@backend/modules/study/study-feedback-authorization";
import { readPublicContentCache } from "@backend/common/content/public-content-cache";
import { AUTHENTICATED_USER_EMAIL_HEADER, SW_STUDY_OWNER_HEADER } from "@shared/auth/authenticated-user";
import { authorizeLearningSession, guestExamQuotaReached, isGuestLearningKey } from "@backend/common/auth/guest-learning-session";

const SUBJECT_IDS = new Set<string>(SW_CURRICULUM_SUBJECT_IDS);
const SW_STUDY_BODY_MAX_BYTES = 512 * 1024;

function jsonArray<T>(value: string, fallback: T[]) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as T[] : fallback;
  } catch {
    return fallback;
  }
}

function selectedSubjects(searchParams: URLSearchParams) {
  return [...new Set(
    (searchParams.get("subjects") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => SUBJECT_IDS.has(value)),
  )];
}

function excludedQuestionIds(searchParams: URLSearchParams) {
  return [...new Set(
    (searchParams.get("exclude") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => /^[A-Z0-9-]{1,64}$/u.test(value)),
  )].slice(0, 100);
}

function requestedQuestionIds(searchParams: URLSearchParams) {
  return [...new Set(
    (searchParams.get("ids") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => /^[A-Z0-9-]{1,64}$/u.test(value)),
  )].slice(0, 100);
}

function selectedQuestionProfile(searchParams: URLSearchParams) {
  return swCurriculumQuestionProfile(searchParams.get("profile"));
}

function theoryPayload(row: SwTheoryRow) {
  return {
    id: row.id,
    subjectGroupId: row.subject_group_id,
    subjectId: row.subject_id,
    category: row.category,
    topic: row.topic,
    title: row.title,
    summary: row.summary,
    content: row.content ? normalizeMarkdownProse(row.content) : undefined,
    reviewAnswers: row.review_answers ? normalizeMarkdownProse(row.review_answers) : undefined,
    keywords: jsonArray<string>(row.keywords, []),
    sortOrder: row.sort_order,
  };
}

function questionFeedbackPayload(row: SwQuestionRow) {
  return {
    correctAnswers: jsonArray<number>(row.correct_answers, []),
    explanation: normalizeExplanationMarkdown(row.explanation),
  };
}

function questionPayload(
  row: SwQuestionDeliveryRow | SwQuestionRow,
  includeFeedback = false,
  feedbackAuthorization = "",
) {
  return {
    id: row.id,
    theoryId: row.theory_id,
    subjectGroupId: row.subject_group_id,
    subjectId: row.subject_id,
    category: row.category,
    topic: row.topic,
    displayOrder: row.display_order,
    difficulty: row.difficulty,
    difficultyRationale: row.difficulty_rationale,
    kind: row.kind,
    prompt: normalizeMarkdownProse(row.prompt),
    choices: jsonArray<string>(row.choices, []),
    tags: jsonArray<string>(row.tags, []),
    ...(feedbackAuthorization ? { feedbackAuthorization } : {}),
    ...(includeFeedback ? questionFeedbackPayload(row as SwQuestionRow) : {}),
  };
}

function shuffledQuestions(rows: SwQuestionDeliveryRow[]) {
  const shuffled = [...rows];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomValue = crypto.getRandomValues(new Uint32Array(1))[0];
    const target = randomValue % (index + 1);
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  return shuffled;
}

async function questionsWithPracticeAuthorization(
  repository: SwStudyRepository,
  userKey: string,
  sessionId: string,
  rows: SwQuestionDeliveryRow[],
) {
  const blocked = new Set(await repository.findPracticeBlockedQuestionIds(
    userKey,
    rows.map((row) => row.id),
  ));
  return Promise.all(rows.map(async (row) => questionPayload(
    row,
    false,
    blocked.has(row.id)
      ? ""
      : await issuePracticeFeedbackAuthorization(userKey, "sw", row.id, sessionId),
  )));
}

async function response(
  request: Request,
  payload: unknown,
  cachePolicy: "public-content" | "private-session" = "public-content",
  init?: ResponseInit,
  sharedCacheKey?: string,
) {
  const body = JSON.stringify(payload);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  const etag = `"${Array.from(new Uint8Array(digest)).slice(0, 12).map((value) => value.toString(16).padStart(2, "0")).join("")}"`;
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": cachePolicy === "public-content"
      ? "public, max-age=0, must-revalidate"
      : "private, no-store",
    "X-Baeumzip-Content-Version": __BAEUMZIP_BUILD_SHA__.slice(0, 12),
    ETag: etag,
  });
  const result = request.headers.get("if-none-match") === etag
    ? new Response(null, { status: 304, headers })
    : new Response(body, { status: init?.status ?? 200, headers });
  if (cachePolicy === "public-content" && sharedCacheKey && result.status === 200) {
    await storeSharedPublicResponse(request, "sw-study", sharedCacheKey, result);
  }
  return result;
}

function requestError(request: Request, status: number, code: string, message: string) {
  return apiErrorResponse(request, { status, code, message });
}

async function verifySwAccountOwner(request: Request) {
  const authenticatedKey = await authenticatedLearnerKey(request);
  // Keep the normal 401 response for anonymous requests. The client header
  // only checks continuity against the server-verified identity.
  if (!authenticatedKey || request.headers.get(SW_STUDY_OWNER_HEADER) === authenticatedKey) return null;
  return requestError(request, 409, "SW_ACCOUNT_CHANGED",
    "로그인 계정이 변경되었거나 오래된 학습 화면입니다. 기록은 보존되며, 새로고침 후 계속할 수 있습니다.");
}

async function accountStatePayload(repository: SwStudyRepository, userKey: string) {
  const state = await repository.readUserState(userKey);
  return {
    progress: state.progress.map((item) => ({
      ...item,
      completed: Boolean(item.completed),
    })),
    sessions: state.sessions.map(sessionPayload),
    attemptSummary: state.attemptSummary,
  };
}

async function publicContentRevision(request: Request): Promise<string | Response> {
  const { email, userKey } = await metricPhase("auth", async () => {
    const email = normalizedEmail(request.headers.get(AUTHENTICATED_USER_EMAIL_HEADER));
    return { email, userKey: email ? await learnerUserHash(email) : null };
  });
  const context = await readRuntimeLearnerRequestContext(userKey, { includeRevision: true });
  if (email) {
    const authorization = await metricPhase("auth", async () =>
      authorizePrefetchedLearner(email, userKey, context.accountRow));
    if (!authorization.ok) return authorization.response;
  }
  return context.revision;
}

async function handleGet(request: Request, repository: SwStudyRepository) {
  const url = new URL(request.url);
  const view = url.searchParams.get("view") ?? "summary";
  const subjects = selectedSubjects(url.searchParams);

  if (["state", "session", "practice"].includes(view)) {
    const ownerError = await verifySwAccountOwner(request);
    if (ownerError) return ownerError;
  }

  if (view === "state") {
    const authorization = await authorizeLearnerRequest(request);
    if (!authorization.ok) return authorization.response;
    return response(request,
      await accountStatePayload(repository, authorization.account.userKey), "private-session");
  }

  if (view === "summary") {
    const revision = await publicContentRevision(request);
    if (revision instanceof Response) return revision;
    const sharedCacheKey = `summary:${revision}`;
    const cached = await readSharedPublicResponse(request, "sw-study", sharedCacheKey);
    if (cached) return cached;
    const subjectCount = await readPublicContentCache({
      namespace: "sw-summary", key: "all", revision,
      loader: () => repository.subjectCount(),
    });
    return response(request, {
      available: subjectCount > 0,
      subjectCount,
    }, "public-content", undefined, sharedCacheKey);
  }

  if (view === "theories") {
    if (!subjects.length) {
      return requestError(request, 400, "SW_SUBJECTS_REQUIRED", "학습할 소주제를 먼저 선택해 주세요.");
    }
    const revision = await publicContentRevision(request);
    if (revision instanceof Response) return revision;
    const subjectKey = [...subjects].sort().join(",");
    const sharedCacheKey = `theories:${revision}:${subjectKey}`;
    const cached = await readSharedPublicResponse(request, "sw-study", sharedCacheKey);
    if (cached) return cached;
    const rows = await readPublicContentCache({
      namespace: "sw-theories", key: subjectKey, revision,
      loader: () => repository.findTheories(subjects),
    });
    return response(
      request,
      { theories: rows.map(theoryPayload) },
      "public-content",
      undefined,
      sharedCacheKey,
    );
  }

  if (view === "theory") {
    const id = Number(url.searchParams.get("id"));
    if (!Number.isInteger(id) || id < 1) {
      return requestError(request, 400, "SW_THEORY_ID_INVALID", "올바른 이론 ID가 필요합니다.");
    }
    const revision = await publicContentRevision(request);
    if (revision instanceof Response) return revision;
    const sharedCacheKey = `theory:${revision}:${id}`;
    const cached = await readSharedPublicResponse(request, "sw-study", sharedCacheKey);
    if (cached) return cached;
    const row = await readPublicContentCache({
      namespace: "sw-theory", key: String(id), revision,
      loader: () => repository.findTheory(id),
    });
    if (!row) return requestError(request, 404, "SW_THEORY_NOT_FOUND", "이론을 찾을 수 없습니다.");
    return response(
      request,
      { theory: theoryPayload(row) },
      "public-content",
      undefined,
      sharedCacheKey,
    );
  }

  if (view === "session") {
    const ids = requestedQuestionIds(url.searchParams);
    if (!ids.length) {
      return requestError(request, 400, "SW_SESSION_IDS_REQUIRED", "복원할 문제 목록이 없습니다.");
    }
    const theoryId = Number(url.searchParams.get("theoryId"));
    const questionProfile = selectedQuestionProfile(url.searchParams);
    const [rows, authorization] = await Promise.all([
      repository.findSessionQuestions({
        ids,
        subjects,
        theoryId,
        requiredTag: questionProfile?.requiredTag ?? null,
      }),
      authorizeLearningSession(request),
    ]);
    if (!authorization.ok) return authorization.response;
    const mode = url.searchParams.get("mode") === "mock" ? "mock" : "practice";
    const requestedSessionId = String(url.searchParams.get("sessionId") ?? "");
    const session = await repository.findSession(authorization.account.userKey, requestedSessionId);
    if (!session
      || session.mode !== mode
      || !["active", "submitted"].includes(session.status)) {
      return requestError(
        request,
        403,
        "SW_SESSION_FORBIDDEN",
        "이 SW 학습 세션의 문항을 확인할 권한이 없습니다.",
      );
    }
    const sessionQuestionIds = new Set(jsonArray<string>(session.questionIds, []));
    if (ids.some((id) => !sessionQuestionIds.has(id))) {
      return requestError(
        request,
        403,
        "SW_SESSION_QUESTION_FORBIDDEN",
        "요청한 문항이 이 SW 학습 세션에 포함되어 있지 않습니다.",
      );
    }
    const rowsById = new Map(rows.map((row) => [row.id, row]));
    const orderedRows = ids
      .map((id) => rowsById.get(id))
      .filter((row): row is SwQuestionDeliveryRow => Boolean(row));
    let questions;
    if (session.status === "submitted" && session.mode === "mock") {
      const feedbackRows = await repository.findFeedbackQuestions(orderedRows.map((row) => row.id));
      const feedbackById = new Map(feedbackRows.map((row) => [row.id, row]));
      questions = orderedRows
        .map((row) => feedbackById.get(row.id))
        .filter((row): row is SwQuestionRow => Boolean(row))
        .map((row) => questionPayload(row, true));
    } else if (session.status === "active" && session.mode === "practice") {
      questions = await questionsWithPracticeAuthorization(
        repository,
        authorization.account.userKey,
        session.id,
        orderedRows,
      );
    } else {
      questions = orderedRows.map((row) => questionPayload(row));
    }
    return response(request, {
      questions,
    }, "private-session");
  }

  if (view === "practice") {
    const theoryId = Number(url.searchParams.get("theoryId"));
    const questionProfile = selectedQuestionProfile(url.searchParams);
    const excludedIds = excludedQuestionIds(url.searchParams);
    const requestedLimit = Number(url.searchParams.get("limit") ?? "20");
    const limit = Math.min(
      100,
      Math.max(1, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 20),
    );
    if (!subjects.length) {
      return requestError(request, 400, "SW_SUBJECTS_REQUIRED", "학습할 소주제를 먼저 선택해 주세요.");
    }
    const requestedMode = url.searchParams.get("mode") === "mock" ? "mock" : "practice";
    const requestedSessionId = String(url.searchParams.get("sessionId") ?? "");
    if (!/^[a-zA-Z0-9_-]{12,100}$/u.test(requestedSessionId)) {
      return requestError(request, 400, "SW_SESSION_INVALID", "SW 문제 세션 식별자가 필요합니다.");
    }
    const profileOrder = Boolean(questionProfile);
    const candidateLimit = Math.min(300, Math.max(limit, limit * 5));
    const candidateInput = {
      subjects,
      theoryId,
      excludedIds,
      requiredTag: questionProfile?.requiredTag ?? null,
      profileOrder,
      profilePhases: questionProfile?.phaseTags ? [...questionProfile.phaseTags] : [],
      limit: candidateLimit,
    };
    const rows = await repository.findPracticeQuestions(candidateInput);
    if (rows.length < limit && excludedIds.length) {
      const fallbackRows = await repository.findPracticeQuestions({
        ...candidateInput,
        excludedIds: rows.map((row) => row.id),
        limit: candidateLimit - rows.length,
      });
      const existingIds = new Set(rows.map((row) => row.id));
      rows.push(...fallbackRows.filter((row) => !existingIds.has(row.id)));
    }
    const authorization = await authorizeLearningSession(request);
    if (!authorization.ok) return authorization.response;
    const selectedRows = shuffledQuestions(rows).slice(0, limit);
    const persistedPracticeSession = authorization.ok && requestedMode === "practice"
      ? await repository.findSession(authorization.account.userKey, requestedSessionId)
      : null;
    const persistedQuestionIds = new Set(
      persistedPracticeSession?.status === "active"
        && persistedPracticeSession.mode === "practice"
        ? jsonArray<string>(persistedPracticeSession.questionIds, [])
        : [],
    );
    const authorizedRows = selectedRows.filter((row) => persistedQuestionIds.has(row.id));
    const authorizations = new Map<string, string>();
    if (authorization.ok && authorizedRows.length) {
      const authorizedQuestions = await questionsWithPracticeAuthorization(
        repository,
        authorization.account.userKey,
        requestedSessionId,
        authorizedRows,
      );
      for (const question of authorizedQuestions) {
        if (question.feedbackAuthorization) {
          authorizations.set(question.id, question.feedbackAuthorization);
        }
      }
    }
    const questions = selectedRows.map((row) => questionPayload(
      row,
      false,
      authorizations.get(row.id) ?? "",
    ));
    return response(request, {
      questions,
    }, "private-session");
  }

  return requestError(request, 400, "SW_VIEW_UNSUPPORTED", "지원하지 않는 SW 학습 요청입니다.");
}

export async function GET(request: Request, repository = new SwStudyRepository()) {
  return withApiErrorBoundary(request, () => handleGet(request, repository), {
    code: "SW_STUDY_UNAVAILABLE",
    message: "SW 학습 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
  });
}

type SwSessionRow = Awaited<ReturnType<SwStudyRepository["findActiveSession"]>>;

function sessionPayload(row: NonNullable<SwSessionRow>) {
  return {
    ...row,
    subjectIds: jsonArray<string>(row.subjectIds, []),
    questionIds: jsonArray<string>(row.questionIds, []),
    answers: JSON.parse(row.answers || "{}") as Record<string, number[]>,
    revealedQuestionIds: jsonArray<string>(row.revealedQuestionIds, []),
    result: JSON.parse(row.result || "{}") as Record<string, unknown>,
  };
}

function sameAnswers(first: number[], second: number[]) {
  return [...first].sort((a, b) => a - b).join(",")
    === [...second].sort((a, b) => a - b).join(",");
}

function stringArray(value: unknown, allowed?: Set<string>) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => (
    typeof item === "string" && (!allowed || allowed.has(item))
  )))];
}

function answerRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    Array.isArray(item)
      ? [...new Set(item.map(Number).filter(Number.isInteger))].sort((a, b) => a - b)
      : Number.isInteger(Number(item)) ? [Number(item)] : [],
  ]));
}

function sameQuestionIds(first: readonly string[], second: readonly string[]) {
  return first.length === second.length && first.every((id, index) => id === second[index]);
}

async function saveLearningSession(
  request: Request,
  repository: SwStudyRepository,
  userKey: string,
  payload: Record<string, unknown>,
  status: "active" | "submitted",
) {
  const id = String(payload.sessionId ?? "");
  const mode = payload.mode === "mock" ? "mock" : payload.mode === "practice" ? "practice" : null;
  const subjectIds = stringArray(payload.subjectIds, SUBJECT_IDS);
  const questionIds = stringArray(payload.questionIds)
    .filter((value) => /^[A-Z0-9-]{1,64}$/u.test(value));
  if (questionIds.length > SW_SESSION_QUESTION_LIMIT) {
    return requestError(request, 400, "SW_SESSION_TOO_LARGE", "활성 SW 학습 세션은 최대 100문항까지 저장할 수 있습니다.");
  }
  const expectedRevision = Number(payload.revision ?? 0);
  if (!/^[a-zA-Z0-9_-]{12,100}$/u.test(id) || !mode || !subjectIds.length || !questionIds.length) {
    return requestError(request, 400, "SW_SESSION_INVALID", "저장할 SW 학습 세션 정보가 올바르지 않습니다.");
  }
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    return requestError(request, 400, "SW_SESSION_REVISION_INVALID", "SW 학습 세션 저장 버전이 필요합니다.");
  }
  const existingSession = await repository.findSession(userKey, id);
  if (!existingSession && await guestExamQuotaReached(userKey, "sw")) {
    return requestError(request, 429, "GUEST_EXAM_LIMIT", "비회원 세션 생성 한도에 도달했습니다. 기존 학습을 이어서 이용하거나 로그인해 주세요.");
  }
  if (existingSession && !["active", "submitted"].includes(existingSession.status)) {
    return requestError(
      request,
      403,
      "SW_SESSION_STATE_FORBIDDEN",
      "이 SW 학습 세션은 현재 상태에서 변경하거나 공개할 수 없습니다.",
    );
  }
  if (status === "submitted") {
    const storedQuestionIds = existingSession
      ? jsonArray<string>(existingSession.questionIds, [])
      : [];
    if (!existingSession
      || existingSession.mode !== mode
      || !sameQuestionIds(storedQuestionIds, questionIds)) {
      return requestError(
        request,
        403,
        "SW_SESSION_SUBMIT_FORBIDDEN",
        "저장된 본인 SW 학습 세션만 제출할 수 있습니다.",
      );
    }
  }
  const questions = await repository.findSessionQuestions({
    ids: questionIds,
    subjects: subjectIds,
    theoryId: Number(payload.theoryId),
    requiredTag: null,
  });
  const byId = new Map(questions.map((question) => [question.id, question]));
  if (questions.length !== questionIds.length || questionIds.some((questionId) => !byId.has(questionId))) {
    return requestError(request, 409, "SW_SESSION_CONTENT_CHANGED", "일부 문제가 변경되어 현재 답안을 그대로 저장할 수 없습니다.");
  }
  const incomingAnswers = answerRecord(payload.answers);
  const answers: Record<string, number[]> = {};
  for (const questionId of questionIds) {
    const question = byId.get(questionId)!;
    const choices = jsonArray<string>(question.choices, []);
    const selected = (incomingAnswers[questionId] ?? [])
      .filter((answer) => answer >= 0 && answer < choices.length);
    if (selected.length && (question.kind !== "single" || selected.length === 1)) {
      answers[questionId] = selected;
    }
  }
  const revealedQuestionIds = stringArray(payload.revealedQuestionIds)
    .filter((questionId) => questionIds.includes(questionId) && Boolean(answers[questionId]));
  const currentIndex = Math.min(
    Math.max(0, Number(payload.currentIndex) || 0),
    Math.max(0, questionIds.length - 1),
  );
  let result: Record<string, unknown> = {};
  let feedbackRows: SwQuestionRow[] = [];
  if (status === "submitted") {
    feedbackRows = await repository.findFeedbackQuestions(questionIds);
    const feedbackById = new Map(feedbackRows.map((question) => [question.id, question]));
    if (feedbackRows.length !== questionIds.length
      || questionIds.some((questionId) => !feedbackById.has(questionId))) {
      return requestError(request, 409, "SW_SESSION_CONTENT_CHANGED", "일부 문제가 변경되어 시험을 채점할 수 없습니다.");
    }
    if (existingSession?.status === "submitted") {
      return response(request, {
        session: sessionPayload(existingSession),
        questions: questionIds.map((questionId) => questionPayload(feedbackById.get(questionId)!, true)),
      }, "private-session");
    }
    const correct = questionIds.filter((questionId) => sameAnswers(
      answers[questionId] ?? [],
      jsonArray<number>(feedbackById.get(questionId)!.correct_answers, []),
    )).length;
    result = {
      total: questionIds.length,
      answered: Object.keys(answers).length,
      correct,
      incorrect: Object.keys(answers).length - correct,
      score: Math.round(correct / questionIds.length * 100),
      submittedAt: new Date().toISOString(),
    };
  }
  const stored = await repository.saveSession({
    recordGuestAnalytics: allowSubmissionAnalytics(request),
    id,
    userKey,
    mode,
    status,
    subjectIds,
    questionIds,
    answers,
    revealedQuestionIds,
    currentIndex,
    result,
    expectedRevision,
    updatedAt: new Date().toISOString(),
  });
  if (stored.outcome === "conflict") {
    return new Response(JSON.stringify({
      error: "다른 탭이나 기기에서 더 최근 SW 학습 상태가 저장되었습니다.",
      code: "SW_SESSION_CONFLICT",
      session: stored.conflict ? sessionPayload(stored.conflict) : null,
    }), { status: 409, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }
  const savedSession = stored.saved!;
  let deliveredQuestions;
  if (status === "submitted") {
    const feedbackById = new Map(feedbackRows.map((question) => [question.id, question]));
    deliveredQuestions = questionIds.map((questionId) => questionPayload(
      feedbackById.get(questionId)!,
      true,
    ));
  } else if (savedSession.status === "active" && savedSession.mode === "practice") {
    deliveredQuestions = await questionsWithPracticeAuthorization(
      repository,
      userKey,
      savedSession.id,
      questions,
    );
  } else {
    deliveredQuestions = questions.map((question) => questionPayload(question));
  }
  return response(request, {
    session: sessionPayload(savedSession),
    questions: deliveredQuestions,
  }, "private-session");
}

async function handlePost(request: Request, repository: SwStudyRepository) {
  const mutationError = verifyUserMutationRequest(request);
  if (mutationError) return mutationError;
  let candidate: unknown;
  try {
    candidate = await readBoundedJsonBody(request, SW_STUDY_BODY_MAX_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyError) {
      return requestError(request, error.status, error.code, error.message);
    }
    return requestError(request, 400, "SW_BODY_INVALID", "SW 학습 저장 요청 본문을 확인할 수 없습니다.");
  }
  const contract = validateSwStudyMutationRequest(candidate);
  if (!contract.ok) {
    const failure = contract as { code: string; message: string };
    return requestError(request, 400, failure.code, failure.message);
  }
  const accepted = contract as { action: string; payload: Record<string, unknown> };
  const ownerError = await verifySwAccountOwner(request);
  if (ownerError) return ownerError;
  const authorization = ["sw-attempt", "sw-session-save", "sw-session-submit"].includes(accepted.action)
    ? await authorizeLearningSession(request, { createIfMissing: true, respectMaintenance: true })
    : await authorizeLearnerRequest(request, { createIfMissing: true, respectMaintenance: true });
  if (!authorization.ok) return authorization.response;
  const payload = accepted.payload;
  const action = accepted.action;
  const userKey = authorization.account.userKey;

  if (action === "sw-attempt") {
    const questionId = String(payload.questionId ?? "");
    const operationId = String(payload.clientOperationId ?? "");
    const sessionId = String(payload.sessionId ?? "");
    const mode = payload.mode === "practice" ? "practice" : null;
    const practiceSession = /^[a-zA-Z0-9_-]{12,100}$/u.test(sessionId)
      ? await repository.findSession(userKey, sessionId)
      : null;
    const practiceQuestionIds = new Set(
      practiceSession ? jsonArray<string>(practiceSession.questionIds, []) : [],
    );
    const blockedQuestionIds = await repository.findPracticeBlockedQuestionIds(userKey, [questionId]);
    const blockingExamItem = blockedQuestionIds.includes(questionId)
      ? { id: "blocked-mock-item", status: "active" }
      : null;
    const feedbackDecision = await decidePracticeFeedbackAccess({
      userKey,
      engine: "sw",
      questionId,
      contextId: sessionId,
      authorization: payload.feedbackAuthorization,
      blockingExamItem,
    });
    const validPracticeSession = practiceSession?.status === "active"
      && practiceSession.mode === "practice"
      && practiceQuestionIds.has(questionId);
    if (!feedbackDecision.allowed || !validPracticeSession) {
      return requestError(
        request,
        403,
        "SW_FEEDBACK_FORBIDDEN",
        "이 문항의 정답과 해설을 확인할 권한이 없거나 아직 공개되지 않았습니다.",
      );
    }
    const question = await repository.findAttemptQuestion(questionId);
    if (!question || !mode || !/^[a-zA-Z0-9_-]{12,80}$/u.test(operationId)) {
      return requestError(request, 400, "SW_ATTEMPT_INVALID", "저장할 SW 풀이 기록이 올바르지 않습니다.");
    }
    const choices = jsonArray<string>(question.choices, []);
    const selectedAnswers = [...new Set(
      (Array.isArray(payload.selectedAnswers) ? payload.selectedAnswers : [payload.selectedAnswers])
        .map(Number).filter(Number.isInteger),
    )].sort((a, b) => a - b);
    if (!selectedAnswers.length
      || selectedAnswers.some((answer) => answer < 0 || answer >= choices.length)
      || (question.kind === "single" && selectedAnswers.length !== 1)) {
      return requestError(request, 400, "SW_ANSWER_INVALID", "선택한 답안이 문제의 선택지 범위를 벗어났습니다.");
    }
    const correct = sameAnswers(selectedAnswers, jsonArray<number>(question.correct_answers, []));
    if (isGuestLearningKey(userKey)) {
      return response(request, {
        attempt: { id: -Date.now(), questionId, selectedAnswers, correct, mode,
          clientOperationId: operationId, createdAt: new Date().toISOString() },
        feedback: questionFeedbackPayload(question), duplicate: false, temporary: true,
      }, "private-session");
    }
    const stored = await repository.insertAttemptIdempotent({
      userKey,
      questionId,
      selectedAnswers,
      correct,
      mode,
      clientOperationId: operationId,
      createdAt: new Date().toISOString(),
    });
    if (stored.conflict) {
      return requestError(
        request,
        409,
        "SW_IDEMPOTENCY_CONFLICT",
        "같은 SW 풀이 저장 식별자가 다른 답안에 사용되었습니다. 화면을 새로고침한 뒤 다시 풀어 주세요.",
      );
    }
    const attempt = stored.attempt;
    return response(request, {
      attempt: {
        ...attempt,
        selectedAnswers: jsonArray<number>(attempt.selectedAnswers, []),
        correct: Boolean(attempt.correct),
      },
      feedback: questionFeedbackPayload(question),
      duplicate: !stored.created,
    }, "private-session", { status: stored.created ? 201 : 200 });
  }

  if (action === "sw-progress") {
    return requestError(request, 410, "THEORY_PROGRESS_RETIRED", "이론 진도 기록 기능이 종료되었습니다.");
  }

  if (action === "sw-session-save" || action === "sw-session-submit") {
    return saveLearningSession(
      request,
      repository,
      userKey,
      payload,
      action === "sw-session-submit" ? "submitted" : "active",
    );
  }

  if (action === "sw-import") {
    const importedTheoryProgress = 0;
    if (payload.activeSession && typeof payload.activeSession === "object") {
      const session = payload.activeSession as Record<string, unknown>;
      const imported = await saveLearningSession(request, repository, userKey, {
        ...session,
        sessionId: session.id,
        action: "sw-session-save",
      }, "active");
      if (!imported.ok) {
        const failure = await imported.json() as Record<string, unknown>;
        return Response.json({
          ...failure,
          ok: false,
          importedTheoryProgress,
          sessionImport: { status: "failed", code: failure.code },
        }, { status: imported.status, headers: imported.headers });
      }
    }
    return response(request, {
      ok: true, importedTheoryProgress,
      sessionImport: { status: payload.activeSession ? "saved" : "not-requested" },
      account: await accountStatePayload(repository, userKey),
    }, "private-session");
  }

  return requestError(request, 400, "SW_ACTION_UNSUPPORTED", "지원하지 않는 SW 학습 저장 요청입니다.");
}

export async function POST(request: Request, repository = new SwStudyRepository()) {
  return withApiErrorBoundary(request, () => handlePost(request, repository), {
    code: "SW_STUDY_SAVE_FAILED",
    message: "SW 학습 상태를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  });
}
