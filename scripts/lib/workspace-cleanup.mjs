import fs from "node:fs";
import path from "node:path";

export const WORKSPACE_CLEANUP_TARGETS = Object.freeze({
  generated: Object.freeze([
    ".ci-artifacts/canonical.sqlite",
    ".next",
    ".vinext",
    "coverage",
    "dist",
    "outputs",
    "playwright-report",
    "test-results",
  ]),
  cache: Object.freeze([
    ".ci-artifacts/test-database-cache",
    "node_modules/.vite",
    "node_modules/.vite-temp",
  ]),
});

function targetPaths(scope) {
  if (scope === "all") {
    return [...WORKSPACE_CLEANUP_TARGETS.generated, ...WORKSPACE_CLEANUP_TARGETS.cache];
  }
  const targets = WORKSPACE_CLEANUP_TARGETS[scope];
  if (!targets) throw new Error("scope must be generated, cache, or all");
  return targets;
}

function assertInsideRoot(root, target) {
  const relative = path.relative(root, target);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`cleanup target must stay inside the workspace: ${target}`);
  }
}

function entryBytes(target) {
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) return stat.size;
  return fs.readdirSync(target).reduce(
    (total, name) => total + entryBytes(path.join(target, name)),
    stat.size,
  );
}

export function cleanWorkspace(root, { scope = "generated", dryRun = false } = {}) {
  const resolvedRoot = path.resolve(root);
  const entries = [];
  for (const relative of targetPaths(scope)) {
    const target = path.resolve(resolvedRoot, relative);
    assertInsideRoot(resolvedRoot, target);
    if (!fs.existsSync(target)) continue;
    const bytes = entryBytes(target);
    if (!dryRun) fs.rmSync(target, { force: true, recursive: true });
    entries.push({ path: relative, bytes });
  }
  return {
    scope,
    dryRun,
    bytes: entries.reduce((total, entry) => total + entry.bytes, 0),
    entries,
  };
}
