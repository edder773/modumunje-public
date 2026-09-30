import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCourseRegistryArtifacts } from "./lib/course-registry-generator.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "packages/shared/src/study/course-registry.source.json");
const outputs = {
  runtime: path.join(root, "packages/shared/src/study/course-contract.mjs"),
  declarations: path.join(root, "packages/shared/src/study/course-contract.d.mts"),
  databaseSql: path.join(root, "apps/backend/resources/course-registry/registered-course-values.sql"),
};
const checkOnly = process.argv.includes("--check");
const source = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
const artifacts = buildCourseRegistryArtifacts(source);
const drift = [];

for (const [name, outputPath] of Object.entries(outputs)) {
  const expected = artifacts[name];
  const existing = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8") : null;
  if (existing === expected) continue;
  drift.push(path.relative(root, outputPath));
  if (!checkOnly) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, expected, "utf8");
  }
}

if (checkOnly && drift.length > 0) {
  throw new Error(`course registry generated artifacts are stale:\n- ${drift.join("\n- ")}\nRun npm run generate:course-registry.`);
}

process.stdout.write(`${JSON.stringify({
  mode: checkOnly ? "check" : "generate",
  source: path.relative(root, sourcePath),
  fields: artifacts.registry.fields.length,
  courses: artifacts.registry.examTypes.length,
  subjects: artifacts.registry.subjects.length,
  contentScopes: artifacts.registry.contentScopes.length,
  changed: drift,
}, null, 2)}\n`);
