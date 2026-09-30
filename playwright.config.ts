import { defineConfig } from "@playwright/test";
import {
  createLocalGoogleStorageState,
  LOCAL_E2E_GOOGLE_SESSION_SECRET,
} from "./tests/e2e/local-google-session";

const deployedBaseUrl = process.env.DEPLOYED_BASE_URL?.replace(/\/$/u, "");

export default defineConfig({
  testDir: "./tests/e2e",
  grepInvert: /@production/u,
  fullyParallel: false,
  timeout: 45_000,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "line",
  use: {
    baseURL: deployedBaseUrl ?? "http://127.0.0.1:4173",
    locale: "ko-KR",
    storageState: deployedBaseUrl ? undefined : createLocalGoogleStorageState(),
    trace: "retain-on-failure",
  },
  webServer: deployedBaseUrl ? undefined : {
    command: "node ./node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4173",
    env: {
      ADMIN_EMAIL: "admin@example.test",
      BAEUMZIP_E2E_CLIENT_BOOTSTRAP: "client-mocked",
      GOOGLE_AUTH_SESSION_SECRET: LOCAL_E2E_GOOGLE_SESSION_SECRET,
      SKCT_GROUP_REPEAT_IDENTITY_VERIFIED: "1",
      SKCT_GROUP_SERVICE_ENABLED: "1",
      SKCT_GROUP_V2_ENABLED: "1",
    },
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
