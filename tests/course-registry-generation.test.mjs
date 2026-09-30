import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  COURSE_CONTENT_SCOPE_ROWS,
  COURSE_SUBJECT_ROWS,
} from "../packages/shared/src/study/course-contract.mjs";
import {
  buildCourseRegistryArtifacts,
} from "../scripts/lib/course-registry-generator.mjs";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "packages/shared/src/study/course-registry.source.json");

function sourceRegistry() {
  return JSON.parse(fs.readFileSync(sourcePath, "utf8"));
}

function sortedRows(rows, keys) {
  return rows.map((row) => Object.fromEntries(keys.map((key) => [key, row[key]])))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

test("course registry generated artifacts are deterministic and current", () => {
  const first = buildCourseRegistryArtifacts(sourceRegistry());
  const second = buildCourseRegistryArtifacts(sourceRegistry());
  assert.deepEqual(first, second);
  assert.equal(
    first.runtime,
    fs.readFileSync(path.join(root, "packages/shared/src/study/course-contract.mjs"), "utf8"),
  );
  assert.equal(
    first.declarations,
    fs.readFileSync(path.join(root, "packages/shared/src/study/course-contract.d.mts"), "utf8"),
  );
  assert.equal(
    first.databaseSql,
    fs.readFileSync(path.join(root, "apps/backend/resources/course-registry/registered-course-values.sql"), "utf8"),
  );
});

test("a synthetic certificate expands runtime, types, and database rows from one source", () => {
  const source = sourceRegistry();
  source.fields.push({
    id: "future-certificates",
    engineId: "certification",
    name: "미래 자격 분야",
    shortLabel: "미래",
    cardTitle: "미래 자격증",
    summary: "확장 계약 검증 분야입니다.",
    status: "available",
  });
  source.subjects.push({
    id: "future-foundations",
    name: "미래 기술 기초",
    aliases: ["미래 기초"],
  });
  source.contentScopes.push({ id: "FUTURE", courseExamTypes: ["FUTURE"], aliases: [] });
  source.courses.push({
    examType: "FUTURE",
    fieldId: "future-certificates",
    courseId: "future",
    name: "미래 자격",
    summary: "확장 계약 검증 과정입니다.",
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
  assert.ok(artifacts.registry.examTypes.includes("FUTURE"));
  assert.equal(artifacts.registry.fields.at(-1).id, "future-certificates");
  assert.deepEqual(
    artifacts.registry.courseContentScopeRows.at(-1),
    { examType: "FUTURE", contentScope: "FUTURE" },
  );
  assert.deepEqual(
    artifacts.registry.courseSubjectRows.at(-1),
    { examType: "FUTURE", subject: "미래 기술 기초" },
  );
  assert.match(artifacts.runtime, /"examType": "FUTURE"/u);
  assert.match(artifacts.runtime, /normalizeRegisteredSubjectId/u);
  assert.match(artifacts.runtime, /"미래 기초": "future-foundations"/u);
  assert.match(artifacts.declarations, /"FUTURE"/u);
  assert.match(artifacts.databaseSql, /\('FUTURE', '미래 기술 기초'\)/u);
});

test("canonical database course rows exactly match the generated registry", () => {
  const database = openCanonicalTestDatabase(root);
  try {
    const actualScopes = database.prepare(`
      SELECT exam_type AS examType, content_scope AS contentScope
      FROM course_content_scopes
    `).all();
    const actualSubjects = database.prepare(`
      SELECT exam_type AS examType, subject FROM course_subjects
    `).all();
    assert.deepEqual(
      sortedRows(actualScopes, ["examType", "contentScope"]),
      sortedRows(COURSE_CONTENT_SCOPE_ROWS, ["examType", "contentScope"]),
    );
    assert.deepEqual(
      sortedRows(actualSubjects, ["examType", "subject"]),
      sortedRows(COURSE_SUBJECT_ROWS, ["examType", "subject"]),
    );
  } finally {
    database.close();
  }
});

test("administrator course, scope, and subject controls consume derived registry values", () => {
  const questionAdmin = fs.readFileSync(
    path.join(root, "apps/frontend/src/features/admin/components/admin-question-sections.tsx"),
    "utf8",
  );
  const theoryAdmin = fs.readFileSync(
    path.join(root, "apps/frontend/src/features/admin/components/admin-theory-sections.tsx"),
    "utf8",
  );
  const sharedAdmin = fs.readFileSync(
    path.join(root, "apps/frontend/src/features/admin/components/admin-content-shared.tsx"),
    "utf8",
  );
  for (const source of [questionAdmin, theoryAdmin]) {
    assert.match(source, /contentDomainOptions/u);
    assert.match(source, /domainConfig[.]scopeOptions/u);
    assert.match(source, /domainConfig[.]subjects/u);
    assert.doesNotMatch(source, /\[\s*["']SQLD["']\s*,\s*["']SQLP["']/u);
  }
  assert.match(sharedAdmin, /@shared\/admin\/content-domains/u);
  const domains = fs.readFileSync(path.join(root, "packages/shared/src/admin/content-domains.ts"), "utf8");
  assert.match(domains, /contentScopesForField/u);
  assert.match(domains, /subjectsForField/u);
  assert.match(domains, /데이터 아키텍처/u);
});
