import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { attachApprovedContentReview } from "../../scripts/lib/content-review-receipt.mjs";

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const stableValue = (value) => Array.isArray(value) ? value.map(stableValue) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])])) : value;
const stableJson = (value) => `${JSON.stringify(stableValue(value), null, 2)}\n`;

// Tests only: verifies the approval mechanism with explicitly synthetic evidence.
export function attachSyntheticContentReview(releaseDirectory, manifest, {
  rightsStatus = "cleared",
  basisRightsStatus = "cleared",
} = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "synthetic-content-review-"));
  try {
    const basisDirectory = path.join(directory, "basis");
    fs.mkdirSync(basisDirectory);
    const sourceBasisText = stableJson({
      schemaVersion: 1,
      kind: "synthetic-source-test-fixture",
      contentSourceSha256: manifest.sourceSha256,
      note: "synthetic test evidence only",
    });
    const licenseBasisText = stableJson({
      schemaVersion: 1,
      kind: "synthetic-license-test-fixture",
      contentSourceSha256: manifest.sourceSha256,
      rightsStatus: basisRightsStatus,
      note: "synthetic test evidence only",
    });
    fs.writeFileSync(path.join(basisDirectory, "source-test.json"), sourceBasisText);
    fs.writeFileSync(path.join(basisDirectory, "license-test.json"), licenseBasisText);
    const shared = {
      schemaVersion: 1,
      contentSourceSha256: manifest.sourceSha256,
      decision: "approved",
      reviewer: "synthetic-test-reviewer",
      reviewedAt: "2026-09-29T00:00:00.000Z",
    };
    const sourceText = stableJson({ ...shared, kind: "source", basis: [{
      kind: "synthetic-source-test-fixture", file: "source-test.json", sha256: sha256(sourceBasisText),
    }] });
    const licenseText = stableJson({ ...shared, kind: "license", rightsStatus, basis: [{
      kind: "synthetic-license-test-fixture", file: "license-test.json", sha256: sha256(licenseBasisText),
    }] });
    const receiptText = stableJson({
      schemaVersion: 1,
      decision: "approved",
      version: manifest.version,
      contentSourceSha256: manifest.sourceSha256,
      questionSha256: manifest.questionSha256,
      theorySha256: manifest.theorySha256,
      sourceReviewEvidenceSha256: sha256(sourceText),
      licenseReviewEvidenceSha256: sha256(licenseText),
      reviewer: "synthetic-test-reviewer",
      reviewedAt: "2026-09-29T00:00:00.000Z",
    });
    fs.writeFileSync(path.join(directory, "source-review.json"), sourceText);
    fs.writeFileSync(path.join(directory, "license-review.json"), licenseText);
    fs.writeFileSync(path.join(directory, "review-receipt.json"), receiptText);
    return attachApprovedContentReview(releaseDirectory, directory, manifest);
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
}
