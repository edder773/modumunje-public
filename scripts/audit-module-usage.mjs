import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceExtensions = [".ts", ".tsx", ".mts", ".mjs", ".js", ".jsx", ".css"];
const ignoredDirectories = new Set([
  ".git",
  ".next",
  ".sites-runtime",
  ".wrangler",
  "dist",
  "node_modules",
  "resources",
]);
const productionRoots = [
  "apps/frontend/app",
  "apps/frontend/src",
  "apps/frontend/worker",
  "apps/backend/src",
  "packages/shared/src",
  "build",
];
const consumerRoots = [
  "apps",
  "build",
  "packages",
  "scripts",
  "tests",
];
const rootConsumers = [
  "next.config.ts",
  "playwright.config.ts",
  "playwright.deployed.config.ts",
  "playwright.production.config.ts",
  "proxy.ts",
  "vite.config.ts",
];
const aliasRoots = new Map([
  ["@frontend/", "apps/frontend/src/"],
  ["@backend/", "apps/backend/src/"],
  ["@shared/", "packages/shared/src/"],
]);

function walk(directory, files = []) {
  if (!fs.existsSync(directory)) return files;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute, files);
    else if (
      sourceExtensions.includes(path.extname(entry.name))
      && !/\.d\.(?:ts|mts)$/u.test(entry.name)
    ) files.push(absolute);
  }
  return files;
}

function relative(file) {
  return path.relative(root, file).replaceAll("\\", "/");
}

function resolveModuleBase(base) {
  const candidates = [base];
  if (!sourceExtensions.includes(path.extname(base))) {
    for (const extension of sourceExtensions) candidates.push(`${base}${extension}`);
    for (const extension of sourceExtensions) candidates.push(path.join(base, `index${extension}`));
  }
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) ?? null;
}

function resolveSpecifier(importer, specifier) {
  if (specifier.startsWith(".")) {
    return resolveModuleBase(path.resolve(path.dirname(importer), specifier));
  }
  for (const [alias, directory] of aliasRoots) {
    if (specifier.startsWith(alias)) {
      return resolveModuleBase(path.join(root, directory, specifier.slice(alias.length)));
    }
  }
  return null;
}

function importSpecifiers(source) {
  const matches = source.matchAll(
    /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*|\brequire\s*\(\s*)["']([^"']+)["']/gu,
  );
  return [...matches].map((match) => match[1]);
}

function isFrameworkEntrypoint(file) {
  const normalized = relative(file);
  if (normalized === "apps/frontend/worker/index.ts") return true;
  if (!normalized.startsWith("apps/frontend/app/")) return false;
  return /\/(?:page|layout|route|error|global-error|loading|not-found|forbidden|unauthorized|sitemap|robots|manifest)\.(?:ts|tsx|mjs)$/u
    .test(normalized);
}

const productionFiles = productionRoots.flatMap((directory) => walk(path.join(root, directory)));
const productionSet = new Set(productionFiles.map((file) => path.resolve(file)));
const inbound = new Map(productionFiles.map((file) => [path.resolve(file), new Set()]));
const outbound = new Map();
const consumers = [
  ...consumerRoots.flatMap((directory) => walk(path.join(root, directory))),
  ...rootConsumers.map((file) => path.join(root, file)).filter((file) => fs.existsSync(file)),
];

for (const importer of consumers) {
  const source = fs.readFileSync(importer, "utf8");
  const resolvedImports = new Set();
  for (const specifier of importSpecifiers(source)) {
    const resolved = resolveSpecifier(importer, specifier);
    if (!resolved || !productionSet.has(path.resolve(resolved))) continue;
    const absolute = path.resolve(resolved);
    inbound.get(absolute)?.add(relative(importer));
    resolvedImports.add(absolute);
  }
  outbound.set(path.resolve(importer), resolvedImports);
}

const orphans = productionFiles
  .filter((file) => !isFrameworkEntrypoint(file) && inbound.get(path.resolve(file))?.size === 0)
  .map(relative)
  .sort();

const runtimeRoots = productionFiles
  .filter(isFrameworkEntrypoint)
  .map((file) => path.resolve(file));
for (const config of ["vite.config.ts", "proxy.ts"]) {
  for (const dependency of outbound.get(path.join(root, config)) ?? []) runtimeRoots.push(dependency);
}
const runtimeReachable = new Set();
const pending = [...runtimeRoots];
while (pending.length) {
  const current = pending.pop();
  if (!current || runtimeReachable.has(current)) continue;
  runtimeReachable.add(current);
  for (const dependency of outbound.get(current) ?? []) pending.push(dependency);
}
const toolingOnly = productionFiles
  .map((file) => path.resolve(file))
  .filter((file) => !runtimeReachable.has(file))
  .map(relative)
  .sort();

const report = {
  status: orphans.length ? "MODULE_ORPHANS_FOUND" : "MODULE_USAGE_OK",
  productionModuleCount: productionFiles.length,
  consumerModuleCount: consumers.length,
  orphanCount: orphans.length,
  orphans,
  runtimeReachableCount: runtimeReachable.size,
  toolingOnlyCount: toolingOnly.length,
  toolingOnly,
};

console.log(JSON.stringify(report, null, 2));
if (orphans.length) process.exitCode = 1;
