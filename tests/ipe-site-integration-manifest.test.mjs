import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  loadIpeSiteIntegrationManifest,
  verifyIpeSiteIntegrations,
} from "../scripts/lib/ipe-site-integration-verifier.mjs";
import { openCanonicalTestDatabase } from "./helpers/canonical-database.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function filesUnder(directory, files = []) {
  if (!fs.existsSync(directory)) return files;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) filesUnder(absolutePath, files);
    else files.push(absolutePath);
  }
  return files;
}

test("compact IPE manifest verifies only the newly retained S1 content", () => {
  const { manifest, bytes, sha256 } = loadIpeSiteIntegrationManifest(root);
  assert.equal(manifest.subjects.length, 1);
  assert.match(sha256, /^[a-f0-9]{64}$/u);
  assert.ok(bytes > 0 && bytes < 200_000);
  assert.deepEqual(manifest.courseReleases.IPEW, {
    status: "released",
    releaseStage: "released",
    questionCount: 2500,
    activeQuestionCount: 2500,
    theoryCount: 94,
    activeTheoryCount: 94,
    requiredBlockers: [],
    questionsBySubject: {
      "s1-software-design": 500,
    },
  });
  assert.equal(manifest.courseReleases.IPEP.status, "released");
  assert.deepEqual(manifest.courseReleases.IPEP.requiredBlockers, []);

  const result = verifyIpeSiteIntegrations(root);
  assert.equal(result.result, "pass");
  assert.equal(result.subjects.reduce((total, subject) => total + subject.theories, 0), 18);
  assert.equal(result.subjects.reduce((total, subject) => total + subject.assets, 0), 27);
  assert.equal(result.subjects.reduce((total, subject) => total + subject.assetReferences, 0), 27);
  assert.deepEqual(result.subjects.map(({ key }) => key), [
    "s1-software-design",
  ]);
});

test("released S5 theories are available in the canonical database", () => {
  const database = openCanonicalTestDatabase(root);
  try {
    const rows = database.prepare(`
      SELECT id, title, content FROM theories
      WHERE id IN (86180001, 86180005, 86210001)
    `).all();
    assert.equal(rows.length, 3);
    assert.ok(rows.every((row) => row.content.includes("/assets/ipe/s5/")));
  } finally {
    database.close();
  }
});

test("active code and tests cannot regain a direct legacy evidence dependency", () => {
  const legacyPath = [".", "integration-evidence"].join("");
  assert.equal(
    fs.existsSync(path.join(root, legacyPath)),
    false,
    "retired legacy evidence tree must not be reintroduced",
  );
  const scanned = [
    ...filesUnder(path.join(root, "apps/frontend")),
    ...filesUnder(path.join(root, "apps/backend/src")),
    ...filesUnder(path.join(root, "packages")),
    ...filesUnder(path.join(root, "scripts")),
    ...filesUnder(path.join(root, "tests")),
    path.join(root, ".gitattributes"),
    path.join(root, "package.json"),
  ].filter((file) => fs.existsSync(file) && fs.statSync(file).isFile());
  const offenders = scanned
    .filter((file) => fs.readFileSync(file).includes(legacyPath))
    .map((file) => path.relative(root, file));
  assert.deepEqual(offenders, []);
});

test("Markdown theory images preserve their aspect ratio in narrow containers", () => {
  const styles = fs.readFileSync(
    path.join(root, "apps/frontend/app/styles/global-foundation.css"),
    "utf8",
  );
  assert.match(styles, /[.]markdown-body img\s*\{[\s\S]*max-width:\s*100%;[\s\S]*height:\s*auto;/u);
});
