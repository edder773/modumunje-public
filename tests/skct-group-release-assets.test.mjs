import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";

const assets = [
  ["apps/frontend/public/assets/P01/q02_it_budget_pies.svg", 4126, "d34b8adb01c7f80129e5ac4a341e61770c7bf7c62b1685b9f7f7c8a1bcb9024d"],
  ["apps/frontend/public/assets/P01/q04_hbm_market.svg", 5129, "9e622dc087b3b02112d320ef33cff9fcd7f9c1e9e6e27842708060ac9e98aa62"],
  ["apps/frontend/public/assets/P01/q05_energy_cumulative.svg", 4711, "93be21f84403859f7d6e346ed20c693647e22640a568cc8a80041e47ca2b90ab"],
  ["apps/frontend/public/assets/P01/q08_quarterly_sales_share.svg", 9631, "fd43079145998f1c3bf03c8f990a87ed2a3e042e44bee04957fa86492492a430"],
  ["apps/frontend/public/assets/P01/q09_production_defect.svg", 7212, "640b23698aea5ad6fd47164ffc3cb44e65061ef655424932a00f1c20948f8b8f"],
  ["apps/frontend/public/assets/P01/q10_c_company_cumulative.svg", 2863, "66c2ac8caed844d00e5f81755ef38930e61975825a770657e29cf2b7e3c70629"],
  ["apps/frontend/public/assets/P06/order380_q01_weighted_average.svg", 2578, "7d889a78762f8431d36af2495d18d0eb9e12ea1aa9c0d69090233481be4cd52e"],
  ["apps/frontend/public/assets/M1_REASON_Q06_rooms.svg", 1644, "371e58178231cbcdce391f58c673f4f9a65ecadd6608eef89b83b9d670dcee55"],
];

test("verified50 public SVG assets retain the reviewed bytes and hashes", () => {
  for (const [path, bytes, sha256] of assets) {
    const content = readFileSync(path);
    assert.equal(statSync(path).size, bytes, path);
    assert.equal(createHash("sha256").update(content).digest("hex"), sha256, path);
    const source = content.toString("utf8");
    assert.match(source, /<svg\b/u, path);
    assert.doesNotMatch(source, /<(?:script|foreignObject)\b|\bon\w+\s*=|(?:href|src)\s*=\s*["'](?:https?:)?\/\//iu, path);
  }
});
