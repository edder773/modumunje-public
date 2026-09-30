import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { hasExplicitModelAnswerHeading } from "../packages/shared/src/content/content-format.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("model-answer headings include the reviewed combined heading", () => {
  assert.equal(hasExplicitModelAnswerHeading("## 모범답안\n\n정답"), true);
  assert.equal(hasExplicitModelAnswerHeading("## 모범답안과 상세 해설\n\n① 후보 식별자"), true);
  assert.equal(hasExplicitModelAnswerHeading("### 예시 답안\n\n예시"), true);
  assert.equal(hasExplicitModelAnswerHeading("본문에서 모범답안을 언급한다."), false);
});

test("quality review does not infer defects from unselected choices", () => {
  const quality = fs.readFileSync(path.join(
    root,
    "apps/backend/src/modules/admin/admin-quality-use-cases.ts",
  ), "utf8");
  assert.doesNotMatch(quality, /선택되지 않는 선택지/u);
  assert.doesNotMatch(quality, /SELECT question_id, selected_answers FROM attempts/u);
  assert.match(quality, /hasExplicitModelAnswerHeading\(explanation\)/u);
});

test("the conventional favicon URL redirects to the search-compatible PNG asset", () => {
  const route = fs.readFileSync(path.join(
    root,
    "apps/frontend/app/favicon.ico/route.ts",
  ), "utf8");
  assert.match(route, /status:\s*308/u);
  assert.match(route, /new URL\("\/favicon[.]png", request[.]url\)/u);
});
