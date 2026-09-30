import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import {
  createCanonicalDatabase,
  createContentRelease,
  DEFAULT_RELEASE_VERSION,
  freshInstallFromRelease,
  importContentRelease,
  inspectContentRelease,
  loadAndValidateRelease,
  verifyDatabaseRelease,
} from "./lib/content-release.mjs";
import { attachApprovedContentReview } from "./lib/content-review-receipt.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const command = process.argv[2];
const positional = process.argv.slice(3).filter((value, index, values) => (
  !value.startsWith("--") && (index === 0 || !values[index - 1].startsWith("--"))
));
const option = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const defaultDirectory = path.join(root, ".content-releases", option("--version") ?? DEFAULT_RELEASE_VERSION);
const explicitReleaseDirectory = positional[0] ?? option("--release");
let releaseDirectory = path.resolve(explicitReleaseDirectory ?? defaultDirectory);
let generatedReleaseDirectory;
const packagedDirectory = path.join(root, "apps/backend/resources/content/releases", option("--version") ?? DEFAULT_RELEASE_VERSION);

if (
  !explicitReleaseDirectory
  && ["inspect", "validate", "verify", "fresh-install"].includes(command)
  && !fs.existsSync(path.join(releaseDirectory, "manifest.json"))
) {
  if (command !== "inspect" && fs.existsSync(path.join(packagedDirectory, "manifest.json"))) {
    releaseDirectory = packagedDirectory;
  } else if (command === "inspect") {
    generatedReleaseDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "baeumzip-content-release-"));
    createContentRelease(root, generatedReleaseDirectory, option("--version") ?? DEFAULT_RELEASE_VERSION);
    releaseDirectory = generatedReleaseDirectory;
  }
}

try {
  if (command === "release") {
    console.log(JSON.stringify(createContentRelease(
      root,
      releaseDirectory,
      option("--version") ?? DEFAULT_RELEASE_VERSION,
    ), null, 2));
  } else if (command === "inspect") {
    const release = inspectContentRelease(releaseDirectory);
    console.log(JSON.stringify({
      questionCount: release.questions.length,
      theoryCount: release.theories.length,
      reviewStatus: [release.manifest.sourceReview, release.manifest.licenseReview],
      version: release.manifest.version,
    }, null, 2));
  } else if (command === "attach-review") {
    const packageDirectory = option("--review-package");
    if (!explicitReleaseDirectory || !packageDirectory) {
      throw new Error("attach-review requires an explicit release directory and --review-package");
    }
    const release = inspectContentRelease(releaseDirectory);
    const manifest = attachApprovedContentReview(releaseDirectory, path.resolve(packageDirectory), release.manifest);
    loadAndValidateRelease(releaseDirectory);
    console.log(JSON.stringify({version: manifest.version, sourceSha256: manifest.sourceSha256, reviewReceiptSha256: manifest.reviewReceiptSha256}, null, 2));
  } else if (command === "validate") {
    const release = loadAndValidateRelease(releaseDirectory);
    console.log(JSON.stringify({
      courseReleases: release.courseReleaseCatalog?.courses.map((course) => ({
        examType: course.examType,
        status: course.status,
      })) ?? [],
      questionCount: release.questions.length,
      theoryCount: release.theories.length,
      version: release.manifest.version,
    }, null, 2));
  } else if (command === "verify") {
    const databasePath = option("--db");
    const database = databasePath ? new DatabaseSync(path.resolve(databasePath)) : createCanonicalDatabase(root);
    try {
      console.log(JSON.stringify(verifyDatabaseRelease(database, releaseDirectory), null, 2));
    } finally {
      database.close();
    }
  } else if (command === "import") {
    const databasePath = option("--db");
    if (!databasePath) throw new Error("content:import requires --db <private SQLite path>");
    if (!fs.existsSync(path.resolve(databasePath))) throw new Error("content:import database does not exist; prepare schema first");
    const database = new DatabaseSync(path.resolve(databasePath));
    try {
      console.log(JSON.stringify(importContentRelease(database, releaseDirectory, {
        activate: process.argv.includes("--activate"),
        confirmVersion: option("--confirm-version"),
      }), null, 2));
    } finally {
      database.close();
    }
  } else if (command === "fresh-install") {
    console.log(JSON.stringify(freshInstallFromRelease(root, releaseDirectory), null, 2));
  } else {
    throw new Error("usage: content-release.mjs <release|inspect|attach-review|validate|verify|import|fresh-install> [release] [options]");
  }
} finally {
  if (generatedReleaseDirectory) {
    fs.rmSync(generatedReleaseDirectory, { recursive: true, force: true });
  }
}
