import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { readFeatureSource } from "./helpers/feature-source.mjs";

const projectRoot = path.resolve(import.meta.dirname, "..");

function source(file) {
  return readFeatureSource(path.join(projectRoot, file), "utf8");
}

test("the public catalog does not request protected study data", () => {
  const study = source("apps/frontend/src/features/study/components/study-app.tsx");

  assert.match(study, /if \(!isAuthenticated && initialLearningLevel === "root"\)/u);
  assert.match(study, /setLoadError\(""\);[\s\S]*?setLoading\(false\);/u);
  assert.match(study, /\{isAuthenticated && <SaveStatus/u);
});

test("the Google login modal keeps equal desktop actions without stretching on mobile", () => {
  const styles = source("apps/frontend/app/globals.css");

  assert.match(styles, /\.login-required-actions\s*\{[\s\S]*?background:\s*transparent/u);
  assert.match(styles, /\.login-required-actions > :is\(a, button\)\s*\{[\s\S]*?flex:\s*1 1 0;[\s\S]*?min-height:\s*48px/u);
  assert.match(styles, /\.modal:has\(> \.modal-body > \.login-required-copy\)\s*\{[\s\S]*?height:\s*auto;[\s\S]*?max-height:\s*calc\(100dvh - 24px\)/u);
  assert.match(styles, /\.modal:has\(> \.modal-body > \.login-required-copy\) \.modal-body\s*\{[\s\S]*?align-content:\s*start/u);
  assert.match(styles, /@media \(max-width: 680px\)[\s\S]*?\.login-required-actions > :is\(a, button\)\s*\{[\s\S]*?flex:\s*0 0 auto;[\s\S]*?width:\s*100%/u);
});
