import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("CI reuses an exact dependency tree without serializing independent jobs", () => {
  const action = source(".github/actions/setup-node-dependencies/action.yml");
  const workflow = source(".github/workflows/ci.yml");

  assert.match(
    action,
    /uses: actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7/u,
  );
  assert.match(
    action,
    /uses: actions\/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6/u,
  );
  assert.match(
    action,
    /node-modules-v1-\$\{\{ runner[.]os \}\}-\$\{\{ runner[.]arch \}\}-node-22[.]13[.]0-\$\{\{ hashFiles\('package[.]json', 'package-lock[.]json', '[.]npmrc'\) \}\}/u,
  );
  assert.match(action, /!node_modules\/[.]vite/u);
  assert.match(action, /!node_modules\/[.]vite-temp/u);
  assert.match(action, /cache-hit != 'true'[\s\S]*run: npm ci/u);
  assert.match(action, /cache-hit == 'true'[\s\S]*run: npm ls --depth=0/u);

  assert.equal(
    (workflow.match(/uses: [.][/]\.github\/actions\/setup-node-dependencies/gu) ?? []).length,
    5,
  );
  assert.doesNotMatch(workflow, /run: npm ci/u);
  assert.match(
    workflow,
    /fast-checks:[\s\S]*install: \$\{\{ needs[.]classify[.]outputs[.]source \}\}/u,
  );
  assert.match(workflow, /node-tests:[\s\S]*needs: \[classify, prepare-database, build\]/u);
  assert.match(workflow, /deep-node-tests:[\s\S]*needs: \[classify, prepare-database, build\]/u);
  assert.match(workflow, /browser-tests:[\s\S]*needs: \[classify, fast-checks, build\]/u);
});
