import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openCanonicalDatabase } from "./lib/canonical-database.mjs";
import { buildDataIntegrityReport } from "./lib/data-integrity.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const databasePathIndex = process.argv.indexOf("--database");
const databasePath = databasePathIndex >= 0 ? process.argv[databasePathIndex + 1] : null;
const database = databasePath
  ? new DatabaseSync(databasePath, { readOnly: true })
  : openCanonicalDatabase(root, { isolated: false });

try {
  const { failures, report } = buildDataIntegrityReport(database, {
    databaseLabel: databasePath ?? process.env.BAEUMZIP_TEST_DATABASE ?? ":memory:",
  });
  process.stdout.write(`${JSON.stringify({ ...report, failures }, null, 2)}\n`);
  if (failures.length > 0) process.exitCode = 1;
} finally {
  database.close();
}
