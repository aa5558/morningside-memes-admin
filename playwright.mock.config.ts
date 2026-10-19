import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// Signed-in end-to-end tests: the real admin app (production build) talking
// to tests/mock/server.mjs, a local Supabase stand-in running the real
// migrations on PGlite. Run `npm run build` first, then:
//   npx playwright test -c playwright.mock.config.ts
// GEMINI_API_KEY from .env.local enables the two tests that call Gemini.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1, // tests share one database
  reporter: [["list"]],
  timeout: 90_000,
  use: { baseURL: "http://localhost:3002" },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node tests/mock/server.mjs",
      url: "http://localhost:54399/__debug/deleted-files",
      reuseExistingServer: false,
    },
    {
      command: "npx next start -p 3002",
      url: "http://localhost:3002/login",
      reuseExistingServer: false,
      env: {
        SUPABASE_URL: "http://localhost:54399",
        SUPABASE_ANON_KEY: "mock-anon-key",
        GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? "",
      },
    },
  ],
});
