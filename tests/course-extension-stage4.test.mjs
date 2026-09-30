import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildCourseRegistryArtifacts } from "../scripts/lib/course-registry-generator.mjs";
import {
  buildCourseReleaseCatalog,
  canonicalRowsSha256,
} from "../scripts/lib/content-release.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function registrySource() {
  return JSON.parse(fs.readFileSync(
    path.join(root, "packages/shared/src/study/course-registry.source.json"),
    "utf8",
  ));
}

function futureRegistry() {
  const source = registrySource();
  source.fields.push({
    id: "future-certifications",
    engineId: "certification",
    name: "미래 자격 분야",
    shortLabel: "미래",
    cardTitle: "미래 자격증",
    summary: "신규 자격증 분야 확장 흐름을 검증합니다.",
    status: "available",
  });
  source.subjects.push({
    id: "future-foundations",
    name: "미래 기술 기초",
    aliases: ["미래 기초"],
  });
  source.contentScopes.push({
    id: "FUTURE",
    courseExamTypes: ["FUTURE"],
    aliases: [],
  });
  source.courses.push({
    examType: "FUTURE",
    fieldId: "future-certifications",
    courseId: "future",
    name: "미래 자격",
    summary: "신규 자격증 확장 흐름을 검증합니다.",
    studyMode: "1과목 · 객관식",
    mockExam: "1문항 · 10분",
    subjectIds: ["future-foundations"],
    descriptiveSubjectIds: [],
    examPolicy: {
      policyVersion: "future-v1",
      title: "미래 자격 모의고사",
      durationMinutes: 10,
      objectiveCounts: { "future-foundations": 1 },
      descriptiveCount: 0,
      objectivePoint: 100,
      descriptivePoint: 0,
      totalQuestions: 1,
      totalPoints: 100,
      passingScore: 60,
      subjectMinimumRate: 40,
      practicalMinimumRate: 0,
      resultDecimals: 0,
    },
  });
  return source;
}

function manifest(questions, theories) {
  return {
    questionCount: questions.length,
    questionSha256: canonicalRowsSha256(questions),
    schemaVersion: "content-v2",
    sourceSha256: "b".repeat(64),
    theoryCount: theories.length,
    theorySha256: canonicalRowsSha256(theories),
    version: "future-v1",
  };
}

async function runtimeModule(source) {
  const url = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  return import(url);
}

test("stable subject ids survive display labels and historical aliases", async () => {
  const artifacts = buildCourseRegistryArtifacts(futureRegistry());
  const runtime = await runtimeModule(artifacts.runtime);

  assert.equal(runtime.COURSE_REGISTRY_SCHEMA_VERSION, 3);
  assert.equal(runtime.COURSE_FIELD_DEFINITIONS.at(-1).id, "future-certifications");
  assert.equal(runtime.normalizeRegisteredSubjectId("future-foundations"), "future-foundations");
  assert.equal(runtime.normalizeRegisteredSubjectId("미래 기술 기초"), "future-foundations");
  assert.equal(runtime.normalizeRegisteredSubjectId("미래 기초"), "future-foundations");
  assert.equal(runtime.registeredSubjectName("미래 기초"), "미래 기술 기초");
  assert.deepEqual(runtime.EXAM_TYPE_SUBJECT_IDS.FUTURE, ["future-foundations"]);

  const invalid = futureRegistry();
  invalid.subjects.at(-1).aliases = [invalid.subjects[0].id];
  assert.throws(
    () => buildCourseRegistryArtifacts(invalid),
    /subject identifier data-modeling is duplicated/u,
  );
});

test("a new certificate stays private until its complete release unit is ready", () => {
  const artifacts = buildCourseRegistryArtifacts(futureRegistry());
  const futureCourse = artifacts.registry.courses.find((course) => course.examType === "FUTURE");
  assert.ok(futureCourse);
  const theory = {
    active: 1,
    category: "미래 기술 기초",
    exam_scope: "FUTURE",
    id: 9101,
  };
  const emptyContent = { questions: [], theories: [theory] };
  const blocked = buildCourseReleaseCatalog(
    manifest(emptyContent.questions, emptyContent.theories),
    emptyContent,
    [futureCourse],
  );
  assert.equal(blocked.courses[0].status, "blocked");
  assert.deepEqual(
    blocked.courses[0].blockers,
    [
      "OBJECTIVE_SHORTAGE:future-foundations:0/1",
      "THEORY_PRACTICE_LINK_MISSING:future-foundations",
    ],
  );

  const readyContent = {
    questions: [{
      active: 1,
      category: "미래 기술 기초",
      exam_scope: "FUTURE",
      id: 9201,
      kind: "single",
      theory_id: 9101,
    }],
    theories: [theory],
  };
  const ready = buildCourseReleaseCatalog(
    manifest(readyContent.questions, readyContent.theories),
    readyContent,
    [futureCourse],
  );
  const released = new Set(
    ready.courses.filter((course) => course.status === "released").map((course) => course.examType),
  );
  const publicCourses = artifacts.registry.courses
    .filter((course) => released.has(course.examType))
    .map((course) => course.examType);
  assert.equal(ready.courses[0].status, "released");
  assert.deepEqual(publicCourses, ["FUTURE"]);

  const catalog = fs.readFileSync(
    path.join(root, "packages/shared/src/study/learning-catalog.ts"),
    "utf8",
  );
  assert.match(catalog, /course\.fieldId === fieldId && isReleasedExamType\(course\.examType\)/u);
});

test("learner controllers delegate navigation chrome and SW rendering", () => {
  const studyApp = fs.readFileSync(
    path.join(root, "apps/frontend/src/features/study/components/study-app.tsx"),
    "utf8",
  );
  const swPlanner = fs.readFileSync(
    path.join(root, "apps/frontend/src/features/study/components/sw-curriculum-planner.tsx"),
    "utf8",
  );
  assert.match(studyApp, /<StudySidebar/u);
  assert.match(studyApp, /<StudyHeader/u);
  assert.doesNotMatch(studyApp, /<aside className="sidebar"/u);
  assert.match(swPlanner, /<SwCurriculumContent/u);
  assert.doesNotMatch(swPlanner, /<SwTheoryListView|<SwMockRunner|<SwPracticeRunner/u);
  assert.ok(Buffer.byteLength(studyApp) <= 90_000);
  assert.ok(Buffer.byteLength(swPlanner) <= 46_000);
});
