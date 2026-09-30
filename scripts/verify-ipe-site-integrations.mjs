import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyIpeSiteIntegrations } from "./lib/ipe-site-integration-verifier.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const subjectIndex = process.argv.indexOf("--subject");
const subjectKey = subjectIndex >= 0 ? process.argv[subjectIndex + 1] : null;
const result = verifyIpeSiteIntegrations(projectRoot, { subjectKey });
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
