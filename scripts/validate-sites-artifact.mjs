import "./verify-private-source-boundary.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { EXPECTED_SCHEMA_VERSION } from "../packages/shared/src/database/schema-contract.mjs";
import {
  validateMigrationInventory,
  verifyPackagedMigrations,
} from "./lib/migration-safety.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workerPath = path.resolve(process.argv[2] ?? path.join(root, "dist/server/index.js"));
const hostingPath = path.resolve(process.argv[3] ?? path.join(root, "dist/.openai/hosting.json"));
const sourceHostingPath = path.join(root, ".openai/hosting.json");
const artifactMigrations = path.join(path.dirname(hostingPath), "drizzle");
const workerConfigPath = path.join(path.dirname(workerPath), "wrangler.json");

for (const required of [workerPath, workerConfigPath, hostingPath, sourceHostingPath, artifactMigrations]) {
  if (!fs.existsSync(required)) throw new Error(`required Sites artifact is missing: ${required}`);
}

const workerConfig = JSON.parse(fs.readFileSync(workerConfigPath, "utf8"));
if (workerConfig.assets?.binding !== "ASSETS"
  || !Array.isArray(workerConfig.assets?.run_worker_first)
  || !workerConfig.assets.run_worker_first.includes("/_next/static/*")) {
  throw new Error("hashed static assets must route through the Worker ASSETS binding");
}

const assetHeaders = fs.readFileSync(path.join(root, "dist/client/_headers"), "utf8");
const assetPaths = assetHeaders.split("\n").filter(line => line.startsWith("/"));
if (!assetPaths.length || assetPaths.length > 100 || assetHeaders.includes("*")) {
  throw new Error("static cache rules must list exact hashed build assets (maximum 100)");
}
for (const asset of assetPaths) {
  if (!/^\/_next\/static\/(?:chunks\/[^/]+-[A-Za-z0-9_-]{8,16}\.js|css\/[^/]+\.[A-Za-z0-9_-]{8,16}\.css)$/u.test(asset)
    || !fs.statSync(path.join(root, "dist/client", asset), { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`invalid immutable asset rule: ${asset}`);
  }
}

const sourceHosting = JSON.parse(fs.readFileSync(sourceHostingPath, "utf8"));
const packagedHosting = JSON.parse(fs.readFileSync(hostingPath, "utf8"));
if (JSON.stringify(packagedHosting) !== JSON.stringify(sourceHosting)) {
  throw new Error("packaged Sites hosting manifest differs from the source manifest");
}

const inventory = validateMigrationInventory(root);
if (inventory.failures.length > 0) {
  throw new Error(`migration inventory failed:\n- ${inventory.failures.join("\n- ")}`);
}
const migrations = verifyPackagedMigrations(root, artifactMigrations);
if (migrations.latestVersion !== EXPECTED_SCHEMA_VERSION) {
  throw new Error("packaged migrations do not reach the expected application schema");
}
for (const entry of inventory.entries) {
  const packagedSql = fs.readFileSync(path.join(artifactMigrations, entry.name), "utf8");
  if (packagedSql.includes("\r")) {
    throw new Error(`packaged migration must use LF line endings: ${entry.name}`);
  }
}

const serverJavaScript = [];
const directories = [path.dirname(workerPath)];
while (directories.length > 0) {
  const directory = directories.pop();
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) directories.push(entryPath);
    else if (entry.isFile() && entry.name.endsWith(".js")) {
      serverJavaScript.push(fs.readFileSync(entryPath, "utf8"));
    }
  }
}
const serverArtifactIncludes = (value) => {
  const literals = [JSON.stringify(value), `'${value}'`, `\`${value}\``];
  return serverJavaScript.some((source) => literals.some((literal) => source.includes(literal)));
};
const expectedBuildSha = process.env.BAEUMZIP_BUILD_SHA?.trim();
if (expectedBuildSha) {
  if (!/^[0-9a-f]{40}$/u.test(expectedBuildSha)) {
    throw new Error("BAEUMZIP_BUILD_SHA must be a full lowercase Git commit SHA");
  }
  if (!serverArtifactIncludes(expectedBuildSha)) {
    throw new Error("dist/server JavaScript does not contain the expected source commit");
  }
}
if (!serverArtifactIncludes(EXPECTED_SCHEMA_VERSION)) {
  throw new Error("dist/server JavaScript does not contain the expected schema version");
}

const workerUrl = pathToFileURL(workerPath);
workerUrl.searchParams.set("sites-validation", `${process.pid}-${Date.now()}`);
const worker = await import(workerUrl.href);
if (!worker.default || typeof worker.default.fetch !== "function") {
  throw new Error("dist/server/index.js must have an ESM default export with fetch(request, env, ctx)");
}

console.log(JSON.stringify({
  result: "pass",
  migrationCount: migrations.count,
  schemaVersion: EXPECTED_SCHEMA_VERSION,
  worker: "default.fetch",
}));
