import { readFeatureSource } from "./helpers/feature-source.mjs";
import assert from "node:assert/strict";
import test from "node:test";

const adminUi = readFeatureSource(new URL("../apps/frontend/src/features/admin/components/admin-app.tsx", import.meta.url), "utf8");
const adminCss = readFeatureSource(new URL("../apps/frontend/app/admin/admin.css", import.meta.url), "utf8");

test("admin navigation uses semantic vector icons instead of one-letter placeholders", () => {
  assert.match(adminUi, /type AdminMenuIconName =/);
  assert.match(adminUi, /function AdminMenuIcon/);
  assert.match(adminUi, /<AdminMenuIcon name=\{item\.icon\} \/>/);
  assert.doesNotMatch(adminUi, /icon:\s*"[회문이검보록설]"/u);
  assert.match(adminCss, /\.admin-sidebar nav a > span svg\s*\{[\s\S]*?width:\s*17px;[\s\S]*?height:\s*17px;/);
});

test("mobile admin section headers do not turn desktop flex basis into vertical whitespace", () => {
  assert.match(
    adminCss,
    /@media \(max-width: 768px\)[\s\S]*?\.admin-section-head > div\s*\{[\s\S]*?width:\s*100%;[\s\S]*?flex:\s*0 1 auto;/,
  );
});

test("mobile admin modal actions stay in a balanced two-button footer", () => {
  assert.match(
    adminCss,
    /@media \(max-width: 768px\)[\s\S]*?\.admin-form-actions\s*\{[\s\S]*?bottom:\s*0;[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/,
  );
  assert.match(
    adminCss,
    /\.admin-form-actions \.admin-button\s*\{[\s\S]*?width:\s*100%;[\s\S]*?min-height:\s*44px;/,
  );
  assert.doesNotMatch(adminCss, /bottom:\s*-15px/);
  assert.doesNotMatch(adminCss, /flex-direction:\s*column-reverse/);
});
