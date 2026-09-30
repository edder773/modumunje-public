import { defineConfig } from "@playwright/test";

const deployedBaseUrl = process.env.DEPLOYED_BASE_URL?.replace(/\/$/u, "");
if (!deployedBaseUrl) throw new Error("DEPLOYED_BASE_URL is required for deployed browser checks");

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  timeout: 60_000,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "line",
  use: {
    baseURL: deployedBaseUrl,
    locale: "ko-KR",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "guest",
      testMatch: ["deployment-quality.spec.ts", "public-indexing.spec.ts", "public-theory.spec.ts"],
    },
    ...(process.env.DEPLOYED_AUTH_STORAGE_STATE ? [{
      name: "authenticated",
      testMatch: ["deployment-auth-quality.spec.ts", "operational-api.spec.ts"],
      use: {
        storageState: process.env.DEPLOYED_AUTH_STORAGE_STATE,
      },
    }] : []),
  ],
});
