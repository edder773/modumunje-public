import { defineConfig } from "@playwright/test";
import {
  createLocalGoogleStorageState,
  LOCAL_E2E_GOOGLE_SESSION_SECRET,
} from "./tests/e2e/local-google-session";

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "test-results/production",
  grep: /@production/u,
  fullyParallel: false,
  timeout: 60_000,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "line",
  use: {
    baseURL: "http://127.0.0.1:4174",
    locale: "ko-KR",
    storageState: createLocalGoogleStorageState(),
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node tests/helpers/production-server.mjs",
    env: {
      ADMIN_EMAIL: "admin@example.test",
      GOOGLE_AUTH_SESSION_SECRET: LOCAL_E2E_GOOGLE_SESSION_SECRET,
      SKCT_GROUP_REPEAT_IDENTITY_VERIFIED: "1",
      SKCT_GROUP_SERVICE_ENABLED: "1",
      SKCT_GROUP_V2_ENABLED: "1",
    },
    url: "http://127.0.0.1:4174",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
