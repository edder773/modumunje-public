import {
  APP_VERSION,
  type AdminIdentity,
  BACKUP_VERSION,
  type D1Row,
  EXAM_TYPES,
  type JsonRecord,
  QUESTION_KINDS,
  SCHEMA_VERSION,
  SETTING_RULES,
  SUBJECTS,
  type SqlCommand,
  adminRepository,
  allRows,
  boundedInteger,
  canonicalTopicId,
  contentScopeAllowsSubject,
  examScopesCompatible,
  execute,
  firstRow,
  hasBalancedMarkdownFences,
  integer,
  isDescriptiveAllowed,
  isExamScope,
  isExamType,
  isSubject,
  jsonList,
  normalizeContentImport,
  normalizeExplanationMarkdown,
  normalizedDuplicateKey,
  now,
  numberList,
  questionContentFingerprint,
  questionValues,
  requiredString,
  stripProblemApplicationSection,
  theoryValues,
  uniqueStrings,
} from "./admin-use-case-runtime";
import {
  readSettings,
} from "./admin-read-use-cases";
import {
  invalidateQualitySnapshot,
} from "./admin-quality-use-cases";
import {
  type BackupEnvelope,
  backupConflicts,
  backupDigestBase,
  restoreBackup,
  validateBackupEnvelope,
} from "./admin-backup-use-cases";

export function normalizeImport(value: unknown) {
  if (!value || typeof value !== "object") {
    throw new Error("가져오기 파일 형식이 유효하지 않습니다.");
  }
  const source = value as JsonRecord;
  if (!Array.isArray(value) && source.metadata && source.data) return value;
  return normalizeContentImport(value, now(), {
    examTypes: EXAM_TYPES,
    subjects: SUBJECTS,
  }) as {
    questions: D1Row[];
    theories: D1Row[];
    swQuestions: D1Row[];
    swTheories: D1Row[];
    includedData: string[];
    sourceFormat: string;
  };
}

export async function nextQuestionDisplayOrder() {
  const row = await firstRow<{ next_order: number }>(`
    SELECT COALESCE(MAX(display_order), 0) + 1 AS next_order
    FROM questions WHERE active = 1
  `);
  return Number(row?.next_order ?? 1);
}

export async function reindexQuestionDisplayOrder() {
  await execute(`
    WITH ordered AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY display_order, id) AS next_order
      FROM questions WHERE active = 1
    )
    UPDATE questions
    SET display_order = (
      SELECT next_order FROM ordered WHERE ordered.id = questions.id
    )
    WHERE active = 1
  `);
}

export async function insertQuestion(payload: JsonRecord) {
  const values = questionValues(payload);
  await validateTheoryCompatibility(
    values.theoryId,
    values.category,
    values.examScope,
  );
  const displayOrder = await nextQuestionDisplayOrder();
  const result = await execute(`
    INSERT INTO questions (
      category, topic, display_order, exam_scope, difficulty,
      difficulty_rationale, kind, prompt, choices, correct_answers,
      explanation, tags, scoring_criteria, required_concepts,
      acceptable_alternatives, deduction_conditions, error_conditions,
      theory_id, bookmarked, active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
  `, [
    values.category,
    values.topic,
    displayOrder,
    values.examScope,
    values.difficulty,
    values.difficultyRationale,
    values.kind,
    values.prompt,
    values.choices,
    values.correctAnswers,
    values.explanation,
    values.tags,
    values.scoringCriteria,
    values.requiredConcepts,
    values.acceptableAlternatives,
    values.deductionConditions,
    values.errorConditions,
    values.theoryId,
    values.active,
    now(),
    now(),
  ]);
  const id = Number(result.meta.last_row_id);
  return firstRow("SELECT * FROM questions WHERE id = ?", [id]);
}

export async function updateQuestion(payload: JsonRecord) {
  const id = integer(payload.id);
  if (!id) throw new Error("수정할 문제 ID가 필요합니다.");
  const before = await firstRow("SELECT * FROM questions WHERE id = ?", [id]);
  if (!before) throw new Error("수정할 문제를 찾을 수 없습니다.");
  const values = questionValues(payload);
  await validateTheoryCompatibility(
    values.theoryId,
    values.category,
    values.examScope,
  );
  await execute(`
    UPDATE questions SET
      category = ?, topic = ?, exam_scope = ?, difficulty = ?,
      difficulty_rationale = ?, kind = ?, prompt = ?, choices = ?,
      correct_answers = ?, explanation = ?, tags = ?, scoring_criteria = ?,
      required_concepts = ?, acceptable_alternatives = ?,
      deduction_conditions = ?, error_conditions = ?, theory_id = ?,
      active = ?, updated_at = ?
    WHERE id = ?
  `, [
    values.category,
    values.topic,
    values.examScope,
    values.difficulty,
    values.difficultyRationale,
    values.kind,
    values.prompt,
    values.choices,
    values.correctAnswers,
    values.explanation,
    values.tags,
    values.scoringCriteria,
    values.requiredConcepts,
    values.acceptableAlternatives,
    values.deductionConditions,
    values.errorConditions,
    values.theoryId,
    values.active,
    now(),
    id,
  ]);
  return {
    before,
    after: await firstRow("SELECT * FROM questions WHERE id = ?", [id]),
  };
}

export async function duplicateQuestion(payload: JsonRecord) {
  const id = integer(payload.id);
  const source = await firstRow("SELECT * FROM questions WHERE id = ?", [id]);
  if (!source) throw new Error("복제할 문제를 찾을 수 없습니다.");
  const displayOrder = await nextQuestionDisplayOrder();
  const result = await execute(`
    INSERT INTO questions (
      category, topic, display_order, exam_scope, difficulty,
      difficulty_rationale, kind, prompt, choices, correct_answers,
      explanation, tags, scoring_criteria, required_concepts,
      acceptable_alternatives, deduction_conditions, error_conditions,
      theory_id, bookmarked, active, created_at, updated_at
    )
    SELECT
      category, topic, ?, exam_scope, difficulty, difficulty_rationale, kind,
      prompt || char(10) || char(10) || '<!-- 관리자 복제본 -->',
      choices, correct_answers, explanation, tags, scoring_criteria,
      required_concepts, acceptable_alternatives, deduction_conditions,
      error_conditions, theory_id, 0, 1, ?, ?
    FROM questions WHERE id = ?
  `, [displayOrder, now(), now(), id]);
  const createdId = Number(result.meta.last_row_id);
  return firstRow("SELECT * FROM questions WHERE id = ?", [createdId]);
}

export async function deactivateQuestion(payload: JsonRecord) {
  const id = integer(payload.id);
  const before = await firstRow("SELECT * FROM questions WHERE id = ?", [id]);
  if (!before) throw new Error("대상 문제를 찾을 수 없습니다.");
  await execute(
    "UPDATE questions SET active = 0, updated_at = ? WHERE id = ?",
    [now(), id],
  );
  if (Boolean(before.active)) {
    await execute(`
      UPDATE questions
      SET display_order = display_order - 1
      WHERE active = 1 AND display_order > ?
    `, [Number(before.display_order)]);
  }
  return {
    before,
    after: await firstRow("SELECT * FROM questions WHERE id = ?", [id]),
    deletionMode: "soft",
  };
}

export async function deleteInactiveQuestion(payload: JsonRecord) {
  const id = integer(payload.id);
  if (!id) throw new Error("삭제할 문제 ID가 필요합니다.");
  const before = await firstRow("SELECT * FROM questions WHERE id = ?", [id]);
  if (!before) throw new Error("삭제할 문제를 찾을 수 없습니다.");
  if (Boolean(before.active)) {
    throw new Error("활성 문제는 영구 삭제할 수 없습니다. 먼저 비활성화해 주세요.");
  }

  const [attemptsRef, bookmarksRef, evaluationsRef, examsRef] = await Promise.all([
    firstRow<{ count: number }>(
      "SELECT COUNT(*) AS count FROM attempts WHERE question_id = ?",
      [id],
    ),
    firstRow<{ count: number }>(
      "SELECT COUNT(*) AS count FROM user_bookmarks WHERE question_id = ?",
      [id],
    ),
    firstRow<{ count: number }>(
      "SELECT COUNT(*) AS count FROM ai_evaluations WHERE question_id = ?",
      [id],
    ),
    firstRow<{ count: number }>(`
      SELECT COUNT(DISTINCT es.id) AS count
      FROM exam_sessions es,
           json_each(CASE WHEN json_valid(es.question_ids) THEN es.question_ids ELSE '[]' END) item
      WHERE CAST(item.value AS INTEGER) = ?
    `, [id]),
  ]);
  const references = {
    attempts: Number(attemptsRef?.count ?? 0),
    bookmarks: Number(bookmarksRef?.count ?? 0),
    evaluations: Number(evaluationsRef?.count ?? 0),
    examSessions: Number(examsRef?.count ?? 0),
  };
  const referenceCount = Object.values(references).reduce((sum, value) => sum + value, 0);
  if (referenceCount > 0) {
    throw new Error(
      `기존 학습 기록이 참조하는 문제라 영구 삭제할 수 없습니다. `
      + `풀이 ${references.attempts}건, 북마크 ${references.bookmarks}건, `
      + `평가 ${references.evaluations}건, 모의고사 ${references.examSessions}건이 연결되어 있습니다.`,
    );
  }

  await execute("DELETE FROM questions WHERE id = ? AND active = 0", [id]);
  return {
    id,
    deleted: true,
    deletionMode: "hard",
    references,
    before,
  };
}

export async function bulkQuestions(payload: JsonRecord) {
  const ids = [...new Set(numberList(payload.ids))];
  if (!ids.length) throw new Error("변경할 문제를 선택해 주세요.");
  if (ids.length > 200) throw new Error("한 번에 최대 200문항까지 변경할 수 있습니다.");
  const rows = await allRows(
    `SELECT * FROM questions WHERE id IN (${ids.map(() => "?").join(",")})`,
    ids,
  );
  if (rows.length !== ids.length) throw new Error("일부 문제를 찾을 수 없습니다.");
  const operation = String(payload.operation ?? "");
  const statements: SqlCommand[] = [];
  if (operation === "activate" || operation === "deactivate") {
    const active = operation === "activate" ? 1 : 0;
    for (const id of ids) {
      statements.push({
        sql: "UPDATE questions SET active = ?, updated_at = ? WHERE id = ?",
        values: [active, now(), id],
      });
    }
  } else if (operation === "examScope") {
    const value = isExamScope(payload.value) ? payload.value : "";
    if (!value) throw new Error("시험 범위가 유효하지 않습니다.");
    for (const row of rows) {
      if (!contentScopeAllowsSubject(value, String(row.category))) {
        throw new Error("선택한 시험 범위에서 제공하지 않는 과목이 포함되어 있습니다.");
      }
      if (
        row.kind === "descriptive"
        && !isDescriptiveAllowed(value, String(row.category))
      ) {
        throw new Error("서술형 문제는 등록된 과정의 지정 과목 범위만 사용할 수 있습니다.");
      }
    }
    for (const id of ids) {
      statements.push({
        sql: "UPDATE questions SET exam_scope = ?, updated_at = ? WHERE id = ?",
        values: [value, now(), id],
      });
    }
  } else if (operation === "category") {
    const value = requiredString(payload.value, "과목");
    if (!isSubject(value)) {
      throw new Error("과목이 유효하지 않습니다.");
    }
    for (const row of rows) {
      if (!contentScopeAllowsSubject(String(row.exam_scope), value)) {
        throw new Error("현재 시험 범위에서 제공하지 않는 과목으로 변경할 수 없습니다.");
      }
      if (
        row.kind === "descriptive"
        && !isDescriptiveAllowed(String(row.exam_scope), value)
      ) {
        throw new Error("서술형 문제는 등록된 과정의 지정 과목으로만 변경할 수 있습니다.");
      }
    }
    for (const id of ids) {
      statements.push({
        sql: "UPDATE questions SET category = ?, updated_at = ? WHERE id = ?",
        values: [value, now(), id],
      });
    }
  } else if (operation === "difficulty") {
    const value = ["하", "중", "상"].includes(String(payload.value))
      ? String(payload.value)
      : "";
    if (!value) throw new Error("난이도가 유효하지 않습니다.");
    for (const id of ids) {
      statements.push({
        sql: "UPDATE questions SET difficulty = ?, updated_at = ? WHERE id = ?",
        values: [value, now(), id],
      });
    }
  } else if (operation === "addTag") {
    const tag = requiredString(payload.value, "태그").slice(0, 60);
    for (const row of rows) {
      const tags = uniqueStrings(row.tags);
      if (!tags.includes(tag)) tags.push(tag);
      statements.push({
        sql: "UPDATE questions SET tags = ?, updated_at = ? WHERE id = ?",
        values: [JSON.stringify(tags), now(), row.id],
      });
    }
  } else {
    throw new Error("지원하지 않는 대량 작업입니다.");
  }
  await adminRepository.batch(statements);
  if (operation === "deactivate") await reindexQuestionDisplayOrder();
  return { ids, operation, changed: statements.length };
}

export async function insertTheory(payload: JsonRecord) {
  const values = theoryValues(payload);
  const result = await execute(`
    INSERT INTO theories (
      title, category, topic, sort_order, exam_scope, difficulty, active,
      summary, content, review_answers, keywords, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    values.title,
    values.category,
    values.topic,
    values.sortOrder,
    values.examScope,
    values.difficulty,
    values.active,
    values.summary,
    values.content,
    values.reviewAnswers,
    values.keywords,
    now(),
    now(),
  ]);
  return firstRow("SELECT * FROM theories WHERE id = ?", [Number(result.meta.last_row_id)]);
}

export async function updateTheory(payload: JsonRecord) {
  const id = integer(payload.id);
  const before = await firstRow("SELECT * FROM theories WHERE id = ?", [id]);
  if (!before) throw new Error("수정할 이론을 찾을 수 없습니다.");
  const values = theoryValues(payload);
  const linkedQuestions = await allRows(
    "SELECT id, category, exam_scope FROM questions WHERE theory_id = ?",
    [id],
  );
  for (const question of linkedQuestions) {
    if (
      question.category !== values.category
      || !examScopesCompatible(
        String(question.exam_scope),
        values.examScope,
      )
    ) {
      throw new Error(
        `연결된 문제 ID ${question.id}와 변경할 이론의 과목 또는 시험 범위가 호환되지 않습니다.`,
      );
    }
  }
  await execute(`
    UPDATE theories SET
      title = ?, category = ?, topic = ?, sort_order = ?, exam_scope = ?,
      difficulty = ?, active = ?, summary = ?, content = ?, review_answers = ?, keywords = ?,
      updated_at = ?
    WHERE id = ?
  `, [
    values.title,
    values.category,
    values.topic,
    values.sortOrder,
    values.examScope,
    values.difficulty,
    values.active,
    values.summary,
    values.content,
    values.reviewAnswers,
    values.keywords,
    now(),
    id,
  ]);
  return {
    before,
    after: await firstRow("SELECT * FROM theories WHERE id = ?", [id]),
  };
}

export async function deactivateTheory(payload: JsonRecord) {
  const id = integer(payload.id);
  const before = await firstRow("SELECT * FROM theories WHERE id = ?", [id]);
  if (!before) throw new Error("대상 이론을 찾을 수 없습니다.");
  await execute(
    "UPDATE theories SET active = 0, updated_at = ? WHERE id = ?",
    [now(), id],
  );
  return {
    before,
    after: await firstRow("SELECT * FROM theories WHERE id = ?", [id]),
    deletionMode: "soft",
  };
}

export async function linkTheory(payload: JsonRecord) {
  const questionId = integer(payload.questionId);
  const theoryId = payload.theoryId === null ? null : integer(payload.theoryId);
  const before = await firstRow(
    "SELECT id, theory_id, category, exam_scope FROM questions WHERE id = ?",
    [questionId],
  );
  if (!before) throw new Error("문제를 찾을 수 없습니다.");
  await validateTheoryCompatibility(
    theoryId,
    String(before.category),
    String(before.exam_scope),
  );
  await execute(
    "UPDATE questions SET theory_id = ?, updated_at = ? WHERE id = ?",
    [theoryId, now(), questionId],
  );
  return { before, after: { id: questionId, theory_id: theoryId } };
}

export async function validateTheoryCompatibility(
  theoryId: number | null,
  category: string,
  examScope: string,
) {
  if (!theoryId) return;
  const theory = await firstRow<{
    id: number;
    category: string;
    exam_scope: string;
  }>(
    "SELECT id, category, exam_scope FROM theories WHERE id = ?",
    [theoryId],
  );
  if (!theory) throw new Error("연결할 이론을 찾을 수 없습니다.");
  if (theory.category !== category) {
    throw new Error("문제와 이론의 과목이 일치하지 않습니다.");
  }
  if (!examScopesCompatible(examScope, theory.exam_scope)) {
    throw new Error("문제와 이론의 시험 적용 범위가 호환되지 않습니다.");
  }
}

export function validatedSettingValue(
  key: keyof typeof SETTING_RULES,
  value: unknown,
) {
  const rule = SETTING_RULES[key];
  if (rule.type === "boolean") return value === true || value === "true" ? "true" : "false";
  if (rule.type === "number") {
    const numeric = Number(value);
    if (!Number.isInteger(numeric) || numeric < rule.min || numeric > rule.max) {
      throw new Error(`${key} 설정은 ${rule.min}~${rule.max} 범위의 정수여야 합니다.`);
    }
    return String(numeric);
  }
  if (rule.type === "exam") {
    if (!isExamType(value)) throw new Error(`기본 시험 모드는 ${EXAM_TYPES.join(", ")} 중 하나여야 합니다.`);
    return value;
  }
  return String(value ?? "").trim().slice(0, rule.max);
}

export async function updateSettings(identity: AdminIdentity, payload: JsonRecord) {
  if (!payload.values || typeof payload.values !== "object") {
    throw new Error("변경할 설정이 필요합니다.");
  }
  const incoming = payload.values as JsonRecord;
  const before = await readSettings();
  const statements: SqlCommand[] = [];
  for (const key of Object.keys(incoming)) {
    if (!(key in SETTING_RULES)) throw new Error(`지원하지 않는 설정입니다: ${key}`);
    const typedKey = key as keyof typeof SETTING_RULES;
    const rule = SETTING_RULES[typedKey];
    const value = validatedSettingValue(typedKey, incoming[key]);
    statements.push({
      sql: `
        INSERT INTO site_settings (key, value, value_type, updated_by_hash, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          value_type = excluded.value_type,
          updated_by_hash = excluded.updated_by_hash,
          updated_at = excluded.updated_at
      `,
      values: [key, value, rule.type === "exam" ? "string" : rule.type, identity.hash, now()],
    });
  }
  if (statements.length) await adminRepository.batch(statements);

  const retention = boundedInteger(
    incoming.analytics_retention_days
      ?? (before.values as JsonRecord).analytics_retention_days,
    7,
    730,
    90,
  );
  await execute(
    "DELETE FROM analytics_events WHERE occurred_at < datetime('now', ?)",
    [`-${retention} days`],
  );
  const after = await readSettings();
  return { before: before.values, after: after.values };
}

export async function applyQualityFix(payload: JsonRecord) {
  const action = String(payload.fixAction ?? "");
  if (action === "reindex-display-order") {
    const before = await firstRow<{ collisions: number }>(`
      SELECT COUNT(*) AS collisions FROM (
        SELECT display_order FROM questions WHERE active = 1
        GROUP BY display_order HAVING COUNT(*) > 1
      )
    `);
    await reindexQuestionDisplayOrder();
    await invalidateQualitySnapshot();
    return { action, before, after: { collisions: 0 } };
  }
  if (action === "remove-problem-application") {
    const rows = await allRows(`
      SELECT id, explanation FROM questions
      WHERE explanation LIKE '%문제 풀이 적용%'
    `);
    const statements: SqlCommand[] = rows.map((row: D1Row) => ({
      sql: "UPDATE questions SET explanation = ?, updated_at = ? WHERE id = ?",
      values: [
        normalizeExplanationMarkdown(stripProblemApplicationSection(row.explanation)),
        now(),
        row.id,
      ],
    }));
    if (statements.length) await adminRepository.batch(statements);
    await invalidateQualitySnapshot();
    return { action, before: { count: rows.length }, after: { count: 0 } };
  }
  throw new Error("자동 수정할 수 없는 품질 항목입니다.");
}

export type ContentImportData = {
  questions: D1Row[];
  theories: D1Row[];
  swQuestions: D1Row[];
  swTheories: D1Row[];
  includedData: string[];
  sourceFormat: string;
};

export function filterContentImportSelection(
  data: ContentImportData,
  selectionValue: unknown,
): { data: ContentImportData; selection: string } {
  const selection = String(selectionValue ?? "all").trim() || "all";
  if (selection === "all") return { data, selection };

  let questions: D1Row[] = [];
  let theories: D1Row[] = [];
  let swQuestions: D1Row[] = [];
  let swTheories: D1Row[] = [];
  if (selection.startsWith("registered:")) {
    const category = selection.slice("registered:".length).trim();
    if (!isSubject(category)) throw new Error("선택한 자격 과목이 유효하지 않습니다.");
    questions = data.questions.filter((row) => String(row.category) === category);
    theories = data.theories.filter((row) => String(row.category) === category);
  } else if (selection.startsWith("sw:")) {
    const subjectId = selection.slice("sw:".length).trim();
    if (!subjectId) throw new Error("선택한 SW 과목이 유효하지 않습니다.");
    swQuestions = data.swQuestions.filter((row) => String(row.subject_id) === subjectId);
    swTheories = data.swTheories.filter((row) => String(row.subject_id) === subjectId);
  } else {
    throw new Error("가져오기 과목 선택값이 유효하지 않습니다.");
  }

  if (!questions.length && !theories.length && !swQuestions.length && !swTheories.length) {
    throw new Error("선택한 과목에 해당하는 문제·이론 데이터가 파일에 없습니다.");
  }
  return {
    selection,
    data: {
      ...data,
      questions,
      theories,
      swQuestions,
      swTheories,
      includedData: [
        ...(theories.length ? ["theories"] : []),
        ...(questions.length ? ["questions"] : []),
        ...(swTheories.length ? ["sw_theories"] : []),
        ...(swQuestions.length ? ["sw_questions"] : []),
      ],
    },
  };
}

export async function inspectContentImport(data: ContentImportData) {
  const readSqlQuestions = data.questions.length > 0;
  const readSqlTheories = data.theories.length > 0 || readSqlQuestions;
  const readSwQuestions = data.swQuestions.length > 0;
  const readSwTheories = data.swTheories.length > 0 || readSwQuestions;
  const [existingQuestions, existingTheories, existingSwQuestions, existingSwTheories] = await Promise.all([
    readSqlQuestions
      ? allRows("SELECT id, kind, prompt, choices, correct_answers, theory_id FROM questions")
      : Promise.resolve([]),
    readSqlTheories
      ? allRows("SELECT id, title, category, topic, exam_scope, active FROM theories")
      : Promise.resolve([]),
    readSwQuestions
      ? allRows("SELECT id, kind, prompt, choices, correct_answers FROM sw_questions")
      : Promise.resolve([]),
    readSwTheories
      ? allRows("SELECT id, title, subject_group_id, subject_id, category, topic, active FROM sw_theories")
      : Promise.resolve([]),
  ]);
  const existingQuestionById = new Map(
    existingQuestions.map((row: D1Row) => [Number(row.id), row]),
  );
  const questionIds = new Set(existingQuestionById.keys());
  const existingFingerprintOwners = new Map<string, Set<number>>();
  for (const row of existingQuestions) {
    const fingerprint = questionContentFingerprint(row);
    if (!fingerprint) continue;
    const owners = existingFingerprintOwners.get(fingerprint) ?? new Set<number>();
    owners.add(Number(row.id));
    existingFingerprintOwners.set(fingerprint, owners);
  }
  const theoryById = new Map(
    existingTheories.map((row: D1Row) => [Number(row.id), row]),
  );
  const existingTheoryIds = new Set(theoryById.keys());
  const theoryTitleKeys = new Set(
    existingTheories.map((row: D1Row) => normalizedDuplicateKey(row.title)),
  );
  for (const row of data.theories) theoryById.set(Number(row.id), row);
  const swTheoryById = new Map(
    existingSwTheories.map((row: D1Row) => [Number(row.id), row]),
  );
  for (const row of data.swTheories) swTheoryById.set(Number(row.id), row);
  const existingSwQuestionIds = new Set(existingSwQuestions.map((row: D1Row) => String(row.id)));
  const existingSwFingerprintOwners = new Map<string, Set<string>>();
  for (const row of existingSwQuestions) {
    const fingerprint = questionContentFingerprint(row);
    if (!fingerprint) continue;
    const owners = existingSwFingerprintOwners.get(fingerprint) ?? new Set<string>();
    owners.add(String(row.id));
    existingSwFingerprintOwners.set(fingerprint, owners);
  }
  const existingSwTheoryIds = new Set(existingSwTheories.map((row: D1Row) => Number(row.id)));

  let newCount = 0;
  let updateCount = 0;
  let duplicateCount = 0;
  let errorCount = 0;
  let repairedTheoryLinks = 0;
  const errors: string[] = [];
  const warnings: string[] = [];
  const seenQuestionIds = new Set<number>();
  const seenQuestionFingerprints = new Map<string, number>();
  const seenTheoryIds = new Set<number>();
  const seenSwQuestionIds = new Set<string>();
  const seenSwQuestionFingerprints = new Map<string, string>();
  const seenSwTheoryIds = new Set<number>();
  const addError = (message: string) => {
    errorCount += 1;
    if (errors.length < 100) errors.push(message);
  };
  const addWarning = (message: string) => {
    if (warnings.length < 50) warnings.push(message);
  };
  const compatibleTheory = (theory: D1Row | undefined, question: D1Row) => (
    Boolean(theory)
    && Number(theory?.active ?? 1) === 1
    && String(theory?.category ?? "") === String(question.category ?? "")
    && canonicalTopicId(theory?.category, theory?.topic, theory?.id)
      === canonicalTopicId(question.category, question.topic, question.theory_id)
    && examScopesCompatible(
      String(question.exam_scope ?? ""),
      String(theory?.exam_scope ?? ""),
    )
  );

  for (const [index, row] of data.theories.entries()) {
    const label = `이론 ${index + 1}`;
    const id = Number(row.id);
    if (!Number.isInteger(id) || id <= 0) addError(`${label}: ID가 유효하지 않습니다.`);
    else if (seenTheoryIds.has(id)) addError(`${label}: ID ${id}가 파일 안에서 중복됩니다.`);
    else seenTheoryIds.add(id);
    if (!String(row.title ?? "").trim()) addError(`${label}: 제목이 누락되었습니다.`);
    if (!isSubject(row.category)) {
      addError(`${label}: 과목이 유효하지 않습니다.`);
    }
    if (!isExamScope(row.exam_scope)) {
      addError(`${label}: 시험 범위가 유효하지 않습니다.`);
    } else if (!contentScopeAllowsSubject(row.exam_scope, String(row.category ?? ""))) {
      addError(`${label}: 시험 범위와 과목 조합이 유효하지 않습니다.`);
    }
    if (!String(row.topic ?? "").trim()) addError(`${label}: 소분류가 누락되었습니다.`);
    if (!String(row.content ?? "").trim()) addError(`${label}: 본문이 누락되었습니다.`);
    if (!hasBalancedMarkdownFences(row.content)) {
      addError(`${label}: 마크다운 코드 펜스가 닫히지 않았습니다.`);
    }
    if (existingTheoryIds.has(id)) updateCount += 1;
    else if (theoryTitleKeys.has(normalizedDuplicateKey(row.title))) duplicateCount += 1;
    else newCount += 1;
  }

  for (const [index, row] of data.questions.entries()) {
    const id = Number(row.id);
    const label = Number.isInteger(id) && id > 0 ? `문제 ID ${id}` : `문제 ${index + 1}`;
    if (!Number.isInteger(id) || id <= 0) addError(`${label}: ID가 유효하지 않습니다.`);
    else if (seenQuestionIds.has(id)) addError(`${label}: 파일 안에서 ID가 중복됩니다.`);
    else seenQuestionIds.add(id);

    const category = String(row.category ?? "");
    const examScope = String(row.exam_scope ?? "");
    const difficulty = String(row.difficulty ?? "");
    const kind = String(row.kind ?? "");
    const prompt = String(row.prompt ?? "").trim();
    const explanation = String(row.explanation ?? "").trim();
    const choices = jsonList(row.choices).map(String);
    const correctAnswers = numberList(row.correct_answers);
    if (!isSubject(category)) {
      addError(`${label}: 과목이 유효하지 않습니다.`);
    }
    if (!isExamScope(examScope)) {
      addError(`${label}: 시험 범위가 유효하지 않습니다.`);
    } else if (!contentScopeAllowsSubject(examScope, category)) {
      addError(`${label}: 시험 범위와 과목 조합이 유효하지 않습니다.`);
    }
    if (!["하", "중", "상"].includes(difficulty)) {
      addError(`${label}: 난이도가 유효하지 않습니다.`);
    }
    if (!QUESTION_KINDS.includes(kind as typeof QUESTION_KINDS[number])) {
      addError(`${label}: 문제 유형이 유효하지 않습니다.`);
    }
    if (!prompt) addError(`${label}: 본문이 누락되었습니다.`);
    if (!explanation) addError(`${label}: 해설 또는 모범답안이 누락되었습니다.`);
    if (/�|모범답안\s*참조/u.test(explanation)) {
      addError(`${label}: 해설 또는 모범답안에 잘못된 대체 문구가 있습니다.`);
    }
    if (!hasBalancedMarkdownFences(prompt) || !hasBalancedMarkdownFences(explanation)) {
      addError(`${label}: 마크다운 코드 펜스가 닫히지 않았습니다.`);
    }
    if (kind === "descriptive") {
      if (!isDescriptiveAllowed(examScope, category)) {
        addError(`${label}: 서술형은 등록된 과정의 지정 과목만 허용됩니다.`);
      }
      if (!uniqueStrings(row.scoring_criteria).length) {
        addError(`${label}: 서술형 채점 기준이 누락되었습니다.`);
      }
      if (!uniqueStrings(row.required_concepts).length) {
        addError(`${label}: 서술형 필수 개념이 누락되었습니다.`);
      }
    } else {
      if (![2, 4].includes(choices.length)) addError(`${label}: 객관식 선택지는 OX형 2개 또는 일반형 4개여야 합니다.`);
      if (
        !correctAnswers.length
        || correctAnswers.some((answer) => answer < 0 || answer >= choices.length)
      ) {
        addError(`${label}: 객관식 정답 번호가 선택지 범위를 벗어납니다.`);
      }
    }

    const theoryId = row.theory_id === null ? null : Number(row.theory_id);
    const importedTheory = theoryId ? theoryById.get(theoryId) : undefined;
    if (theoryId && !compatibleTheory(importedTheory, row)) {
      const existingTheoryId = Number(existingQuestionById.get(id)?.theory_id ?? 0);
      const existingTheory = existingTheoryId
        ? theoryById.get(existingTheoryId)
        : undefined;
      if (compatibleTheory(existingTheory, row)) {
        row.theory_id = existingTheoryId;
        repairedTheoryLinks += 1;
        addWarning(`${label}: 파일의 연결 이론 대신 현재 검증된 연결을 보존합니다.`);
      } else {
        addError(`${label}: 연결 이론이 없거나 과목·시험 범위가 호환되지 않습니다.`);
      }
    } else if (!theoryId) {
      addWarning(`${label}: 연결 이론이 없습니다.`);
    }

    const fingerprint = questionContentFingerprint({
      kind,
      prompt,
      choices,
      correctAnswers,
    });
    const existingDuplicateId = [...(existingFingerprintOwners.get(fingerprint) ?? [])]
      .find((ownerId) => ownerId !== id);
    const fileDuplicateId = fingerprint
      ? seenQuestionFingerprints.get(fingerprint)
      : undefined;
    const duplicateId = existingDuplicateId ?? (
      fileDuplicateId !== id ? fileDuplicateId : undefined
    );
    if (duplicateId) {
      addWarning(`${label}: 문제 ID ${duplicateId}와 내용·선택지·정답이 의미상 중복될 수 있습니다.`);
    }
    if (fingerprint && !seenQuestionFingerprints.has(fingerprint)) {
      seenQuestionFingerprints.set(fingerprint, id);
    }

    if (questionIds.has(id)) updateCount += 1;
    else if (duplicateId) duplicateCount += 1;
    else newCount += 1;
  }

  for (const [index, row] of data.swTheories.entries()) {
    const id = Number(row.id);
    const label = `SW 이론 ${index + 1}`;
    if (!Number.isInteger(id) || id <= 0) addError(`${label}: ID가 유효하지 않습니다.`);
    else if (seenSwTheoryIds.has(id)) addError(`${label}: ID ${id}가 파일 안에서 중복됩니다.`);
    else seenSwTheoryIds.add(id);
    for (const [field, name] of [
      ["subject_group_id", "대분류 ID"], ["subject_id", "소분류 ID"],
      ["category", "대분류"], ["topic", "소분류"], ["title", "제목"],
      ["summary", "요약"], ["content", "본문"],
    ] as const) {
      if (!String(row[field] ?? "").trim()) addError(`${label}: ${name}이(가) 누락되었습니다.`);
    }
    if (!hasBalancedMarkdownFences(row.content)) addError(`${label}: 마크다운 코드 펜스가 닫히지 않았습니다.`);
    if (existingSwTheoryIds.has(id)) updateCount += 1;
    else newCount += 1;
  }

  for (const [index, row] of data.swQuestions.entries()) {
    const id = String(row.id ?? "").trim();
    const label = id ? `SW 문제 ID ${id}` : `SW 문제 ${index + 1}`;
    if (!id || id.length > 64) addError(`${label}: ID가 유효하지 않습니다.`);
    else if (seenSwQuestionIds.has(id)) addError(`${label}: 파일 안에서 ID가 중복됩니다.`);
    else seenSwQuestionIds.add(id);
    const theory = swTheoryById.get(Number(row.theory_id));
    if (!theory || Number(theory.active ?? 1) !== 1) {
      addError(`${label}: 연결할 활성 SW 이론을 찾을 수 없습니다.`);
    } else if (
      String(row.subject_group_id) !== String(theory.subject_group_id)
      || String(row.subject_id) !== String(theory.subject_id)
      || String(row.category) !== String(theory.category)
      || String(row.topic) !== String(theory.topic)
    ) {
      addError(`${label}: 이론과 문제의 SW 분류가 일치하지 않습니다.`);
    }
    const choices = jsonList(row.choices).map(String);
    const correctAnswers = numberList(row.correct_answers);
    if (!String(row.prompt ?? "").trim()) addError(`${label}: 본문이 누락되었습니다.`);
    if (!String(row.explanation ?? "").trim()) addError(`${label}: 해설이 누락되었습니다.`);
    if (!hasBalancedMarkdownFences(row.prompt) || !hasBalancedMarkdownFences(row.explanation)) {
      addError(`${label}: 마크다운 코드 펜스가 닫히지 않았습니다.`);
    }
    if (!["하", "중", "상"].includes(String(row.difficulty))) addError(`${label}: 난이도가 유효하지 않습니다.`);
    if (choices.length !== 4) addError(`${label}: 선택지는 4개여야 합니다.`);
    if (!correctAnswers.length || correctAnswers.some((answer) => answer < 0 || answer >= choices.length)) {
      addError(`${label}: 정답 번호가 선택지 범위를 벗어납니다.`);
    }
    const fingerprint = questionContentFingerprint({
      kind: String(row.kind ?? "single"),
      prompt: row.prompt,
      choices,
      correctAnswers,
    });
    const existingDuplicateId = [...(existingSwFingerprintOwners.get(fingerprint) ?? [])]
      .find((ownerId) => ownerId !== id);
    const fileDuplicateId = fingerprint ? seenSwQuestionFingerprints.get(fingerprint) : undefined;
    const duplicateId = existingDuplicateId ?? (fileDuplicateId !== id ? fileDuplicateId : undefined);
    if (duplicateId) {
      addWarning(`${label}: SW 문제 ID ${duplicateId}와 본문·선택지·정답이 중복될 수 있습니다.`);
    }
    if (fingerprint && !seenSwQuestionFingerprints.has(fingerprint)) {
      seenSwQuestionFingerprints.set(fingerprint, id);
    }
    if (existingSwQuestionIds.has(id)) updateCount += 1;
    else if (duplicateId) duplicateCount += 1;
    else newCount += 1;
  }

  return {
    counts: {
      questions: data.questions.length,
      theories: data.theories.length,
      swQuestions: data.swQuestions.length,
      swTheories: data.swTheories.length,
      create: newCount,
      update: updateCount,
      possibleDuplicates: duplicateCount,
      repairedTheoryLinks,
      errors: errorCount,
    },
    errors,
    errorsTruncated: errorCount > errors.length,
    warnings,
    canCommit: errorCount === 0,
  };
}

export async function previewImport(payload: JsonRecord) {
  const normalized = normalizeImport(
    typeof payload.data === "string" ? JSON.parse(payload.data) : payload.data,
  );
  if (
    normalized
    && typeof normalized === "object"
    && "metadata" in normalized
    && "data" in normalized
  ) {
    if (payload.selection && payload.selection !== "all") {
      throw new Error("백업 파일은 과목 단위로 나누지 않고 전체 콘텐츠로만 검증할 수 있습니다.");
    }
    const envelope = await validateBackupEnvelope(normalized);
    return {
      format: "backup",
      metadata: envelope.metadata,
      conflicts: await backupConflicts(envelope),
      errors: [],
    };
  }
  const selected = filterContentImportSelection(normalized as ContentImportData, payload.selection);
  const data = selected.data;
  const inspection = await inspectContentImport(data);
  return {
    format: "content",
    sourceFormat: data.sourceFormat,
    selection: selected.selection,
    includedData: data.includedData,
    ...inspection,
  };
}

export async function commitImport(identity: AdminIdentity, payload: JsonRecord) {
  const normalized = normalizeImport(
    typeof payload.data === "string" ? JSON.parse(payload.data) : payload.data,
  );
  if (
    normalized
    && typeof normalized === "object"
    && "metadata" in normalized
    && "data" in normalized
  ) {
    if (payload.selection && payload.selection !== "all") {
      throw new Error("백업 파일은 과목 단위로 나누지 않고 전체 콘텐츠로만 복원할 수 있습니다.");
    }
    const envelope = await validateBackupEnvelope(normalized);
    return restoreBackup(identity, envelope, "content-only", "", {
      skipSafetyBackup: envelope.metadata.discardWithoutBackup === true,
    });
  }
  const data = filterContentImportSelection(
    normalized as ContentImportData,
    payload.selection,
  ).data;
  const inspection = await inspectContentImport(data);
  if (!inspection.canCommit) {
    throw new Error(
      `가져오기 검증 오류 ${inspection.counts.errors}건을 먼저 수정해 주세요. ${inspection.errors[0] ?? ""}`.trim(),
    );
  }
  const metadataWithoutChecksum = {
    backupVersion: BACKUP_VERSION,
    appVersion: APP_VERSION,
    schemaVersion: SCHEMA_VERSION,
    type: "content" as const,
    source: "manual" as const,
    generatedAt: now(),
    includedData: data.includedData,
    counts: {
      theories: data.theories.length,
      questions: data.questions.length,
      sw_theories: data.swTheories.length,
      sw_questions: data.swQuestions.length,
    },
  };
  const backupData: BackupEnvelope["data"] = {
    questions: data.questions,
    theories: data.theories,
    sw_questions: data.swQuestions,
    sw_theories: data.swTheories,
  };
  const envelope: BackupEnvelope = {
    metadata: {
      ...metadataWithoutChecksum,
      checksum: await backupDigestBase(metadataWithoutChecksum, backupData),
    },
    data: backupData,
  };
  return restoreBackup(identity, envelope, "content-only", "", {
    skipSafetyBackup: inspection.counts.update === 0,
  });
}
