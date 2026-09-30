import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildCourseRegistryArtifacts } from "../scripts/lib/course-registry-generator.mjs";
import { buildSwCurriculumArtifacts } from "../scripts/lib/sw-curriculum-generator.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function json(file) {
  return JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
}

async function runtimeModule(source) {
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

test("SW curriculum source deterministically drives UI, API profiles, and content import mapping", async () => {
  const source = json("packages/shared/src/study/sw-curriculum.source.json");
  const artifacts = buildSwCurriculumArtifacts(source);
  const runtime = await runtimeModule(artifacts.runtime);
  const summary = await runtimeModule(artifacts.summaryRuntime);

  assert.equal(artifacts.runtime, fs.readFileSync(path.join(root, "packages/shared/src/study/sw-curriculum-contract.mjs"), "utf8"));
  assert.equal(artifacts.declarations, fs.readFileSync(path.join(root, "packages/shared/src/study/sw-curriculum-contract.d.mts"), "utf8"));
  assert.equal(artifacts.summaryRuntime, fs.readFileSync(path.join(root, "packages/shared/src/study/sw-curriculum-summary.mjs"), "utf8"));
  assert.equal(artifacts.summaryDeclarations, fs.readFileSync(path.join(root, "packages/shared/src/study/sw-curriculum-summary.d.mts"), "utf8"));
  assert.deepEqual(summary.SW_CURRICULUM_SUMMARY_SUBJECT_IDS, runtime.SW_CURRICULUM_SUBJECT_IDS);
  assert.deepEqual(summary.SW_CURRICULUM_SUMMARY_SUBJECT_GROUPS.map(group => group.subjects.map(subject => subject.id)), runtime.SW_CURRICULUM_SUBJECT_GROUPS.map(group => group.subjects.map(subject => subject.id)));
  assert.ok(summary.SW_CURRICULUM_SUMMARY_SUBJECT_GROUPS.every(group => group.subjects.every(subject => subject.topics.length === 0)));
  assert.ok(Object.isFrozen(summary.SW_CURRICULUM_SUMMARY_SUBJECT_GROUPS[0].subjects[0]));
  assert.equal(artifacts.python, fs.readFileSync(path.join(root, "scripts/sw_curriculum_contract.py"), "utf8"));
  assert.equal(runtime.SW_CURRICULUM_SUBJECT_IDS.length, 15);
  assert.equal(runtime.SW_CURRICULUM_SUBJECT_GROUPS.length, 5);
  assert.equal(runtime.SW_CURRICULUM_RECOMMENDATIONS.length, 3);

  const profile = runtime.swCurriculumQuestionProfileForSubjects([
    "system-operations",
    "information-security",
    "software-engineering",
    "programming-languages",
    "network-data-communication",
    "database-sql",
    "operating-systems",
    "data-structures",
  ]);
  assert.equal(profile.id, "information-processing-engineer");
  assert.equal(runtime.swCurriculumQuestionProfile(profile.id), profile);
  assert.equal(runtime.swCurriculumQuestionProfile("unknown"), null);

  const importer = fs.readFileSync(path.join(root, "scripts/import-sw-learning-content.py"), "utf8");
  const catalog = fs.readFileSync(path.join(root, "packages/shared/src/study/learning-catalog.ts"), "utf8");
  const planner = fs.readFileSync(path.join(root, "apps/frontend/src/features/study/components/sw-curriculum-planner.tsx"), "utf8");
  assert.match(importer, /from sw_curriculum_contract import SUBJECTS/u);
  assert.doesNotMatch(importer, /^SUBJECTS\s*=\s*\{/mu);
  assert.match(catalog, /SW_CURRICULUM_SUMMARY_SUBJECT_GROUPS/u);
  assert.doesNotMatch(catalog, /from "\.\/sw-curriculum-contract\.mjs"/u);
  assert.match(planner, /SW_CURRICULUM_SUBJECT_GROUPS/u);
  assert.doesNotMatch(catalog, /name:\s*"자료구조"/u);
});

test("a new certification field and course expand from one source while incomplete content stays gated", async () => {
  const source = json("packages/shared/src/study/course-registry.source.json");
  source.fields.push({
    id: "future-certifications",
    engineId: "certification",
    name: "미래 자격 분야",
    shortLabel: "미래",
    cardTitle: "미래 자격증",
    summary: "신규 자격증 자동 확장을 검증합니다.",
    status: "available",
  });
  source.subjects.push({ id: "future-foundations", name: "미래 기술 기초", aliases: [] });
  source.contentScopes.push({ id: "FUTURE", courseExamTypes: ["FUTURE"], aliases: [] });
  source.courses.push({
    examType: "FUTURE",
    fieldId: "future-certifications",
    courseId: "future",
    name: "미래 자격",
    summary: "신규 자격증 자동 확장을 검증합니다.",
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

  const artifacts = buildCourseRegistryArtifacts(source);
  const runtime = await runtimeModule(artifacts.runtime);
  assert.equal(runtime.COURSE_REGISTRY_SCHEMA_VERSION, 3);
  assert.equal(runtime.COURSE_FIELD_DEFINITIONS.at(-1).id, "future-certifications");
  assert.equal(runtime.COURSE_DEFINITIONS.at(-1).examType, "FUTURE");

  const catalog = fs.readFileSync(path.join(root, "packages/shared/src/study/learning-catalog.ts"), "utf8");
  assert.match(catalog, /COURSE_FIELD_DEFINITIONS\.flatMap/u);
  assert.match(catalog, /isReleasedExamType\(course\.examType\)/u);
  assert.match(catalog, /return courses\.length \? \[\{/u);

  const missingField = structuredClone(source);
  missingField.fields.pop();
  assert.throws(() => buildCourseRegistryArtifacts(missingField), /references unknown field future-certifications/u);
});

test("complete workspace type checking is a required production build gate", () => {
  const packageJson = json("package.json");
  const build = fs.readFileSync(path.join(root, "scripts/build-verified.sh"), "utf8");
  assert.match(packageJson.scripts["check:types"], /tsc --noEmit -p tsconfig\.json/u);
  assert.match(build, /Type-checking the complete workspace/u);
  assert.match(build, /tsc" --noEmit -p/u);
});
