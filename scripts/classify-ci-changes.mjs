import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { classifyChanges } from "./lib/ci-changes.mjs";

const rangeIndex = process.argv.indexOf("--range");
const range = rangeIndex >= 0 ? process.argv[rangeIndex + 1] : "HEAD^...HEAD";
if (!range) throw new Error("--range requires a Git comparison range");

const diff = spawnSync("git", ["diff", "--name-only", range], { encoding: "utf8" });
if (diff.status !== 0) throw new Error(diff.stderr || `git diff failed for ${range}`);

const files = diff.stdout.split("\n").filter(Boolean);
const full = process.env.GITHUB_EVENT_NAME === "workflow_dispatch";
const result = classifyChanges(files, { full });
const output = Object.entries(result)
  .map(([key, value]) => `${key}=${String(value)}`)
  .concat(`changedCount=${files.length}`)
  .join("\n");

if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${output}\n`, "utf8");
console.log(JSON.stringify({ files, full, result }, null, 2));
