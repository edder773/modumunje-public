import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { openCanonicalDatabase } from "./lib/canonical-database.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const database = openCanonicalDatabase(projectRoot, { isolated: false });

const empty = {
  questions: [],
  theories: [],
  attempts: [],
  examSessions: [],
  theoryProgress: [],
  evaluations: [],
  settings: { selectedExam: "SQLP" },
};

function bytes(payload) {
  return Buffer.byteLength(JSON.stringify(payload));
}

function percentile(values, ratio) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * ratio))];
}

function timed(statement, count = 50) {
  const values = [];
  for (let index = 0; index < count; index += 1) {
    const started = performance.now();
    statement.all();
    values.push(performance.now() - started);
  }
  return {
    p75Ms: Number(percentile(values, 0.75).toFixed(3)),
    p95Ms: Number(percentile(values, 0.95).toFixed(3)),
  };
}

const theoryListStatement = database.prepare(`
  SELECT id, title, category, topic, sort_order, exam_scope, summary, keywords
  FROM theories
  WHERE active = 1 AND exam_scope IN ('both', 'SQLP')
  ORDER BY category, sort_order, id
`);
const theoryList = theoryListStatement.all().map((row) => ({
  ...row,
  content: "",
  review_answers: "",
  keywords: JSON.parse(row.keywords),
}));

const largestTheory = database.prepare(`
  SELECT * FROM theories
  WHERE active = 1 AND exam_scope IN ('both', 'SQLP')
  ORDER BY length(content) + length(review_answers) DESC
  LIMIT 1
`).get();
const theoryDetail = {
  ...largestTheory,
  active: Boolean(largestTheory.active),
  keywords: JSON.parse(largestTheory.keywords),
};

const questionWindowStatement = database.prepare(`
  SELECT * FROM questions
  WHERE active = 1 AND exam_scope IN ('both', 'SQLP')
  ORDER BY length(prompt) + length(choices) + length(explanation) DESC
  LIMIT 5
`);
const questionWindow = questionWindowStatement.all().map((row) => ({
  ...row,
  active: Boolean(row.active),
  bookmarked: false,
  choices: JSON.parse(row.choices),
  correct_answers: JSON.parse(row.correct_answers),
  tags: JSON.parse(row.tags),
  scoring_criteria: JSON.parse(row.scoring_criteria),
  required_concepts: JSON.parse(row.required_concepts),
  acceptable_alternatives: JSON.parse(row.acceptable_alternatives),
  deduction_conditions: JSON.parse(row.deduction_conditions),
  error_conditions: JSON.parse(row.error_conditions),
}));

const practiceCandidateStatement = database.prepare(`
  SELECT id FROM questions
  WHERE active = 1 AND practice_scope = 'general'
    AND exam_scope = 'SQLP' AND category = 'SQL 고급 활용 및 튜닝'
    AND kind = 'single'
  ORDER BY display_order, id LIMIT 12
`);
const mockCandidateStatement = database.prepare(`
  SELECT id, category, exam_scope, kind, practice_scope, variant_group_id,
    choices, correct_answers
  FROM questions
  WHERE active = 1 AND practice_scope = 'general'
    AND exam_scope IN ('both', 'SQLP') AND id != 722
  ORDER BY display_order, id
`);
const scopedValidationStatement = database.prepare(`
  SELECT id, kind, choices, correct_answers
  FROM questions WHERE active = 1 AND id IN (1, 2, 3, 4, 5)
`);
const overviewStatement = database.prepare(`
  SELECT
    (SELECT COUNT(*) FROM questions WHERE active = 1) AS question_count,
    (SELECT COUNT(*) FROM theories WHERE active = 1) AS theory_count
`);
const overview = overviewStatement.get();
const scopes = {
  overview: bytes({ ...empty, overview }),
  theoryList: bytes({ ...empty, theories: theoryList }),
  largestTheoryDetail: bytes({
    ...empty,
    theories: [theoryDetail],
    theoryNavigation: { linkedCount: 0, previous: theoryList[0], next: theoryList[1] },
  }),
  worstCasePracticeWindow5: bytes({ ...empty, questions: questionWindow }),
  worstCaseMockWindow5: bytes({ ...empty, questions: questionWindow }),
};
const payloadBudgets = {
  overview: 512,
  theoryList: 100_000,
  largestTheoryDetail: 48_000,
  worstCasePracticeWindow5: 40_000,
  worstCaseMockWindow5: 40_000,
};
const budgetFailures = Object.entries(payloadBudgets)
  .filter(([key, budget]) => scopes[key] > budget)
  .map(([key, budget]) => ({ key, bytes: scopes[key], budgetBytes: budget }));

console.log(JSON.stringify({
  environment: process.env.BAEUMZIP_TEST_DATABASE
    ? "prepared SQLite data-layer benchmark (not deployed RUM)"
    : "in-memory SQLite data-layer benchmark (not deployed RUM)",
  payloadBytes: scopes,
  payloadBudgets,
  budgetFailures,
  payloadKiB: Object.fromEntries(
    Object.entries(scopes).map(([key, value]) => [key, Number((value / 1024).toFixed(2))]),
  ),
  localQuery: {
    overview: timed(overviewStatement),
    theoryList: timed(theoryListStatement),
    practiceWindow5: timed(questionWindowStatement),
    practiceCandidates12: timed(practiceCandidateStatement),
    mockCandidateMetadata: timed(mockCandidateStatement),
    guestValidation5: timed(scopedValidationStatement),
  },
}, null, 2));
if (budgetFailures.length) process.exitCode = 1;
