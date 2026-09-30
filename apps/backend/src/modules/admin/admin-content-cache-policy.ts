// These are server-authored statements, never user-provided SQL. Treat unfamiliar
// CTE writes conservatively; ordinary SELECTs use the repository read methods.
export function changesPublicContent(sql: string) {
  const statement = sql.replace(/\/\*[\s\S]*?\*\/|--[^\n]*/gu, " ").trim();
  if (/^WITH\b/iu.test(statement)) return true;
  const target = statement.match(
    /^(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|REPLACE\s+INTO|UPDATE(?:\s+OR\s+\w+)?|DELETE\s+FROM)\s+[`"\[]?(\w+)/iu,
  )?.[1]?.toLowerCase();
  return Boolean(target && [
    "questions", "theories", "sw_questions", "sw_theories", "sw_question_tags",
    "content_releases", "course_content_scopes", "course_subjects", "site_settings",
  ].includes(target));
}
