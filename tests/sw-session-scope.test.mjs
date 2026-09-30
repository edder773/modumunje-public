import { readFeatureSource } from "./helpers/feature-source.mjs";
import assert from "node:assert/strict";
import test from "node:test";

const studyApp = readFeatureSource(
  new URL("../apps/frontend/src/features/study/components/study-app.tsx", import.meta.url),
  "utf8",
);
const curriculum = readFeatureSource(
  new URL("../apps/frontend/src/features/study/components/sw-curriculum-selection.tsx", import.meta.url),
  "utf8",
);
const persistence = readFeatureSource(
  new URL("../apps/frontend/src/features/study/persistence/sw-learning-store.ts", import.meta.url),
  "utf8",
);
const sessionRestore = readFeatureSource(
  new URL("../apps/frontend/src/features/study/model/sw-session-restore.mjs", import.meta.url),
  "utf8",
);
const study = `${studyApp}\n${curriculum}\n${persistence}\n${sessionRestore}`;

test("saved SW sessions are scoped to the exact selected subject combination", () => {
  assert.match(study, /function subjectSelectionsMatch\(first: string\[\], second: string\[\]\)/u);
  assert.match(study, /if \(!subjectSelectionsMatch\(session\.subjectIds, \[\.\.\.selectedSubjectIds\]\)\)/u);
  assert.match(study, /저장된 문제 풀이는 다른 학습 범위의 초안/u);
  assert.match(study, /const selectionChanged = !subjectSelectionsMatch\(current\.selectedSubjectIds, nextSubjectIds\)/u);
  assert.match(study, /if \(selectionChanged\) \{[\s\S]*delete nextState\.recentPracticeQuestionIds/u);
  assert.match(study, /function changeSwCurriculumSelection[\s\S]*window\.confirm[\s\S]*clearPersistedSwSession/u);
  assert.match(study, /if \(!subjectSelectionsMatch\(session\.subjectIds, \[\.\.\.selectedSubjectIds\]\)\)/u);
});

test("changing a combination clears local answers and invalidates older requests", () => {
  assert.match(study, /function resetSwQuestionSessionState\(\)[\s\S]*swReadRequests\.cancelAll\("session-reset"\)/u);
  assert.match(study, /resetSwQuestionSessionState\(\)[\s\S]*setPracticeAnswers\(\{\}\)[\s\S]*setRevealedQuestions\(new Set\(\)\)/u);
  assert.match(study, /function changeSwCurriculumSelection\(subjectIds: Set<string>\)[\s\S]*resetSwQuestionSessionState\(\)[\s\S]*writeSwCurriculumSelection\(subjectIds\)/u);
  assert.match(studyApp, /onSelectionChange=\{changeSwCurriculumSelection\}/u);
  assert.match(curriculum, /changeSelection\(recommendationIsSelected\(availableIds\) \? new Set\(\) : new Set\(availableIds\)\)/u);
  assert.match(curriculum, /onClick=\{\(\) => changeSelection\(new Set\(\)\)\}/u);
  assert.ok((study.match(/!request\.isCurrent\(\)/gu) ?? []).length >= 5);
  assert.match(study, /setQuestionSessionScopeKey\(""\)/u);
  assert.match(study, /questionSessionScopeKey !== selectedSubjectIdsKey/u);
  assert.match(study, /subjectIds: questionSessionScopeKey\.split\(","\)/u);
  assert.match(study, /previousSelectedSubjectIdsKeyRef\.current === selectedSubjectIdsKey/u);
});

test("restoring a session keeps answers only for returned valid questions", () => {
  assert.match(study, /requestedSwSessionQuestionIds\(session\.questionIds\)/u);
  assert.match(sessionRestore, /return \[\.\.\.new Set\(questionIds\)\]\.slice\(-100\)/u);
  assert.match(study, /view:\s*"session"[\s\S]*subjects:\s*session\.subjectIds\.join\(","\)/u);
  assert.match(sessionRestore, /requestedIds\.has\(question\.id\)/u);
  assert.match(study, /sessionSubjectIds\.has\(question\.subjectId\)/u);
  assert.match(study, /question\.theoryId === session\.theoryId/u);
  assert.match(study, /requiredTag:\s*selectedQuestionProfile\?\.requiredTag/u);
  assert.match(sessionRestore, /question\.tags\.includes\(requiredTag\)/u);
  assert.match(sessionRestore, /const scopeIsComplete = scopedQuestions\.length === requestedQuestionIds\.length/u);
  assert.match(study, /if \(!restored\.scopeIsComplete\) \{[\s\S]*콘텐츠 변경으로[\s\S]*제외하고 남은 답안을 복원/u);
  assert.match(sessionRestore, /const restoredIds = new Set\(\)/u);
  assert.match(study, /Object\.entries\(session\.answers\)\.filter/u);
  assert.match(study, /item < \(question\?\.choices\.length \?\? 0\)/u);
  assert.match(study, /restoredIds\.has\(questionId\) && Boolean\(restoredAnswers\[questionId\]\?\.length\)/u);
  assert.doesNotMatch(study, /setPracticeAnswers\(session\.answers\)/u);
});

test("SW APIs constrain both restored and theory-linked questions to the selected scope", () => {
  const api = readFeatureSource(
    new URL("../apps/backend/src/modules/sw-study/sw-study.service.ts", import.meta.url),
    "utf8",
  );
  const repository = readFeatureSource(
    new URL("../apps/backend/src/modules/sw-study/sw-study.repository.ts", import.meta.url),
    "utf8",
  );
  const practiceQuery = readFeatureSource(
    new URL("../apps/backend/src/modules/sw-study/sw-practice-query.mjs", import.meta.url),
    "utf8",
  );
  const sessionBranch = api.slice(
    api.indexOf('if (view === "session")'),
    api.indexOf('if (view === "practice")'),
  );
  const practiceBranch = api.slice(
    api.indexOf('if (view === "practice")'),
    api.indexOf('return requestError(request, 400, "SW_VIEW_UNSUPPORTED"'),
  );
  const sessionRepository = repository.slice(
    repository.indexOf("async findSessionQuestions"),
    repository.indexOf("async findPracticeQuestions"),
  );
  const practiceRepository = repository.slice(repository.indexOf("async findPracticeQuestions"));

  assert.match(sessionBranch, /repository\.findSessionQuestions\(\{/u);
  assert.match(sessionBranch, /subjects,[\s\S]*theoryId,[\s\S]*requiredTag:/u);
  assert.match(sessionRepository, /clauses\.push\("theory_id = \?"\)/u);
  assert.match(sessionRepository, /EXISTS \([\s\S]*sw_question_tags[\s\S]*sw_question_tags\.tag = \?/u);
  assert.match(practiceBranch, /if \(!subjects\.length\) \{[\s\S]*return requestError/u);
  assert.match(practiceBranch, /repository\.findPracticeQuestions\(\{/u);
  assert.match(practiceRepository, /buildSwPracticeQuery\(input\)/u);
  assert.match(practiceQuery, /clauses\.push\("theory_id = \?"\)/u);
  assert.match(study, /theoryId,[\s\S]*subjects:\s*selectedSubjectQuery\(\)/u);
  assert.match(study, /theoryId:\s*selectedTheory\?\.id/u);
});
