import { readFeatureSource } from "./helpers/feature-source.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function source(file) {
  return readFeatureSource(path.join(projectRoot, file), "utf8");
}

test("learner aggregates use the shared objective and graded practical attempt policy", () => {
  const component = source("apps/frontend/src/features/study/components/study-app.tsx");

  assert.match(
    component,
    /const objectiveExamAttempts = useMemo\([\s\S]*?gradedPracticeAttempts\(availableQuestions, examAttempts, selectedExam\)/,
  );
  assert.match(
    component,
    /<LearningRecordsHub[\s\S]*?objectiveAttempts=\{objectiveExamAttempts\}/,
  );
  assert.match(
    component,
    /<StatsView[\s\S]*?attempts=\{objectiveAttempts\}/,
  );
  assert.match(
    component,
    /const streak = studyDataLoaded[\s\S]*?calcStreak\(objectiveExamAttempts\)[\s\S]*?courseOverview\?\.streak \?\? calcStreak\(objectiveExamAttempts\)/,
  );
});

test("subject records count objective and automatically graded practical questions", () => {
  const styles = source("apps/frontend/app/globals.css");
  const stats = source("apps/frontend/src/features/study/components/sql/records/records-screen.tsx");

  assert.match(
    stats,
    /for \(const question of questions\) \{[\s\S]*?if \(!isObjectiveKind\(question\.kind\) && question\.examScope !== "IPEP"\) continue;[\s\S]*?questionById\.set\(question\.id/,
  );
  assert.match(
    stats,
    /accuracy: counts\.attempts[\s\S]*?Math\.round\(\(counts\.correct \/ counts\.attempts\) \* 100\)/,
  );
  assert.match(stats, /const questionById = new Map<number, QuestionMeta>\(\)/);
  assert.match(stats, /\{practiceKind\} 정답률 \{item\.accuracy === null \? "—" : `\$\{item\.accuracy\}%`\}/);
  assert.match(stats, /\{examDisplayName\(examType\)\} \{practiceKind\} 풀이 요약/);
  assert.doesNotMatch(stats, /서술형 평가는 포함하지 않습니다/);
  assert.doesNotMatch(stats, /<span className="section-kicker">SQL 학습 기록<\/span>/);
  assert.match(styles, /\.category-toggle-copy > \.category-accuracy/);
});
