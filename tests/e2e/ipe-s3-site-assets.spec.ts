import { expect, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const assets = [
  "btree-search-path.svg",
  "deadlock-wait-graph.svg",
  "etl-pipeline.svg",
  "join-row-matching.svg",
  "key-inclusion.svg",
  "migration-validation-flow.svg",
  "normalization-path.svg",
  "null-three-valued-logic.svg",
  "recovery-log-timeline.svg",
  "select-logical-order.svg",
  "sql-language-map.svg",
  "three-schema-architecture.svg",
  "transaction-state-flow.svg",
];

test("retired S3 diagrams remain absent after the IPE content reset", async ({ request }) => {
  for (const name of assets) {
    const response = await request.get(
      `/learning-assets/information-processing/database-construction/${name}`,
    );
    // Release 3eb41be deliberately removed the previous IPE content and diagrams.
    expect(response.status(), name).toBe(404);
  }
});

test("S3 theory diagrams scale inside a 320px learning container", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.setContent(`
    <main style="box-sizing:border-box;width:100%;padding:16px">
      <article class="markdown-body" style="width:100%">
        <img
          alt="트랜잭션 상태 흐름"
          height="360"
          src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='720' height='360' viewBox='0 0 720 360'%3E%3Crect width='720' height='360' fill='white'/%3E%3C/svg%3E"
          width="720"
        />
      </article>
    </main>
  `);
  await page.addStyleTag({
    path: path.join(root, "apps/frontend/app/styles/global-foundation.css"),
  });

  const image = page.getByRole("img", { name: "트랜잭션 상태 흐름" });
  await expect(image).toHaveCSS("max-width", "100%");
  await expect.poll(async () => {
    const imageBox = await image.boundingBox();
    const articleBox = await page.locator("article").boundingBox();
    if (!imageBox || !articleBox) return false;
    const preservesAspectRatio = Math.abs(imageBox.width / imageBox.height - 2) < 0.01;
    return imageBox.width <= articleBox.width + 0.5 && preservesAspectRatio;
  }).toBe(true);
});
