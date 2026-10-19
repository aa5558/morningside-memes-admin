import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// Lets the tests check that server-only values never reach the browser.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

// Runs against a local production build by default. Point BASE_URL at a
// deployment to run the same checks there:
//   BASE_URL=https://morningside-memes-admin.vercel.app npx playwright test
const baseURL = process.env.BASE_URL ?? "http://localhost:3001";

export default defineConfig({
  testDir: "./tests/public",
  fullyParallel: true,
  reporter: [["list"]],
  use: { baseURL },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: "npm run start -- -p 3001",
        url: "http://localhost:3001/login",
        reuseExistingServer: true,
      },
});
