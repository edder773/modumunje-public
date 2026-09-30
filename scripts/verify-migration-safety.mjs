import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrationSafetyDrill } from "./lib/migration-safety.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
console.log(JSON.stringify(runMigrationSafetyDrill(root), null, 2));
