import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stableJson } from "./lib/content-release.mjs";
import {
  contentReleaseEvidenceMarkdown,
  verifyContentReleaseGate,
} from "./lib/content-release-gate.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function option(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

const evidence = verifyContentReleaseGate(root, {
  releaseDirectory: option("--release"),
  version: option("--version"),
});
const output = option("--output");
const summary = option("--summary");

if (output) {
  const outputFile = path.resolve(output);
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, stableJson(evidence), "utf8");
}
if (summary) {
  const summaryFile = path.resolve(summary);
  fs.mkdirSync(path.dirname(summaryFile), { recursive: true });
  fs.appendFileSync(summaryFile, contentReleaseEvidenceMarkdown(evidence), "utf8");
}

process.stdout.write(stableJson(evidence));
