import vinext from "vinext";
import { defineConfig } from "vite";
import { execFileSync } from "node:child_process";
import packageJson from "./package.json" with { type: "json" };
import { sites } from "./build/sites-vite-plugin.ts";
import { preserveVinextRequestBodies } from "./build/vinext-request-body-guard.ts";
import { EXPECTED_SCHEMA_VERSION } from "./packages/shared/src/database/schema-contract.mjs";

const localRuntimeVariableNames = [
  "ADMIN_EMAIL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_AUTH_SESSION_SECRET",
  "GOOGLE_OAUTH_REDIRECT_URI",
  "BAEUMZIP_E2E_CLIENT_BOOTSTRAP",
  "CANONICAL_RECOVERY_SOURCE",
  "SKCT_GROUP_SERVICE_ENABLED",
  "SKCT_GROUP_V2_ENABLED",
  "SKCT_GROUP_REPEAT_IDENTITY_VERIFIED",
  "BACKUP_SCHEDULE_VERIFIED",
] as const;

const localRuntimeVariables = Object.fromEntries(
  localRuntimeVariableNames.flatMap((name) => (
    process.env[name] === undefined ? [] : [[name, process.env[name]]]
  )),
);

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  main: "./apps/frontend/worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  // The platform serves matching assets before the Worker by default. Route
  // only build assets through the Worker so it can set a browser cache policy
  // for content-hashed JS/CSS while all other assets keep their current path.
  assets: {
    binding: "ASSETS",
    run_worker_first: ["/_next/static/*"],
  },
  vars: localRuntimeVariables,
  ratelimits: [
    {
      name: "EVENT_RATE_LIMITER",
      namespace_id: "773004",
      simple: { limit: 120, period: 60 as const },
    },
  ],
  // Public CI has no Sites project identity or live data bindings.
  d1_databases: [],
  r2_buckets: [],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");
  const buildSha = process.env.BAEUMZIP_BUILD_SHA
    ?? process.env.GITHUB_SHA
    ?? (() => { try { return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return "public-source"; } })();
  const builtAt = process.env.BAEUMZIP_BUILT_AT ?? new Date().toISOString();

  return {
    define: {
      __BAEUMZIP_BUILD_SHA__: JSON.stringify(buildSha),
      __BAEUMZIP_BUILT_AT__: JSON.stringify(builtAt),
      __BAEUMZIP_APP_VERSION__: JSON.stringify(packageJson.version),
      __BAEUMZIP_SCHEMA_VERSION__: JSON.stringify(EXPECTED_SCHEMA_VERSION),
    },
    publicDir: "apps/frontend/public",
    server: {
      host: "0.0.0.0",
      allowedHosts: ["terminal.local"],
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [
      preserveVinextRequestBodies(),
      vinext({
        appDir: "apps/frontend",
        // Keep titles, canonical URLs and robots directives in the initial head
        // for every visitor, including crawlers that do not execute JavaScript.
        nextConfig: { htmlLimitedBots: /.*/ },
      }),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        config: localBindingConfig,
      }),
    ],
  };
});
