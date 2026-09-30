import crypto from "node:crypto";
import {
  COURSE_DEFINITIONS,
  contentScopeAllowsRegisteredSubject,
  REGISTERED_CONTENT_SCOPES,
} from "../../packages/shared/src/study/course-contract.mjs";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openCanonicalDatabase } from "./canonical-database.mjs";
import { assertContentReview, isPinnedHistoricalManifest } from "./content-review-receipt.mjs";

export const LEGACY_CONTENT_SCHEMA_VERSION = "content-v1";
export const CONTENT_SCHEMA_VERSION = "content-v2";
export const DEFAULT_RELEASE_VERSION = "learning-2026.09.13.6";
export const CONTENT_RELEASE_CONTRACT_VERSION = 3;
export const COURSE_RELEASE_CATALOG_SCHEMA_VERSION = 5;

export const LEGACY_QUESTION_COLUMNS = Object.freeze([
  "id", "category", "topic", "display_order", "exam_scope", "difficulty",
  "difficulty_rationale", "kind", "prompt", "choices", "correct_answers",
  "explanation", "tags", "scoring_criteria", "required_concepts",
  "acceptable_alternatives", "deduction_conditions", "error_conditions",
  "theory_id", "practice_scope", "bookmarked", "active", "created_at", "updated_at",
]);

export const QUESTION_COLUMNS = Object.freeze([
  ...LEGACY_QUESTION_COLUMNS.slice(0, 20),
  "variant_group_id",
  ...LEGACY_QUESTION_COLUMNS.slice(20),
]);

export const THEORY_COLUMNS = Object.freeze([
  "id", "title", "category", "topic", "sort_order", "exam_scope", "difficulty",
  "active", "summary", "content", "review_answers", "keywords", "created_at", "updated_at",
]);

const JSON_QUESTION_FIELDS = Object.freeze([
  "choices", "correct_answers", "tags", "scoring_criteria", "required_concepts",
  "acceptable_alternatives", "deduction_conditions", "error_conditions",
]);
const JSON_THEORY_FIELDS = Object.freeze(["keywords"]);
const FORBIDDEN_FIELDS = new Set(["rawSource", "sourceFile", "sourceText", "copyrightOwner"]);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

export function stableJson(value) {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}

export function canonicalRowsSha256(rows) {
  return sha256(JSON.stringify(rows));
}

function appliesToCourse(row, course) {
  return course.acceptedContentScopes.includes(row.exam_scope)
    && course.subjects.some((subject) => subject.name === row.category);
}

function courseReleaseBlockers(course, questions, theories) {
  const blockers = [];
  const contentKinds = new Set(course.contentKinds ?? ["theory", "question", "mock-exam"]);
  const activeQuestions = questions.filter((row) => Number(row.active) === 1);
  const activeTheories = theories.filter((row) => Number(row.active) === 1);
  const releasedSubjects = course.releasedSubjects ?? course.subjects;
  const questionSubjectNames = new Set(
    (course.questionSubjects ?? (contentKinds.has("question") ? releasedSubjects : []))
      .map((subject) => subject.name),
  );
  const subjectCoverage = releasedSubjects.map((subject) => {
    const subjectQuestions = activeQuestions.filter((row) => row.category === subject.name);
    const subjectTheories = activeTheories.filter((row) => row.category === subject.name);
    const subjectTheoryIds = new Set(subjectTheories.map((row) => Number(row.id)));
    const linkedQuestions = subjectQuestions.filter((row) => (
      row.theory_id != null && subjectTheoryIds.has(Number(row.theory_id))
    ));
    const linkedTheoryIds = new Set(linkedQuestions.map((row) => Number(row.theory_id)));
    const objectiveQuestionCount = subjectQuestions.filter((row) => row.kind !== "descriptive").length;
    const descriptiveQuestionCount = subjectQuestions.filter((row) => row.kind === "descriptive").length;
    const theoryCount = subjectTheories.length;
    const subjectHasQuestions = contentKinds.has("question")
      && questionSubjectNames.has(subject.name);
    const requiredObjectiveQuestionCount = subjectHasQuestions
      ? Number(course.examPolicy?.objectiveCounts[subject.name] ?? 0)
      : 0;
    if (subjectHasQuestions && objectiveQuestionCount < requiredObjectiveQuestionCount) {
      blockers.push(
        `OBJECTIVE_SHORTAGE:${subject.id}:${objectiveQuestionCount}/${requiredObjectiveQuestionCount}`,
      );
    }
    if (contentKinds.has("theory") && theoryCount < 1) blockers.push(`THEORY_MISSING:${subject.id}`);
    if (subjectHasQuestions && theoryCount > 0 && linkedQuestions.length < 1) {
      blockers.push(`THEORY_PRACTICE_LINK_MISSING:${subject.id}`);
    }
    if (
      subjectHasQuestions
      && course.descriptiveSubjects.includes(subject.name)
      && descriptiveQuestionCount < 1
    ) blockers.push(`DESCRIPTIVE_SUBJECT_MISSING:${subject.id}`);
    return {
      descriptiveQuestionCount,
      linkedQuestionCount: linkedQuestions.length,
      linkedTheoryCount: linkedTheoryIds.size,
      objectiveQuestionCount,
      requiredObjectiveQuestionCount,
      subjectId: subject.id,
      subjectName: subject.name,
      theoryCount,
    };
  });
  const descriptiveQuestionCount = activeQuestions
    .filter((row) => row.kind === "descriptive").length;
  if (contentKinds.has("mock-exam") && !course.examPolicy) blockers.push("EXAM_POLICY_MISSING");
  if (contentKinds.has("question") && course.examPolicy && descriptiveQuestionCount < course.examPolicy.descriptiveCount) {
    blockers.push(
      `DESCRIPTIVE_TOTAL_SHORTAGE:${descriptiveQuestionCount}/${course.examPolicy.descriptiveCount}`,
    );
  }
  return { blockers, subjectCoverage };
}

export function buildCourseReleaseCatalog(
  manifest,
  { questions, theories },
  courseDefinitions = COURSE_DEFINITIONS,
) {
  if (
    manifest.questionCount !== questions.length
    || manifest.theoryCount !== theories.length
    || manifest.questionSha256 !== canonicalRowsSha256(questions)
    || manifest.theorySha256 !== canonicalRowsSha256(theories)
  ) {
    throw new Error("content manifest does not match the rows used for course releases");
  }

  const courses = courseDefinitions.map((course) => {
    const courseQuestions = questions.filter((row) => appliesToCourse(row, course));
    const courseTheories = theories.filter((row) => appliesToCourse(row, course));
    const activeQuestions = courseQuestions.filter((row) => Number(row.active) === 1);
    const activeTheories = courseTheories.filter((row) => Number(row.active) === 1);
    const readiness = courseReleaseBlockers(course, courseQuestions, courseTheories);
    const blockers = [...readiness.blockers];
    if (course.releaseStage === "intake") blockers.push("RELEASE_APPROVAL_PENDING");
    return {
      acceptedContentScopes: [...course.acceptedContentScopes],
      contentKinds: [...(course.contentKinds ?? ["theory", "question", "mock-exam"])],
      activeQuestionCount: activeQuestions.length,
      activeTheoryCount: activeTheories.length,
      blockers,
      courseId: course.courseId,
      descriptiveQuestionCount: activeQuestions
        .filter((row) => row.kind === "descriptive").length,
      examType: course.examType,
      fieldId: course.fieldId,
      objectiveQuestionCount: activeQuestions
        .filter((row) => row.kind !== "descriptive").length,
      policyVersion: course.examPolicy?.policyVersion ?? "pending",
      questionCount: courseQuestions.length,
      questionSha256: canonicalRowsSha256(courseQuestions),
      releaseStage: course.releaseStage ?? "released",
      releasedSubjectIds: (course.releasedSubjects ?? course.subjects).map((subject) => subject.id),
      questionSubjectIds: (course.questionSubjects ?? []).map((subject) => subject.id),
      status: blockers.length === 0 ? "released" : "blocked",
      subjectCoverage: readiness.subjectCoverage,
      theoryCount: courseTheories.length,
      theorySha256: canonicalRowsSha256(courseTheories),
    };
  });

  const uncoveredQuestionIds = questions
    .filter((row) => !courseDefinitions.some((course) => appliesToCourse(row, course)))
    .map((row) => row.id);
  const uncoveredTheoryIds = theories
    .filter((row) => !courseDefinitions.some((course) => appliesToCourse(row, course)))
    .map((row) => row.id);
  if (uncoveredQuestionIds.length || uncoveredTheoryIds.length) {
    throw new Error(
      `canonical content is outside every registered course: questions=${uncoveredQuestionIds.length}, theories=${uncoveredTheoryIds.length}`,
    );
  }

  return {
    contentReleaseVersion: manifest.version,
    contentSchemaVersion: manifest.schemaVersion,
    contentSourceSha256: manifest.sourceSha256,
    courses,
    schemaVersion: COURSE_RELEASE_CATALOG_SCHEMA_VERSION,
  };
}

export function validateCourseReleaseCatalog(
  catalog,
  manifest,
  content,
  courseDefinitions = COURSE_DEFINITIONS,
) {
  const expected = buildCourseReleaseCatalog(manifest, content, courseDefinitions);
  if (stableJson(catalog) !== stableJson(expected)) {
    throw new Error("course release catalog does not match canonical course content");
  }
  return expected;
}

function releaseCreatedAt(version) {
  const match = version.match(/(20\d{2})[.-](\d{2})[.-](\d{2})/u);
  if (!match) throw new Error("release version must include a YYYY.MM.DD or YYYY-MM-DD date");
  return `${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`;
}

export function createCanonicalDatabase(root) {
  return openCanonicalDatabase(root);
}

function questionColumnsForSchema(schemaVersion) {
  if (schemaVersion === LEGACY_CONTENT_SCHEMA_VERSION) return LEGACY_QUESTION_COLUMNS;
  if (schemaVersion === CONTENT_SCHEMA_VERSION) return QUESTION_COLUMNS;
  throw new Error(`unsupported content schema: ${schemaVersion}`);
}

export function readCanonicalContent(database, schemaVersion = CONTENT_SCHEMA_VERSION) {
  const questionColumns = questionColumnsForSchema(schemaVersion);
  const questions = database.prepare(`
    SELECT ${questionColumns.join(", ")}
    FROM questions
    ORDER BY display_order, id
  `).all();
  const theories = database.prepare(`
    SELECT ${THEORY_COLUMNS.join(", ")}
    FROM theories
    ORDER BY category, sort_order, id
  `).all();
  return { questions, theories };
}

function writeNdjson(file, rows) {
  const serialized = `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
  fs.writeFileSync(file, serialized, "utf8");
  return { bytes: Buffer.byteLength(serialized), sha256: sha256(serialized) };
}

export function contentSourceChecksum(schemaVersion, questionSha256, theorySha256) {
  return sha256([
    "baeumzip-content-release",
    schemaVersion,
    questionSha256,
    theorySha256,
  ].join("\0"));
}

function restoreExactHistoricalManifest(version, outputDirectory, draftManifest, courseReleaseText) {
  if (path.basename(version) !== version) return null;
  const packaged = path.resolve(
    import.meta.dirname,
    "../../apps/backend/resources/content/releases",
    version,
  );
  const packagedManifestPath = path.join(packaged, "manifest.json");
  const packagedCatalogPath = path.join(packaged, "course-releases.json");
  if (!fs.existsSync(packagedManifestPath) || !fs.existsSync(packagedCatalogPath)) return null;
  const historicalText = fs.readFileSync(packagedManifestPath, "utf8");
  if (!isPinnedHistoricalManifest(version, historicalText)
    || fs.readFileSync(packagedCatalogPath, "utf8") !== courseReleaseText) return null;
  const historical = JSON.parse(historicalText);
  if (historical.questionArtifactSha256 !== draftManifest.questionArtifactSha256
    || historical.theoryArtifactSha256 !== draftManifest.theoryArtifactSha256
    || historical.questionSha256 !== draftManifest.questionSha256
    || historical.theorySha256 !== draftManifest.theorySha256
    || historical.sourceSha256 !== draftManifest.sourceSha256) return null;
  fs.writeFileSync(path.join(outputDirectory, "manifest.json"), historicalText);
  return historical;
}

export function createContentReleaseFromDatabase(
  database,
  outputDirectory,
  version = DEFAULT_RELEASE_VERSION,
) {
  fs.mkdirSync(outputDirectory, { recursive: true });
  const { questions, theories } = readCanonicalContent(database);
  const questionArtifact = writeNdjson(path.join(outputDirectory, "questions.ndjson"), questions);
  const theoryArtifact = writeNdjson(path.join(outputDirectory, "theories.ndjson"), theories);
  const questionSha256 = canonicalRowsSha256(questions);
  const theorySha256 = canonicalRowsSha256(theories);
  let manifest = {
    createdAt: releaseCreatedAt(version),
    licenseReview: "pending",
    questionArtifactSha256: questionArtifact.sha256,
    questionCount: questions.length,
    questionSha256,
    schemaVersion: CONTENT_SCHEMA_VERSION,
    sourceReview: "pending",
    sourceSha256: contentSourceChecksum(
      CONTENT_SCHEMA_VERSION,
      questionSha256,
      theorySha256,
    ),
    theoryArtifactSha256: theoryArtifact.sha256,
    theoryCount: theories.length,
    theorySha256,
    version,
  };
  const courseReleaseCatalog = buildCourseReleaseCatalog(manifest, { questions, theories });
  const courseReleaseText = stableJson(courseReleaseCatalog);
  manifest.courseReleaseCatalogSchemaVersion = COURSE_RELEASE_CATALOG_SCHEMA_VERSION;
  manifest.courseReleaseCatalogSha256 = sha256(courseReleaseText);
  manifest.releaseContractVersion = CONTENT_RELEASE_CONTRACT_VERSION;
  fs.writeFileSync(path.join(outputDirectory, "manifest.json"), stableJson(manifest), "utf8");
  fs.writeFileSync(
    path.join(outputDirectory, "course-releases.json"),
    courseReleaseText,
    "utf8",
  );
  // Reuse approval only when every generated content/catalog byte matches a
  // manifest already pinned in the repository. New or changed content stays pending.
  manifest = restoreExactHistoricalManifest(version, outputDirectory, manifest, courseReleaseText) ?? manifest;
  return {
    courseReleaseCatalog,
    manifest,
    outputDirectory,
    questionBytes: questionArtifact.bytes,
    theoryBytes: theoryArtifact.bytes,
  };
}

export function createContentRelease(root, outputDirectory, version = DEFAULT_RELEASE_VERSION) {
  const database = createCanonicalDatabase(root);
  try {
    return createContentReleaseFromDatabase(database, outputDirectory, version);
  } finally {
    database.close();
  }
}

function readUtf8(file) {
  const bytes = fs.readFileSync(file);
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function readNdjson(file) {
  const content = readUtf8(file);
  if (!content.endsWith("\n")) throw new Error(`${path.basename(file)} must end with LF`);
  const lines = content.split("\n").filter(Boolean);
  return { content, rows: lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`${path.basename(file)}:${index + 1} is not valid JSON: ${error.message}`);
    }
  }) };
}

function parsedArray(row, field, errors, label) {
  try {
    const value = JSON.parse(row[field]);
    if (!Array.isArray(value)) errors.push(`${label}.${field} must be a JSON array`);
    return Array.isArray(value) ? value : [];
  } catch {
    errors.push(`${label}.${field} is invalid JSON`);
    return [];
  }
}

function balancedFences(value) {
  return (String(value ?? "").match(/```/gu) ?? []).length % 2 === 0;
}

function validateRows(questions, theories, questionColumns) {
  const errors = [];
  const questionIds = new Set();
  const theoryIds = new Set();
  for (const theory of theories) {
    const label = `theory:${theory.id}`;
    if (!Number.isInteger(theory.id) || theoryIds.has(theory.id)) errors.push(`${label} has an invalid or duplicate ID`);
    theoryIds.add(theory.id);
    for (const field of THEORY_COLUMNS) if (!(field in theory)) errors.push(`${label}.${field} is missing`);
    for (const field of JSON_THEORY_FIELDS) parsedArray(theory, field, errors, label);
    if (![0, 1].includes(Number(theory.active))) errors.push(`${label}.active must be 0 or 1`);
    if (!REGISTERED_CONTENT_SCOPES.includes(theory.exam_scope)) errors.push(`${label}.exam_scope is invalid`);
    if (!contentScopeAllowsRegisteredSubject(theory.exam_scope, theory.category)) {
      errors.push(`${label} has an invalid exam_scope/category pair`);
    }
    if (!balancedFences(theory.content) || !balancedFences(theory.review_answers)) {
      errors.push(`${label} has unbalanced Markdown fences`);
    }
    for (const key of Object.keys(theory)) if (FORBIDDEN_FIELDS.has(key)) errors.push(`${label}.${key} is forbidden`);
  }
  for (const question of questions) {
    const label = `question:${question.id}`;
    if (!Number.isInteger(question.id) || questionIds.has(question.id)) errors.push(`${label} has an invalid or duplicate ID`);
    questionIds.add(question.id);
    for (const field of questionColumns) if (!(field in question)) errors.push(`${label}.${field} is missing`);
    const parsed = Object.fromEntries(JSON_QUESTION_FIELDS.map((field) => [field, parsedArray(question, field, errors, label)]));
    if (!["single", "multiple", "descriptive"].includes(question.kind)) errors.push(`${label}.kind is invalid`);
    if (!REGISTERED_CONTENT_SCOPES.includes(question.exam_scope)) errors.push(`${label}.exam_scope is invalid`);
    if (!contentScopeAllowsRegisteredSubject(question.exam_scope, question.category)) {
      errors.push(`${label} has an invalid exam_scope/category pair`);
    }
    if (!["general", "theory_only"].includes(question.practice_scope)) errors.push(`${label}.practice_scope is invalid`);
    if (![0, 1].includes(Number(question.active))) errors.push(`${label}.active must be 0 or 1`);
    if (question.theory_id != null && !theoryIds.has(question.theory_id)) errors.push(`${label}.theory_id does not exist`);
    if (question.kind !== "descriptive") {
      if (![2, 4].includes(parsed.choices.length)) errors.push(`${label}.choices must contain two or four values`);
      if (parsed.correct_answers.length === 0 || parsed.correct_answers.some((answer) => (
        !Number.isInteger(answer) || answer < 0 || answer >= parsed.choices.length
      ))) errors.push(`${label}.correct_answers is out of range`);
    }
    if (!balancedFences(question.prompt) || !balancedFences(question.explanation)) {
      errors.push(`${label} has unbalanced Markdown fences`);
    }
    for (const key of Object.keys(question)) if (FORBIDDEN_FIELDS.has(key)) errors.push(`${label}.${key} is forbidden`);
  }
  return errors;
}

function validateTheoryRemovalContract(manifest, theories) {
  const removedTheoryIds = manifest.removedTheoryIds ?? [];
  const theoryIdRemap = manifest.theoryIdRemap ?? [];
  if (!Array.isArray(removedTheoryIds) || !Array.isArray(theoryIdRemap)) {
    return ["theory removal contract must use arrays"];
  }
  if (removedTheoryIds.length === 0 && theoryIdRemap.length === 0) return [];
  const errors = [];
  const existingIds = new Set(theories.map((row) => Number(row.id)));
  const removedIds = new Set();
  const mappedIds = new Set();
  for (const id of removedTheoryIds) {
    if (!Number.isInteger(id) || removedIds.has(id)) errors.push("removedTheoryIds contains an invalid or duplicate ID");
    removedIds.add(id);
    if (existingIds.has(id)) errors.push(`removed theory ${id} is still present in the release`);
  }
  for (const mapping of theoryIdRemap) {
    const sourceId = Number(mapping?.sourceId);
    const canonicalId = Number(mapping?.canonicalId);
    if (!Number.isInteger(sourceId) || !Number.isInteger(canonicalId) || mappedIds.has(sourceId)) {
      errors.push("theoryIdRemap contains an invalid or duplicate source ID");
      continue;
    }
    mappedIds.add(sourceId);
    if (!removedIds.has(sourceId)) errors.push(`theory remap source ${sourceId} is not removed`);
    if (!existingIds.has(canonicalId)) errors.push(`theory remap target ${canonicalId} is absent from the release`);
  }
  if (removedIds.size !== mappedIds.size) errors.push("every removed theory must have one canonical remap target");
  return errors;
}

export function loadAndValidateRelease(releaseDirectory, options = {}) {
  const manifestText = readUtf8(path.join(releaseDirectory, "manifest.json"));
  const manifest = JSON.parse(manifestText);
  if (manifestText !== stableJson(manifest)) throw new Error("manifest.json is not canonical sorted JSON with LF");
  const required = [
    "version", "schemaVersion", "createdAt", "questionCount", "theoryCount",
    "questionSha256", "theorySha256", "sourceSha256", "sourceReview", "licenseReview",
  ];
  for (const field of required) if (manifest[field] == null || manifest[field] === "") throw new Error(`manifest.${field} is required`);
  const releaseContractVersion = manifest.releaseContractVersion ?? 1;
  if (![1, 2, CONTENT_RELEASE_CONTRACT_VERSION].includes(releaseContractVersion)) {
    throw new Error(`unsupported content release contract: ${releaseContractVersion}`);
  }
  if (releaseContractVersion >= 2) {
    for (const field of ["courseReleaseCatalogSchemaVersion", "courseReleaseCatalogSha256"]) {
      if (manifest[field] == null || manifest[field] === "") {
        throw new Error(`manifest.${field} is required`);
      }
    }
    if (manifest.courseReleaseCatalogSchemaVersion !== COURSE_RELEASE_CATALOG_SCHEMA_VERSION) {
      throw new Error("unsupported course release catalog schema");
    }
  }
  const questionColumns = questionColumnsForSchema(manifest.schemaVersion);

  const questionArtifact = readNdjson(path.join(releaseDirectory, "questions.ndjson"));
  const theoryArtifact = readNdjson(path.join(releaseDirectory, "theories.ndjson"));
  const failures = [];
  if (questionArtifact.rows.length !== manifest.questionCount) failures.push("question count mismatch");
  if (theoryArtifact.rows.length !== manifest.theoryCount) failures.push("theory count mismatch");
  if (sha256(questionArtifact.content) !== manifest.questionArtifactSha256) failures.push("question artifact checksum mismatch");
  if (sha256(theoryArtifact.content) !== manifest.theoryArtifactSha256) failures.push("theory artifact checksum mismatch");
  if (canonicalRowsSha256(questionArtifact.rows) !== manifest.questionSha256) failures.push("question canonical checksum mismatch");
  if (canonicalRowsSha256(theoryArtifact.rows) !== manifest.theorySha256) failures.push("theory canonical checksum mismatch");
  if (
    manifest.schemaVersion === CONTENT_SCHEMA_VERSION
    && manifest.sourceSha256 !== contentSourceChecksum(
      manifest.schemaVersion,
      manifest.questionSha256,
      manifest.theorySha256,
    )
  ) failures.push("content source checksum mismatch");
  failures.push(...validateRows(questionArtifact.rows, theoryArtifact.rows, questionColumns));
  failures.push(...validateTheoryRemovalContract(manifest, theoryArtifact.rows));
  try {
    validateReplacementCourseScope(
      manifest.replacementCourseScope ?? null,
      questionArtifact.rows,
      theoryArtifact.rows,
    );
    if (manifest.replacementCourseScope && manifest.replacementScope) {
      failures.push("course-wide and single-subject replacement metadata cannot be combined");
    }
  } catch (error) {
    failures.push(error.message);
  }
  const courseReleaseFile = path.join(releaseDirectory, "course-releases.json");
  let courseReleaseCatalog = null;
  if (fs.existsSync(courseReleaseFile)) {
    const courseReleaseText = readUtf8(courseReleaseFile);
    if (
      releaseContractVersion >= 2
      && sha256(courseReleaseText) !== manifest.courseReleaseCatalogSha256
    ) failures.push("course release catalog checksum mismatch");
    courseReleaseCatalog = JSON.parse(courseReleaseText);
    if (courseReleaseText !== stableJson(courseReleaseCatalog)) {
      failures.push("course-releases.json is not canonical sorted JSON with LF");
    } else if (!options.allowHistoricalCourseContract) {
      try {
        validateCourseReleaseCatalog(
          courseReleaseCatalog,
          manifest,
          { questions: questionArtifact.rows, theories: theoryArtifact.rows },
        );
      } catch (error) {
        failures.push(error.message);
      }
    }
  } else if (releaseContractVersion >= 2) {
    failures.push("course-releases.json is required by the release contract");
  }
  if (failures.length > 0) throw new Error(`content release validation failed:\n- ${failures.join("\n- ")}`);
  assertContentReview(releaseDirectory, manifest, manifestText, options);
  return {
    courseReleaseCatalog,
    manifest,
    questions: questionArtifact.rows,
    theories: theoryArtifact.rows,
  };
}

// Structural/editorial inspection only. Import and promotion use loadAndValidateRelease.
export function inspectContentRelease(releaseDirectory, options = {}) {
  return loadAndValidateRelease(releaseDirectory, { ...options, allowPendingReview: true });
}

function upsertRows(database, table, rows) {
  if (rows.length === 0) return;
  const columns = Object.keys(rows[0]);
  const updates = columns.filter((column) => column !== "id")
    .map((column) => `${column} = excluded.${column}`).join(", ");
  const statement = database.prepare(
    `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")}) `
      + `ON CONFLICT(id) DO UPDATE SET ${updates}`,
  );
  for (const row of rows) statement.run(...columns.map((column) => row[column]));
}

function validateReplacementCourseScope(scope, questions, theories) {
  if (scope == null) return null;
  const valid = (
    typeof scope === "object"
    && typeof scope.questionExamScope === "string"
    && scope.questionExamScope.trim().length > 0
    && Array.isArray(scope.theoryExamScopes)
    && scope.theoryExamScopes.length > 0
    && new Set(scope.theoryExamScopes).size === scope.theoryExamScopes.length
    && scope.theoryExamScopes.every((value) => typeof value === "string" && value.trim().length > 0)
    && Array.isArray(scope.categories)
    && scope.categories.length > 0
    && new Set(scope.categories).size === scope.categories.length
    && scope.categories.every((value) => typeof value === "string" && value.trim().length > 0)
  );
  if (!valid) throw new Error("content release course replacement metadata is invalid");
  const categories = new Set(scope.categories);
  const theoryScopes = new Set(scope.theoryExamScopes);
  if (!questions.some((row) => row.exam_scope === scope.questionExamScope && categories.has(row.category))) {
    throw new Error("content release course replacement has no incoming questions");
  }
  if (!theories.some((row) => theoryScopes.has(row.exam_scope) && categories.has(row.category))) {
    throw new Error("content release course replacement has no incoming theories");
  }
  if (questions.some((row) => row.exam_scope === scope.questionExamScope && !categories.has(row.category))) {
    throw new Error("content release course replacement leaves a question outside its approved categories");
  }
  if (theories.some((row) => theoryScopes.has(row.exam_scope) && !categories.has(row.category))) {
    throw new Error("content release course replacement leaves a theory outside its approved categories");
  }
  return scope;
}

export function importContentRelease(database, releaseDirectory, options = {}) {
  const release = loadAndValidateRelease(releaseDirectory, {
    allowHistoricalCourseContract: options.allowHistoricalCourseContract === true,
  });
  const removedQuestionIds = release.manifest.removedQuestionIds ?? [];
  const replacementScope = release.manifest.replacementScope ?? null;
  const replacementCourseScope = validateReplacementCourseScope(
    release.manifest.replacementCourseScope ?? null,
    release.questions,
    release.theories,
  );
  if (
    !Array.isArray(removedQuestionIds)
    || new Set(removedQuestionIds).size !== removedQuestionIds.length
    || removedQuestionIds.some((id) => !Number.isInteger(id))
    || (removedQuestionIds.length > 0 && (
      !replacementScope
      || typeof replacementScope.category !== "string"
      || typeof replacementScope.examScope !== "string"
    ))
  ) throw new Error("content release question replacement metadata is invalid");
  const releasedQuestionIds = new Set(release.questions.map(({ id }) => Number(id)));
  if (removedQuestionIds.some((id) => releasedQuestionIds.has(id))) {
    throw new Error("removed question IDs cannot remain in the content release");
  }
  const existingCount = Number(database.prepare("SELECT COUNT(*) AS count FROM questions").get().count);
  if (existingCount > 0 && options.confirmVersion !== release.manifest.version) {
    throw new Error(`existing content requires --confirm-version ${release.manifest.version}`);
  }
  const timestamp = new Date().toISOString();
  database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare(`
      INSERT INTO content_releases (
        version, schema_version, source_checksum, question_checksum, theory_checksum,
        expected_question_count, imported_question_count, expected_theory_count,
        imported_theory_count, status, created_at, activated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, 0, 'importing', ?, NULL)
      ON CONFLICT(version) DO UPDATE SET
        schema_version = excluded.schema_version,
        source_checksum = excluded.source_checksum,
        question_checksum = excluded.question_checksum,
        theory_checksum = excluded.theory_checksum,
        expected_question_count = excluded.expected_question_count,
        expected_theory_count = excluded.expected_theory_count,
        status = 'importing',
        activated_at = NULL
    `).run(
      release.manifest.version,
      release.manifest.schemaVersion,
      release.manifest.sourceSha256,
      release.manifest.questionSha256,
      release.manifest.theorySha256,
      release.manifest.questionCount,
      release.manifest.theoryCount,
      timestamp,
    );
    if (replacementScope) {
      database.prepare(`
        DELETE FROM exam_sessions
        WHERE EXISTS (
          SELECT 1 FROM exam_session_items item
          INNER JOIN questions question ON question.id = item.question_id
          WHERE item.session_id = exam_sessions.id
            AND question.category = ? AND question.exam_scope = ?
        )
      `).run(replacementScope.category, replacementScope.examScope);
    }
    if (replacementCourseScope) {
      database.prepare("DELETE FROM exam_sessions WHERE exam_type = ?")
        .run(replacementCourseScope.questionExamScope);
      database.prepare("DELETE FROM questions WHERE exam_scope = ?")
        .run(replacementCourseScope.questionExamScope);
      database.prepare(`
        DELETE FROM theories
        WHERE exam_scope IN (SELECT CAST(value AS TEXT) FROM json_each(?))
          AND category IN (SELECT CAST(value AS TEXT) FROM json_each(?))
      `).run(
        JSON.stringify(replacementCourseScope.theoryExamScopes),
        JSON.stringify(replacementCourseScope.categories),
      );
    }
    if (removedQuestionIds.length > 0) {
      database.prepare(`
        DELETE FROM questions
        WHERE id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
      `).run(JSON.stringify(removedQuestionIds));
    }
    upsertRows(database, "theories", release.theories);
    upsertRows(database, "questions", release.questions);
    const theoryIdRemap = release.manifest.theoryIdRemap ?? [];
    const removedTheoryIds = release.manifest.removedTheoryIds ?? [];
    if (theoryIdRemap.length > 0) {
      const serializedRemap = JSON.stringify(theoryIdRemap);
      database.prepare(`
        UPDATE questions
        SET theory_id = (
          SELECT CAST(json_extract(mapping.value, '$.canonicalId') AS INTEGER)
          FROM json_each(?) mapping
          WHERE CAST(json_extract(mapping.value, '$.sourceId') AS INTEGER) = questions.theory_id
        )
        WHERE theory_id IN (
          SELECT CAST(json_extract(mapping.value, '$.sourceId') AS INTEGER)
          FROM json_each(?) mapping
        )
      `).run(serializedRemap, serializedRemap);
    }
    if (removedTheoryIds.length > 0) {
      database.prepare(`
        DELETE FROM theories
        WHERE id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
      `).run(JSON.stringify(removedTheoryIds));
    }
    const status = options.activate ? "active" : "verified";
    if (options.activate) database.prepare("UPDATE content_releases SET status = 'verified', activated_at = NULL WHERE status = 'active'").run();
    database.prepare(`
      UPDATE content_releases SET imported_question_count = ?, imported_theory_count = ?,
        status = ?, activated_at = ? WHERE version = ?
    `).run(
      release.questions.length,
      release.theories.length,
      status,
      options.activate ? timestamp : null,
      release.manifest.version,
    );
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return verifyDatabaseRelease(database, release);
}

export function verifyDatabaseRelease(database, releaseOrDirectory) {
  const release = typeof releaseOrDirectory === "string"
    ? loadAndValidateRelease(releaseOrDirectory)
    : releaseOrDirectory;
  const actual = readCanonicalContent(database, release.manifest.schemaVersion);
  const result = {
    questionCount: actual.questions.length,
    questionSha256: canonicalRowsSha256(actual.questions),
    theoryCount: actual.theories.length,
    theorySha256: canonicalRowsSha256(actual.theories),
  };
  if (
    result.questionCount !== release.manifest.questionCount
    || result.theoryCount !== release.manifest.theoryCount
    || result.questionSha256 !== release.manifest.questionSha256
    || result.theorySha256 !== release.manifest.theorySha256
  ) throw new Error(`database content does not match release ${release.manifest.version}`);
  return result;
}

export function createSchemaSnapshot(sourceDatabase) {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  const objects = sourceDatabase.prepare(`
    SELECT type, name, sql FROM sqlite_master
    WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'trigger' THEN 2 ELSE 3 END, name
  `).all();
  for (const object of objects) database.exec(object.sql);
  for (const table of ["course_content_scopes", "course_subjects"]) {
    const columns = sourceDatabase.prepare(`PRAGMA table_info(${table})`).all()
      .map((column) => column.name);
    if (!columns.length) continue;
    const rows = sourceDatabase.prepare(`SELECT ${columns.join(", ")} FROM ${table}`).all();
    if (!rows.length) continue;
    const insert = database.prepare(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
    );
    for (const row of rows) insert.run(...columns.map((column) => row[column]));
  }
  return database;
}

export function freshInstallFromRelease(root, releaseDirectory) {
  const release = loadAndValidateRelease(releaseDirectory);
  const upgrade = createCanonicalDatabase(root);
  const migrationBaseline = readCanonicalContent(upgrade);
  const fresh = createSchemaSnapshot(upgrade);
  try {
    const imported = importContentRelease(fresh, releaseDirectory, { activate: true });
    importContentRelease(upgrade, releaseDirectory, {
      activate: true,
      confirmVersion: release.manifest.version,
    });
    const freshContent = readCanonicalContent(fresh);
    const upgradedContent = readCanonicalContent(upgrade);
    if (JSON.stringify(upgradedContent) !== JSON.stringify(freshContent)) {
      throw new Error("fresh release install differs from the production-upgrade result");
    }
    const sampleIds = fresh.prepare(`
      SELECT id FROM questions WHERE active = 1 ORDER BY display_order, id LIMIT 5
    `).all().map((row) => row.id);
    const placeholders = sampleIds.map(() => "?").join(",");
    const apiQueryCount = fresh.prepare(`SELECT id, prompt FROM questions WHERE id IN (${placeholders})`).all(...sampleIds).length;
    const brokenTheoryLinks = Number(fresh.prepare(`
      SELECT COUNT(*) AS count FROM questions q
      LEFT JOIN theories t ON t.id = q.theory_id
      WHERE q.theory_id IS NOT NULL AND t.id IS NULL
    `).get().count);
    if (apiQueryCount !== sampleIds.length || brokenTheoryLinks !== 0) throw new Error("fresh install API query or theory reference verification failed");
    return {
      ...imported,
      activeVersion: release.manifest.version,
      apiQueryCount,
      brokenTheoryLinks,
      migrationBaselineMatches: JSON.stringify(migrationBaseline) === JSON.stringify(freshContent),
      upgradeParity: true,
    };
  } finally {
    upgrade.close();
    fresh.close();
  }
}

export function verifyFailedImportRollback(root, releaseDirectory) {
  const release = loadAndValidateRelease(releaseDirectory);
  const database = createCanonicalDatabase(root);
  const activeRelease = () => database.prepare(`
    SELECT version, status, source_checksum, question_checksum, theory_checksum, activated_at
    FROM content_releases WHERE status = 'active'
    ORDER BY activated_at DESC, created_at DESC, version DESC LIMIT 1
  `).get() ?? null;
  try {
    const before = {
      activeRelease: activeRelease(),
      content: readCanonicalContent(database),
    };
    const firstQuestionId = release.questions[0]?.id;
    if (!Number.isInteger(firstQuestionId)) throw new Error("rollback drill requires a question row");
    database.exec(`
      CREATE TEMP TRIGGER stage9_force_content_import_failure
      BEFORE UPDATE ON questions
      WHEN NEW.id = ${firstQuestionId}
      BEGIN
        SELECT RAISE(ABORT, 'stage9 forced content import failure');
      END;
    `);
    let failure;
    try {
      importContentRelease(database, releaseDirectory, {
        activate: true,
        confirmVersion: release.manifest.version,
      });
    } catch (error) {
      failure = error;
    }
    if (!failure || !String(failure.message).includes("stage9 forced content import failure")) {
      throw new Error("rollback drill did not reach the forced transactional failure");
    }
    database.exec("DROP TRIGGER stage9_force_content_import_failure");
    const after = {
      activeRelease: activeRelease(),
      content: readCanonicalContent(database),
    };
    if (JSON.stringify(after) !== JSON.stringify(before)) {
      throw new Error("failed content import changed the active release or canonical rows");
    }
    return {
      activeVersion: after.activeRelease?.version ?? null,
      activeVersionPreserved: true,
      questionCount: after.content.questions.length,
      theoryCount: after.content.theories.length,
      transactionRolledBack: true,
    };
  } finally {
    database.close();
  }
}
