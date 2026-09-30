import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  applyDatabaseBootstrap,
  databaseBootstrapFiles,
} from "./database-bootstrap.mjs";

export const TEST_DATABASE_ENV = "BAEUMZIP_TEST_DATABASE";
const CANONICAL_CACHE_VERSION = "v2";
export const CANONICAL_CACHE_MAX_FILES = 2;
export const CANONICAL_CACHE_MIN_AGE_MS = 24 * 60 * 60 * 1_000;
export const CANONICAL_CACHE_TEMP_MAX_AGE_MS = 60 * 60 * 1_000;

const canonicalCacheFilePattern = /^canonical-[a-f0-9]{64}[.]sqlite$/u;
const canonicalCacheTempFilePattern = /^[.]canonical-[a-f0-9]{64}-\d+[.]tmp$/u;

const temporaryDirectories = new Set();
let cleanupRegistered = false;

function registerCleanup(directory) {
  temporaryDirectories.add(directory);
  if (cleanupRegistered) return;
  cleanupRegistered = true;
  process.once("exit", () => {
    for (const temporaryDirectory of temporaryDirectories) {
      try {
        fs.rmSync(temporaryDirectory, {
          force: true,
          recursive: true,
          maxRetries: 3,
          retryDelay: 50,
        });
      } catch (error) {
        if (!error || typeof error !== "object" || !("code" in error)
          || !["EBUSY", "EPERM"].includes(String(error.code))) throw error;
        // On Windows the SQLite handle may remain locked until this child exits.
        // Clones live under the suite directory, which the parent removes next.
      }
    }
  });
}

export function migrationFiles(root) {
  const migrationDirectory = path.join(root, "apps/backend/drizzle");
  return fs.readdirSync(migrationDirectory)
    .filter((name) => /^\d{4}.*[.]sql$/u.test(name))
    .sort()
    .map((name) => path.join(migrationDirectory, name));
}

export function applyCanonicalMigrations(database, root) {
  database.exec("PRAGMA foreign_keys = ON");
  for (const migration of migrationFiles(root)) {
    database.exec(fs.readFileSync(migration, "utf8").replaceAll("\r\n", "\n"));
  }
  return database;
}

export function applyCanonicalDatabase(database, root) {
  applyCanonicalMigrations(database, root);
  applyDatabaseBootstrap(database, root);
  return database;
}

export function buildCanonicalDatabaseFile(root, outputFile) {
  const resolvedOutput = path.resolve(outputFile);
  fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });
  fs.rmSync(resolvedOutput, { force: true });
  const database = new DatabaseSync(resolvedOutput);
  try {
    applyCanonicalDatabase(database, root);
  } finally {
    database.close();
  }
  return resolvedOutput;
}

export function canonicalDatabaseFingerprint(root) {
  const hash = createHash("sha256");
  hash.update(`${CANONICAL_CACHE_VERSION}\0${process.versions.node}\0`);
  for (const migration of migrationFiles(root)) {
    hash.update(`${path.basename(migration)}\0`);
    hash.update(fs.readFileSync(migration, "utf8").replaceAll("\r\n", "\n"));
    hash.update("\0");
  }
  for (const resource of databaseBootstrapFiles(root)) {
    hash.update(`${path.relative(root, resource).replaceAll("\\", "/")}\0`);
    hash.update(fs.readFileSync(resource));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function pruneCanonicalDatabaseCache(cacheDirectory, {
  activeFile,
  maxFiles = CANONICAL_CACHE_MAX_FILES,
  minAgeMs = CANONICAL_CACHE_MIN_AGE_MS,
  tempMaxAgeMs = CANONICAL_CACHE_TEMP_MAX_AGE_MS,
  now = Date.now(),
} = {}) {
  if (!Number.isInteger(maxFiles) || maxFiles < 1) {
    throw new Error("maxFiles must be a positive integer");
  }
  for (const [name, value] of [["minAgeMs", minAgeMs], ["tempMaxAgeMs", tempMaxAgeMs]]) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`);
  }

  const resolvedCache = path.resolve(cacheDirectory);
  if (!fs.existsSync(resolvedCache)) return { removed: [], retained: [] };

  const databaseFiles = [];
  const temporaryFiles = [];
  for (const entry of fs.readdirSync(resolvedCache, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(resolvedCache, entry.name);
    const stat = fs.statSync(file);
    if (canonicalCacheFilePattern.test(entry.name)) {
      databaseFiles.push({ file, mtimeMs: stat.mtimeMs });
    } else if (canonicalCacheTempFilePattern.test(entry.name)) {
      temporaryFiles.push({ file, mtimeMs: stat.mtimeMs });
    }
  }
  databaseFiles.sort((left, right) => right.mtimeMs - left.mtimeMs || left.file.localeCompare(right.file));

  const retained = new Set();
  const resolvedActive = activeFile ? path.resolve(activeFile) : "";
  if (resolvedActive && databaseFiles.some(({ file }) => file === resolvedActive)) {
    retained.add(resolvedActive);
  }
  for (const { file } of databaseFiles) {
    if (retained.size >= maxFiles) break;
    retained.add(file);
  }

  const removed = [];
  for (const { file, mtimeMs } of databaseFiles) {
    if (retained.has(file) || now - mtimeMs < minAgeMs) continue;
    fs.rmSync(file, { force: true });
    removed.push(file);
  }
  for (const { file, mtimeMs } of temporaryFiles) {
    if (now - mtimeMs < tempMaxAgeMs) continue;
    fs.rmSync(file, { force: true });
    removed.push(file);
  }

  return {
    removed,
    retained: databaseFiles
      .map(({ file }) => file)
      .filter((file) => fs.existsSync(file)),
  };
}

export function ensureCanonicalDatabaseCache(root, cacheDirectory) {
  const resolvedCache = path.resolve(cacheDirectory);
  const fingerprint = canonicalDatabaseFingerprint(root);
  const databaseFile = path.join(resolvedCache, `canonical-${fingerprint}.sqlite`);
  fs.mkdirSync(resolvedCache, { recursive: true });
  const reused = fs.existsSync(databaseFile);

  if (!reused) {
    const temporaryFile = path.join(
      resolvedCache,
      `.canonical-${fingerprint}-${process.pid}.tmp`,
    );
    buildCanonicalDatabaseFile(root, temporaryFile);
    try {
      fs.renameSync(temporaryFile, databaseFile);
    } catch (error) {
      if (!fs.existsSync(databaseFile)) throw error;
      fs.rmSync(temporaryFile, { force: true });
    }
  }

  const { removed } = pruneCanonicalDatabaseCache(resolvedCache, {
    activeFile: databaseFile,
  });
  return { databaseFile, fingerprint, reused, pruned: removed.length };
}

function cloneFixture(fixture) {
  const temporaryDirectory = fs.mkdtempSync(path.join(path.dirname(fixture), "clone-"));
  const clone = path.join(temporaryDirectory, "canonical.sqlite");
  fs.copyFileSync(fixture, clone, fs.constants.COPYFILE_FICLONE);
  registerCleanup(temporaryDirectory);
  return clone;
}

export function openCanonicalDatabase(root, { isolated = true } = {}) {
  const configuredFixture = process.env[TEST_DATABASE_ENV]?.trim();
  if (configuredFixture) {
    const fixture = path.resolve(configuredFixture);
    if (!fs.existsSync(fixture)) throw new Error(`${TEST_DATABASE_ENV} does not exist: ${fixture}`);
    const database = new DatabaseSync(isolated ? cloneFixture(fixture) : fixture, {
      readOnly: !isolated,
    });
    database.exec("PRAGMA foreign_keys = ON");
    return database;
  }

  return applyCanonicalDatabase(new DatabaseSync(":memory:"), root);
}
