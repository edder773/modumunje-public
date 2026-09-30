import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import {
  extractModelAnswer,
  normalizeComparableContent,
} from "../packages/shared/src/content/content-format.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const database = new DatabaseSync(":memory:");
const migrations = fs.readdirSync(path.join(projectRoot, "apps/backend/drizzle"))
  .filter((name) => /^\d+.*[.]sql$/.test(name))
  .sort();

for (const migration of migrations) {
  database.exec(fs.readFileSync(path.join(projectRoot, "apps/backend/drizzle", migration), "utf8"));
}

const questions = database.prepare(`
  SELECT q.*, t.id AS linked_theory_id, t.active AS linked_theory_active,
         t.category AS linked_theory_category, t.exam_scope AS linked_theory_scope
  FROM questions q
  LEFT JOIN theories t ON t.id = q.theory_id
  WHERE q.active = 1
  ORDER BY q.id
`).all();

const sourceArtifactPattern = /(?:^|\n)\s*(?:#{1,6}\s*)?(?:\d+\s*부\s*[:：]|수록\s*문항|출처\s*[:：]|원본\s*[:：]|out\(\d+\)\.pdf|\.pdf\s*[—-])/imu;
const placeholderAnswerPattern = /^(?:모범답안|정답|해설)(?:을|을\s+)?\s*(?:참조|확인)|^(?:없음|미정|n\/a)$/iu;
const longPrompts = [];
const brokenAnswers = [];
const sourceArtifacts = [];
const missingTheories = [];
const theoryDifficulties = database.prepare(
  "SELECT difficulty, COUNT(*) AS count FROM theories GROUP BY difficulty ORDER BY difficulty",
).all();
const genericImportHeadings = [];

for (const question of questions) {
  const prompt = String(question.prompt ?? "");
  const explanation = String(question.explanation ?? "");
  if (prompt.length > 900 || prompt.split(/\r?\n/)[0].length > 180) {
    longPrompts.push({
      id: question.id,
      kind: question.kind,
      length: prompt.length,
      firstLine: prompt.split(/\r?\n/)[0].slice(0, 240),
    });
  }
  if (/^\s*#{1,6}\s+SQLP\s+(?:확장\s+문제|튜닝\s+실전)\s+\d+/i.test(prompt)) {
    genericImportHeadings.push(question.id);
  }
  if (question.kind === "descriptive") {
    const modelAnswer = extractModelAnswer(explanation);
    const normalizedAnswer = normalizeComparableContent(modelAnswer);
    const technicalShortAnswer = normalizedAnswer.length >= 12
      && /(?:\b(?:no_merge|leading|ordered|use_nl|use_hash|use_merge|index|full|push_subq|no_unnest)\b|(?:select|insert|update|delete)\s+)/i
        .test(normalizedAnswer);
    if (
      (!technicalShortAnswer && normalizedAnswer.length < 48)
      || placeholderAnswerPattern.test(modelAnswer.trim())
      || sourceArtifactPattern.test(modelAnswer)
    ) {
      brokenAnswers.push({
        id: question.id,
        answerLength: normalizedAnswer.length,
        modelAnswer: modelAnswer.slice(0, 320),
      });
    }
  }
  if (sourceArtifactPattern.test(explanation)) {
    sourceArtifacts.push({
      id: question.id,
      excerpt: explanation.match(sourceArtifactPattern)?.[0]?.trim() ?? "",
    });
  }
  const scopeCompatible = question.exam_scope === "both"
    || question.linked_theory_scope === "both"
    || question.exam_scope === question.linked_theory_scope;
  if (
    !question.theory_id
    || !question.linked_theory_id
    || question.linked_theory_active !== 1
    || question.category !== question.linked_theory_category
    || !scopeCompatible
  ) {
    missingTheories.push({
      id: question.id,
      category: question.category,
      topic: question.topic,
      examScope: question.exam_scope,
      theoryId: question.theory_id,
      linkedCategory: question.linked_theory_category,
      linkedScope: question.linked_theory_scope,
    });
  }
}

console.log(JSON.stringify({
  totals: {
    activeQuestions: questions.length,
    descriptiveQuestions: questions.filter((question) => question.kind === "descriptive").length,
    longPrompts: longPrompts.length,
    brokenAnswers: brokenAnswers.length,
    sourceArtifacts: sourceArtifacts.length,
    missingTheories: missingTheories.length,
    genericImportHeadings: genericImportHeadings.length,
  },
  theoryDifficulties,
  brokenAnswers,
  brokenAnswerDetails: questions
    .filter((question) => brokenAnswers.some((item) => item.id === question.id))
    .map((question) => ({
      id: question.id,
      category: question.category,
      topic: question.topic,
      prompt: question.prompt,
      explanation: question.explanation,
      scoringCriteria: question.scoring_criteria,
      requiredConcepts: question.required_concepts,
      theoryId: question.theory_id,
    })),
  sourceArtifacts,
  sourceArtifactDetails: questions
    .filter((question) => sourceArtifacts.some((item) => item.id === question.id))
    .map((question) => ({
      id: question.id,
      prompt: question.prompt,
      explanation: question.explanation,
    })),
  missingTheories,
  longPrompts: longPrompts.slice(0, 120),
  candidateTheories: database.prepare(`
    SELECT id, title, category, topic, exam_scope
    FROM theories
    WHERE active = 1
      AND (
        title LIKE '%실행계획%'
        OR title LIKE '%랜덤 액세스%'
        OR title LIKE '%인덱스 설계%'
        OR title LIKE '%소트%'
        OR title LIKE '%서브쿼리%'
        OR title LIKE '%조인 순서%'
        OR title LIKE '%조인 제거%'
      )
    ORDER BY category, sort_order, id
  `).all(),
}, null, 2));
