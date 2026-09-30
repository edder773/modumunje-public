import assert from "node:assert/strict";
import test from "node:test";
import { readFeatureSource } from "./helpers/feature-source.mjs";

function source(path) {
  return readFeatureSource(new URL(`../${path}`, import.meta.url), "utf8");
}

test("long SQL mock exams prefetch stable chunks instead of requesting every next question", () => {
  const frontend = source("apps/frontend/src/features/study/components/study-app.tsx");
  const sessionDomain = source("apps/backend/src/modules/study/study-session.domain.ts");

  assert.match(frontend, /const QUESTION_CHUNK_SIZE = 10/u);
  assert.match(frontend, /const QUESTION_PREFETCH_CHUNKS = 2/u);
  assert.match(frontend, /Math\.floor\(examIndex \/ QUESTION_CHUNK_SIZE\) \* QUESTION_CHUNK_SIZE/u);
  assert.match(frontend, /chunkStart \+ QUESTION_CHUNK_SIZE \* QUESTION_PREFETCH_CHUNKS/u);
  assert.match(sessionDomain, /const MOCK_QUESTION_WINDOW = 10/u);
  assert.match(sessionDomain, /function mockQuestionWindow/u);
  assert.match(sessionDomain, /Math\.floor\(safeIndex \/ MOCK_QUESTION_WINDOW\) \* MOCK_QUESTION_WINDOW/u);
});

test("mock saves are serialized and update only changed item rows in one D1 batch", () => {
  const frontend = source("apps/frontend/src/features/study/components/study-app.tsx");
  const backend = source("apps/backend/src/modules/study/study.service.ts");
  const sessionDomain = source("apps/backend/src/modules/study/study-session.domain.ts");
  const repository = source("apps/backend/src/modules/study/study-session.repository.ts");

  assert.match(frontend, /examSaveQueueRef/u);
  assert.match(frontend, /examSaveQueueRef\.current\.catch\(\(\) => undefined\)\.then\(execute\)/u);
  assert.match(frontend, /if \(examFinalizingRef\.current\) return/u);
  assert.doesNotMatch(frontend, /keepalive:\s*true/u);
  assert.doesNotMatch(frontend, /addEventListener\("pagehide"/u);
  assert.match(sessionDomain, /function changedExamItemState/u);
  assert.match(backend, /items:\s*changedExamItemState\(session, state\)/u);
  assert.match(repository, /const \[revisionResult\] = await database\.batch\(statements\)/u);
  assert.match(repository, /UPDATE exam_sessions[\s\S]*revision = \?[\s\S]*UPDATE exam_session_items/u);
  assert.match(repository, /AND EXISTS \([\s\S]*FROM exam_sessions[\s\S]*current_index = \?/u);
});

test("SQL and SW practice screens show completed and prepared question counts", () => {
  const frontend = source("apps/frontend/src/features/study/components/study-app.tsx");

  assert.match(frontend, /푼 문제 \{answeredCount\}문항 · 남은 문제 \{unanswered\}문항/u);
  assert.match(frontend, /풀이 완료 \{cursor \+ \(revealed \? 1 : 0\)\}문항 · 준비된 문제 \{queue\.length\}문항/u);
  assert.match(frontend, /풀이 완료 \{completed\.length\}문항 · 정답 \{correctCount\}문항 · 준비된 문제 \{questions\.length\}문항/u);
});
