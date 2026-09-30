import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const REVIEW_FILES = Object.freeze({
  source: "source-review.json",
  license: "license-review.json",
  receipt: "review-receipt.json",
});
const SHA256 = /^[a-f0-9]{64}$/u;
const BASIS_FILENAME = /^[a-z0-9][a-z0-9._-]{0,80}[.]json$/u;
const MAX_BASIS_BYTES = 1024 * 1024;
const legacyManifestSha256 = JSON.parse(fs.readFileSync(
  new URL("./legacy-content-release-sha256.json", import.meta.url), "utf8",
));

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

export function isPinnedHistoricalManifest(version, manifestText) {
  return legacyManifestSha256[version] === sha256(manifestText);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

const stableJson = (value) => `${JSON.stringify(stableValue(value), null, 2)}\n`;

function readCanonicalJson(file) {
  if (fs.lstatSync(file).isSymbolicLink()) throw new Error("content review files cannot be symlinks");
  const text = fs.readFileSync(file, "utf8");
  const value = JSON.parse(text);
  if (text !== stableJson(value)) throw new Error("content review file is not canonical JSON: " + path.basename(file));
  return { text, value, sha256: sha256(text) };
}

function nonblank(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validateEvidence(evidence, manifest, kind) {
  if (evidence.schemaVersion !== 1 || evidence.kind !== kind || evidence.decision !== "approved"
    || evidence.contentSourceSha256 !== manifest.sourceSha256 || !nonblank(evidence.reviewer)
    || !nonblank(evidence.reviewedAt) || !Array.isArray(evidence.basis) || !evidence.basis.length
    || evidence.basis.length > 10
    || evidence.basis.some((entry) => !nonblank(entry?.kind)
      || !BASIS_FILENAME.test(entry?.file ?? "") || !SHA256.test(entry?.sha256))) {
    throw new Error("content " + kind + " review evidence is incomplete or not bound to this content");
  }
  if (kind === "license" && evidence.rightsStatus !== "cleared") {
    throw new Error("content license rights are not explicitly cleared");
  }
}

function validateBasisFiles(directory, manifest, evidence) {
  const basisDirectory = path.join(directory, "basis");
  if (fs.lstatSync(basisDirectory).isSymbolicLink()) {
    throw new Error("content review basis directory cannot be a symlink");
  }
  const files = new Map();
  for (const [reviewKind, entry] of [
    ...evidence.source.basis.map((entry) => ["source", entry]),
    ...evidence.license.basis.map((entry) => ["license", entry]),
  ]) {
    const { kind, file, sha256: expected } = entry;
    const location = path.join(basisDirectory, file);
    if (fs.statSync(location).size > MAX_BASIS_BYTES) {
      throw new Error("content review basis file exceeds the size limit");
    }
    const artifact = readCanonicalJson(location);
    if (artifact.sha256 !== expected || artifact.value?.schemaVersion !== 1
      || artifact.value?.kind !== kind
      || artifact.value?.contentSourceSha256 !== manifest.sourceSha256
      || (reviewKind === "license" && artifact.value?.rightsStatus !== "cleared")) {
      throw new Error("content review basis file is missing, changed or not bound to this content");
    }
    files.set(file, artifact.text);
  }
  return files;
}

function validatePackage(directory, manifest) {
  const source = readCanonicalJson(path.join(directory, REVIEW_FILES.source));
  const license = readCanonicalJson(path.join(directory, REVIEW_FILES.license));
  const receipt = readCanonicalJson(path.join(directory, REVIEW_FILES.receipt));
  validateEvidence(source.value, manifest, "source");
  validateEvidence(license.value, manifest, "license");
  const basisFiles = validateBasisFiles(directory, manifest, {
    source: source.value,
    license: license.value,
  });
  const value = receipt.value;
  if (value.schemaVersion !== 1 || value.decision !== "approved"
    || value.version !== manifest.version
    || value.contentSourceSha256 !== manifest.sourceSha256
    || value.questionSha256 !== manifest.questionSha256
    || value.theorySha256 !== manifest.theorySha256
    || value.sourceReviewEvidenceSha256 !== source.sha256
    || value.licenseReviewEvidenceSha256 !== license.sha256
    || !nonblank(value.reviewer) || !nonblank(value.reviewedAt)) {
    throw new Error("content review receipt is incomplete or does not match the release and evidence");
  }
  return { source, license, receipt, basisFiles };
}

export function assertContentReview(releaseDirectory, manifest, manifestText, {
  allowPendingReview = false,
} = {}) {
  const contract = manifest.releaseContractVersion ?? 1;
  if (contract < 3) {
    if (allowPendingReview) return "historical-structure-only";
    if (manifest.sourceReview !== "passed" || manifest.licenseReview !== "passed"
      || !isPinnedHistoricalManifest(manifest.version, manifestText)) {
      throw new Error("historical content review is not pinned to an approved manifest");
    }
    return "pinned-historical";
  }
  if (manifest.sourceReview === "pending" && manifest.licenseReview === "pending") {
    if (allowPendingReview && !manifest.reviewReceiptSha256) return "pending-structure-only";
    throw new Error("content review is pending; approval receipt is required before promotion or activation");
  }
  if (manifest.sourceReview !== "passed" || manifest.licenseReview !== "passed"
    || !SHA256.test(manifest.reviewReceiptSha256 ?? "")) {
    throw new Error("content review status or receipt checksum is invalid");
  }
  const reviewed = validatePackage(path.join(releaseDirectory, "review-evidence"), manifest);
  if (reviewed.receipt.sha256 !== manifest.reviewReceiptSha256) {
    throw new Error("content review receipt checksum mismatch");
  }
  return "receipt-approved";
}

export function attachApprovedContentReview(releaseDirectory, packageDirectory, manifest) {
  if (manifest.releaseContractVersion !== 3
    || manifest.sourceReview !== "pending" || manifest.licenseReview !== "pending"
    || manifest.reviewReceiptSha256) {
    throw new Error("only a pending contract-v3 release can receive review approval");
  }
  const reviewed = validatePackage(packageDirectory, manifest);
  const target = path.join(releaseDirectory, "review-evidence");
  if (fs.existsSync(target)) throw new Error("review evidence already exists in release");
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, REVIEW_FILES.source), reviewed.source.text);
  fs.writeFileSync(path.join(target, REVIEW_FILES.license), reviewed.license.text);
  fs.writeFileSync(path.join(target, REVIEW_FILES.receipt), reviewed.receipt.text);
  fs.mkdirSync(path.join(target, "basis"));
  for (const [file, text] of reviewed.basisFiles) {
    fs.writeFileSync(path.join(target, "basis", file), text);
  }
  const approved = {
    ...manifest,
    licenseReview: "passed",
    reviewReceiptSha256: reviewed.receipt.sha256,
    sourceReview: "passed",
  };
  fs.writeFileSync(path.join(releaseDirectory, "manifest.json"), stableJson(approved));
  return approved;
}
