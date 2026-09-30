import { readdir, writeFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { isImmutableStaticAssetPath, IMMUTABLE_CACHE_CONTROL } from "../apps/frontend/worker/immutable-static-assets";

export async function staticAssetHeaders(directory: string) {
  const paths: string[] = [];
  async function walk(folder: string) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const file = resolve(folder, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) {
        const pathname = `/${relative(directory, file).split("\\").join("/")}`;
        if (isImmutableStaticAssetPath(pathname)) paths.push(pathname);
      }
    }
  }
  await walk(directory);
  paths.sort();
  // Cloudflare supports 100 _headers rules. Fail closed instead of applying
  // immutable caching to missing/non-hashed files through a broad wildcard.
  if (!paths.length || paths.length > 100) throw new Error(`Expected 1–100 hashed JS/CSS assets; found ${paths.length}`);
  return "# Exact files from this build; HTML, errors and non-hashed files are excluded.\n"
    + paths.map(path => `${path}\n  Cache-Control: ${IMMUTABLE_CACHE_CONTROL}\n  X-Baeumzip-Asset-Route: static-manifest\n`).join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = resolve(process.argv[2] ?? "dist/client");
  await writeFile(resolve(directory, "_headers"), await staticAssetHeaders(directory));
}
