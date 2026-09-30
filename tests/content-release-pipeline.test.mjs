import { APPROVED_RELEASE } from "./helpers/approved-release.mjs";
import { attachSyntheticContentReview } from "./helpers/synthetic-content-review.mjs";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  CONTENT_SCHEMA_VERSION,
  createContentRelease,
  freshInstallFromRelease,
  inspectContentRelease,
  LEGACY_CONTENT_SCHEMA_VERSION,
  loadAndValidateRelease,
  stableJson,
} from "../scripts/lib/content-release.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const TEST_RELEASE_VERSION = "learning-2026.09.29.synthetic-review-test";

test("canonical content releases are deterministic and preserve IDs and links", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "baeumzip-release-"));
  const first = path.join(temporary, "first");
  const second = path.join(temporary, "second");
  try {
    createContentRelease(root, first, TEST_RELEASE_VERSION);
    createContentRelease(root, second, TEST_RELEASE_VERSION);
    for (const file of [
      "course-releases.json",
      "manifest.json",
      "questions.ndjson",
      "theories.ndjson",
    ]) {
      assert.deepEqual(fs.readFileSync(path.join(first, file)), fs.readFileSync(path.join(second, file)));
    }
    const release = inspectContentRelease(first);
    assert.equal(release.manifest.sourceReview, "pending");
    assert.equal(release.manifest.licenseReview, "pending");
    assert.throws(() => loadAndValidateRelease(first), /approval receipt is required/u);
    assert.equal(release.manifest.schemaVersion, CONTENT_SCHEMA_VERSION);
    assert.equal(release.questions.length, APPROVED_RELEASE.questionCount);
    assert.equal(release.theories.length, APPROVED_RELEASE.theoryCount);
    assert.equal(new Set(release.questions.map((row) => row.id)).size, APPROVED_RELEASE.questionCount);
    assert.equal(new Set(release.theories.map((row) => row.id)).size, APPROVED_RELEASE.theoryCount);
    assert.ok(release.questions.every((row) => Object.hasOwn(row, "variant_group_id")));
    assert.equal(release.questions.filter((row) => row.variant_group_id != null).length, 28);
    assert.deepEqual(
      release.courseReleaseCatalog.courses.map((course) => [course.examType, course.status]),
      [
        ["SQLD", "released"],
        ["SQLP", "released"],
        ["DASP", "released"],
        ["DAP", "released"],
        ["BAE", "released"],
        ["IPEW", "released"],
        ["IPEP", "released"],
        ["ISEW", "released"],
        ["ISEP", "blocked"],
      ],
    );
    fs.rmSync(path.join(first, "course-releases.json"));
    assert.throws(
      () => inspectContentRelease(first),
      /course-releases[.]json is required by the release contract/u,
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("legacy content-v1 releases remain readable during forward recovery", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "baeumzip-release-v1-"));
  try {
    createContentRelease(root, temporary, TEST_RELEASE_VERSION);
    const questions = fs.readFileSync(path.join(temporary, "questions.ndjson"), "utf8")
      .trimEnd().split("\n").map((line) => JSON.parse(line));
    for (const question of questions) delete question.variant_group_id;
    const questionArtifact = `${questions.map((row) => JSON.stringify(row)).join("\n")}\n`;
    fs.writeFileSync(path.join(temporary, "questions.ndjson"), questionArtifact);
    const manifest = JSON.parse(fs.readFileSync(path.join(temporary, "manifest.json"), "utf8"));
    manifest.schemaVersion = LEGACY_CONTENT_SCHEMA_VERSION;
    manifest.questionArtifactSha256 = sha256(questionArtifact);
    manifest.questionSha256 = sha256(JSON.stringify(questions));
    manifest.sourceSha256 = "legacy-content-source-checksum";
    delete manifest.courseReleaseCatalogSchemaVersion;
    delete manifest.courseReleaseCatalogSha256;
    delete manifest.releaseContractVersion;
    fs.writeFileSync(path.join(temporary, "manifest.json"), stableJson(manifest));
    fs.rmSync(path.join(temporary, "course-releases.json"));

    const release = inspectContentRelease(temporary);
    assert.equal(release.manifest.schemaVersion, LEGACY_CONTENT_SCHEMA_VERSION);
    assert.ok(release.questions.every((row) => !Object.hasOwn(row, "variant_group_id")));
    assert.throws(() => loadAndValidateRelease(temporary), /not pinned to an approved manifest/u);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("fresh release install matches the production upgrade result", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "baeumzip-fresh-install-"));
  try {
    createContentRelease(root, temporary, TEST_RELEASE_VERSION);
    const draft = inspectContentRelease(temporary);
    attachSyntheticContentReview(temporary, draft.manifest);
    assert.deepEqual(freshInstallFromRelease(root, temporary), {
      activeVersion: TEST_RELEASE_VERSION,
      apiQueryCount: 5,
      brokenTheoryLinks: 0,
      migrationBaselineMatches: true,
      questionCount: APPROVED_RELEASE.questionCount,
      questionSha256: APPROVED_RELEASE.questionSha256,
      theoryCount: APPROVED_RELEASE.theoryCount,
      theorySha256: APPROVED_RELEASE.theorySha256,
      upgradeParity: true,
    });
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
