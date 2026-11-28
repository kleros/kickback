import { defineConfig, devices } from "@playwright/test";

import { E2E_APP_PORT, E2E_RPC_PORT } from "./e2e/utils/servers";

const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${E2E_APP_PORT}`;

// eslint-disable-next-line turbo/no-undeclared-env-vars -- read by Playwright directly, never through a turbo task
const RPC_PORT = process.env.E2E_RPC_PORT ?? E2E_RPC_PORT;

// set before the workers start, so global-setup and the fixtures' `config/chains` read the servers started here
process.env.E2E_BASE_URL = BASE_URL;
process.env.NEXT_PUBLIC_LOCAL_RPC_URL = `http://127.0.0.1:${RPC_PORT}`;

export default defineConfig({
  testDir: "./e2e/tests",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["html", { open: "never" }], ["list"]],
  use: {
    baseURL: BASE_URL,
    trace: process.env.CI ? "on-first-retry" : "retain-on-failure",
    timezoneId: "GMT",
    // eslint-disable-next-line turbo/no-undeclared-env-vars -- a preinstalled Chromium when the pinned one is absent
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, testIgnore: /organiser(-regressions)?\.spec\.ts/ },
    // warps the shared node's clock for good, so it runs after every spec that needs the suite event open
    {
      name: "organiser",
      use: { ...devices["Desktop Chrome"] },
      testMatch: /organiser(-regressions)?\.spec\.ts/,
      dependencies: ["chromium"],
    },
  ],
  webServer: [
    {
      // the package's `local-node` script passes --no-deploy, which this Hardhat does not accept
      command: `yarn workspace @kickback/contracts hardhat node --port ${RPC_PORT}`,
      url: process.env.NEXT_PUBLIC_LOCAL_RPC_URL,
      // never reuse: a process already on the port is not known to be this suite's node or app
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command: `yarn next dev --port ${new URL(BASE_URL).port || "80"}`,
      url: BASE_URL,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        NEXT_PUBLIC_CHAIN: "hardhat",
        NEXT_PUBLIC_LOCAL_RPC_URL: process.env.NEXT_PUBLIC_LOCAL_RPC_URL,
        NEXT_PUBLIC_REOWN_PROJECT_ID: process.env.NEXT_PUBLIC_REOWN_PROJECT_ID || "e2e-placeholder",
      },
    },
  ],
});
