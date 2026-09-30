import assert from "node:assert/strict";
import test from "node:test";
import { readFeatureSource } from "./helpers/feature-source.mjs";

function source(path) {
  return readFeatureSource(new URL(`../${path}`, import.meta.url), "utf8");
}

test("learning-record navigation avoids a duplicate server component request", () => {
  const study = source("apps/frontend/src/features/study/components/study-app.tsx");
  const router = source("apps/frontend/src/features/study/routing/use-learning-router.ts");

  assert.match(
    study,
    /writeLearningUrl\(routeForView\(view, selectedExam\), "push", "client"\)/u,
  );
  assert.match(router, /strategy: "router" \| "client" = "client"/u);
  assert.match(router, /window\.history\.pushState/u);
});

test("learning-record reads are scoped by tab and return session summaries", () => {
  const repository = source("apps/backend/src/modules/study/study.repository.ts");
  const recordQueries = source("apps/backend/src/modules/study/study-records.repository-queries.ts");
  const service = source("apps/backend/src/modules/study/study.service.ts");
  const readRecords = repository.match(/async readRecords[\s\S]*?async readExamSessions/u)?.[0] ?? "";

  assert.match(readRecords, /return readRecordBatch\(this\.connection\(\), userKey, selectedExam, options\)/u);
  assert.match(recordQueries, /if \(options\.view === "stats"\) \{[\s\S]*add\("attempts"[\s\S]*add\("sessions"[\s\S]*add\("stats"/u);
  assert.match(recordQueries, /else if \(options\.view === "incorrect"\) \{[\s\S]*add\("incorrect"/u);
  assert.match(recordQueries, /else \{[\s\S]*add\("bookmarks"/u);
  assert.doesNotMatch(readRecords, /theoryProgress/u);
  assert.doesNotMatch(readRecords, /aiEvaluations/u);
  assert.match(service, /examSessions: sessionRows\.map\(parseExamSessionSummary\)/u);
  assert.match(service, /recordsSummary: summary/u);
});
