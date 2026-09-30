import { BACKUP_SCHEMA_VERSION } from "../packages/shared/src/admin/backup-contract.mjs";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import {
  createCanonicalDatabase,
  createContentReleaseFromDatabase,
  DEFAULT_RELEASE_VERSION,
  importContentRelease,
  stableJson,
} from "./lib/content-release.mjs";
import { attachApprovedContentReview } from "./lib/content-review-receipt.mjs";
import { buildContentReleaseEvidence } from "./lib/content-release-gate.mjs";
import {
  ADMIN_IMPORT_FILE_MAX_BYTES,
  ADMIN_REQUEST_MAX_BYTES,
} from "../packages/shared/src/admin/admin-transfer-limits.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

function option(name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

const version = option("--version") ?? DEFAULT_RELEASE_VERSION;
const outputDirectory = path.resolve(
  option("--output") ?? path.join(root, ".content-releases", version),
);
const sourceDatabasePath = option("--source-db");
const activationDatabasePath = option("--activate-db");
const confirmation = option("--confirm-version");
const theoryIdRemapPath = option("--theory-id-remap");
const reviewPackagePath = option("--review-package");
if (reviewPackagePath && !fs.statSync(path.resolve(reviewPackagePath)).isDirectory()) {
  throw new Error("--review-package must point to a review package directory");
}
const requestedAdminTables = option("--admin-tables")?.split(",")
  .map((table) => table.trim())
  .filter(Boolean) ?? ["questions", "theories", "content_releases"];
const allowedAdminTables = new Set([
  "questions", "theories", "sw_questions", "sw_theories", "content_releases",
]);
if (
  requestedAdminTables.length === 0
  || new Set(requestedAdminTables).size !== requestedAdminTables.length
  || requestedAdminTables.some((table) => !allowedAdminTables.has(table))
) {
  throw new Error("--admin-tables must be a unique comma-separated subset of content tables");
}
let theoryIdRemap = [];
if (theoryIdRemapPath) {
  if (!requestedAdminTables.includes("theories") || !requestedAdminTables.includes("content_releases")) {
    throw new Error("--theory-id-remap requires theories and content_releases in --admin-tables");
  }
  theoryIdRemap = JSON.parse(fs.readFileSync(path.resolve(theoryIdRemapPath), "utf8"));
  if (
    !Array.isArray(theoryIdRemap)
    || theoryIdRemap.length === 0
    || theoryIdRemap.some((row) => (
      !Number.isInteger(row?.sourceId)
      || !Number.isInteger(row?.canonicalId)
      || row.sourceId === row.canonicalId
    ))
    || new Set(theoryIdRemap.map(({ sourceId }) => sourceId)).size !== theoryIdRemap.length
  ) {
    throw new Error("--theory-id-remap must contain unique integer sourceId/canonicalId pairs");
  }
}

if (activationDatabasePath && confirmation !== version) {
  throw new Error(`--activate-db requires --confirm-version ${version}`);
}
if (fs.existsSync(outputDirectory)) {
  throw new Error(`release output already exists and will not be overwritten: ${outputDirectory}`);
}
if (sourceDatabasePath && !fs.existsSync(path.resolve(sourceDatabasePath))) {
  throw new Error(`source database does not exist: ${path.resolve(sourceDatabasePath)}`);
}
if (activationDatabasePath && !fs.existsSync(path.resolve(activationDatabasePath))) {
  throw new Error(`activation database does not exist: ${path.resolve(activationDatabasePath)}`);
}

fs.mkdirSync(path.dirname(outputDirectory), { recursive: true });
const stagingDirectory = fs.mkdtempSync(path.join(
  path.dirname(outputDirectory),
  `.${path.basename(outputDirectory)}.staging-`,
));
let sourceDatabase;

function writeAdminImportEnvelope(database, outputFile, manifest, includedData, remap) {
  if (!includedData.includes("questions")) {
    const compatible = database.prepare(`
      SELECT version FROM content_releases
      WHERE question_checksum = ?
      ORDER BY created_at DESC, version DESC LIMIT 1
    `).get(manifest.questionSha256);
    if (!compatible) {
      throw new Error("a partial admin import may omit questions only when their checksum matches an earlier release");
    }
  }
  const queries = {
    questions: "SELECT * FROM questions ORDER BY display_order, id",
    theories: "SELECT * FROM theories ORDER BY category, sort_order, id",
    sw_questions: "SELECT * FROM sw_questions ORDER BY display_order, id",
    sw_theories: "SELECT * FROM sw_theories ORDER BY subject_group_id, subject_id, sort_order, id",
    content_releases: `
      SELECT * FROM content_releases
      ORDER BY CASE WHEN status = 'active' THEN 1 ELSE 0 END, created_at, version
    `,
  };
  const data = Object.fromEntries(includedData.map((table) => [
    table,
    database.prepare(queries[table]).all(),
  ]));
  const metadataWithoutChecksum = {
    backupVersion: "1",
    appVersion: JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    type: "content",
    source: "manual",
    generatedAt: manifest.createdAt,
    includedData,
    counts: Object.fromEntries(Object.entries(data).map(([table, rows]) => [table, rows.length])),
    ...(includedData.includes("questions") && manifest.replacementScope
      ? { replacementScope: manifest.replacementScope }
      : {}),
    ...(includedData.includes("questions") && manifest.removedQuestionIds?.length
      ? { removedQuestionIds: manifest.removedQuestionIds }
      : {}),
    ...(includedData.includes("questions") && includedData.includes("theories") && manifest.replacementCourseScope
      ? { replacementCourseScope: manifest.replacementCourseScope }
      : {}),
    ...(remap.length ? {
      replaceMissingTables: ["theories"],
      theoryIdRemap: remap,
    } : {}),
  };
  const checksum = crypto.createHash("sha256")
    .update(JSON.stringify({ metadata: metadataWithoutChecksum, data }))
    .digest("hex");
  const envelope = {
    metadata: { ...metadataWithoutChecksum, checksum },
    data,
  };
  const serialized = `${JSON.stringify(envelope)}\n`;
  const fileBytes = Buffer.byteLength(serialized);
  const requestBytes = Buffer.byteLength(JSON.stringify({
    action: "import-commit",
    data: envelope,
    selection: "all",
  }));
  if (fileBytes > ADMIN_IMPORT_FILE_MAX_BYTES) {
    throw new Error(
      `admin import envelope is ${fileBytes} bytes; the browser limit is ${ADMIN_IMPORT_FILE_MAX_BYTES}`,
    );
  }
  if (requestBytes > ADMIN_REQUEST_MAX_BYTES) {
    throw new Error(
      `admin import request is ${requestBytes} bytes; the server limit is ${ADMIN_REQUEST_MAX_BYTES}`,
    );
  }
  fs.writeFileSync(outputFile, serialized, "utf8");
  return { checksum, file: outputFile, fileBytes, requestBytes };
}

function preservePackagedReplacementMetadata(created) {
  const packagedManifestPath = path.join(
    root,
    "apps/backend/resources/content/releases",
    version,
    "manifest.json",
  );
  if (!fs.existsSync(packagedManifestPath)) return created;
  const packaged = JSON.parse(fs.readFileSync(packagedManifestPath, "utf8"));
  for (const field of ["version", "questionCount", "questionSha256", "theoryCount", "theorySha256"]) {
    if (packaged[field] !== created.manifest[field]) {
      throw new Error(`packaged release ${field} does not match the promoted database`);
    }
  }
  const replacementMetadata = {
    ...(packaged.replacementScope ? { replacementScope: packaged.replacementScope } : {}),
    ...(packaged.removedQuestionIds?.length
      ? { removedQuestionIds: packaged.removedQuestionIds }
      : {}),
    ...(packaged.replacementCourseScope
      ? { replacementCourseScope: packaged.replacementCourseScope }
      : {}),
    ...(Number.isInteger(packaged.discardedQuestionCount)
      ? { discardedQuestionCount: packaged.discardedQuestionCount }
      : {}),
    ...(Number.isInteger(packaged.discardedTheoryCount)
      ? { discardedTheoryCount: packaged.discardedTheoryCount }
      : {}),
  };
  if (Object.keys(replacementMetadata).length === 0) return created;
  created.manifest = { ...created.manifest, ...replacementMetadata };
  fs.writeFileSync(
    path.join(stagingDirectory, "manifest.json"),
    stableJson(created.manifest),
    "utf8",
  );
  return created;
}

try {
  sourceDatabase = sourceDatabasePath
    ? new DatabaseSync(path.resolve(sourceDatabasePath), { readOnly: true })
    : createCanonicalDatabase(root);
  const created = preservePackagedReplacementMetadata(
    createContentReleaseFromDatabase(sourceDatabase, stagingDirectory, version),
  );
  if (theoryIdRemap.length) {
    created.manifest = {
      ...created.manifest,
      removedTheoryIds: theoryIdRemap.map(({ sourceId }) => sourceId),
      theoryIdRemap,
    };
    fs.writeFileSync(
      path.join(stagingDirectory, "manifest.json"),
      stableJson(created.manifest),
      "utf8",
    );
  }
  if (reviewPackagePath) {
    created.manifest = attachApprovedContentReview(
      stagingDirectory,
      path.resolve(reviewPackagePath),
      created.manifest,
    );
  }
  sourceDatabase.close();
  sourceDatabase = null;

  const evidence = buildContentReleaseEvidence(root, stagingDirectory);
  let activation = null;
  let adminImport = null;
  if (activationDatabasePath) {
    const activationDatabase = new DatabaseSync(path.resolve(activationDatabasePath));
    try {
      activation = importContentRelease(activationDatabase, stagingDirectory, {
        activate: true,
        confirmVersion: confirmation,
      });
      const active = activationDatabase.prepare(`
        SELECT version FROM content_releases WHERE status = 'active'
        ORDER BY activated_at DESC, created_at DESC, version DESC LIMIT 1
      `).get();
      if (active?.version !== version) {
        throw new Error(`activation database did not activate ${version}`);
      }
      adminImport = writeAdminImportEnvelope(
        activationDatabase,
        path.join(stagingDirectory, "admin-import.json"),
        created.manifest,
        requestedAdminTables,
        theoryIdRemap,
      );
    } finally {
      activationDatabase.close();
    }
  }

  fs.renameSync(stagingDirectory, outputDirectory);
  process.stdout.write(stableJson({
    activation,
    adminImport: adminImport ? {
      checksum: adminImport.checksum,
      file: path.join(outputDirectory, "admin-import.json"),
      fileBytes: adminImport.fileBytes,
      fileLimitBytes: ADMIN_IMPORT_FILE_MAX_BYTES,
      requestBytes: adminImport.requestBytes,
      requestLimitBytes: ADMIN_REQUEST_MAX_BYTES,
      includedData: requestedAdminTables,
      replaceMissingTables: theoryIdRemap.length ? ["theories"] : [],
      theoryIdRemapCount: theoryIdRemap.length,
    } : null,
    checks: evidence.checks,
    outputDirectory,
    questionCount: evidence.manifest.questionCount,
    sourceDatabase: sourceDatabasePath ? path.resolve(sourceDatabasePath) : "canonical-migration-baseline",
    status: activation ? "PROMOTED_AND_ACTIVATED" : "PROMOTED",
    theoryCount: evidence.manifest.theoryCount,
    version,
  }));
} finally {
  sourceDatabase?.close();
  if (fs.existsSync(stagingDirectory)) {
    fs.rmSync(stagingDirectory, { force: true, recursive: true });
  }
}
