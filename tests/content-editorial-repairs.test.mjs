import assert from "node:assert/strict";
import test from "node:test";
import { repairEditorialText, repairDaExplanation } from "../scripts/lib/content-editorial-repairs.mjs";

test("editorial repairs preserve identifier boundaries and resolve Korean particles", () => {
  assert.equal(repairEditorialText("TSTAFF_SAMPLE TEMP_STAFF XTSTAFF_SAMPLE 단말는 배열을(를) 정의을(를)"), "TEMP TEMP_STAFF XTSTAFF_SAMPLE 단말은 배열을 정의를");
  assert.equal(
    repairEditorialText("유효시작일를 유효시작일는 유효종료일를 `유효시작일`와"),
    "유효시작일을 유효시작일은 유효종료일을 `유효시작일`과",
  );
});
test("nested answer templates and inline fences retain the answer, SQL and rationale once", () => {
  const source = "## 정답\n\n① 선택\n\n## 상세 해설\n\n## 정답\n\nA\n\n## 정답 선택지\n\n선택\n\n## 상세 해설\n\n설명\n\n## 선택지 분석\n\n- **A.** ```sql\nSELECT 1;\n``` — **정답.** 근거";
  const result = repairDaExplanation(source);
  assert.equal((result.match(/^## 정답$/gmu) ?? []).length, 1);
  assert.match(result, /① 선택/u);
  assert.match(result, /\*\*①\*\*\n\n```sql\nSELECT 1;\n```\n\n\*\*정답\.\*\* 근거/u);
  assert.equal(repairDaExplanation(result), result);
});
test("only identical neighboring DAP answer/detail sections are deduplicated", () => {
  assert.equal(repairDaExplanation("## 모범답안과 상세 해설\n\n보존\n\n## 핵심 해설\n\n보존\n\n## 이론 근거\n\n근거"), "## 모범답안과 상세 해설\n보존\n\n## 이론 근거\n\n근거");
  const different = "## 모범답안과 상세 해설\n\n답\n\n## 핵심 해설\n\n다른 근거";
  assert.equal(repairDaExplanation(different), different);
});
