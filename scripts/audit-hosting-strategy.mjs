import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditHostingStrategy } from "./lib/hosting-strategy.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputIndex = process.argv.indexOf("--output");
const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : "";
if (outputIndex >= 0 && !outputPath) throw new Error("--output requires a path");

const report = auditHostingStrategy(root);
const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (outputPath) {
  const absoluteOutput = path.resolve(root, outputPath);
  fs.mkdirSync(path.dirname(absoluteOutput), { recursive: true });
  fs.writeFileSync(absoluteOutput, serialized, "utf8");
}
process.stdout.write(serialized);
if (report.failures.length > 0) process.exitCode = 1;
