import assert from "node:assert/strict";

function nonEmptyString(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert.ok(value.trim(), `${label} must not be empty`);
  return value;
}

function uniqueValues(values, label) {
  assert.equal(new Set(values).size, values.length, `${label} must be unique`);
}

function finiteNonNegative(value, label) {
  assert.equal(typeof value, "number", `${label} must be a number`);
  assert.ok(Number.isFinite(value) && value >= 0, `${label} must be non-negative`);
  return value;
}

function sqlText(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function typescriptLiteral(value, depth = 0) {
  const indent = "  ".repeat(depth);
  const nestedIndent = "  ".repeat(depth + 1);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null) return "null";
  if (Array.isArray(value)) {
    if (value.length === 0) return "readonly []";
    return `readonly [\n${value.map((item) => `${nestedIndent}${typescriptLiteral(item, depth + 1)},`).join("\n")}\n${indent}]`;
  }
  const entries = Object.entries(value);
  if (entries.length === 0) return "Readonly<Record<string, never>>";
  return `Readonly<{\n${entries.map(([key, item]) => `${nestedIndent}readonly ${JSON.stringify(key)}: ${typescriptLiteral(item, depth + 1)};`).join("\n")}\n${indent}}>`;
}

export function validateCourseRegistrySource(source) {
  assert.equal(source?.schemaVersion, 3, "course registry schemaVersion must be 3");
  assert.ok(Array.isArray(source.fields) && source.fields.length > 0, "fields are required");
  assert.ok(Array.isArray(source.subjects) && source.subjects.length > 0, "subjects are required");
  assert.ok(Array.isArray(source.contentScopes) && source.contentScopes.length > 0, "contentScopes are required");
  assert.ok(Array.isArray(source.courses) && source.courses.length > 0, "courses are required");

  const subjectIds = source.subjects.map((subject, index) => nonEmptyString(subject.id, `subjects[${index}].id`));
  const subjectNames = source.subjects.map((subject, index) => nonEmptyString(subject.name, `subjects[${index}].name`));
  uniqueValues(subjectIds, "subject ids");
  uniqueValues(subjectNames, "subject names");
  const subjectIdentifiers = new Set();
  for (const [subjectIndex, subject] of source.subjects.entries()) {
    assert.match(subject.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/u, `subjects[${subjectIndex}].id must be a stable kebab-case key`);
    assert.ok(Array.isArray(subject.aliases), `subjects[${subjectIndex}].aliases must be an array`);
    uniqueValues(subject.aliases, `subjects[${subjectIndex}].aliases`);
    for (const identifier of [subject.id, subject.name, ...subject.aliases]) {
      const normalized = nonEmptyString(identifier, `subjects[${subjectIndex}] identifier`).trim().toLocaleLowerCase("ko-KR");
      assert.ok(!subjectIdentifiers.has(normalized), `subject identifier ${identifier} is duplicated`);
      subjectIdentifiers.add(normalized);
    }
  }
  const subjectById = new Map(source.subjects.map((subject) => [subject.id, subject]));

  const fieldIds = source.fields.map((field, index) => nonEmptyString(field.id, `fields[${index}].id`));
  uniqueValues(fieldIds, "field ids");
  for (const [fieldIndex, field] of source.fields.entries()) {
    const label = `fields[${fieldIndex}]`;
    assert.match(field.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/u, `${label}.id must be a stable kebab-case key`);
    assert.equal(field.engineId, "certification", `${label}.engineId must be certification`);
    for (const key of ["name", "shortLabel", "cardTitle", "summary"]) {
      nonEmptyString(field[key], `${label}.${key}`);
    }
    assert.equal(field.status, "available", `${label}.status must be available`);
    if (field.brandSubtitleLines !== undefined) {
      assert.ok(Array.isArray(field.brandSubtitleLines) && field.brandSubtitleLines.length === 2, `${label}.brandSubtitleLines must contain two lines`);
      field.brandSubtitleLines.forEach((line, index) => nonEmptyString(line, `${label}.brandSubtitleLines[${index}]`));
    }
  }
  const fieldIdSet = new Set(fieldIds);

  const examTypes = source.courses.map((course, index) => nonEmptyString(course.examType, `courses[${index}].examType`));
  const courseIds = source.courses.map((course, index) => nonEmptyString(course.courseId, `courses[${index}].courseId`));
  uniqueValues(examTypes, "exam types");
  uniqueValues(courseIds, "course ids");
  assert.ok(examTypes.includes(source.defaultExamType), "defaultExamType must reference a course");
  const examTypeSet = new Set(examTypes);

  const scopeIds = source.contentScopes.map((scope, index) => nonEmptyString(scope.id, `contentScopes[${index}].id`));
  uniqueValues(scopeIds, "content scope ids");
  const normalizedAliases = [];
  for (const [scopeIndex, scope] of source.contentScopes.entries()) {
    assert.ok(Array.isArray(scope.courseExamTypes) && scope.courseExamTypes.length > 0, `contentScopes[${scopeIndex}] must reference courses`);
    uniqueValues(scope.courseExamTypes, `contentScopes[${scopeIndex}].courseExamTypes`);
    for (const examType of scope.courseExamTypes) {
      assert.ok(examTypeSet.has(examType), `content scope ${scope.id} references unknown course ${examType}`);
    }
    assert.ok(Array.isArray(scope.aliases), `contentScopes[${scopeIndex}].aliases must be an array`);
    for (const alias of [scope.id, ...scope.aliases]) {
      const normalized = nonEmptyString(alias, `contentScopes[${scopeIndex}] alias`).toUpperCase();
      assert.ok(!normalizedAliases.includes(normalized), `content scope alias ${alias} is duplicated`);
      normalizedAliases.push(normalized);
    }
  }

  for (const [courseIndex, course] of source.courses.entries()) {
    const label = `courses[${courseIndex}]`;
    for (const key of ["fieldId", "name", "summary", "studyMode", "mockExam"]) {
      nonEmptyString(course[key], `${label}.${key}`);
    }
    assert.ok(
      course.releaseStage === undefined || ["intake", "released"].includes(course.releaseStage),
      `${label}.releaseStage must be intake or released`,
    );
    assert.ok(fieldIdSet.has(course.fieldId), `${label} references unknown field ${course.fieldId}`);
    assert.ok(Array.isArray(course.subjectIds) && course.subjectIds.length > 0, `${label}.subjectIds are required`);
    uniqueValues(course.subjectIds, `${label}.subjectIds`);
    for (const subjectId of course.subjectIds) {
      assert.ok(subjectById.has(subjectId), `${label} references unknown subject ${subjectId}`);
    }
    const intake = course.releaseStage === "intake";
    const releasedSubjectIds = course.releasedSubjectIds ?? course.subjectIds;
    assert.ok(Array.isArray(releasedSubjectIds) && (intake || releasedSubjectIds.length > 0), `${label}.releasedSubjectIds must be non-empty for a released course`);
    uniqueValues(releasedSubjectIds, `${label}.releasedSubjectIds`);
    for (const subjectId of releasedSubjectIds) {
      assert.ok(course.subjectIds.includes(subjectId), `${label} released subject ${subjectId} is not in the course`);
    }
    const contentKinds = course.contentKinds ?? ["theory", "question", "mock-exam"];
    assert.ok(Array.isArray(contentKinds) && (intake || contentKinds.length > 0), `${label}.contentKinds must be non-empty for a released course`);
    uniqueValues(contentKinds, `${label}.contentKinds`);
    for (const contentKind of contentKinds) {
      assert.ok(["theory", "question", "mock-exam"].includes(contentKind), `${label} has an invalid content kind ${contentKind}`);
    }
    assert.ok(
      !contentKinds.includes("mock-exam") || contentKinds.includes("question"),
      `${label}.mock-exam requires question content`,
    );
    const questionSubjectIds = course.questionSubjectIds
      ?? (contentKinds.includes("question") ? releasedSubjectIds : []);
    assert.ok(Array.isArray(questionSubjectIds), `${label}.questionSubjectIds must be an array`);
    uniqueValues(questionSubjectIds, `${label}.questionSubjectIds`);
    assert.ok(
      contentKinds.includes("question") === (questionSubjectIds.length > 0),
      `${label}.questionSubjectIds must be non-empty exactly when question content is released`,
    );
    for (const subjectId of questionSubjectIds) {
      assert.ok(
        releasedSubjectIds.includes(subjectId),
        `${label} question subject ${subjectId} is not a released subject`,
      );
    }
    assert.ok(Array.isArray(course.descriptiveSubjectIds), `${label}.descriptiveSubjectIds must be an array`);
    uniqueValues(course.descriptiveSubjectIds, `${label}.descriptiveSubjectIds`);
    for (const subjectId of course.descriptiveSubjectIds) {
      assert.ok(course.subjectIds.includes(subjectId), `${label} descriptive subject ${subjectId} is not in the course`);
    }
    assert.ok(source.contentScopes.some((scope) => scope.id === course.examType && scope.courseExamTypes.length === 1 && scope.courseExamTypes[0] === course.examType), `${label} requires a direct content scope`);
    const acceptedScopes = source.contentScopes.filter((scope) => scope.courseExamTypes.includes(course.examType));
    assert.ok(acceptedScopes.length > 0, `${label} has no accepted content scope`);

    const policy = course.examPolicy;
    if (policy === null) {
      assert.ok(intake && !contentKinds.includes("mock-exam"), `${label} may omit an exam policy only during intake without mock exams`);
      continue;
    }
    nonEmptyString(policy?.policyVersion, `${label}.examPolicy.policyVersion`);
    nonEmptyString(policy?.title, `${label}.examPolicy.title`);
    assert.ok(policy?.objectiveCounts && typeof policy.objectiveCounts === "object" && !Array.isArray(policy.objectiveCounts), `${label}.examPolicy.objectiveCounts must be an object`);
    for (const [subjectId, count] of Object.entries(policy.objectiveCounts)) {
      assert.ok(course.subjectIds.includes(subjectId), `${label} objective count references unknown course subject ${subjectId}`);
      finiteNonNegative(count, `${label}.examPolicy.objectiveCounts.${subjectId}`);
    }
    const numericKeys = [
      "durationMinutes", "descriptiveCount", "objectivePoint", "descriptivePoint",
      "totalQuestions", "totalPoints", "passingScore", "subjectMinimumRate",
      "practicalMinimumRate", "resultDecimals",
    ];
    for (const key of numericKeys) finiteNonNegative(policy[key], `${label}.examPolicy.${key}`);
    const objectiveCount = Object.values(policy.objectiveCounts).reduce((total, count) => total + count, 0);
    assert.equal(objectiveCount + policy.descriptiveCount, policy.totalQuestions, `${label} question count does not match policy`);
    assert.ok(Math.abs(
      objectiveCount * policy.objectivePoint + policy.descriptiveCount * policy.descriptivePoint - policy.totalPoints,
    ) < 0.0001, `${label} total points do not match policy`);
    assert.equal(
      course.descriptiveSubjectIds.length > 0,
      policy.descriptiveCount > 0,
      `${label} descriptive subjects and count must agree`,
    );
  }
  for (const fieldId of fieldIds) {
    assert.ok(source.courses.some((course) => course.fieldId === fieldId), `field ${fieldId} has no course`);
  }

  const localCourses = source.localPracticeCourses ?? [];
  assert.ok(Array.isArray(localCourses), "localPracticeCourses must be an array");
  uniqueValues([...courseIds, ...localCourses.map(course => course.courseId)], "all course ids");
  for (const course of localCourses) {
    for (const key of ["courseId", "fieldId", "name", "summary", "section", "sectionTitle", "releaseKey"]) nonEmptyString(course[key], `localPracticeCourses.${key}`);
    for (const key of ["courseId", "section", "releaseKey"]) assert.match(course[key], /^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
    assert.ok(fieldIdSet.has(course.fieldId), "Local practice field must be registered");
    assert.equal(course.engineId, "certification");
    assert.equal(course.capability, "local-practice");
    assert.ok(!course.examType && !course.examPolicy && !course.subjectIds, "Local practice must not claim an exam policy or DB question scope");
  }
  return source;
}

export function normalizedCourseRegistry(sourceValue) {
  const source = validateCourseRegistrySource(structuredClone(sourceValue));
  const subjectById = new Map(source.subjects.map((subject) => [subject.id, subject]));
  const courses = source.courses.map((course) => {
    const acceptedContentScopes = source.contentScopes
      .filter((scope) => scope.courseExamTypes.includes(course.examType))
      .map((scope) => scope.id);
    const objectiveCounts = Object.fromEntries(Object.entries(course.examPolicy?.objectiveCounts ?? {})
      .map(([subjectId, count]) => [subjectById.get(subjectId).name, count]));
    return {
      examType: course.examType,
      fieldId: course.fieldId,
      courseId: course.courseId,
      name: course.name,
      releaseStage: course.releaseStage ?? "released",
      summary: course.summary,
      studyMode: course.studyMode,
      mockExam: course.mockExam,
      subjects: course.subjectIds.map((subjectId) => subjectById.get(subjectId)),
      releasedSubjects: (course.releasedSubjectIds ?? course.subjectIds)
        .map((subjectId) => subjectById.get(subjectId)),
      contentKinds: course.contentKinds ?? ["theory", "question", "mock-exam"],
      questionSubjects: (course.questionSubjectIds
        ?? ((course.contentKinds ?? ["theory", "question", "mock-exam"]).includes("question")
          ? (course.releasedSubjectIds ?? course.subjectIds)
          : []))
        .map((subjectId) => subjectById.get(subjectId)),
      acceptedContentScopes,
      descriptiveSubjects: course.descriptiveSubjectIds.map((subjectId) => subjectById.get(subjectId).name),
      examPolicy: course.examPolicy ? { ...course.examPolicy, objectiveCounts } : null,
    };
  });
  const examTypes = courses.map((course) => course.examType);
  const contentScopeCourses = Object.fromEntries(source.contentScopes
    .map((scope) => [scope.id, scope.courseExamTypes]));
  const examTypeSubjects = Object.fromEntries(courses
    .map((course) => [course.examType, course.subjects.map((subject) => subject.name)]));
  const examTypeSubjectIds = Object.fromEntries(courses
    .map((course) => [course.examType, course.subjects.map((subject) => subject.id)]));
  const courseContentScopeRows = courses.flatMap((course) => source.contentScopes
    .filter((scope) => scope.courseExamTypes.includes(course.examType))
    .map((scope) => ({ examType: course.examType, contentScope: scope.id })));
  const courseSubjectRows = courses.flatMap((course) => course.subjects
    .map((subject) => ({ examType: course.examType, subject: subject.name })));
  return {
    schemaVersion: source.schemaVersion,
    defaultExamType: source.defaultExamType,
    fields: source.fields,
    subjects: source.subjects,
    contentScopes: source.contentScopes,
    courses,
    localPracticeCourses: source.localPracticeCourses ?? [],
    examTypes,
    registeredSubjects: source.subjects.map((subject) => subject.name),
    registeredSubjectIds: source.subjects.map((subject) => subject.id),
    registeredContentScopes: source.contentScopes.map((scope) => scope.id),
    contentScopeCourses,
    examTypeSubjects,
    examTypeSubjectIds,
    courseContentScopeRows,
    courseSubjectRows,
  };
}

function runtimeModule(registry) {
  const aliases = Object.fromEntries(registry.contentScopes.flatMap((scope) => (
    [scope.id, ...scope.aliases].map((alias) => [alias.toUpperCase(), scope.id])
  )));
  const subjectIdentifiers = Object.fromEntries(registry.subjects.flatMap((subject) => (
    [subject.id, subject.name, ...subject.aliases]
      .map((identifier) => [identifier.trim().toLocaleLowerCase("ko-KR"), subject.id])
  )));
  const subjectNames = Object.fromEntries(registry.subjects.map((subject) => [subject.id, subject.name]));
  return `// Generated by scripts/generate-course-registry.mjs from course-registry.source.json.\n// Do not edit this file directly.\n\nfunction deepFreeze(value) {\n  if (value && typeof value === "object" && !Object.isFrozen(value)) {\n    for (const nested of Object.values(value)) deepFreeze(nested);\n    Object.freeze(value);\n  }\n  return value;\n}\n\nexport const COURSE_REGISTRY_SCHEMA_VERSION = ${registry.schemaVersion};\nexport const DEFAULT_REGISTERED_EXAM_TYPE = ${JSON.stringify(registry.defaultExamType)};\nexport const COURSE_FIELD_DEFINITIONS = deepFreeze(${JSON.stringify(registry.fields, null, 2)});\nexport const SUBJECT_DEFINITIONS = deepFreeze(${JSON.stringify(registry.subjects, null, 2)});\nexport const CONTENT_SCOPE_DEFINITIONS = deepFreeze(${JSON.stringify(registry.contentScopes, null, 2)});\nexport const COURSE_DEFINITIONS = deepFreeze(${JSON.stringify(registry.courses, null, 2)});\nexport const LOCAL_PRACTICE_COURSES = deepFreeze(${JSON.stringify(registry.localPracticeCourses, null, 2)});\nexport const REGISTERED_EXAM_TYPES = deepFreeze(${JSON.stringify(registry.examTypes, null, 2)});\nexport const REGISTERED_CONTENT_SCOPES = deepFreeze(${JSON.stringify(registry.registeredContentScopes, null, 2)});\nexport const REGISTERED_SUBJECTS = deepFreeze(${JSON.stringify(registry.registeredSubjects, null, 2)});\nexport const REGISTERED_SUBJECT_IDS = deepFreeze(${JSON.stringify(registry.registeredSubjectIds, null, 2)});\nexport const CONTENT_SCOPE_COURSES = deepFreeze(${JSON.stringify(registry.contentScopeCourses, null, 2)});\nexport const EXAM_TYPE_SUBJECTS = deepFreeze(${JSON.stringify(registry.examTypeSubjects, null, 2)});\nexport const EXAM_TYPE_SUBJECT_IDS = deepFreeze(${JSON.stringify(registry.examTypeSubjectIds, null, 2)});\nexport const COURSE_CONTENT_SCOPE_ROWS = deepFreeze(${JSON.stringify(registry.courseContentScopeRows, null, 2)});\nexport const COURSE_SUBJECT_ROWS = deepFreeze(${JSON.stringify(registry.courseSubjectRows, null, 2)});\n\nconst CONTENT_SCOPE_ALIASES = deepFreeze(${JSON.stringify(aliases, null, 2)});\nconst SUBJECT_IDENTIFIERS = deepFreeze(${JSON.stringify(subjectIdentifiers, null, 2)});\nconst SUBJECT_NAMES = deepFreeze(${JSON.stringify(subjectNames, null, 2)});\n\nexport function normalizeRegisteredSubjectId(value) {\n  return SUBJECT_IDENTIFIERS[String(value ?? "").trim().toLocaleLowerCase("ko-KR")] ?? "";\n}\n\nexport function registeredSubjectName(value) {\n  return SUBJECT_NAMES[normalizeRegisteredSubjectId(value)] ?? "";\n}\n\nexport function contentScopeAllowsRegisteredSubject(scope, subject) {\n  const courses = CONTENT_SCOPE_COURSES[String(scope)] ?? [];\n  const subjectName = registeredSubjectName(subject);\n  return Boolean(subjectName) && courses.length > 0 && courses.every((examType) => (\n    EXAM_TYPE_SUBJECTS[examType]?.includes(subjectName)\n  ));\n}\n\nexport function contentScopeAllowsRegisteredSubjectId(scope, subjectId) {\n  const courses = CONTENT_SCOPE_COURSES[String(scope)] ?? [];\n  const normalizedSubjectId = normalizeRegisteredSubjectId(subjectId);\n  return Boolean(normalizedSubjectId) && courses.length > 0 && courses.every((examType) => (\n    EXAM_TYPE_SUBJECT_IDS[examType]?.includes(normalizedSubjectId)\n  ));\n}\n\nexport function normalizeRegisteredExamType(value) {\n  const normalized = String(value ?? "").trim().toUpperCase();\n  return REGISTERED_EXAM_TYPES.find((examType) => examType === normalized) ?? "";\n}\n\nexport function normalizeRegisteredContentScope(value) {\n  const scope = String(value ?? "").trim();\n  const examType = normalizeRegisteredExamType(scope);\n  return examType || CONTENT_SCOPE_ALIASES[scope.toUpperCase()] || scope;\n}\n`;
}

function declarationModule(registry) {
  const declarations = [
    ["COURSE_REGISTRY_SCHEMA_VERSION", registry.schemaVersion],
    ["DEFAULT_REGISTERED_EXAM_TYPE", registry.defaultExamType],
    ["COURSE_FIELD_DEFINITIONS", registry.fields],
    ["SUBJECT_DEFINITIONS", registry.subjects],
    ["CONTENT_SCOPE_DEFINITIONS", registry.contentScopes],
    ["COURSE_DEFINITIONS", registry.courses],
    ["LOCAL_PRACTICE_COURSES", registry.localPracticeCourses],
    ["REGISTERED_EXAM_TYPES", registry.examTypes],
    ["REGISTERED_CONTENT_SCOPES", registry.registeredContentScopes],
    ["REGISTERED_SUBJECTS", registry.registeredSubjects],
    ["REGISTERED_SUBJECT_IDS", registry.registeredSubjectIds],
    ["CONTENT_SCOPE_COURSES", registry.contentScopeCourses],
    ["EXAM_TYPE_SUBJECTS", registry.examTypeSubjects],
    ["EXAM_TYPE_SUBJECT_IDS", registry.examTypeSubjectIds],
    ["COURSE_CONTENT_SCOPE_ROWS", registry.courseContentScopeRows],
    ["COURSE_SUBJECT_ROWS", registry.courseSubjectRows],
  ];
  return `// Generated by scripts/generate-course-registry.mjs from course-registry.source.json.\n// Do not edit this file directly.\n\n${declarations.map(([name, value]) => `export const ${name}: ${typescriptLiteral(value)};`).join("\n\n")}\n\nexport function normalizeRegisteredSubjectId(value: unknown): string;\nexport function registeredSubjectName(value: unknown): string;\nexport function contentScopeAllowsRegisteredSubject(scope: unknown, subject: unknown): boolean;\nexport function contentScopeAllowsRegisteredSubjectId(scope: unknown, subjectId: unknown): boolean;\nexport function normalizeRegisteredExamType(value: unknown): string;\nexport function normalizeRegisteredContentScope(value: unknown): string;\n`;
}

function databaseSql(registry) {
  const scopeValues = registry.courseContentScopeRows
    .map((row) => `  (${sqlText(row.examType)}, ${sqlText(row.contentScope)})`).join(",\n");
  const subjectValues = registry.courseSubjectRows
    .map((row) => `  (${sqlText(row.examType)}, ${sqlText(row.subject)})`).join(",\n");
  return `-- Generated by scripts/generate-course-registry.mjs from course-registry.source.json.\n-- Copy this additive SQL into the next reviewed forward migration; do not edit old migrations.\n\nINSERT OR IGNORE INTO \`course_content_scopes\` (\`exam_type\`, \`content_scope\`)\nVALUES\n${scopeValues};\n--> statement-breakpoint\n\nINSERT OR IGNORE INTO \`course_subjects\` (\`exam_type\`, \`subject\`)\nVALUES\n${subjectValues};\n--> statement-breakpoint\n`;
}

export function buildCourseRegistryArtifacts(source) {
  const registry = normalizedCourseRegistry(source);
  return {
    registry,
    // Only freshly generated literals are frozen here; unused constants have no side effects.
    runtime: runtimeModule(registry).replace(/(const [A-Z_]+ = )deepFreeze\(/gu, "$1/* @__PURE__ */ deepFreeze("),
    declarations: declarationModule(registry),
    databaseSql: databaseSql(registry),
  };
}
