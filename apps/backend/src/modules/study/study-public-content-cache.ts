import { readPublicContentCache } from "@backend/common/content/public-content-cache";
import { readContentCacheRevision } from "@backend/common/content/content-cache-revision";
import type { ExamType } from "./domain/study.domain";
import type { StudyRepository } from "./study.repository";

function guestTheoryContext(selectedExam: ExamType) {
  return {
    progressRows: [],
    setting: { userKey: "", selectedExam, createdAt: "", updatedAt: "" },
  };
}

export function needsStudyContentRevision(scope: string, privateResponse: boolean) {
  return ["overview", "bootstrap", "theories", "theory", "practice-meta"].includes(scope)
    || !privateResponse;
}

export function studyContentRevision(scope: string, privateResponse: boolean) {
  return needsStudyContentRevision(scope, privateResponse)
    ? readContentCacheRevision()
    : Promise.resolve("");
}

export async function courseOverviewInputs(
  repository: StudyRepository,
  userKey: string | undefined,
  revision: string,
) {
  const [contentRows, userRows] = await Promise.all([readPublicContentCache({
    namespace: "overview",
    key: "all",
    revision,
    loader: () => repository.readCourseContentOverview(),
  }), userKey ? repository.readCourseUserOverview(userKey) : Promise.resolve(null)]);
  return userRows ? { contentRows, ...userRows } : { contentRows };
}

export async function theoryListInputs(
  repository: StudyRepository,
  _userKey: string | undefined,
  selectedExam: ExamType,
  revision: string,
) {
  const [rows, userRows] = await Promise.all([readPublicContentCache({
    namespace: "theories",
    key: selectedExam,
    revision,
    loader: () => repository.findTheoryRows(selectedExam),
  }), Promise.resolve(guestTheoryContext(selectedExam))]);
  return { rows, ...userRows };
}

export async function theoryDetailInputs(
  repository: StudyRepository,
  _userKey: string | undefined,
  selectedExam: ExamType,
  theoryId: number,
  revision: string,
) {
  const [context, userRows] = await Promise.all([readPublicContentCache({
    namespace: "theory",
    key: `${selectedExam}:${theoryId}`,
    revision,
    loader: () => repository.findTheoryDetailRow(theoryId, selectedExam),
  }), Promise.resolve(guestTheoryContext(selectedExam))]);
  return { context, ...userRows };
}
