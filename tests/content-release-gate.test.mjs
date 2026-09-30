import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  assertReleaseCoursesReady,
  CONTENT_RELEASE_EVIDENCE_SCHEMA_VERSION,
  contentReleaseEvidenceMarkdown,
  verifyContentReleaseGate,
} from "../scripts/lib/content-release-gate.mjs";

const root = path.resolve(import.meta.dirname, "..");

test("the historical release cannot produce promotion evidence while answer cues exceed the limit", () => {
  assert.throws(() => verifyContentReleaseGate(root), /answer cue gate failed.*SQLD=.*SQLP=/u);
});

test("compact promotion evidence includes answer-cue metrics without private content", () => {
  const evidence = {
    courses: [{examType: "SQLD", releaseStage: "released", status: "released", activeQuestionCount: 4,
      activeTheoryCount: 1, linkedQuestionCount: 4, linkedTheoryCount: 1}],
    manifest: {version: "synthetic-review", schemaVersion: "test", questionCount: 4, theoryCount: 1, sourceSha256: "synthetic"},
    verification: {answerCues: {threshold: 0.4, byCourse: {SQLD: {
      singleItems: 4, pickLongestExpectedAccuracy: 0.25, wrongMinusCorrectAbsoluteGap: 0,
    }}}},
  };
  const markdown = contentReleaseEvidenceMarkdown(evidence);
  assert.equal(markdown, contentReleaseEvidenceMarkdown(evidence));
  assert.match(markdown, /SQLD \| 4 \| 0[.]2500 \| 0[.]0000/u);
  assert.match(markdown, /longest-choice expected accuracy ≤ 0[.]40/u);
  assert.equal(CONTENT_RELEASE_EVIDENCE_SCHEMA_VERSION, 4);
});

test("the content release gate permits intake courses but rejects blocked release targets", () => {
  assert.doesNotThrow(() => assertReleaseCoursesReady({
    courses: [{
      blockers: ["OBJECTIVE_SHORTAGE:future:1/2", "RELEASE_APPROVAL_PENDING"],
      examType: "FUTURE",
      releaseStage: "intake",
      status: "blocked",
    }],
  }));
  assert.throws(
    () => assertReleaseCoursesReady({
      courses: [{
        blockers: ["OBJECTIVE_SHORTAGE:future:1/2"],
        examType: "FUTURE",
        releaseStage: "released",
        status: "blocked",
      }],
    }),
    /FUTURE: OBJECTIVE_SHORTAGE:future:1\/2/u,
  );
});

test("CI stores only compact release evidence and not private content artifacts", () => {
  const workflow = fs.readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");
  const packageJson = fs.readFileSync(path.join(root, "package.json"), "utf8");

  assert.match(packageJson, /"verify:content-release": "node scripts\/verify-content-release[.]mjs"/u);
  assert.match(packageJson, /"verify:content-delivery": "node scripts\/audit-content-delivery[.]mjs"/u);
  assert.match(workflow, /npm run verify:content-delivery -- --output [.]ci-artifacts\/content-release-evidence[.]json/u);
  assert.match(workflow, /name: content-release-evidence/u);
  assert.match(workflow, /path: [.]ci-artifacts\/content-release-evidence[.]json/u);
  assert.doesNotMatch(workflow, /path: [.]content-releases/u);
});
