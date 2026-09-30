import assert from "node:assert/strict";
import test from "node:test";
import { readFeatureSource } from "./helpers/feature-source.mjs";

function featureSource(path) {
  return readFeatureSource(new URL(`../${path}`, import.meta.url), "utf8");
}

test("SQL practice keeps next navigation on the right and shows in-context progress", () => {
  const frontend = featureSource("apps/frontend/src/features/study/components/study-app.tsx");
  const styles = featureSource("apps/frontend/app/globals.css");

  assert.match(frontend, /현재까지 \$\{cursor \+ 1\}문항 풀이/u);
  assert.match(styles, /\.explanation-actions \{[\s\S]*justify-content: space-between;/u);
  assert.match(styles, /\.practice-inline-progress,[\s\S]*\.sw-question-progress \{/u);
});

test("SW practice shows completed and correct counts beside next navigation", () => {
  const frontend = featureSource("apps/frontend/src/features/study/components/study-app.tsx");

  assert.match(frontend, /현재까지 \{completed\.length\}문항 풀이 · 정답 \{correctCount\}문항/u);
  assert.match(frontend, /<footer className="explanation-actions">[\s\S]*practice-inline-progress[\s\S]*다음 문제/u);
});
