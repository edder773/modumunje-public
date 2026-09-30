import { EXAM_TYPES } from "@shared/study/study-domain";
import { parseUtcDate } from "@shared/date/korea-date.mjs";
import type { GuestLearningState } from "../persistence/guest-learning-store";
import type { StudyData } from "../components/study-screen-shared";
import { calcStreak } from "./study-data-utils";

export function mergeGuestData(payload: StudyData, guest: GuestLearningState): StudyData {
  guest = { ...guest, theoryProgress: [] };
  const bookmarks = new Set(guest.bookmarks);
  const overview = payload.overview;
  const loadedQuestionMeta = new Map(
    payload.questions.map((question) => [question.id, question]),
  );
  const guestByExam = overview ? { ...overview.byExam } : undefined;
  if (overview && guestByExam) {
    for (const selectedExam of EXAM_TYPES) {
      const objectiveAttempts = guest.attempts.filter((attempt) => (
        attempt.examType === selectedExam && !attempt.mode.includes("self-assessment")
      ));
      const recentAttempt = [...objectiveAttempts]
        .sort((first, second) => +parseUtcDate(second.createdAt) - +parseUtcDate(first.createdAt))[0];
      const recentQuestion = recentAttempt
        ? loadedQuestionMeta.get(recentAttempt.questionId)
        : undefined;
      const recentTheory = [...guest.theoryProgress]
        .filter((progress) => progress.examType === selectedExam)
        .sort((first, second) => +new Date(second.updatedAt) - +new Date(first.updatedAt))[0];
      const attemptAt = recentAttempt?.createdAt ?? "";
      const theoryAt = recentTheory?.updatedAt ?? "";
      const theoryIsLatest = Boolean(theoryAt && (!attemptAt || theoryAt > attemptAt));
      guestByExam[selectedExam] = {
        ...guestByExam[selectedExam],
        objectiveAttemptCount: objectiveAttempts.length,
        completedTheoryCount: guest.theoryProgress.filter((progress) => (
          progress.examType === selectedExam && progress.completed
        )).length,
        bookmarkCount: guest.bookmarks.length,
        streak: calcStreak(objectiveAttempts),
        hasActiveMock: false,
        recentActivity: theoryIsLatest
          ? "최근 읽은 이론"
          : recentQuestion
            ? recentQuestion.topic
              ? `${recentQuestion.category} · ${recentQuestion.topic}`
              : recentQuestion.category
            : attemptAt ? "최근 문제 풀이" : "",
        lastActivityAt: theoryIsLatest ? theoryAt : attemptAt,
        lastActivityKind: theoryIsLatest ? "theory" : attemptAt ? "practice" : "",
        lastTheoryId: theoryIsLatest ? recentTheory?.theoryId ?? null : null,
      };
    }
  }
  return {
    ...payload,
    questions: payload.questions.map((question) => ({
      ...question,
      bookmarked: bookmarks.has(question.id),
    })),
    attempts: guest.attempts,
    theoryProgress: guest.theoryProgress.map((item, index) => ({
      id: -(index + 1),
      theoryId: item.theoryId,
      examType: item.examType,
      completed: item.completed,
    })),
    settings: { selectedExam: guest.selectedExam },
    overview: overview && guestByExam ? { ...overview, byExam: guestByExam } : overview,
  };
}
