import { normalizeMarkdownProse } from "@shared/content/content-format.mjs";
import { koreaDayStreak } from "@shared/date/korea-date.mjs";
import { feedbackRevealDecision } from "@shared/study/exam-feedback-authorization.mjs";
import {
  DEFAULT_EXAM_TYPE,
  EXAM_TYPES,
  examScopeAllows,
  questionAllowedForExam,
  uniqueStrings,
  type ExamType
} from "./domain/study.domain";
import {
  StudyRequestError
} from "./study-attempt.service";
import {
  buildCourseContentOverview,
  type CourseOverviewStats,
} from "./study-course-overview.domain";
import {
  courseOverviewInputs,
  theoryDetailInputs,
  theoryListInputs
} from "./study-public-content-cache";
import {
  questionRowsByIds,
  recordQuestionPayloadsFromRows
} from "./study-question-delivery";
import {
  mockQuestionWindow,
  parseExamSession,
  parseExamSessionSummary
} from "./study-session.domain";
import { theoryDetailDelivery } from "./study-theory-delivery";
import {
  StudyRepository,
  type TheoryRow
} from "./study.repository";


import { examType, numberList } from "./study-request-values";

import { sessionForUser } from "./study-owned-session";

export function createStudyReadUseCases(studyRepository: StudyRepository) {
  function theoryPayload(row: TheoryRow, includeContent = true) {
    return {
      ...row,
      content: includeContent ? normalizeMarkdownProse(row.content) : "",
      reviewAnswers: includeContent ? normalizeMarkdownProse(row.reviewAnswers) : "",
      keywords: uniqueStrings(row.keywords),
      active: Boolean(row.active),
    };
  }

  async function readUserSetting(key: string) {
    return studyRepository.readUserSetting(key);
  }

  async function readLearningShell(userKey?: string) {
    return {
      questions: [],
      theories: [],
      attempts: [],
      examSessions: [],
      theoryProgress: [],
      evaluations: [],
      settings: userKey
        ? await readUserSetting(userKey)
        : { selectedExam: DEFAULT_EXAM_TYPE },
    };
  }

  function applyRecentActivity(
    target: CourseOverviewStats,
    activity: {
      at: string;
      kind: Exclude<CourseOverviewStats["lastActivityKind"], "">;
      label: string;
      theoryId?: number | null;
    },
  ) {
    if (!activity.at || (target.lastActivityAt && target.lastActivityAt >= activity.at)) return;
    target.lastActivityAt = activity.at;
    target.lastActivityKind = activity.kind;
    target.recentActivity = activity.label;
    target.lastTheoryId = activity.theoryId ?? null;
  }

  async function readCourseOverview(key: string | undefined, rev: string) {
    const overviewRows = await courseOverviewInputs(studyRepository, key, rev);
    const {
      byExam,
      questionCount: totalQuestionCount,
      explainedQuestionCount: totalExplainedQuestionCount,
      theoryCount: totalTheoryCount,
    } = buildCourseContentOverview(overviewRows.contentRows);

    if (!key) {
      return {
        questions: [],
        theories: [],
        attempts: [],
        examSessions: [],
        theoryProgress: [],
        evaluations: [],
        settings: { selectedExam: DEFAULT_EXAM_TYPE },
        overview: {
          questionCount: totalQuestionCount,
          explainedQuestionCount: totalExplainedQuestionCount,
          theoryCount: totalTheoryCount,
          questionMeta: [],
          byExam,
        },
      };
    }

    if (!("setting" in overviewRows)) throw new Error("overview user data is unavailable");
    const {
      attemptRows,
      progressRows,
      bookmarkRows,
      activeSessionRows,
      recentRows,
      recentTheoryRows,
      attemptDayRows,
      setting,
    } = overviewRows;

    for (const row of attemptRows ?? []) {
      const selectedExam = examType(row.exam_type);
      byExam[selectedExam].objectiveAttemptCount = Number(row.attempt_count ?? 0);
    }
    for (const row of progressRows ?? []) {
      const selectedExam = examType(row.exam_type);
      byExam[selectedExam].completedTheoryCount = Number(row.completed_count ?? 0);
    }
    for (const examType of EXAM_TYPES) {
      byExam[examType].bookmarkCount = (bookmarkRows ?? []).reduce((count, row) => (
        count + (questionAllowedForExam({
          examScope: row.exam_scope,
          category: row.category,
          kind: row.kind,
        }, examType) ? Number(row.item_count) : 0)
      ), 0);
    }
    for (const row of activeSessionRows ?? []) {
      const selectedExam = examType(row.exam_type);
      byExam[selectedExam].hasActiveMock = Number(row.active_count ?? 0) > 0;
      applyRecentActivity(byExam[selectedExam], {
        at: row.active_updated_at,
        kind: "mock",
        label: "진행 중인 모의고사",
      });
    }
    for (const row of recentRows ?? []) {
      const selectedExam = examType(row.exam_type);
      applyRecentActivity(byExam[selectedExam], {
        at: row.created_at,
        kind: "practice",
        label: row.topic ? `${row.category} · ${row.topic}` : row.category,
      });
    }
    for (const row of recentTheoryRows ?? []) {
      const selectedExam = examType(row.exam_type);
      applyRecentActivity(byExam[selectedExam], {
        at: row.updated_at,
        kind: "theory",
        label: row.title || (row.topic ? `${row.category} · ${row.topic}` : row.category),
        theoryId: Number(row.theory_id),
      });
    }
    for (const selectedExam of EXAM_TYPES) {
      byExam[selectedExam].streak = koreaDayStreak(
        (attemptDayRows ?? [])
          .filter((row) => examType(row.exam_type) === selectedExam)
          .map((row) => row.learning_day),
      );
    }

    return {
      questions: [],
      theories: [],
      attempts: [],
      examSessions: [],
      theoryProgress: [],
      evaluations: [],
      settings: setting,
      overview: {
        questionCount: totalQuestionCount,
        explainedQuestionCount: totalExplainedQuestionCount,
        theoryCount: totalTheoryCount,
        questionMeta: [],
        byExam,
      },
    };
  }

  function scopedEmpty(settings: { selectedExam: string } = { selectedExam: DEFAULT_EXAM_TYPE }) {
    return {
      questions: [],
      theories: [],
      attempts: [],
      examSessions: [],
      theoryProgress: [],
      evaluations: [],
      settings,
    };
  }

  async function readTheoryList(key: string | undefined, selectedExam: ExamType, revision: string) {
    const { rows, setting } = await theoryListInputs(
      studyRepository, key, selectedExam, revision,
    );
    return {
      ...scopedEmpty(setting),
      theories: rows
        .filter((row) => examScopeAllows(row.examScope, selectedExam))
        .map((row) => ({
          ...row,
          keywords: uniqueStrings(row.keywords).slice(0, 3),
        })),
    };
  }

  async function readTheoryDetail(
    key: string | undefined,
    selectedExam: ExamType,
    theoryId: number,
    revision: string,
  ) {
    if (!Number.isInteger(theoryId) || theoryId < 1) {
      throw new StudyRequestError(400, "올바른 이론 ID가 필요합니다.");
    }
    const { context, setting } = await theoryDetailInputs(
      studyRepository, key, selectedExam, theoryId, revision,
    );
    if (!context) {
      throw new StudyRequestError(404, "이론을 찾을 수 없습니다.");
    }
    const delivery = theoryDetailDelivery(context);
    return {
      ...scopedEmpty(setting),
      theories: [theoryPayload(delivery.row)],
      theoryNavigation: {
        linkedCount: delivery.linkedCount,
        previous: delivery.previous,
        next: delivery.next,
      },
    };
  }

  async function readRecords(key: string, selectedExam: ExamType, params: URLSearchParams) {
    const limit = Math.max(1, Math.min(50, Number(params.get("limit")) || 30));
    const attemptCursor = Number(params.get("attemptCursor"));
    const bookmarkCursor = Number(params.get("bookmarkCursor"));
    const requestedView = params.get("view");
    const view = requestedView === "incorrect" || requestedView === "bookmarks"
      ? requestedView
      : "stats";
    const { attemptRows, sessionRows, bookmarkRows, setting, summary, stats, questionRows } =
      await studyRepository.readRecords(key, selectedExam, {
        limit,
        attemptCursor: Number.isInteger(attemptCursor) && attemptCursor > 0 ? attemptCursor : undefined,
        bookmarkCursor: Number.isInteger(bookmarkCursor) && bookmarkCursor > 0 ? bookmarkCursor : undefined,
        view,
      });
    const attemptPage = attemptRows.slice(0, limit);
    const bookmarkPage = bookmarkRows.slice(0, limit);
    const referencedIds = [...new Set([
      ...attemptPage.map((row) => row.questionId),
      ...bookmarkPage.map((row) => row.questionId),
    ])];
    const recordQuestions = await recordQuestionPayloadsFromRows(referencedIds, key, questionRows);
    return {
      ...scopedEmpty(setting),
      questions: recordQuestions,
      attempts: attemptPage.map((row) => ({
        ...row,
        selectedAnswers: numberList(row.selectedAnswers),
        correct: Boolean(row.correct),
        isAdmin: Boolean(row.isAdmin),
      })),
      examSessions: sessionRows.map(parseExamSessionSummary),
      recordsSummary: summary,
      recordStats: stats,
      recordsPagination: {
        attemptsNextCursor: view !== "bookmarks" && attemptRows.length > limit
          ? attemptPage.at(-1)?.id ?? null
          : null,
        bookmarksNextCursor: view === "bookmarks" && bookmarkRows.length > limit
          ? bookmarkPage.at(-1)?.questionId ?? null
          : null,
        limit,
      },
    };
  }

  async function readMockData(key: string, selectedExam: ExamType) {
    const { sessionRows, setting } = await studyRepository.readExamSessions(key, selectedExam);
    const active = sessionRows.find((row) => row.status === "active");
    const activeWithItems = active
      ? { ...active, items: await studyRepository.findSessionItems(active.id) }
      : null;
    const parsedActive = activeWithItems ? parseExamSession(activeWithItems) : null;
    const activeIds = parsedActive?.questionIds ?? [];
    const currentIndex = active
      ? Math.min(Math.max(0, Number(active.currentIndex) || 0), Math.max(0, activeIds.length - 1))
      : 0;
    return {
      ...scopedEmpty(setting),
      questions: await questionRowsByIds(studyRepository, mockQuestionWindow(activeIds, currentIndex), key),
      examSessions: sessionRows.slice(0, 20).map((row) => row.status === "active" && parsedActive?.id === row.id
        ? parsedActive
        : parseExamSessionSummary(row)),
      mockPagination: {
        hasMore: sessionRows.length > 20,
        limit: 20,
      },
    };
  }

  async function readMockSession(key: string, sessionId: string) {
    const row = await sessionForUser(studyRepository, key, sessionId);
    if (!row) throw new StudyRequestError(404, "모의고사 기록을 찾을 수 없습니다.", `mock session not found: ${sessionId}`);
    const session = parseExamSession(row);
    return {
      ...scopedEmpty({ selectedExam: examType(row.examType) }),
      examSessions: [session],
      questions: feedbackRevealDecision({
        activity: "exam",
        authorizationValid: false,
        session: {
          ownerMatches: true,
          containsQuestion: true,
          status: session.status,
        },
      }).allowed
        ? await questionRowsByIds(studyRepository, session.questionIds, key, true)
        : await questionRowsByIds(studyRepository, session.questionIds, key),
    };
  }


  return { readLearningShell, readCourseOverview, readTheoryList, readTheoryDetail, readRecords, readMockData, readMockSession, scopedEmpty };
}
