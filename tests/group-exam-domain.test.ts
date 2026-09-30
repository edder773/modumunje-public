import assert from "node:assert/strict";
import test from "node:test";
import {
  buildQuestionTimeline,
  competitionRanks,
  currentQuestionPosition,
  kstDateKey,
  nextKstMidnight,
  selectQuestionBundles,
} from "../apps/backend/src/modules/group-exams/domain/group-exam.domain";

test("KST quota date changes at Seoul midnight", () => {
  assert.equal(kstDateKey("2026-09-18T14:59:59.999Z"), "2026-09-18");
  assert.equal(kstDateKey("2026-09-18T15:00:00.000Z"), "2026-09-19");
  assert.equal(nextKstMidnight("2026-09-18T14:59:59.999Z"), "2026-09-18T15:00:00.000Z");
  assert.equal(nextKstMidnight("2026-09-18T15:00:00.000Z"), "2026-09-19T15:00:00.000Z");
});

test("question selection preserves dependency bundles and exact requested count", async () => {
  const rows = [
    { uid: "a1", area: "언어이해" as const, dependencyGroupId: "a" },
    { uid: "a2", area: "언어이해" as const, dependencyGroupId: "a" },
    { uid: "b", area: "자료해석" as const, dependencyGroupId: null },
    { uid: "c", area: "창의수리" as const, dependencyGroupId: null },
  ];
  const selected = await selectQuestionBundles(rows, 3, "stable");
  assert.equal(selected.length, 3);
  assert.equal(selected.filter((row) => row.dependencyGroupId === "a").length, 2);
  await assert.rejects(() => selectQuestionBundles(rows.slice(0, 2), 1, "stable"), /공통자료 묶음/u);
});

test("server timeline uses an exclusive deadline and competition ranking", () => {
  const start = new Date("2026-09-19T00:00:00.000Z");
  const timeline = buildQuestionTimeline([
    { area: "언어이해", timeLimitSeconds: 45 },
    { area: "자료해석", timeLimitSeconds: 30 },
  ], start);
  assert.equal(currentQuestionPosition(timeline.items, start.getTime()), 0);
  assert.equal(currentQuestionPosition(timeline.items, Date.parse(timeline.items[0].deadlineAt)), 1);
  assert.deepEqual(competitionRanks([{ id: "a", score: 3 }, { id: "b", score: 3 }, { id: "c", score: 2 }]).map((row) => row.rank), [1, 1, 3]);
});
