import path from "node:path";
import { fileURLToPath } from "node:url";
import { runBackupRecoveryDrill } from "./lib/backup-recovery-verifier.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const result = runBackupRecoveryDrill(projectRoot);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
