import { expect, test } from "@playwright/test";

const assets = [
  "async-state.svg",
  "complexity-scale.svg",
  "coverage-evidence.svg",
  "defect-loop.svg",
  "deployment-safety.svg",
  "design-techniques.svg",
  "drm-components.svg",
  "integration-error-map.svg",
  "integration-flow.svg",
  "interface-contract.svg",
  "observability-triad.svg",
  "package-evidence.svg",
  "performance-observation.svg",
  "release-chain.svg",
  "security-controls.svg",
  "soap-stack.svg",
  "sort-family-map.svg",
  "stack-queue-flow.svg",
  "test-levels.svg",
  "test-process.svg",
  "tree-traversal.svg",
  "validation-layers.svg",
  "xml-json-compare.svg",
];

test("retired S2 diagrams remain absent after the IPE content reset", async ({ request }) => {
  for (const name of assets) {
    const response = await request.get(
      `/learning-assets/information-processing/software-development/${name}`,
    );
    // Release 3eb41be deliberately removed the previous IPE content and diagrams.
    expect(response.status(), name).toBe(404);
  }
});


test("current S2 teaching images are served as PNGs from their focused release paths", async ({ request }) => {
  for (const name of ["insertion-sort", "integration-tests", "interface-flow", "merge-sort", "stack-queue", "tree-traversal"]) {
    const response = await request.get(`/learning-assets/information-processing/software-development/s2-focused-20260907/${name}.png`);
    expect(response.status(), name).toBe(200);
    expect(response.headers()["content-type"], name).toContain("image/png");
    expect((await response.body()).subarray(0, 8).toString("hex"), name).toBe("89504e470d0a1a0a");
  }
});
