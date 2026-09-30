import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

test("CI workflow labels and test titles remain consistently English", () => {
  const workflowDirectory = path.join(root, ".github", "workflows");
  for (const name of fs.readdirSync(workflowDirectory).filter((entry) => /[.]ya?ml$/u.test(entry))) {
    const source = fs.readFileSync(path.join(workflowDirectory, name), "utf8");
    assert.doesNotMatch(source, /[가-힣]/u, `${name} contains a Korean CI label`);
  }

  const testDirectory = path.join(root, "tests");
  const pending = [testDirectory];
  while (pending.length) {
    const directory = pending.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(file);
        continue;
      }
      if (!/[.](?:mjs|ts)$/u.test(entry.name)) continue;
      const source = fs.readFileSync(file, "utf8");
      const titles = source.matchAll(/\btest(?:[.]describe)?\(\s*(["'`])([^\n]*?)\1/gu);
      for (const match of titles) {
        assert.doesNotMatch(match[2], /[가-힣]/u, `${path.relative(root, file)} has a Korean test title`);
      }
    }
  }
});
