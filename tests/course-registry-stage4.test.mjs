import { readFeatureSource } from "./helpers/feature-source.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { buildStudyPracticeQuery } from "../apps/backend/src/modules/study/study-practice-query.mjs";
import { normalizeContentImport } from "../packages/shared/src/admin/admin-import.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function source(file) {
  return readFeatureSource(path.join(root, file), "utf8");
}

async function loadCourseRegistry() {
  const file = path.join(root, "packages/shared/src/study/course-registry.ts");
  const output = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: file,
    reportDiagnostics: true,
  });
  assert.deepEqual(output.diagnostics ?? [], []);
  const contractSource = readFileSync(
    path.join(root, "packages/shared/src/study/course-contract.mjs"),
    "utf8",
  );
  const contractUrl = `data:text/javascript;base64,${Buffer.from(contractSource).toString("base64")}`;
  const releaseSource = readFileSync(
    path.join(root, "packages/shared/src/study/course-release-contract.mjs"),
    "utf8",
  );
  const releaseUrl = `data:text/javascript;base64,${Buffer.from(releaseSource).toString("base64")}`;
  const compiled = output.outputText
    .replace("./course-contract.mjs", contractUrl)
    .replace("./course-release-contract.mjs", releaseUrl);
  const url = `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`;
  return import(url);
}

test("course registry distinguishes registered intake courses from released exam policies", async () => {
  const registry = await loadCourseRegistry();
  assert.deepEqual(registry.EXAM_TYPES, ["SQLD", "SQLP", "DASP", "DAP", "BAE", "IPEW", "IPEP", "ISEW", "ISEP"]);
  assert.deepEqual(registry.RELEASED_EXAM_TYPES, ["SQLD", "SQLP", "DASP", "DAP", "BAE", "IPEW", "IPEP", "ISEW"]);
  assert.ok(registry.isExamType(registry.DEFAULT_EXAM_TYPE));
  assert.ok(registry.isReleasedExamType(registry.DEFAULT_EXAM_TYPE));
  assert.equal(registry.isExamType("BAE"), true);
  assert.equal(registry.isReleasedExamType("BAE"), true);
  assert.equal(registry.COURSE_REGISTRY.BAE.releaseStage, "released");
  assert.deepEqual(registry.COURSE_REGISTRY.BAE.contentKinds, ["theory", "question"]);
  assert.deepEqual(
    registry.COURSE_REGISTRY.BAE.releasedSubjects.map((subject) => subject.id),
    [
      "big-data-analysis-planning",
      "big-data-exploration",
      "big-data-modeling",
      "big-data-result-interpretation",
    ],
  );
  assert.deepEqual(
    registry.courseQuestionSubjects("BAE").map((subject) => subject.id),
    [
      "big-data-analysis-planning",
      "big-data-exploration",
      "big-data-modeling",
      "big-data-result-interpretation",
    ],
  );
  assert.equal(registry.COURSE_REGISTRY.IPEW.releaseStage, "released");
  assert.equal(registry.COURSE_REGISTRY.IPEP.releaseStage, "released");
  assert.deepEqual(registry.acceptedContentScopes("IPEW"), ["IPEW", "IPE"]);
  assert.deepEqual(registry.acceptedContentScopes("IPEP"), ["IPEP", "IPE"]);
  assert.equal(new Set(registry.EXAM_TYPES).size, registry.EXAM_TYPES.length);
  assert.equal(new Set(registry.COURSE_DEFINITIONS.map((course) => course.courseId)).size, registry.EXAM_TYPES.length);

  for (const course of registry.COURSE_DEFINITIONS) {
    assert.equal(registry.COURSE_REGISTRY[course.examType], course);
    assert.ok(course.acceptedContentScopes.includes(course.examType));
    assert.ok(course.subjects.length > 0);
    if (course.examPolicy === null) {
      assert.equal(course.releaseStage, "intake");
      assert.equal(course.contentKinds.includes("mock-exam"), false);
      assert.equal(registry.isReleasedExamType(course.examType), false);
      continue;
    }
    assert.equal(
      Object.values(course.examPolicy.objectiveCounts).reduce((total, count) => total + count, 0)
        + course.examPolicy.descriptiveCount,
      course.examPolicy.totalQuestions,
    );
    assert.ok(Object.isFrozen(course));
    assert.ok(Object.isFrozen(course.examPolicy));
    assert.ok(Object.isFrozen(course.acceptedContentScopes));
  }
  assert.ok(Object.isFrozen(registry.COURSE_DEFINITIONS));
  assert.ok(Object.isFrozen(registry.EXAM_CONFIGS));
  assert.equal(registry.examDisplayName("DASP"), "DAsP");
  assert.deepEqual(registry.acceptedContentScopes("DASP"), ["DASP", "DA"]);
  assert.deepEqual(registry.acceptedContentScopes("DAP"), ["DAP", "DA"]);
  assert.equal(registry.EXAM_CONFIGS.DASP.totalQuestions, 50);
  assert.equal(registry.EXAM_CONFIGS.DASP.durationMinutes, 90);
  assert.equal(registry.EXAM_CONFIGS.DAP.totalQuestions, 76);
  assert.equal(registry.EXAM_CONFIGS.DAP.durationMinutes, 240);
  assert.equal(registry.EXAM_CONFIGS.DAP.objectivePoint, 0.8);
  assert.equal(registry.EXAM_CONFIGS.DAP.descriptivePoint, 40);
  assert.equal(registry.EXAM_CONFIGS.DAP.practicalMinimumRate, 40);
  assert.equal(registry.contentScopeAllowsSubject("DA", "데이터 모델링"), true);
  assert.equal(registry.contentScopeAllowsSubjectId("DA", "data-modeling-practice"), true);
  assert.equal(registry.contentScopeAllowsSubject("DA", "데이터베이스 설계와 이용"), false);
  assert.equal(registry.subjectId("데이터 모델링의 이해"), "data-modeling");
  assert.equal(registry.subjectName("data-modeling"), "데이터 모델링의 이해");
  assert.deepEqual(registry.courseSubjectIds("SQLP"), [
    "data-modeling",
    "sql-basics",
    "sql-advanced-tuning",
  ]);
});

test("SQL and data-architecture shared scopes stay isolated in course queries", async () => {
  const registry = await loadCourseRegistry();
  assert.deepEqual(
    registry.EXAM_TYPES.filter((examType) => registry.acceptedContentScopes(examType).includes("both")),
    ["SQLD", "SQLP"],
  );

  const futureCourseQuery = buildStudyPracticeQuery({
    selectedExam: "DAP",
    eligibility: {
      sql: "q.exam_scope IN (?, ?) AND q.kind IN ('single', 'multiple')",
      values: ["DAP", "DA"],
    },
    category: "전체 과목",
    difficulty: "전체",
    kind: "objective",
    theoryId: Number.NaN,
    excludedIds: [],
    excludedVariantGroupIds: [],
    limit: 5,
  });
  assert.deepEqual(futureCourseQuery.values.slice(0, 3), ["DAP", "DA", 5]);
  assert.doesNotMatch(futureCourseQuery.sql, /SQLD|SQLP|'both'/u);
  assert.match(futureCourseQuery.sql, /q\.exam_scope IN \(\?, \?\)/u);
  assert.match(futureCourseQuery.sql, /q\.kind IN \('single', 'multiple'\)/u);
});

test("admin import canonicalizes a future course through the injected registry contract", () => {
  const imported = normalizeContentImport({
    questions: [{
      id: 1,
      category: "데이터 모델링",
      topic: "논리 데이터 모델",
      examScope: "DAsP",
      difficulty: "중",
      kind: "single",
      prompt: "확장 과정 계약을 확인한다.",
      choices: ["예", "아니오"],
      correctAnswers: [0],
      explanation: "확장 과정은 주입된 계약으로 정규화한다.",
    }],
  }, "2026-08-22T00:00:00.000Z", {
    examTypes: ["SQLD", "SQLP", "DASP", "DAP"],
    subjects: ["데이터 모델링의 이해", "SQL 기본 및 활용", "SQL 고급 활용 및 튜닝", "데이터 모델링"],
  });
  assert.equal(imported.questions[0].exam_scope, "DASP");
  assert.equal(imported.questions[0].category, "데이터 모델링");
});

test("active application boundaries consume registry guards instead of literal course lists", () => {
  const files = [
    "apps/backend/src/modules/study/study.service.ts",
    "apps/backend/src/modules/study/study-attempt.service.ts",
    "apps/backend/src/modules/study/study-site-settings-cache.ts",
    "apps/frontend/src/features/study/routing/use-learning-router.ts",
    "apps/frontend/src/features/study/persistence/guest-learning-store.ts",
    "apps/frontend/src/features/study/components/study-app.tsx",
  ];
  for (const file of files) {
    const code = source(file);
    assert.doesNotMatch(code, /(?:===|!==)\s*["']SQL[DP]["']\s*(?:&&|\|\|)/u, file);
    assert.doesNotMatch(code, /\[["']SQLD["'],\s*["']SQLP["']\]/u, file);
  }
  assert.match(source(files[0]), /isReleasedExamType/u);
  assert.match(source(files[1]), /isReleasedExamType/u);
  assert.match(source(files[3]), /isReleasedExamType/u);
  assert.match(source("packages/shared/src/study/learning-catalog.ts"), /COURSE_DEFINITIONS/u);
  assert.match(source("apps/backend/src/modules/study/study.repository.ts"), /courseQuestionEligibility/u);
});

test("registry module remains directly buildable without application dependencies", () => {
  const registry = source("packages/shared/src/study/course-registry.ts");
  assert.doesNotMatch(registry, /from\s+["']@(?:frontend|backend)|from\s+["'](?:react|next|@nestjs)/u);
  assert.equal(pathToFileURL(path.join(root, "packages/shared/src/study/course-registry.ts")).protocol, "file:");
});
