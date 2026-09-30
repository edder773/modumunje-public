import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const fail = (message) => { throw new Error(message); };
const remotes = execFileSync("git", ["remote"], { cwd: root, encoding: "utf8" }).trim().split(/\s+/u).filter(Boolean);
for (const remote of remotes) {
  const values = execFileSync("git", ["remote", "get-url", "--all", remote], { cwd: root, encoding: "utf8" }).trim().split("\n");
  if (values.some(value => !value.startsWith("https://git.chatgpt-team.site/"))) fail("Private source has an external Git destination");
}
const publicRoot = path.join(root, "apps/frontend/public");
const clientRoot = path.join(root, "dist/client");
const privateInventory = JSON.parse(fs.readFileSync(path.join(root, "apps/backend/resources/content/manifests/ipe-practical-diagrams.json"), "utf8"));
const privateNames = privateInventory.assets.map(asset => path.basename(asset.legacyUrl));
function scan(directory, built = false) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) fail("Public assets must not contain symlinks");
    if (entry.name === ".internal" || entry.name === "requirements.json") fail("Internal state entered public assets");
    if (entry.isDirectory()) { scan(target, built); continue; }
    if (built && /\.(?:js|json|html|map)$/u.test(entry.name)) {
      const source = fs.readFileSync(target, "utf8");
      if (privateNames.some(name => source.includes(name))) fail("Private diagram inventory entered the client bundle");
    }
  }
}
scan(publicRoot);
if (!fs.existsSync(clientRoot)) fail("Build client assets before verifying the private source boundary");
scan(clientRoot, true);
console.log(JSON.stringify({ result: "pass", boundary: "private-source-and-public-assets" }));
