import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  canonicalRowsSha256,
  loadAndValidateRelease,
} from "./content-release.mjs";

export const IPE_SITE_MANIFEST_PATH = "apps/backend/resources/content/manifests/ipe-site-integrations.json";

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sortReferences(references) {
  return [...references].sort((left, right) => (
    left.file.localeCompare(right.file, "en") || left.theoryId - right.theoryId
  ));
}

function sortedScopeCounts(rows) {
  const counts = {};
  for (const row of rows) counts[row.exam_scope] = (counts[row.exam_scope] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right, "en")));
}

function passingAttestation(value) {
  return /^(?:PASS|PASSED|PASS_WITH_[A-Z_]+|NOT_APPLICABLE)$/iu.test(String(value).toUpperCase());
}

function assetReferences(rows, basePath) {
  const references = [];
  for (const row of rows) {
    for (const match of row.content.matchAll(/!\[[^\]]*\]\((\/learning-assets\/[^)]+)\)/gu)) {
      invariant(
        match[1].startsWith(`${basePath}/`),
        `${row.id} references an asset outside ${basePath}: ${match[1]}`,
      );
      references.push({ file: path.basename(match[1]), theoryId: row.id });
    }
  }
  return references;
}

function verifyTheoryRows(subject, rows) {
  const expected = subject.canonicalTheory;
  invariant(rows.length === expected.count, `${subject.key} theory count changed`);
  invariant(new Set(rows.map(({ id }) => id)).size === rows.length, `${subject.key} theory IDs are not unique`);
  invariant(
    new Set(rows.map(({ sort_order: sortOrder }) => sortOrder)).size === rows.length,
    `${subject.key} sort orders are not unique`,
  );
  invariant(same(rows.map(({ id }) => id), expected.ids), `${subject.key} theory IDs changed`);
  invariant(rows[0]?.id === expected.minimumId, `${subject.key} minimum theory ID changed`);
  invariant(rows.at(-1)?.id === expected.maximumId, `${subject.key} maximum theory ID changed`);
  invariant(same(sortedScopeCounts(rows), expected.scopes), `${subject.key} content scopes changed`);
  invariant(canonicalRowsSha256(rows) === expected.sha256, `${subject.key} canonical theory checksum changed`);
  invariant(rows.every((row) => row.category === subject.category && Number(row.active) === 1), `${subject.key} row contract changed`);
  invariant(
    rows.every((row) => !/\{\{ASSET_BASE\}\}|attached-file:|[.]\/assets\//u.test(row.content)),
    `${subject.key} retains a temporary asset reference`,
  );
  invariant(
    rows.every((row) => !/\]\(\s*(?:javascript|data|vbscript):/iu.test(row.content)),
    `${subject.key} contains an unsafe Markdown link`,
  );
  const approvedHosts = new Set(subject.approvedReferenceHosts);
  for (const row of rows) {
    for (const match of row.content.matchAll(/https?:\/\/[^)\s]+/gu)) {
      const reference = new URL(match[0]);
      invariant(reference.protocol === "https:", `${subject.key} contains an insecure reference`);
      invariant(approvedHosts.has(reference.hostname), `${subject.key} contains an unapproved reference host`);
    }
  }
}

function verifyAssets(projectRoot, subject, rows) {
  const expected = subject.publicAssets;
  const publicDirectory = path.join(projectRoot, "apps/frontend/public", expected.basePath);
  invariant(fs.existsSync(publicDirectory), `${subject.key} public asset directory is missing`);
  const actualNames = fs.readdirSync(publicDirectory)
    .filter((name) => /[.](?:png|svg)$/u.test(name))
    .sort();
  const expectedNames = expected.assets.map(({ file }) => file).sort();
  invariant(expected.count === expected.assets.length, `${subject.key} manifest asset count is invalid`);
  invariant(same(actualNames, expectedNames), `${subject.key} public asset inventory changed`);

  const references = assetReferences(rows, expected.basePath);
  invariant(references.length === expected.referenceCount, `${subject.key} asset reference count changed`);
  const manifestReferences = [];
  for (const asset of expected.assets) {
    const absolutePath = path.join(publicDirectory, asset.file);
    const content = fs.readFileSync(absolutePath);
    invariant(content.byteLength === asset.bytes, `${subject.key}/${asset.file} byte size changed`);
    invariant(sha256(content) === asset.sha256, `${subject.key}/${asset.file} checksum changed`);
    invariant(asset.referenceCount === asset.theoryIds.length, `${subject.key}/${asset.file} reference metadata is invalid`);
    for (const theoryId of asset.theoryIds) manifestReferences.push({ file: asset.file, theoryId });
    if (asset.file.endsWith(".svg")) {
      const svg = content.toString("utf8");
      invariant(/role="img"/u.test(svg), `${subject.key}/${asset.file} is missing role=img`);
      invariant(/aria-labelledby="title desc"/u.test(svg), `${subject.key}/${asset.file} is missing aria-labelledby`);
      invariant(/<title id="title">[^<]+<\/title>/u.test(svg), `${subject.key}/${asset.file} is missing a title`);
      invariant(/<desc id="desc">[^<]+<\/desc>/u.test(svg), `${subject.key}/${asset.file} is missing a description`);
      invariant(
        !/<script|<foreignObject|<image|@font-face|(?:href|src)=["']https?:|url\(["']?https?:/iu.test(svg),
        `${subject.key}/${asset.file} contains blocked SVG content`,
      );
    } else {
      invariant(
        content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
        `${subject.key}/${asset.file} is not a valid PNG`,
      );
      invariant(String(asset.altText ?? "").trim().length > 0, `${subject.key}/${asset.file} is missing alt text`);
      invariant(String(asset.caption ?? "").trim().length > 0, `${subject.key}/${asset.file} is missing a caption`);
    }
  }
  invariant(
    same(sortReferences(references), sortReferences(manifestReferences)),
    `${subject.key} asset-to-theory assignments changed`,
  );
}

function verifyAttestations(subject) {
  invariant(subject.intakeSchemaVersion === "ipe-intake-v1", `${subject.key} intake contract changed`);
  invariant(/^ipe-20\d{2}[.]\d{2}[.]\d{2}[.]\d+$/u.test(subject.contentVersion), `${subject.key} content version is invalid`);
  invariant(subject.sourceReview === "passed", `${subject.key} source review is not passed`);
  invariant(subject.licenseReview === "passed", `${subject.key} license review is not passed`);
  invariant(subject.sourceDocumentCount > 0, `${subject.key} source ledger is empty`);
  invariant(subject.approvedReferenceHosts.length > 0, `${subject.key} approved host ledger is empty`);
  invariant(/^[a-f0-9]{64}$/u.test(subject.sourceDocumentsSha256), `${subject.key} source ledger checksum is invalid`);
  invariant(subject.sourceArtifacts.length >= 9, `${subject.key} compact source attestations are incomplete`);
  for (const artifact of subject.sourceArtifacts) {
    invariant(artifact.bytes > 0, `${subject.key}/${artifact.name} byte size is invalid`);
    invariant(/^[a-f0-9]{64}$/u.test(artifact.sha256), `${subject.key}/${artifact.name} checksum is invalid`);
  }
  const review = subject.reviewAttestations;
  invariant(review.blockersStatus === "CONTENT_REVIEW_REQUIRED", `${subject.key} release blocker status changed`);
  invariant(review.blockerCodes.length > 0, `${subject.key} release blocker ledger is empty`);
  invariant(passingAttestation(review.rightsStatus), `${subject.key} rights review is not passing`);
  invariant(passingAttestation(review.sourceStatus), `${subject.key} source verification is not passing`);
  invariant(passingAttestation(review.codeExecutionStatus), `${subject.key} code execution review is not passing`);
  invariant(passingAttestation(review.calculationStatus), `${subject.key} calculation review is not passing`);
  invariant(passingAttestation(review.duplicateStatus), `${subject.key} duplicate review is not passing`);
  invariant(review.blockedAssetCount === 0, `${subject.key} has blocked assets`);
  invariant(review.codeExecutionFailed === 0, `${subject.key} has failed code examples`);
  invariant(review.idRemapCount === 0, `${subject.key} has unresolved ID remaps`);
}

function verifyCourseCatalog(projectRoot, manifest, selectedSubjects) {
  const releaseDirectory = path.join(
    projectRoot,
    "apps/backend/resources/content/releases",
    manifest.canonicalRelease.version,
  );
  const release = JSON.parse(fs.readFileSync(path.join(releaseDirectory, "manifest.json"), "utf8"));
  for (const field of ["version", "schemaVersion", "questionCount", "questionSha256", "theoryCount", "theorySha256"]) {
    invariant(release[field] === manifest.canonicalRelease[field], `canonical release ${field} changed`);
  }
  const catalog = JSON.parse(fs.readFileSync(path.join(releaseDirectory, "course-releases.json"), "utf8"));
  const courses = new Map(catalog.courses.map((course) => [course.examType, course]));
  for (const [examType, expected] of Object.entries(manifest.courseReleases)) {
    const course = courses.get(examType);
    invariant(course, `${examType} course release is missing`);
    for (const field of [
      "status",
      "releaseStage",
      "questionCount",
      "activeQuestionCount",
      "theoryCount",
      "activeTheoryCount",
    ]) {
      invariant(course[field] === expected[field], `${examType} ${field} changed`);
    }
    for (const blocker of expected.requiredBlockers) {
      invariant(course.blockers.includes(blocker), `${examType} required blocker is missing: ${blocker}`);
    }
    if (expected.status === "released") {
      invariant(course.blockers.length === 0, `${examType} released course retains blockers`);
    }
  }
  for (const subject of selectedSubjects) {
    for (const [examType, acceptedScopes] of [
      ["IPEW", new Set(["IPE", "IPEW"])],
      ["IPEP", new Set(["IPE", "IPEP"])],
    ]) {
      const course = courses.get(examType);
      const expected = manifest.courseReleases[examType];
      const coverage = course.subjectCoverage.find(({ subjectId }) => subjectId === subject.subjectId);
      const theoryCount = Object.entries(subject.canonicalTheory.scopes)
        .filter(([scope]) => acceptedScopes.has(scope))
        .reduce((total, [, count]) => total + count, 0);
      invariant((coverage?.theoryCount ?? 0) === theoryCount, `${subject.key} ${examType} theory coverage changed`);
      invariant(
        (coverage?.objectiveQuestionCount ?? 0) === (
          expected.questionsBySubject?.[subject.key] ?? expected.questionsPerSubject
        ),
        `${subject.key} ${examType} question coverage changed`,
      );
    }
  }
}

export function loadIpeSiteIntegrationManifest(projectRoot) {
  const absolutePath = path.join(projectRoot, IPE_SITE_MANIFEST_PATH);
  const text = fs.readFileSync(absolutePath, "utf8").replaceAll("\r\n", "\n");
  invariant(!/\/Users\//u.test(text), "IPE integration manifest contains an absolute local path");
  invariant(!/[.]integration-evidence/u.test(text), "IPE integration manifest contains a legacy evidence path");
  const manifest = JSON.parse(text);
  invariant(manifest.schemaVersion === "ipe-site-integration-manifest-v1", "IPE integration manifest schema changed");
  invariant(manifest.subjects.length === 1, "IPE integration manifest must contain only the upgraded S1 subject");
  invariant(manifest.courseReleases?.IPEW && manifest.courseReleases?.IPEP, "IPE course release contracts are incomplete");
  return { manifest, sha256: sha256(text), bytes: Buffer.byteLength(text) };
}

export function verifyIpeSiteIntegrations(projectRoot, { subjectKey = null } = {}) {
  const retiredEvidenceDirectory = path.join(projectRoot, [".", "integration-evidence"].join(""));
  invariant(!fs.existsSync(retiredEvidenceDirectory), "retired IPE integration evidence tree was reintroduced");

  const { manifest, sha256: manifestSha256, bytes: manifestBytes } = loadIpeSiteIntegrationManifest(projectRoot);
  const selectedSubjects = subjectKey
    ? manifest.subjects.filter(({ key }) => key === subjectKey)
    : manifest.subjects;
  invariant(selectedSubjects.length === 1, `unknown IPE subject: ${subjectKey}`);

  const releaseDirectory = path.join(
    projectRoot,
    "apps/backend/resources/content/releases",
    manifest.canonicalRelease.version,
  );
  // This attestation pins a historical release, whose course policy predates later courses.
  const release = loadAndValidateRelease(releaseDirectory, { allowHistoricalCourseContract: true });
  const canonical = { questions: release.questions, theories: release.theories };
  invariant(canonical.questions.length === manifest.canonicalRelease.questionCount, "canonical question count changed");
  invariant(canonicalRowsSha256(canonical.questions) === manifest.canonicalRelease.questionSha256, "canonical question checksum changed");
  invariant(canonical.theories.length === manifest.canonicalRelease.theoryCount, "canonical theory count changed");
  invariant(canonicalRowsSha256(canonical.theories) === manifest.canonicalRelease.theorySha256, "canonical theory checksum changed");

  const summaries = [];
  for (const subject of selectedSubjects) {
    verifyAttestations(subject);
    const rows = canonical.theories.filter((row) => row.category === subject.category && Number(row.active) === 1)
      .sort((left, right) => left.sort_order - right.sort_order || left.id - right.id);
    verifyTheoryRows(subject, rows);
    verifyAssets(projectRoot, subject, rows);
    summaries.push({
      key: subject.key,
      theories: rows.length,
      scopes: subject.canonicalTheory.scopes,
      theorySha256: subject.canonicalTheory.sha256,
      assets: subject.publicAssets.count,
      assetReferences: subject.publicAssets.referenceCount,
      sourceSha256: subject.primarySource.sha256,
      historicalStageRelease: subject.historicalStageRelease,
    });
  }
  verifyCourseCatalog(projectRoot, manifest, selectedSubjects);

  return {
    result: "pass",
    manifest: { path: IPE_SITE_MANIFEST_PATH, bytes: manifestBytes, sha256: manifestSha256 },
    sourceBaseline: manifest.sourceBaseline,
    canonicalRelease: manifest.canonicalRelease,
    subjects: summaries,
  };
}
