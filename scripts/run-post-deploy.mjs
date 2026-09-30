import { spawnSync } from "node:child_process";

const DEFAULT_DEPLOYED_BASE_URL = "https://modumunje.com";
const deployedBaseUrl = (process.env.DEPLOYED_BASE_URL?.trim() || DEFAULT_DEPLOYED_BASE_URL)
  .replace(/\/$/u, "");
const requireAuthenticated = process.env.DEPLOYED_REQUIRE_AUTH === "1";

if (requireAuthenticated && !process.env.DEPLOYED_AUTH_STORAGE_STATE?.trim()) {
  throw new Error(
    "DEPLOYED_REQUIRE_AUTH=1 requires DEPLOYED_AUTH_STORAGE_STATE to identify an authenticated Playwright state file",
  );
}

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const environment = {
  ...process.env,
  DEPLOYED_BASE_URL: deployedBaseUrl,
};

for (const script of ["test:smoke:deployed", "test:e2e:deployed"]) {
  const result = spawnSync(npmCommand, ["run", script], {
    env: environment,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

process.stdout.write(`${JSON.stringify({
  authenticatedCoverage: Boolean(process.env.DEPLOYED_AUTH_STORAGE_STATE?.trim()),
  baseUrl: deployedBaseUrl,
  result: "pass",
})}\n`);

