import { gzipSync } from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverDirectory = path.join(root, "dist/server");
const clientDirectory = path.join(root, "dist/client");
const entry = path.join(serverDirectory, "index.js");
if (!fs.existsSync(entry)) throw new Error("dist/server/index.js is missing; run the production build first");
const manifestPath = path.join(clientDirectory, ".vite/manifest.json");
if (!fs.existsSync(manifestPath)) throw new Error("dist/client/.vite/manifest.json is missing; run the production build first");

function filesUnder(directory) {
  return fs.readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((item) => item.isFile())
    .map((item) => path.join(item.parentPath, item.name));
}

const files = filesUnder(serverDirectory);
const recoveryChunks = files.filter((file) => {
  const source = fs.readFileSync(file, "utf8");
  return source.includes("COMPRESSED_QUESTION_BANK_BASE64")
    || source.includes("COMPRESSED_THEORY_BANK_BASE64");
});
const entrySource = fs.readFileSync(entry, "utf8");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

function staticClientFiles(entryKeys) {
  const visited = new Set();
  function visit(key) {
    if (visited.has(key)) return;
    const item = manifest[key];
    if (!item) throw new Error(`client manifest entry is missing: ${key}`);
    visited.add(key);
    for (const imported of item.imports ?? []) visit(imported);
  }
  for (const key of entryKeys) visit(key);
  return [...new Set([...visited].map((key) => manifest[key].file))];
}

function clientMetric(entryKeys) {
  const staticFiles = staticClientFiles(entryKeys);
  return {
    entries: entryKeys,
    initialJsBytes: staticFiles
      .filter((file) => file.endsWith(".js"))
      .reduce((sum, file) => sum + fs.statSync(path.join(clientDirectory, file)).size, 0),
    staticFiles,
  };
}

function manifestEntry(sourcePath) {
  if (manifest[sourcePath]) return sourcePath;
  const name = path.basename(sourcePath).replace(/\.[^.]+$/u, "");
  const matches = Object.entries(manifest).filter(([, entry]) => entry.src === sourcePath || entry.name === name);
  if (matches.length !== 1) throw Error(`Expected one client entry for ${sourcePath}; got ${matches.length}`);
  return matches[0][0];
}
// Catalog cards and GET filtering are server-rendered. These are the client
// islands rendered by its shell/layout, including the signed-in report action.
const rootEntries = [
  "apps/frontend/src/features/study/components/catalog/catalog-report-action.tsx",
  "apps/frontend/src/features/study/telemetry/page-view-tracker.tsx",
  "apps/frontend/src/features/advertising/reserved-ad-slot.tsx",
].map(manifestEntry);
const pageTrackerEntry = manifestEntry("apps/frontend/src/features/study/telemetry/page-view-tracker.tsx");
const rootCatalogClient = clientMetric(rootEntries);
const studyAppClient = clientMetric([manifestEntry("apps/frontend/src/features/study/components/study-app.tsx"), pageTrackerEntry]);
const browserEntry = Object.keys(manifest).find(key => key.includes("virtual:vinext-app-browser-entry"));
if (!browserEntry) throw Error("Client browser entry is missing");
const rootWithRuntime = clientMetric([browserEntry, ...rootEntries]);
// Vinext attaches root layout CSS to the Worker entry, and screen CSS to lazy entries.
const serverManifest = JSON.parse(fs.readFileSync(path.join(serverDirectory, ".vite/manifest.json"), "utf8"));
const initialCssFiles = [...new Set(Object.values(serverManifest)
  .filter((item) => item.isEntry)
  .flatMap((item) => item.css ?? []))];
if (!initialCssFiles.length) throw new Error("Worker entry CSS is missing from the build manifest");
const lazyCssFiles = [...new Set(Object.values(manifest)
  .filter((item) => item.isDynamicEntry)
  .flatMap((item) => item.css ?? []))];
function cssBytes(files) {
  return files.reduce((sum, file) => sum + fs.statSync(path.join(clientDirectory, file)).size, 0);
}
const clientFiles = filesUnder(clientDirectory);
const largestClientAsset = clientFiles
  .map((file) => ({
    file: path.relative(root, file).replaceAll("\\", "/"),
    bytes: fs.statSync(file).size,
  }))
  .sort((left, right) => right.bytes - left.bytes)[0];
const result = {
  initialCssBytes: cssBytes(initialCssFiles),
  initialCssFiles,
  lazyCssBytes: cssBytes(lazyCssFiles),
  lazyCssFiles,
  serverEntryBytes: fs.statSync(entry).size,
  serverEntryBudgetBytes: 3_000_000,
  serverTotalGzipBytes: files.reduce((sum, file) => sum + gzipSync(fs.readFileSync(file)).length, 0),
  serverTotalGzipBudgetBytes: 1_500_000,
  serverTotalBytes: files.reduce((sum, file) => sum + fs.statSync(file).size, 0),
  recoveryChunks: recoveryChunks.map((file) => ({
    file: path.relative(root, file).replaceAll("\\", "/"),
    bytes: fs.statSync(file).size,
  })),
  recoveryBankInNormalEntry: entrySource.includes("COMPRESSED_QUESTION_BANK_BASE64"),
  clientTotalBytes: clientFiles.reduce((sum, file) => sum + fs.statSync(file).size, 0),
  largestClientAsset,
  rootCatalogWithBrowserRuntimeJsBytes: rootWithRuntime.initialJsBytes,
  rootCatalogWithBrowserRuntimeStaticFiles: rootWithRuntime.staticFiles,
  rootCatalogInitialJsBytes: rootCatalogClient.initialJsBytes,
  rootCatalogInitialJsBudgetBytes: 360_000,
  studyAppInitialJsBytes: studyAppClient.initialJsBytes,
  studyAppInitialJsBudgetBytes: 505_000,
  rootCatalogStaticFiles: rootCatalogClient.staticFiles,
};
console.log(JSON.stringify(result, null, 2));
if (
  result.recoveryBankInNormalEntry
  || result.recoveryChunks.length > 0
  || result.serverTotalGzipBytes > result.serverTotalGzipBudgetBytes
  || result.serverEntryBytes > result.serverEntryBudgetBytes
  || result.rootCatalogInitialJsBytes > result.rootCatalogInitialJsBudgetBytes
  || result.studyAppInitialJsBytes > result.studyAppInitialJsBudgetBytes
) {
  process.exitCode = 1;
}
