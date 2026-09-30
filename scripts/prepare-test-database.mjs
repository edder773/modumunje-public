import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCanonicalDatabaseFile, migrationFiles } from "./lib/canonical-database.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputIndex = process.argv.indexOf("--output");
const output = outputIndex >= 0 ? process.argv[outputIndex + 1] : ".ci-artifacts/canonical.sqlite";

if (!output) throw new Error("--output requires a file path");

const startedAt = performance.now();
const database = buildCanonicalDatabaseFile(root, path.resolve(root, output));
console.log(JSON.stringify({
  database,
  durationMs: Number((performance.now() - startedAt).toFixed(1)),
  migrations: migrationFiles(root).length,
}));
