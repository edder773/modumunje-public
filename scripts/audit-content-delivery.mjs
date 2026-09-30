import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stableJson } from "./lib/content-release.mjs";
import { verifyContentDelivery } from "./lib/content-delivery.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function option(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

const report = verifyContentDelivery(root, {
  deep: !process.argv.includes("--quick"),
});
const output = option("--output");
if (output) {
  const outputFile = path.resolve(output);
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, stableJson(report), "utf8");
}
process.stdout.write(stableJson(report));
