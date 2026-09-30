import path from "node:path";
import { fileURLToPath } from "node:url";
import { runDownloadedBackupRecoveryDrill } from "./lib/downloaded-backup-verifier.mjs";

const inputIndex = process.argv.indexOf("--input");
const inputFile = inputIndex >= 0 ? process.argv[inputIndex + 1] : "";
if (!inputFile) {
  process.stderr.write("Usage: npm run verify:downloaded-backup -- --input /absolute/path/to/backup.json\n");
  process.exitCode = 2;
} else {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const result = runDownloadedBackupRecoveryDrill(projectRoot, inputFile);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
