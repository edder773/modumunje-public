import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanWorkspace } from "./lib/workspace-cleanup.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dryRun = process.argv.includes("--dry-run");
const positional = process.argv.slice(2).filter((argument) => argument !== "--dry-run");
if (positional.length > 1) throw new Error("usage: clean-workspace.mjs [generated|cache|all] [--dry-run]");

const report = cleanWorkspace(root, {
  scope: positional[0] || "generated",
  dryRun,
});
console.log(JSON.stringify(report, null, 2));
