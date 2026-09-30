import { validateAdminAnswerIndices } from "@shared/admin/question-answer-input";
import { certificationAdminField } from "@shared/admin/content-domains";
import {
  type D1Row,
  type JsonRecord,
  allRows,
  boundedInteger,
  canonicalContentSource,
  createRowsExportStream,
  execute,
  exportFilename,
  firstRow,
  integer,
  now,
  jsonList,
  requiredString,
  searchTokens,
  sqlLike,
  swTheoryValues,
  uniqueStrings,
} from "./admin-use-case-runtime";
import { contentScopesForField } from "@shared/study/study-domain";

function appendContentDomainExportFilter(url: URL, where: string[], values: unknown[]) {
  const domain = url.searchParams.get("contentDomain");
  const fieldId = certificationAdminField(domain);
  if (!fieldId) return;
  const scopes = contentScopesForField(fieldId);
  where.push(`exam_scope IN (${scopes.map(() => "?").join(",")})`);
  values.push(...scopes);
}

export function questionExportParameters(url: URL) {
  const active = url.searchParams.get("active");
  return {
    ids: (url.searchParams.get("ids") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .map(Number)
      .filter((value) => Number.isInteger(value) && value > 0)
      .slice(0, 200),
    search: (url.searchParams.get("search") ?? "").trim(),
    examScope: url.searchParams.get("examScope") ?? "",
    category: url.searchParams.get("category") ?? "",
    kind: url.searchParams.get("kind") ?? "",
    difficulty: url.searchParams.get("difficulty") ?? "",
    active: active === "active" || active === "inactive" ? active : "",
    contentDomain: url.searchParams.get("contentDomain") ?? "",
  };
}

export function questionExportFilter(url: URL) {
  const where = ["1 = 1"];
  const values: unknown[] = [];
  appendContentDomainExportFilter(url, where, values);
  const parameters = questionExportParameters(url);
  if (parameters.ids.length) {
    where.push(`id IN (${parameters.ids.map(() => "?").join(",")})`);
    values.push(...parameters.ids);
  }
  for (const token of searchTokens(parameters.search)) {
    const term = sqlLike(token);
    where.push(`(
      prompt LIKE ? ESCAPE '\\'
      OR topic LIKE ? ESCAPE '\\'
      OR tags LIKE ? ESCAPE '\\'
      OR CAST(id AS TEXT) LIKE ? ESCAPE '\\'
      OR CAST(display_order AS TEXT) LIKE ? ESCAPE '\\'
    )`);
    values.push(term, term, term, term, term);
  }
  for (const [column, value] of [
    ["exam_scope", parameters.examScope],
    ["category", parameters.category],
    ["kind", parameters.kind],
    ["difficulty", parameters.difficulty],
  ]) {
    if (value) {
      where.push(`${column} = ?`);
      values.push(value);
    }
  }
  if (parameters.active) {
    where.push("active = ?");
    values.push(parameters.active === "active" ? 1 : 0);
  }
  return { where, values };
}

export type QuestionExportSource = {
  source: "database" | "canonical-recovery";
  total: number;
  loadPage: (offset: number, limit: number) => Promise<D1Row[]>;
};

export async function readQuestionExportSource(url: URL): Promise<QuestionExportSource> {
  const bankCount = await firstRow<{ total: number }>(
    "SELECT COUNT(*) AS total FROM questions",
  );
  if (Number(bankCount?.total ?? 0) > 0) {
    const { where, values } = questionExportFilter(url);
    const clause = where.join(" AND ");
    const count = await firstRow<{ total: number }>(
      `SELECT COUNT(*) AS total FROM questions WHERE ${clause}`,
      values,
    );
    return {
      source: "database",
      total: Number(count?.total ?? 0),
      loadPage: (offset, limit) => allRows(
        `SELECT * FROM questions WHERE ${clause}
         ORDER BY display_order, id LIMIT ? OFFSET ?`,
        [...values, limit, offset],
      ),
    };
  }

  // Recovery is explicit and lazy: normal admin and learner requests never
  // decode the complete canonical bank.
  const parameters = questionExportParameters(url);
  const rows = await canonicalContentSource.loadQuestions(parameters) as D1Row[];
  const fieldId = certificationAdminField(parameters.contentDomain);
  const allowedScopes = fieldId ? new Set(contentScopesForField(fieldId)) : null;
  const scopedRows = allowedScopes
    ? rows.filter((row) => allowedScopes.has(String(row.exam_scope) as never))
    : rows;
  return {
    source: "canonical-recovery",
    total: scopedRows.length,
    loadPage: async (offset, limit) => scopedRows.slice(offset, offset + limit),
  };
}

export function theoryExportParameters(url: URL) {
  const active = url.searchParams.get("active");
  return {
    category: url.searchParams.get("category") ?? "",
    examScope: url.searchParams.get("examScope") ?? "",
    topic: url.searchParams.get("topic") ?? "",
    active: active === "active" || active === "inactive" ? active : "",
    contentDomain: url.searchParams.get("contentDomain") ?? "",
  };
}

export function theoryExportFilter(url: URL) {
  const where = ["1 = 1"];
  const values: unknown[] = [];
  appendContentDomainExportFilter(url, where, values);
  const parameters = theoryExportParameters(url);
  for (const [column, value] of [
    ["category", parameters.category],
    ["exam_scope", parameters.examScope],
    ["topic", parameters.topic],
  ]) {
    if (value) {
      where.push(`${column} = ?`);
      values.push(value);
    }
  }
  if (parameters.active) {
    where.push("active = ?");
    values.push(parameters.active === "active" ? 1 : 0);
  }
  return { where, values };
}

export async function readTheoryExportSource(url: URL): Promise<QuestionExportSource> {
  const bankCount = await firstRow<{ total: number }>(
    "SELECT COUNT(*) AS total FROM theories",
  );
  if (Number(bankCount?.total ?? 0) > 0) {
    const { where, values } = theoryExportFilter(url);
    const clause = where.join(" AND ");
    const count = await firstRow<{ total: number }>(
      `SELECT COUNT(*) AS total FROM theories WHERE ${clause}`,
      values,
    );
    return {
      source: "database",
      total: Number(count?.total ?? 0),
      loadPage: (offset, limit) => allRows(
        `SELECT * FROM theories WHERE ${clause}
         ORDER BY category, sort_order, id LIMIT ? OFFSET ?`,
        [...values, limit, offset],
      ),
    };
  }
  const parameters = theoryExportParameters(url);
  const rows = await canonicalContentSource.loadTheories(parameters) as D1Row[];
  const fieldId = certificationAdminField(parameters.contentDomain);
  const allowedScopes = fieldId ? new Set(contentScopesForField(fieldId)) : null;
  const scopedRows = allowedScopes
    ? rows.filter((row) => allowedScopes.has(String(row.exam_scope) as never))
    : rows;
  return {
    source: "canonical-recovery",
    total: scopedRows.length,
    loadPage: async (offset, limit) => scopedRows.slice(offset, offset + limit),
  };
}

const ROW_EXPORT_SCOPES = ["questions", "theories", "sw-questions", "sw-theories"] as const;
export type RowExportScope = typeof ROW_EXPORT_SCOPES[number];

export function isRowExportScope(value: string): value is RowExportScope {
  return ROW_EXPORT_SCOPES.includes(value as RowExportScope);
}

export async function readSwExportSource(
  scope: "sw-questions" | "sw-theories",
  url: URL,
): Promise<QuestionExportSource> {
  const isQuestion = scope === "sw-questions";
  const table = isQuestion ? "sw_questions" : "sw_theories";
  const where = ["1 = 1"];
  const values: unknown[] = [];
  const search = (url.searchParams.get("search") ?? "").trim();
  for (const token of searchTokens(search)) {
    const term = sqlLike(token);
    where.push(isQuestion
      ? `(prompt LIKE ? ESCAPE '\\' OR topic LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\' OR CAST(id AS TEXT) LIKE ? ESCAPE '\\')`
      : `(title LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\' OR topic LIKE ? ESCAPE '\\' OR CAST(id AS TEXT) LIKE ? ESCAPE '\\')`);
    values.push(term, term, term, term);
  }
  for (const [column, value] of [
    ["subject_group_id", url.searchParams.get("subjectGroupId") ?? url.searchParams.get("subjectGroup") ?? ""],
    ["subject_id", url.searchParams.get("subjectId") ?? url.searchParams.get("subject") ?? ""],
    ["category", url.searchParams.get("category") ?? ""],
    ["difficulty", isQuestion ? url.searchParams.get("difficulty") ?? "" : ""],
  ]) {
    if (value) {
      where.push(`${column} = ?`);
      values.push(value);
    }
  }
  const active = url.searchParams.get("active");
  if (active === "active" || active === "inactive") {
    where.push("active = ?");
    values.push(active === "active" ? 1 : 0);
  }
  const clause = where.join(" AND ");
  const count = await firstRow<{ total: number }>(
    `SELECT COUNT(*) AS total FROM ${table} WHERE ${clause}`,
    values,
  );
  return {
    source: "database",
    total: Number(count?.total ?? 0),
    loadPage: (offset, limit) => allRows(
      `SELECT * FROM ${table} WHERE ${clause}
       ORDER BY ${isQuestion ? "display_order" : "sort_order"}, id LIMIT ? OFFSET ?`,
      [...values, limit, offset],
    ),
  };
}

export async function readExportPage(url: URL) {
  const scope = url.searchParams.get("scope") ?? "questions";
  if (!isRowExportScope(scope)) {
    throw new Error("분할 내보내기 대상이 유효하지 않습니다.");
  }
  const page = boundedInteger(url.searchParams.get("page"), 1, 999999, 1);
  const pageSize = boundedInteger(url.searchParams.get("pageSize"), 25, 100, 75);
  const offset = (page - 1) * pageSize;
  let rows: D1Row[];
  let total: number;
  let source: "database" | "canonical-recovery" = "database";
  if (scope === "questions") {
    const questionSource = await readQuestionExportSource(url);
    source = questionSource.source;
    total = questionSource.total;
    rows = await questionSource.loadPage(offset, pageSize);
  } else if (scope === "theories") {
    const theorySource = await readTheoryExportSource(url);
    source = theorySource.source;
    total = theorySource.total;
    rows = await theorySource.loadPage(offset, pageSize);
  } else {
    const swSource = await readSwExportSource(scope, url);
    source = swSource.source;
    total = swSource.total;
    rows = await swSource.loadPage(offset, pageSize);
  }
  return {
    scope,
    page,
    pageSize,
    total,
    rows,
    source,
    hasMore: offset + rows.length < total,
  };
}

export async function streamRowExport(url: URL, exportedAt: string) {
  const scope = url.searchParams.get("scope") ?? "questions";
  if (!isRowExportScope(scope)) {
    throw new Error("내보내기 대상이 유효하지 않습니다.");
  }
  const format = url.searchParams.get("format") === "csv" ? "csv" : "json";
  const pageSize = 75;
  let source: "database" | "canonical-recovery" = "database";
  let total: number;
  let loadPage: (offset: number, limit: number) => Promise<D1Row[]>;
  if (scope === "questions") {
    const questionSource = await readQuestionExportSource(url);
    source = questionSource.source;
    total = questionSource.total;
    loadPage = questionSource.loadPage;
  } else if (scope === "theories") {
    const theorySource = await readTheoryExportSource(url);
    source = theorySource.source;
    total = theorySource.total;
    loadPage = theorySource.loadPage;
  } else {
    const swSource = await readSwExportSource(scope, url);
    source = swSource.source;
    total = swSource.total;
    loadPage = swSource.loadPage;
  }
  if (total < 1) {
    throw new Error(scope.includes("questions")
      ? "내보낼 문제가 0건입니다. 문제은행 데이터를 다시 확인해 주세요."
      : "내보낼 이론이 0건입니다. 이론 데이터를 다시 확인해 주세요.");
  }

  const stream = createRowsExportStream({
    scope,
    format,
    total,
    exportedAt,
    pageSize,
    loadPage,
  });
  const extension = format === "csv" ? "csv" : "json";
  return {
    count: total,
    response: new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": extension === "csv"
          ? "text/csv; charset=utf-8"
          : "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${exportFilename(
          scope,
          extension,
          exportedAt,
          url.searchParams.get("category") ?? url.searchParams.get("subjectId") ?? "",
        )}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Baeumzip-Export-Scope": scope,
        "X-Baeumzip-Export-Count": String(total),
        "X-Baeumzip-Export-Source": source,
      },
    }),
  };
}

export async function exportData(url: URL) {
  const scope = url.searchParams.get("scope") ?? "questions";
  const exportedAt = now();
  if (isRowExportScope(scope)) {
    return streamRowExport(url, exportedAt);
  }
  let data: unknown;
  let count: number | null = null;
  if (scope === "links") {
    const links = await allRows(`
      SELECT id AS question_id, theory_id FROM questions
      WHERE theory_id IS NOT NULL ORDER BY id
    `);
    count = links.length;
    data = {
      exportedAt,
      count,
      links,
    };
  } else if (scope === "statistics") {
    const questionStatistics = await allRows(`
      SELECT q.id, q.display_order, q.category, q.topic, q.difficulty,
             COUNT(a.id) AS attempts,
             SUM(a.result = 'correct') AS correct,
             SUM(a.result IN ('incorrect', 'partial')) AS incorrect
      FROM questions q LEFT JOIN attempts a ON a.question_id = q.id
      GROUP BY q.id ORDER BY q.display_order
    `);
    count = questionStatistics.length;
    data = {
      exportedAt,
      count,
      questionStatistics,
    };
  } else {
    throw new Error("내보내기 대상이 유효하지 않습니다.");
  }
  const serialized = JSON.stringify(data, null, 2);
  return {
    count,
    response: new Response(serialized, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${exportFilename(scope, "json", exportedAt)}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Baeumzip-Export-Scope": scope,
        "X-Baeumzip-Export-Count": String(count ?? 0),
      },
    }),
  };
}

export async function swQuestionValues(payload: JsonRecord) {
  const theoryId = integer(payload.theoryId);
  const theory = await firstRow<{
    id: number;
    subject_group_id: string;
    subject_id: string;
    category: string;
    topic: string;
  }>(`SELECT id, subject_group_id, subject_id, category, topic FROM sw_theories WHERE id = ?`, [theoryId]);
  if (!theory) throw new Error("연결할 SW 이론을 찾을 수 없습니다.");
  const choices = Array.isArray(payload.choices) ? payload.choices.map((item) => String(item).trim()) : [];
  const kind = payload.kind === "multiple" ? "multiple" : "single";
  if (choices.length !== 4 || choices.some((choice) => !choice)) throw new Error("SW 문제 선택지는 4개가 필요합니다.");
  const correctAnswers = validateAdminAnswerIndices(jsonList(payload.correctAnswers), choices.length, kind);
  return {
    theoryId,
    subjectGroupId: theory.subject_group_id,
    subjectId: theory.subject_id,
    category: theory.category,
    topic: theory.topic,
    displayOrder: Math.max(0, integer(payload.displayOrder)),
    difficulty: ["하", "중", "상"].includes(String(payload.difficulty)) ? String(payload.difficulty) : "중",
    difficultyRationale: String(payload.difficultyRationale ?? "").trim(),
    kind,
    prompt: requiredString(payload.prompt, "SW 문제 본문"),
    choices: JSON.stringify(choices),
    correctAnswers: JSON.stringify(correctAnswers),
    explanation: requiredString(payload.explanation, "SW 문제 해설"),
    tags: JSON.stringify(uniqueStrings(payload.tags)),
    requiredConcepts: JSON.stringify(uniqueStrings(payload.requiredConcepts)),
    active: payload.active === false ? 0 : 1,
  };
}

export async function createSwQuestion(payload: JsonRecord) {
  const values = await swQuestionValues(payload);
  const id = typeof payload.id === "string" && /^[A-Z0-9-]{4,64}$/u.test(payload.id.trim())
    ? payload.id.trim()
    : `SW-MANUAL-${crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
  const displayOrder = values.displayOrder || Number((await firstRow<{ next_order: number }>(
    "SELECT COALESCE(MAX(display_order), 0) + 1 AS next_order FROM sw_questions",
  ))?.next_order ?? 1);
  await execute(`
    INSERT INTO sw_questions (
      id, theory_id, subject_group_id, subject_id, category, topic,
      display_order, difficulty, difficulty_rationale, kind, prompt, choices,
      correct_answers, explanation, tags, required_concepts, active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [id, values.theoryId, values.subjectGroupId, values.subjectId, values.category, values.topic,
    displayOrder, values.difficulty, values.difficultyRationale, values.kind, values.prompt,
    values.choices, values.correctAnswers, values.explanation, values.tags, values.requiredConcepts,
    values.active, now(), now()]);
  return firstRow("SELECT * FROM sw_questions WHERE id = ?", [id]);
}

export async function updateSwQuestion(payload: JsonRecord) {
  const id = requiredString(payload.id, "SW 문제 ID");
  const before = await firstRow("SELECT * FROM sw_questions WHERE id = ?", [id]);
  if (!before) throw new Error("수정할 SW 문제를 찾을 수 없습니다.");
  const values = await swQuestionValues(payload);
  await execute(`
    UPDATE sw_questions SET
      theory_id = ?, subject_group_id = ?, subject_id = ?, category = ?, topic = ?,
      display_order = ?, difficulty = ?, difficulty_rationale = ?, kind = ?, prompt = ?,
      choices = ?, correct_answers = ?, explanation = ?, tags = ?, required_concepts = ?,
      active = ?, updated_at = ?
    WHERE id = ?
  `, [values.theoryId, values.subjectGroupId, values.subjectId, values.category, values.topic,
    values.displayOrder, values.difficulty, values.difficultyRationale, values.kind, values.prompt,
    values.choices, values.correctAnswers, values.explanation, values.tags, values.requiredConcepts,
    values.active, now(), id]);
  return { before, after: await firstRow("SELECT * FROM sw_questions WHERE id = ?", [id]) };
}

export async function createSwTheory(payload: JsonRecord) {
  const values = swTheoryValues(payload);
  const id = Number((await firstRow<{ next_id: number }>(
    "SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM sw_theories",
  ))?.next_id ?? 1);
  await execute(`
    INSERT INTO sw_theories (
      id, subject_group_id, subject_id, category, topic, title, summary, content,
      review_answers, keywords, sort_order, active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [id, values.subjectGroupId, values.subjectId, values.category, values.topic,
    values.title, values.summary, values.content, values.reviewAnswers, values.keywords,
    values.sortOrder, values.active, now(), now()]);
  return firstRow("SELECT * FROM sw_theories WHERE id = ?", [id]);
}

export async function updateSwTheory(payload: JsonRecord) {
  const id = integer(payload.id);
  const before = await firstRow("SELECT * FROM sw_theories WHERE id = ?", [id]);
  if (!before) throw new Error("수정할 SW 이론을 찾을 수 없습니다.");
  const values = swTheoryValues(payload);
  await execute(`
    UPDATE sw_theories SET
      subject_group_id = ?, subject_id = ?, category = ?, topic = ?, title = ?,
      summary = ?, content = ?, review_answers = ?, keywords = ?, sort_order = ?,
      active = ?, updated_at = ?
    WHERE id = ?
  `, [values.subjectGroupId, values.subjectId, values.category, values.topic, values.title,
    values.summary, values.content, values.reviewAnswers, values.keywords, values.sortOrder,
    values.active, now(), id]);
  return { before, after: await firstRow("SELECT * FROM sw_theories WHERE id = ?", [id]) };
}
