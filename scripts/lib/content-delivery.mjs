import fs from "node:fs";
import path from "node:path";
import {
  CONTENT_MIGRATION_CUTOFF,
  CONTENT_RELEASE_TABLES,
  EXPECTED_SCHEMA_VERSION,
  SCHEMA_BASELINE_LOCK,
  SCHEMA_BASELINE_VERSION,
} from "../../packages/shared/src/database/schema-contract.mjs";
import { COURSE_CONTENT_RELEASE_VERSION } from "../../packages/shared/src/study/course-release-contract.mjs";
import {
  DEFAULT_RELEASE_VERSION,
  loadAndValidateRelease,
} from "./content-release.mjs";
import { buildContentReleaseEvidence } from "./content-release-gate.mjs";
import { validateMigrationInventory } from "./migration-safety.mjs";

export const CONTENT_DELIVERY_EVIDENCE_SCHEMA_VERSION = 1;

function commandGroup(name) {
  if (name.startsWith("test:") || name === "test" || name === "prepare:test-db") return "tests";
  if (name.startsWith("generate:")) return "generators";
  if (/^(?:audit|check|verify|validate|measure|analyze):/u.test(name)) return "verification";
  if (name.startsWith("content:") || name === "db:fresh-install") return "content-release";
  return "operations";
}

export function groupedPackageCommands(packageJson) {
  const groups = {};
  for (const name of Object.keys(packageJson.scripts ?? {}).sort()) {
    const group = commandGroup(name);
    groups[group] ??= [];
    groups[group].push(name);
  }
  return Object.fromEntries(Object.entries(groups).sort(([left], [right]) => left.localeCompare(right)));
}

export function verifyContentDelivery(root, { deep = true } = {}) {
  const inventory = validateMigrationInventory(root);
  if (inventory.failures.length > 0) {
    throw new Error(`content/schema boundary failed:\n- ${inventory.failures.join("\n- ")}`);
  }
  if (
    Number(EXPECTED_SCHEMA_VERSION) < Number(CONTENT_MIGRATION_CUTOFF)
    || SCHEMA_BASELINE_LOCK.through !== SCHEMA_BASELINE_VERSION
  ) {
    throw new Error("expected schema must follow the content cutoff and the schema baseline lock must match the baseline version");
  }

  const releaseDirectory = path.join(
    root,
    "apps/backend/resources/content/releases",
    DEFAULT_RELEASE_VERSION,
  );
  const release = loadAndValidateRelease(releaseDirectory);
  if (fs.existsSync(path.join(releaseDirectory, "admin-import.json"))) {
    throw new Error("admin-import.json is an operational secret and must not be committed with a release");
  }
  if (
    release.manifest.version !== DEFAULT_RELEASE_VERSION
    || COURSE_CONTENT_RELEASE_VERSION !== DEFAULT_RELEASE_VERSION
  ) {
    throw new Error("default, packaged, and generated content release versions differ");
  }

  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const commandGroups = groupedPackageCommands(packageJson);
  const commandCount = Object.values(commandGroups).reduce((total, names) => total + names.length, 0);
  if (commandCount !== Object.keys(packageJson.scripts ?? {}).length) {
    throw new Error("package command catalog is incomplete");
  }

  return {
    checks: {
      commandCatalog: "passed",
      contentRelease: "passed",
      futureContentSqlBlocked: "passed",
      schemaBaseline: "passed",
      releaseVersionAlignment: "passed",
      ...(deep ? { releaseRecoveryDrills: "passed" } : {}),
    },
    commandCatalog: Object.fromEntries(Object.entries(commandGroups).map(([group, names]) => [group, {
      count: names.length,
      names,
    }])),
    content: {
      protectedTables: CONTENT_RELEASE_TABLES,
      questionCount: release.manifest.questionCount,
      questionSha256: release.manifest.questionSha256,
      releaseContractVersion: release.manifest.releaseContractVersion,
      theoryCount: release.manifest.theoryCount,
      theorySha256: release.manifest.theorySha256,
      version: release.manifest.version,
    },
    evidenceSchemaVersion: CONTENT_DELIVERY_EVIDENCE_SCHEMA_VERSION,
    migration: {
      contentCutoff: CONTENT_MIGRATION_CUTOFF,
      count: inventory.entries.length,
      baselineCount: inventory.history.count,
      baselineSha256: inventory.history.sha256,
      baselineVersion: SCHEMA_BASELINE_VERSION,
      latestVersion: inventory.latestVersion,
      nextSchemaVersion: String(Number(EXPECTED_SCHEMA_VERSION) + 1).padStart(4, "0"),
    },
    release: deep ? buildContentReleaseEvidence(root, releaseDirectory) : null,
  };
}
