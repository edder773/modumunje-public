import { learnerQuestionSql } from "./study-content-visibility";
import {
  CONTENT_REVISION_CHANGED_SQL, contentCacheRevisionFromRow,
  contentCacheRevisionReadStatement, contentRevisionChangedBindings,
  type RevisionRow,
} from "@backend/common/content/content-cache-revision";
import {
  acceptedContentScopes,
  type ExamType,
} from "./domain/study.domain";

type QueryResult = { results?: unknown[] } | undefined;

function rowsFrom<T>(result: QueryResult) {
  return (result?.results ?? []) as T[];
}

type TheoryListRow = {
  updatedAt: string;
  id: number;
  title: string;
  category: string;
  topic: string;
  sortOrder: number;
  examScope: string;
  summary: string;
  keywords: string;
};

type TheoryProgressRow = {
  id: number;
  userKey: string;
  theoryId: number;
  examType: string;
  completed: number;
  updatedAt: string;
};

function fallbackSetting(userKey: string | undefined, selectedExam: ExamType) {
  return {
    userKey: userKey ?? "",
    selectedExam,
    createdAt: "",
    updatedAt: "",
  };
}

function theoryListStatement(database: D1Database, selectedExam: ExamType,
  cachedRevision?: [string, string, string] | null) {
  const scopes = acceptedContentScopes(selectedExam);
  const placeholders = scopes.map(() => "?").join(", ");
  return database.prepare(`
    ${cachedRevision === undefined ? "" : `WITH cache_gate AS MATERIALIZED (SELECT 1 WHERE ${CONTENT_REVISION_CHANGED_SQL})`}
    SELECT id, title, category, topic, sort_order AS sortOrder,
      exam_scope AS examScope, summary, keywords, updated_at AS updatedAt
    FROM ${cachedRevision === undefined ? "theories" : "cache_gate CROSS JOIN theories"}
    WHERE active = 1 AND exam_scope IN (${placeholders})
    ORDER BY category, sort_order, id
  `).bind(...(cachedRevision === undefined ? [] : contentRevisionChangedBindings(cachedRevision)), ...scopes);
}

export async function readTheoryListRows(database: D1Database, selectedExam: ExamType) {
  return rowsFrom<TheoryListRow>(await theoryListStatement(database, selectedExam).all());
}

export async function readTheoryListUserContext(
  _database: D1Database, userKey: string, selectedExam: ExamType,
) {
  return { progressRows: [] as TheoryProgressRow[], setting: fallbackSetting(userKey, selectedExam) };
}

export async function readTheoryListContext(
  database: D1Database, userKey: string | undefined, selectedExam: ExamType,
) {
  return { rows: await readTheoryListRows(database, selectedExam), progressRows: [] as TheoryProgressRow[], setting: fallbackSetting(userKey, selectedExam) };
}

function theoryDetailStatement(
  database: D1Database,
  theoryId: number,
  selectedExam: ExamType,
  cachedRevision?: [string, string, string] | null,
) {
  const scopes = acceptedContentScopes(selectedExam);
  const placeholders = scopes.map(() => "?").join(", ");
  return database.prepare(`
    WITH ${cachedRevision === undefined ? "" : `cache_gate AS MATERIALIZED (SELECT 1 WHERE ${CONTENT_REVISION_CHANGED_SQL}),`}
    eligible AS (
      SELECT id,
        LAG(id) OVER (ORDER BY category, sort_order, id) AS previous_id,
        LEAD(id) OVER (ORDER BY category, sort_order, id) AS next_id
      FROM ${cachedRevision === undefined ? "theories" : "cache_gate CROSS JOIN theories"}
      WHERE active = 1 AND exam_scope IN (${placeholders})
    )
    SELECT current.id, current.title, current.category, current.topic,
      current.sort_order AS sortOrder, current.exam_scope AS examScope,
      current.difficulty, current.active, current.summary, current.content,
      current.review_answers AS reviewAnswers, current.keywords,
      current.created_at AS createdAt, current.updated_at AS updatedAt,
      previous.id AS previousId, previous.title AS previousTitle,
      previous.category AS previousCategory, previous.topic AS previousTopic,
      previous.sort_order AS previousSortOrder,
      previous.exam_scope AS previousExamScope,
      previous.summary AS previousSummary, previous.keywords AS previousKeywords,
      following.id AS nextId, following.title AS nextTitle,
      following.category AS nextCategory, following.topic AS nextTopic,
      following.sort_order AS nextSortOrder,
      following.exam_scope AS nextExamScope,
      following.summary AS nextSummary, following.keywords AS nextKeywords,
      (SELECT COUNT(*) FROM questions
        WHERE active = 1 AND ${learnerQuestionSql()} AND theory_id = current.id) AS linkedCount
    FROM ${cachedRevision === undefined ? "" : "cache_gate CROSS JOIN "}eligible
    JOIN theories AS current ON current.id = eligible.id
    LEFT JOIN theories AS previous ON previous.id = eligible.previous_id
    LEFT JOIN theories AS following ON following.id = eligible.next_id
    WHERE eligible.id = ?
  `).bind(...(cachedRevision === undefined ? [] : contentRevisionChangedBindings(cachedRevision)), ...scopes, theoryId);
}

export async function readTheoryDetailRow(
  database: D1Database,
  theoryId: number,
  selectedExam: ExamType,
) {
  return rowsFrom<Record<string, unknown>>(
    await theoryDetailStatement(database, theoryId, selectedExam).all(),
  )[0];
}

export async function readTheoryListAndDetailRows(
  database: D1Database,
  selectedExam: ExamType,
  theoryId?: number,
) {
  const statements = [theoryListStatement(database, selectedExam)];
  if (theoryId) statements.push(theoryDetailStatement(database, theoryId, selectedExam));
  const [listResult, detailResult] = await database.batch(statements);
  return {
    rows: rowsFrom<TheoryListRow>(listResult),
    context: rowsFrom<Record<string, unknown>>(detailResult)[0] ?? null,
  };
}

export async function readTheoryListAndDetailWithRevision(
  database: D1Database,
  selectedExam: ExamType,
  theoryId: number | undefined,
  cachedRevision: [string, string, string] | null,
) {
  const statements = [
    contentCacheRevisionReadStatement(database),
    theoryListStatement(database, selectedExam, cachedRevision),
  ];
  if (theoryId) statements.push(theoryDetailStatement(database, theoryId, selectedExam, cachedRevision));
  const [revisionResult, listResult, detailResult] = await database.batch(statements);
  return {
    revision: contentCacheRevisionFromRow(rowsFrom<RevisionRow>(revisionResult)[0]),
    rows: rowsFrom<TheoryListRow>(listResult),
    context: rowsFrom<Record<string, unknown>>(detailResult)[0] ?? null,
  };
}

export async function readTheoryDetailUserContext(
  _database: D1Database, _theoryId: number, userKey: string, selectedExam: ExamType,
) {
  return { progressRows: [] as TheoryProgressRow[], setting: fallbackSetting(userKey, selectedExam) };
}

export async function readTheoryDetailContext(
  database: D1Database, theoryId: number, userKey: string | undefined, selectedExam: ExamType,
) {
  return { context: await readTheoryDetailRow(database, theoryId, selectedExam), progressRows: [] as TheoryProgressRow[], setting: fallbackSetting(userKey, selectedExam) };
}
