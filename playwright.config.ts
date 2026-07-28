import { defineConfig, devices } from "@playwright/test";

const externalURL = process.env.FUNNEL_ZERO_TEST_URL;
const localURL = "http://127.0.0.1:8787";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: externalURL ?? localURL,
    trace: "retain-on-failure"
  },
  webServer: externalURL
    ? undefined
    : {
        command: "npx wrangler dev --local --port 8787",
        url: `${localURL}/api/health`,
        reuseExistingServer: true,
        timeout: 120_000
      },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 5"] } }
  ]
});
