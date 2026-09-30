import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { COURSE_REGISTRY, EXAM_CONFIGS, isExamType, isReleasedExamType } from "../packages/shared/src/study/course-registry";
import { PREPARING_COURSES, parsePreparingLearningPath, preparingCoursePath } from "../packages/shared/src/study/preparing-courses";
import { isPublicLearningPath } from "../packages/shared/src/study/learning-access";
import { parseLearningPath } from "../packages/shared/src/study/learning-catalog";
import { contentDomainForScope, contentDomainOptions } from "../packages/shared/src/admin/content-domains";
import { CATALOG_FIELD_CARDS, searchCatalogFields } from "../apps/frontend/src/features/study/components/catalog/catalog-fields";
import CoursePreparation from "../apps/frontend/src/features/study/components/catalog/course-preparation";
import { validateCourseRegistrySource } from "../scripts/lib/course-registry-generator.mjs";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";
import { examType } from "../apps/backend/src/modules/study/study-request-values";
import { createStudyExamUseCases } from "../apps/backend/src/modules/study/study-exam-use-cases";
import type { StudyRepository } from "../apps/backend/src/modules/study/study.repository";

const guest = { status: "guest" as const, displayName: "방문자", userKey: "", signInPath: "/api/auth/google/start" };
const source = () => JSON.parse(fs.readFileSync("packages/shared/src/study/course-registry.source.json", "utf8"));

test("written system questions are released while practical remains isolated intake", () => {
  for (const exam of ["ISEW", "ISEP"] as const) {
    const course = COURSE_REGISTRY[exam];
    assert.equal(isExamType(exam), true);
    assert.equal(isReleasedExamType(exam), exam === "ISEW");
    assert.equal(course.releaseStage, exam === "ISEW" ? "released" : "intake");
    assert.deepEqual(course.acceptedContentScopes, [exam]);
    assert.deepEqual(course.contentKinds, exam === "ISEW" ? ["theory", "question"] : []);
    assert.deepEqual(course.questionSubjects.map(subject => subject.name), exam === "ISEW" ? ["시스템보안"] : []);
    assert.equal(contentDomainForScope(exam), "ise");
  }
  const options = contentDomainOptions("ise");
  assert.deepEqual(options.scopeOptions.map(item => item.value), ["ISEW", "ISEP"]);
  assert.equal(options.subjects.length, 6);
  assert.deepEqual(COURSE_REGISTRY.ISEW.subjects.map(subject => subject.name), ["시스템보안", "네트워크보안", "어플리케이션보안", "정보보안일반", "정보보안관리 및 법규"]);
  assert.deepEqual(COURSE_REGISTRY.ISEP.subjects.map(subject => subject.name), ["정보보안 실무"]);
  assert.equal(EXAM_CONFIGS.ISEW.totalQuestions, 100);
  assert.equal(EXAM_CONFIGS.ISEW.durationMinutes, 150);
  assert.equal(EXAM_CONFIGS.ISEP, null);
});

test("practical preparation remains public while written theory routes open", () => {
  assert.equal(parsePreparingLearningPath("/learn/information-security"), null);
  assert.deepEqual(parseLearningPath("/learn/information-security"), { fieldId: "information-security", page: "field" });
  assert.deepEqual(parseLearningPath("/learn/information-security/ise-written/theories"), { examType: "ISEW", page: "theories" });
  assert.equal(isPublicLearningPath("/learn/information-security/ise-written/theories"), true);
  for (const course of PREPARING_COURSES) {
    const path = preparingCoursePath(course);
    assert.equal(parsePreparingLearningPath(path)?.course?.examType, course.examType);
    assert.equal(isPublicLearningPath(path), true);
    assert.equal(parseLearningPath(path), null);
    for (const page of ["theories", "practice", "mock", "unknown"]) {
      const unavailable = path.replace(/home$/, page);
      assert.equal(parsePreparingLearningPath(unavailable), null);
      assert.equal(parseLearningPath(unavailable), null);
      assert.equal(isPublicLearningPath(unavailable), false);
    }
  }
});

test("catalog search combines released written and preparing practical links", () => {
  const field = CATALOG_FIELD_CARDS.find(item => item.id === "information-security")!;
  assert.ok(!field.preparing);
  assert.equal(field.links.length, 2);
  assert.equal(field.links.filter(link => link.preparing).length, 1);
  assert.ok(field.links.every(link => parsePreparingLearningPath(link.href) || parseLearningPath(link.href)));
  for (const [term, suffix] of [["정보보안 필기", "ise-written/home"], ["정보보안기사 실기", "ise-practical/home"]]) {
    const links = searchCatalogFields(CATALOG_FIELD_CARDS, term).flatMap(item => item.links);
    assert.equal(links.length, 1);
    assert.ok(links[0].href.endsWith(suffix));
  }
});

test("preparation pages render the correct subjects and no exercise actions for guests and members", () => {
  for (const course of PREPARING_COURSES) {
    const route = parsePreparingLearningPath(preparingCoursePath(course))!;
    for (const session of [guest, { ...guest, status: "active" as const, adminAccess: false, groupExamAccess: false, signOutPath: "/api/auth/logout" }]) {
      const html = renderToStaticMarkup(<CoursePreparation route={route} session={session} />);
      assert.match(html, /자료 검수를 마친 과정부터/);
      assert.match(html, /준비 중/);
      for (const subject of course.subjects) assert.ok(html.includes(`<li>${subject.name}</li>`));
      assert.equal((html.match(/<li>/g) ?? []).length, course.subjects.length);
      assert.doesNotMatch(html, /모의고사 시작|문제 풀기|답안 제출|0문항/);
      assert.ok(html.includes("https://www.cq.or.kr/qh_quagm01_020.do"));
    }
  }
});

test("pending practical policies cannot be promoted or enabled for mock exams", () => {
  assert.doesNotThrow(() => validateCourseRegistrySource(source()));
  const missingPolicy = source();
  const course = missingPolicy.courses.find((item: { examType: string }) => item.examType === "ISEP");
  course.releaseStage = "released";
  course.releasedSubjectIds = course.subjectIds;
  course.contentKinds = ["theory"];
  assert.throws(() => validateCourseRegistrySource(missingPolicy), /omit an exam policy only during intake/);
  course.releaseStage = "intake";
  course.contentKinds = ["question", "mock-exam"];
  course.questionSubjectIds = course.subjectIds;
  assert.throws(() => validateCourseRegistrySource(missingPolicy), /omit an exam policy only during intake/);
});

test("mock exams reject partial-question and intake courses before database access", async () => {
  const repository = new Proxy({}, { get() { throw new Error("Unexpected database access"); } }) as StudyRepository;
  const exams = createStudyExamUseCases(repository);
  for (const exam of ["ISEW", "ISEP"] as const) {
    if (exam === "ISEP") assert.throws(() => examType(exam));
    else assert.equal(examType(exam), exam);
    await assert.rejects(exams.startExam("test-user", exam, false), /exam policy pending/);
  }
});

test("security migration is idempotent and never changes existing learning content", () => {
  const db = openCanonicalTestDatabase(process.cwd());
  try {
    const before = JSON.stringify({ questions: db.prepare("SELECT * FROM questions ORDER BY id").all(), theories: db.prepare("SELECT * FROM theories ORDER BY id").all() });
    const migration = fs.readFileSync("apps/backend/drizzle/0557_information_security_courses.sql", "utf8");
    db.exec(migration); db.exec(migration);
    assert.equal(JSON.stringify({ questions: db.prepare("SELECT * FROM questions ORDER BY id").all(), theories: db.prepare("SELECT * FROM theories ORDER BY id").all() }), before);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM course_subjects WHERE exam_type IN ('ISEW','ISEP')").get()!.n, 6);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM course_content_scopes WHERE exam_type IN ('ISEW','ISEP')").get()!.n, 2);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM questions WHERE exam_scope IN ('ISEW','ISEP')").get()!.n, 50);
  } finally { db.close(); }
});
