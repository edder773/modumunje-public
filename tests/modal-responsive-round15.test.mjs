import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { readFeatureSource } from "./helpers/feature-source.mjs";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("learner modals contain long prose and use a compact mobile type scale", async () => {
  const styles = readFeatureSource(
    new URL("apps/frontend/app/globals.css", root),
    "utf8",
  );

  assert.match(
    styles,
    /\.modal-body > \*,[\s\S]*?\.modal-body :where\(section, article, form, fieldset, details, dl, div\)[\s\S]*?min-width:\s*0;[\s\S]*?max-width:\s*100%/,
  );
  assert.match(
    styles,
    /\.modal-body :where\(p, h1, h2, h3, h4, h5, h6, li, dt, dd, summary, label, a, strong\)[\s\S]*?overflow-wrap:\s*anywhere/,
  );
  assert.match(
    styles,
    /@media \(max-width:\s*680px\)[\s\S]*?\.modal,[\s\S]*?width:\s*100%;[\s\S]*?height:\s*100%;[\s\S]*?\.modal-head h2[\s\S]*?font-size:\s*clamp\(17px,\s*5vw,\s*20px\)/,
  );
  assert.match(
    styles,
    /\.modal-body \.markdown-body\s*\{[\s\S]*?font-size:\s*15px;[\s\S]*?line-height:\s*1\.68/,
  );
  assert.match(
    styles,
    /\.modal-body :where\(pre, code, table, th, td\)[\s\S]*?overflow-wrap:\s*normal/,
  );
});

test("admin modals use the same viewport and typography safeguards", async () => {
  const styles = await read("apps/frontend/app/admin/admin.css");

  assert.match(
    styles,
    /\.admin-modal-body > \*,[\s\S]*?\.admin-modal-body :where\(section, article, form, fieldset, details, dl, div\)[\s\S]*?min-width:\s*0;[\s\S]*?max-width:\s*100%/,
  );
  assert.match(
    styles,
    /\.admin-modal-body :where\(p, h1, h2, h3, h4, h5, h6, li, dt, dd, summary, label, a, strong\)[\s\S]*?overflow-wrap:\s*anywhere/,
  );
  assert.match(
    styles,
    /@media \(max-width:\s*430px\)[\s\S]*?\.admin-modal,[\s\S]*?width:\s*100%;[\s\S]*?height:\s*100%;[\s\S]*?\.admin-modal > header h2[\s\S]*?font-size:\s*18px/,
  );
  assert.match(
    styles,
    /\.admin-markdown\s*\{[\s\S]*?font-size:\s*14px;[\s\S]*?line-height:\s*1\.68/,
  );
  assert.match(
    styles,
    /\.admin-modal-body :where\(pre, code, table, th, td\)[\s\S]*?overflow-wrap:\s*normal/,
  );
});
