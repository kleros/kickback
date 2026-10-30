import { defineConfig, devices } from "@playwright/test";

/** Where the app is served; another port runs a second dev server beside one already on 3000. */
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

/** The Hardhat node's port; another one runs the tests beside a node already on 8545. */
// eslint-disable-next-line turbo/no-undeclared-env-vars -- read by Playwright directly, never through a turbo task
const RPC_PORT = process.env.E2E_RPC_PORT ?? "8545";

// set before the workers start, so the fixtures' `config/chains` reads the same node the app does
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
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // the package's `local-node` script passes --no-deploy, which this Hardhat does not accept
      command: `yarn workspace @kickback/contracts hardhat node --port ${RPC_PORT}`,
      url: process.env.NEXT_PUBLIC_LOCAL_RPC_URL,
      reuseExistingServer: true,
      timeout: 180_000,
    },
    {
      command: `yarn next dev --port ${new URL(BASE_URL).port || "3000"}`,
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: {
        NEXT_PUBLIC_CHAIN: "hardhat",
        NEXT_PUBLIC_LOCAL_RPC_URL: process.env.NEXT_PUBLIC_LOCAL_RPC_URL,
        NEXT_PUBLIC_REOWN_PROJECT_ID: process.env.NEXT_PUBLIC_REOWN_PROJECT_ID || "e2e-placeholder",
      },
    },
  ],
});
