import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the Vite config loads with the future native config loader", () => {
  const script = [
    'import { loadConfigFromFile } from "vite";',
    "const loaded = await loadConfigFromFile(",
    '  { command: "build", mode: "production" },',
    '  undefined, process.cwd(), "error", undefined, "native",',
    ");",
    'if (loaded?.path !== process.cwd() + "/vite.config.ts") throw new Error("config path mismatch");',
    'if (!loaded?.config?.plugins?.some((plugin) => plugin?.name === "sites")) throw new Error("sites plugin missing");',
    'if (!loaded?.config?.plugins?.some((plugin) => plugin?.name === "baeumzip:preserve-vinext-request-bodies")) throw new Error("body guard missing");',
  ].join("\n");
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "--eval", script],
    { cwd: root, encoding: "utf8" },
  );

  assert.equal(
    result.status,
    0,
    [result.stdout, result.stderr].filter(Boolean).join("\n"),
  );
});
