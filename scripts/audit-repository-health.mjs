import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectRepositoryHealth, guardChangedFiles } from "./lib/repository-health.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseIndex = process.argv.indexOf("--base");
const rangeIndex = process.argv.indexOf("--range");
const base = rangeIndex >= 0
  ? process.argv[rangeIndex + 1]
  : baseIndex >= 0
    ? process.argv[baseIndex + 1]
    : undefined;
const report = collectRepositoryHealth(root);
const failures = guardChangedFiles(root, base);

console.log(JSON.stringify({ ...report, failures }, null, 2));
if (failures.length > 0) process.exitCode = 1;
