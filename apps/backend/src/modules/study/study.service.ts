import {
  authorizePrefetchedLearner,
  isAdminRequest,
  learnerUserHash,
  normalizedEmail,
  verifyUserMutationRequest,
} from "@backend/common/auth/admin-auth";
import { requestIdFor } from "@backend/common/http/api-response";
import { guestImportPayloadDigest } from "./study-guest-import-digest";
import { metricPhase } from "@backend/common/observability/d1-metrics";
import { isPublicStudyScope } from "@shared/study/learning-access";
import { gradePracticalAnswer } from "./ipe-practical-grading";
import { writeSystemError } from "@backend/common/observability";
import {
  readBoundedJsonBody,
  RequestBodyError,
} from "@shared/http/bounded-json-body.mjs";
import { validateStudyMutationRequest } from "@shared/study/study-mutation-contract.mjs";
import {
  examScopeAllows, selfAssessmentVerdict
} from "./domain/study.domain";
import {
  questionFeedbackPayload,
  readAuthorizedPracticeQuestion,
  saveLearningAttempt,
  StudyRequestError,
} from "./study-attempt.service";
import { studyErrorResponse } from "./study-error-response";
import { authorizeStudyMutation } from "./study-practice-authorization";
import {
  readPracticeBatch,
  readPracticeMeta,
  readQuestionSelection
} from "./study-question-delivery";
import {
  parseStudyReadScope,
  privateStudyReadScope,
} from "./study-read-scope";
import {
  readPublicStudyResponseCache,
  readSharedStudyResponseCache,
  sharedStudyCacheKey,
  studyJsonResponse,
} from "./study-response-cache";
import { readPublicSiteSettings } from "./study-site-settings-cache";
import { publicSiteSettingsFromRows } from "./study-site-settings-cache";
import { AUTHENTICATED_USER_EMAIL_HEADER } from "@shared/auth/authenticated-user";
import {
  StudyRepository,
  type GuestImportAttempt,
  type GuestImportProgress
} from "./study.repository";


import { createStudyExamUseCases } from "./study-exam-use-cases";
import { allowSubmissionAnalytics } from "../events/guest-mock-submission-sql";
import { createStudyReadUseCases } from "./study-read-use-cases";
import { examType, list, now, numberList, PRIVATE_CACHE_CONTROL, PUBLIC_CACHE_CONTROL, requiredString, STUDY_BODY_MAX_BYTES, type JsonRecord } from "./study-request-values";
export { examType } from "./study-request-values";

function createStudyHandlers(studyRepository: StudyRepository) {
  const { readLearningShell, readCourseOverview, readTheoryList, readTheoryDetail,
    readRecords, readMockData, readMockSession, scopedEmpty } = createStudyReadUseCases(studyRepository);
  const { startExam, saveExam, submitExam } = createStudyExamUseCases(studyRepository);

  async function GET(request: Request) {
    try {
      const url = new URL(request.url);
      if (url.searchParams.get("export") === "1") {
        return Response.json({
          error: "전체 데이터 내보내기는 데이터 관리 화면 개편 후 제공됩니다.",
        }, { status: 410 });
      }
      const requestedScope = url.searchParams.get("scope");
      const scope = parseStudyReadScope(requestedScope);
      if (!scope) {
        return Response.json({
          error: requestedScope
            ? "지원하지 않는 학습 데이터 범위입니다."
            : "학습 데이터 범위(scope)가 필요합니다.",
        }, {
          status: 400,
          headers: {
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
      const selectedExam = examType(url.searchParams.get("exam") ?? undefined);
      const { email, userKey } = await metricPhase("auth", async () => {
        const email = normalizedEmail(request.headers.get(AUTHENTICATED_USER_EMAIL_HEADER));
        return { email, userKey: email ? await learnerUserHash(email) : null };
      });
      if (!email && !isPublicStudyScope(scope)) {
        const missing = await metricPhase("auth", async () => authorizePrefetchedLearner(email, userKey, null));
        if (!missing.ok) return missing.response;
      }
      const responsePrivate = Boolean(userKey) || privateStudyReadScope(scope) || scope === "shell";
      const contextOptions = {
        includeRevision: true,
        includeSetting: scope === "shell",
      };
      const context = await metricPhase("context", () => studyRepository.readStudyRequestContext(userKey, contextOptions));
      const authorization = await metricPhase("auth", async () =>
        authorizePrefetchedLearner(email, userKey, context.accountRow));
      if (!authorization.ok && authorization.response.status !== 401) return authorization.response;
      if (scope === "shell") {
        const data = await readLearningShell();
        return studyJsonResponse(request, {
          ...data,
          settings: context.setting ?? data.settings,
          site: publicSiteSettingsFromRows(context.siteRows),
          adminAccess: authorization.ok && isAdminRequest(request),
          authenticated: authorization.ok,
        }, {
          isPrivate: true,
          privateCacheControl: PRIVATE_CACHE_CONTROL,
          publicCacheControl: PUBLIC_CACHE_CONTROL,
        });
      }
      const key = authorization.ok ? authorization.account.userKey : undefined;
      const rev = context.revision;
      const site = publicSiteSettingsFromRows(context.siteRows);
      const responseRev = JSON.stringify([rev, site]);
      const edge = responsePrivate ? null : sharedStudyCacheKey(scope, selectedExam, url.searchParams, responseRev);
      // Reuse the existing scope/filter/revision key, so query ordering and
      // transport-only build markers cannot force response-cache misses.
      const publicKey = responsePrivate ? undefined : edge
        ? `${url.pathname}:${edge}` : `${responseRev}:${url.pathname}${url.search}`;
      if (publicKey) {
        const cached = readPublicStudyResponseCache(request, publicKey, PUBLIC_CACHE_CONTROL);
        if (cached) return cached;
      }
      if (edge) {
        const cached = await metricPhase("cache", () => readSharedStudyResponseCache(request, edge));
        if (cached) return cached;
      }
      const dataPromise = metricPhase("data", async () => scope === "overview" || scope === "bootstrap"
          ? readCourseOverview(key, rev)
          : scope === "theories"
            ? readTheoryList(key, selectedExam, rev)
            : scope === "theory"
              ? readTheoryDetail(key, selectedExam, Number(url.searchParams.get("id")), rev)
              : scope === "practice-meta"
                ? readPracticeMeta(studyRepository, key, selectedExam, rev)
                : scope === "practice"
                  ? readPracticeBatch(studyRepository, key, selectedExam, url.searchParams)
                  : scope === "questions"
                    ? readQuestionSelection(studyRepository, key, selectedExam, url.searchParams)
                    : scope === "records"
                      ? key
                        ? readRecords(key, selectedExam, url.searchParams)
                        : {
                          ...scopedEmpty({ selectedExam }),
                          recordsPagination: {
                            attemptsNextCursor: null,
                            bookmarksNextCursor: null,
                            limit: 30,
                          },
                        }
                      : scope === "mock-session"
                        ? key
                          ? readMockSession(key, requiredString(url.searchParams.get("id"), "id"))
                          : readLearningShell()
                        : key
                          ? readMockData(key, selectedExam)
                          : readLearningShell());
      const data = await dataPromise;
      const payload = {
        ...data,
        site,
        adminAccess: authorization.ok && isAdminRequest(request),
        authenticated: authorization.ok,
      };
      return studyJsonResponse(request, payload, {
        isPrivate: responsePrivate,
        privateCacheControl: PRIVATE_CACHE_CONTROL,
        publicCacheControl: PUBLIC_CACHE_CONTROL,
        publicCacheKey: publicKey,
        sharedCacheKey: edge ?? undefined,
      });
    } catch (error) {
      const requestId = requestIdFor(request);
      if (!(error instanceof StudyRequestError)) {
        await writeSystemError({
          errorType: "study_read_failed",
          pagePath: "/api/study",
          message: `[${requestId}] ${error instanceof Error ? error.message : "학습 데이터 조회 실패"}`,
        });
      }
      return studyErrorResponse(request, error, requestId);
    }
  }

  async function POST(request: Request) {
    let action = "";
    let payload: JsonRecord = {};
    try {
      const mutationError = verifyUserMutationRequest(request);
      if (mutationError) return mutationError;
      let candidate: unknown;
      try {
        candidate = await readBoundedJsonBody(request, STUDY_BODY_MAX_BYTES);
      } catch (error) {
        if (error instanceof RequestBodyError) {
          throw new StudyRequestError(
            error.status,
            error.message,
            error.code,
            error.code,
          );
        }
        throw new StudyRequestError(
          400,
          "학습 저장 요청 본문을 확인할 수 없습니다.",
          "invalid JSON request body",
          "STUDY_BODY_INVALID",
        );
      }
      const contract = validateStudyMutationRequest(candidate);
      if (!contract.ok) {
        const failure = contract as { code: string; message: string };
        throw new StudyRequestError(400, failure.message, failure.code, failure.code);
      }
      const accepted = contract as { action: string; payload: JsonRecord };
      payload = accepted.payload;
      action = accepted.action;
      if (action === "evaluate") {
        return Response.json({
          error: "서술형 자동 채점은 제공하지 않습니다. 평가 기준과 모범답안을 확인한 뒤 예상 점수를 직접 기록해 주세요.",
        }, { status: 410 });
      }
      if (action === "theory") {
        return Response.json(
          { error: "이론 등록은 관리자 페이지에서만 사용할 수 있습니다." },
          { status: 403 },
        );
      }
      if (action === "question") {
        return Response.json(
          { error: "문제 등록은 관리자 페이지에서만 사용할 수 있습니다." },
          { status: 403 },
        );
      }
      if (action === "import") {
        return Response.json({
          error: "백업 파일 가져오기는 데이터 관리 화면 개편 후 제공됩니다.",
        }, { status: 410 });
      }
      const authorization = await authorizeStudyMutation(request, payload, action, studyRepository);
      if (!authorization.ok) return authorization.response;
      const { key, context: practiceContext, site: practiceSite } = authorization;
      if (action === "account-touch") {
        await studyRepository.ensureUserSetting(key);
        return Response.json({ ok: true }, {
          headers: { "Cache-Control": "no-store" },
        });
      }
      const adminActivity = isAdminRequest(request);
      const site = practiceSite ?? await readPublicSiteSettings(studyRepository);
      if (site.maintenanceMode && !adminActivity) {
        return Response.json(
          { error: "현재 유지보수 중입니다. 잠시 후 다시 이용해 주세요." },
          { status: 503 },
        );
      }

      if (action === "guest-import") {
        const importId = requiredString(payload.importId, "importId");
        if (!/^[a-zA-Z0-9_-]{12,80}$/.test(importId)) {
          throw new Error("valid importId is required");
        }
        const suppliedBookmarks = Array.isArray(payload.bookmarks) ? payload.bookmarks : [];
        const suppliedAttempts = Array.isArray(payload.attempts) ? payload.attempts : [];
        if (suppliedBookmarks.length > 2_000 || suppliedAttempts.length > 2_000
          || suppliedBookmarks.some((id) => !Number.isInteger(id) || id < 1)
          || suppliedAttempts.some((item) => !item || typeof item !== "object" || Array.isArray(item))) {
          throw new StudyRequestError(400, "가져올 학습 기록의 형식이나 개수를 확인해 주세요.");
        }
        const bookmarkIds = [...new Set(numberList(suppliedBookmarks))]
          .filter((id) => id > 0)
          .slice(0, 2_000);
        const guestAttempts = suppliedAttempts as JsonRecord[];
        const payloadDigest = await guestImportPayloadDigest(payload);
        const receipt = await studyRepository.guestImportReceipt(key, importId);
        if (receipt) {
          if (!receipt.payloadDigest || receipt.payloadDigest !== payloadDigest) {
            throw new StudyRequestError(409, "기존 가져오기 기록과 요청 내용이 달라 보류했습니다.",
              "guest import receipt mismatch or legacy receipt", "GUEST_IMPORT_CONFLICT");
          }
          return Response.json({ ok: true, imported: true, duplicate: true, verified: true,
            bookmarks: bookmarkIds.length, attempts: guestAttempts.length, theoryProgress: 0 });
        }
        const candidateQuestionIds = [...new Set([
          ...bookmarkIds,
          ...guestAttempts.map((item) => Number(item.questionId))
            .filter((id) => Number.isInteger(id) && id > 0),
        ])];
        const activeQuestionRows = await studyRepository.findFeedbackQuestionsByIds(candidateQuestionIds);
        const activeQuestions = new Map(
          activeQuestionRows.map((row) => [Number(row.id), {
            row,
            kind: String(row.kind),
            choiceCount: list(row.choices).length,
            correctAnswers: numberList(row.correctAnswers).sort((a, b) => a - b),
          }]),
        );
        const blockedQuestionIds = new Set(await studyRepository.findPracticeBlockedQuestionIds(
          key, candidateQuestionIds,
        ));
        if (blockedQuestionIds.size > 0) {
          return Response.json({ ok: true, imported: false, deferred: true });
        }
        const validBookmarkIds: number[] = [];
        const importAttempts: GuestImportAttempt[] = [];
        const importProgress: GuestImportProgress[] = [];

        for (const questionId of bookmarkIds) {
          if (!activeQuestions.has(questionId)) continue;
          validBookmarkIds.push(questionId);
        }
        for (const item of guestAttempts) {
          const questionId = Number(item.questionId);
          const question = activeQuestions.get(questionId);
          const selectedExam = examType(item.examType);
          if (!question || !examScopeAllows(question.row.examScope, selectedExam)) continue;
          const answerText = typeof item.answerText === "string" ? item.answerText.slice(0, 16_384) : "";
          const suppliedCreatedAt = typeof item.createdAt === "string" && !Number.isNaN(Date.parse(item.createdAt))
            ? item.createdAt : null;
          if (question.kind === "descriptive") {
            if (!answerText.trim()) continue;
            const grade = selectedExam === "IPEP" ? await gradePracticalAnswer(question.row, answerText) : null;
            const selfScore = Math.round(Number(item.score));
            if (selectedExam === "IPEP" && !grade) continue;
            if (!grade && (!Number.isFinite(selfScore) || selfScore < 0 || selfScore > 100)) continue;
            const score = grade?.score ?? selfScore;
            const result = grade?.result ?? selfAssessmentVerdict(score);
            importAttempts.push({ questionId, selectedAnswers: [], correct: result === "correct",
              mode: selectedExam === "IPEP" ? "guest-import:practice" : "guest-import:self-assessment",
              examType: selectedExam, result, score, answerText,
              reviewStatus: result === "correct" ? "mastered" : "pending", isAdmin: adminActivity,
              createdAt: suppliedCreatedAt ?? now(), compareCreatedAt: suppliedCreatedAt !== null });
            continue;
          }
          const selectedAnswers = [...new Set(numberList(item.selectedAnswers))]
            .filter((answer) => answer >= 0 && answer < question.choiceCount)
            .sort((a, b) => a - b);
          if (!selectedAnswers.length || (question.kind === "single" && selectedAnswers.length !== 1)) continue;
          const correct = selectedAnswers.length === question.correctAnswers.length
            && selectedAnswers.every((answer, index) => answer === question.correctAnswers[index]);
          const result = correct ? "correct" : "incorrect";
          importAttempts.push({
            questionId,
            selectedAnswers,
            correct,
            mode: `guest-import:${String(item.mode ?? "practice").slice(0, 60)}`,
            examType: examType(item.examType),
            result,
            score: correct ? 100 : 0,
            reviewStatus: correct ? "mastered" : "pending",
            isAdmin: adminActivity,
            createdAt: suppliedCreatedAt ?? now(), compareCreatedAt: suppliedCreatedAt !== null,
          });
        }
        if (validBookmarkIds.length !== bookmarkIds.length || importAttempts.length !== guestAttempts.length) {
          throw new StudyRequestError(422, "일부 학습 기록을 확인할 수 없어 가져오기를 보류했습니다.",
            "guest import contains unresolved items", "GUEST_IMPORT_UNRESOLVED_ITEMS");
        }
        const committed = await studyRepository.commitGuestImport({
          userKey: key,
          importId,
          payloadDigest,
          selectedExam: examType(payload.selectedExam),
          bookmarkIds: validBookmarkIds,
          attempts: importAttempts,
          progress: importProgress,
        });
        if (!committed.imported) {
          if (committed.conflict) {
            throw new StudyRequestError(409, "기존 가져오기 기록과 요청 내용이 달라 보류했습니다.",
              "guest import operation identity conflict", "GUEST_IMPORT_CONFLICT");
          }
          if (committed.duplicate) {
            return Response.json({ ok: true, imported: true, duplicate: true, verified: true,
              bookmarks: validBookmarkIds.length, attempts: committed.attempts, theoryProgress: 0 });
          }
          return Response.json({ ok: true, imported: false, deferred: true });
        }
        return Response.json({
          ok: true,
          imported: true,
          verified: true,
          bookmarks: validBookmarkIds.length,
          attempts: committed.attempts,
          theoryProgress: importProgress.length,
        });
      }

      if (action === "question-feedback") {
        const questionId = Number(payload.questionId);
        const selectedExam = examType(payload.examType);
        const answerText = typeof payload.answerText === "string" ? payload.answerText.trim() : "";
        if (!Number.isInteger(questionId) || questionId < 1 || !answerText) {
          throw new StudyRequestError(400, "작성한 답안과 유효한 문항이 필요합니다.");
        }
        if (new TextEncoder().encode(answerText).byteLength > 16_384) {
          throw new StudyRequestError(400, "서술형 답안은 16KB 이내로 입력해 주세요.");
        }
        const question = await readAuthorizedPracticeQuestion({
          key,
          questionId,
          feedbackAuthorization: payload.feedbackAuthorization,
          repository: studyRepository,
          context: practiceContext,
        });
        if (!question || question.kind !== "descriptive" || !examScopeAllows(question.examScope, selectedExam)) {
          throw new StudyRequestError(404, "현재 과정에서 확인할 수 있는 서술형 문항을 찾지 못했습니다.");
        }
        return Response.json({
          feedback: questionFeedbackPayload(question),
        }, { headers: { "Cache-Control": PRIVATE_CACHE_CONTROL } });
      }

      if (action === "attempt" || action === "self-assessment" || action === "short-answer") {
        return await saveLearningAttempt({
          action,
          payload,
          key,
          adminActivity,
          repository: studyRepository,
          practiceContext,
        });
      }

      if (action === "bookmark") {
        const questionId = Number(payload.questionId);
        const bookmarked = payload.bookmarked === true;
        const exists = await studyRepository.setBookmark(key, questionId, bookmarked);
        if (!exists) {
          throw new StudyRequestError(
            404,
            "북마크할 문항을 찾지 못했습니다.",
            `question not found: ${questionId}`,
            "STUDY_QUESTION_NOT_FOUND",
          );
        }
        return Response.json({ ok: true, questionId, bookmarked });
      }

      if (action === "settings") {
        const selectedExam = examType(payload.selectedExam);
        await studyRepository.updateUserSetting(key, selectedExam, now());
        return Response.json({ ok: true, selectedExam });
      }

      if (action === "theory-progress") {
        return Response.json({ error: "이론 진도 기록 기능이 종료되었습니다.", code: "THEORY_PROGRESS_RETIRED" }, { status: 410 });
      }

      if (action === "exam-start") {
        return await startExam(key, examType(payload.examType), adminActivity, payload.formId, allowSubmissionAnalytics(request));
      }

      if (action === "exam-save") {
        return await saveExam(key, payload);
      }

      if (action === "exam-submit") {
        return await submitExam(key, payload, allowSubmissionAnalytics(request));
      }

      return Response.json({
        error: "지원하지 않는 학습 저장 요청입니다.",
        code: "STUDY_ACTION_UNSUPPORTED",
      }, { status: 400 });
    } catch (error) {
      const requestId = requestIdFor(request);
      if (!(error instanceof StudyRequestError)) {
        await writeSystemError({
          errorType: "study_write_failed",
          pagePath: "/api/study",
          questionId: Number.isInteger(Number(payload.questionId))
            ? Number(payload.questionId)
            : null,
          message: `[${requestId}] ${error instanceof Error ? error.message : "학습 데이터 저장 실패"}`,
        });
      }
      return studyErrorResponse(request, error, requestId);
    }
  }

  async function PATCH() {
    return Response.json({
      error: "콘텐츠 수정은 관리자 페이지에서만 사용할 수 있습니다.",
    }, { status: 403 });
  }

  async function DELETE() {
    return Response.json({
      error: "콘텐츠 삭제는 관리자 페이지에서만 사용할 수 있습니다.",
    }, { status: 403 });
  }


  return { GET, POST, PATCH, DELETE };
}

const studyHandlerCache = new WeakMap<
  StudyRepository,
  ReturnType<typeof createStudyHandlers>
>();

function handlersFor(repository: StudyRepository) {
  const existing = studyHandlerCache.get(repository);
  if (existing) return existing;
  const handlers = createStudyHandlers(repository);
  studyHandlerCache.set(repository, handlers);
  return handlers;
}

export function GET(request: Request, repository = new StudyRepository()) {
  return handlersFor(repository).GET(request);
}

export function POST(request: Request, repository = new StudyRepository()) {
  return handlersFor(repository).POST(request);
}

export function PATCH(repository = new StudyRepository()) {
  return handlersFor(repository).PATCH();
}

export function DELETE(repository = new StudyRepository()) {
  return handlersFor(repository).DELETE();
}
