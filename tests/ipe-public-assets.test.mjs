import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { loadIpeSiteIntegrationManifest } from "../scripts/lib/ipe-site-integration-verifier.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("published IPE learning images are self-contained and readable at target widths", async () => {
  const { manifest } = loadIpeSiteIntegrationManifest(root);
  const browser = await chromium.launch({ headless: true });
  const failures = [];

  try {
    for (const width of [320, 390, 768, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 1200 } });
      for (const subject of manifest.subjects) {
        for (const asset of subject.publicAssets.assets) {
          const absolutePath = path.join(
            root,
            "apps/frontend/public",
            subject.publicAssets.basePath,
            asset.file,
          );
          if (path.extname(asset.file).toLowerCase() === ".png") {
            const source = fs.readFileSync(absolutePath).toString("base64");
            const escapedAlt = (asset.altText ?? asset.title)
              .replaceAll("&", "&amp;")
              .replaceAll('"', "&quot;")
              .replaceAll("<", "&lt;")
              .replaceAll(">", "&gt;");
            await page.setContent(`
              <style>*{box-sizing:border-box}html,body{margin:0}img{display:block;max-width:100%;height:auto}</style>
              <main style="width:100%;margin:0"><figure style="width:100%;margin:0">
                <img src="data:image/png;base64,${source}" alt="${escapedAlt}" />
              </figure></main>
            `);
            const audit = await page.locator("img").evaluate((node) => {
              const box = node.getBoundingClientRect();
              return {
                complete: node.complete,
                naturalHeight: node.naturalHeight,
                naturalWidth: node.naturalWidth,
                renderedHeight: box.height,
                renderedWidth: box.width,
                viewportWidth: document.documentElement.clientWidth,
              };
            });
            if (!audit.complete || audit.naturalWidth === 0 || audit.naturalHeight === 0) {
              failures.push(`${asset.file} does not decode as a PNG`);
            }
            if (audit.renderedWidth > audit.viewportWidth + 0.5) {
              failures.push(`${asset.file} overflows at ${width}px`);
            }
            const naturalRatio = audit.naturalWidth / audit.naturalHeight;
            const renderedRatio = audit.renderedWidth / audit.renderedHeight;
            if (Math.abs(naturalRatio - renderedRatio) > 0.01) {
              failures.push(`${asset.file} is distorted at ${width}px`);
            }
            continue;
          }
          const svg = fs.readFileSync(absolutePath, "utf8");
          assert.match(svg, /role="img"/u, asset.file);
          assert.match(svg, /aria-labelledby="title desc"/u, asset.file);
          assert.doesNotMatch(
            svg,
            /<script|<foreignObject|<image|@font-face|(?:href|src)=["']https?:|url\(["']?https?:/iu,
            asset.file,
          );

          await page.setContent(`<style>*{box-sizing:border-box}html,body{margin:0}</style><main style="width:100%;margin:0"><figure style="width:100%;margin:0">${svg}</figure></main>`);
          const audit = await page.locator("svg").evaluate((node) => {
            const svgBox = node.getBoundingClientRect();
            const scale = svgBox.width / node.viewBox.baseVal.width;
            const texts = [...node.querySelectorAll("text")].map((item) => {
              const box = item.getBoundingClientRect();
              return {
                effectiveFontSize: Number.parseFloat(getComputedStyle(item).fontSize) * scale,
                inside: box.left >= svgBox.left - 0.5
                  && box.right <= svgBox.right + 0.5
                  && box.top >= svgBox.top - 0.5
                  && box.bottom <= svgBox.bottom + 0.5,
              };
            });
            return {
              minimumFontSize: Math.min(...texts.map((item) => item.effectiveFontSize)),
              outsideCount: texts.filter((item) => !item.inside).length,
            };
          });
          if (audit.outsideCount > 0) {
            failures.push(`${asset.file} clips ${audit.outsideCount} text block(s) at ${width}px`);
          }
          if (audit.minimumFontSize < 9.99) {
            failures.push(`${asset.file} has ${audit.minimumFontSize}px text at ${width}px`);
          }
        }
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
  assert.deepEqual(failures, []);
});
