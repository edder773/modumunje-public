import { access, cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Plugin } from "vite";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function normalizeSqlLineEndings(directory: string): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  await Promise.all(entries.map(async (entry) => {
    const target = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await normalizeSqlLineEndings(target);
      return;
    }
    if (!entry.isFile() || !entry.name.endsWith(".sql")) return;

    const source = await readFile(target, "utf8");
    const normalized = source.replace(/\r\n?/gu, "\n");
    if (normalized !== source) await writeFile(target, normalized, "utf8");
  }));
}

// Packages Sites metadata and migrations after Vite finishes compiling.
export function sites(): Plugin {
  let root = process.cwd();

  return {
    name: "sites",
    apply: "build",
    configResolved(config) {
      root = config.root;
    },
    async closeBundle() {
      const outputDirectory = resolve(root, "dist", ".openai");
      const hostingConfig = resolve(root, ".openai", "hosting.json");
      const drizzleSource = resolve(root, "apps", "backend", "drizzle");

      await rm(outputDirectory, { recursive: true, force: true });
      await mkdir(outputDirectory, { recursive: true });

      if (await exists(hostingConfig)) {
        await cp(hostingConfig, resolve(outputDirectory, "hosting.json"));
      }
      if (await exists(drizzleSource)) {
        const drizzleOutput = resolve(outputDirectory, "drizzle");
        await cp(drizzleSource, drizzleOutput, {
          recursive: true,
        });
        // Sites parses migration breakpoints on Linux. Keep packaged SQL
        // byte-stable across Windows and Unix builds so trigger bodies are not
        // submitted as an incomplete statement.
        await normalizeSqlLineEndings(drizzleOutput);
      }
    },
  };
}
