import { readFileSync, existsSync } from "node:fs";
import { expect, test } from "@playwright/test";

// What a visitor without an admin session can reach. Signed-in checks
// (regular user → Access Denied, superadmin → dashboard) need a real Google
// account and are covered by supabase/tests/admin_security_tests.sql plus the
// manual checklist in the README.

const ADMIN_PAGES = [
  "/",
  "/analytics",
  "/users",
  "/users/00000000-0000-0000-0000-000000000000",
  "/media",
  "/media/new",
  "/media/00000000-0000-0000-0000-000000000000",
  "/votes",
  "/audit",
  "/studio",
  "/studio/requests",
  "/studio/requests/00000000-0000-0000-0000-000000000000",
  "/studio/responses",
  "/studio/examples",
  "/models",
  "/terms",
  "/images",
  "/access",
];

const PROTECTED_TEXT = /Registered users|Humans vs\. Gemini|Votes cast|Audit log|Danger zone/;

test.describe("signed-out visitors", () => {
  for (const path of ADMIN_PAGES) {
    test(`${path} redirects to the login page`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.ok()).toBeTruthy();
      await expect(page).toHaveURL(/\/login(\?|$)/);
      await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
      await expect(page.locator("body")).not.toContainText(PROTECTED_TEXT);
      if (path !== "/") {
        expect(new URL(page.url()).searchParams.get("next")).toBe(path);
      }
    });
  }

  test("the redirect itself carries no page content", async ({ request }) => {
    for (const path of ADMIN_PAGES) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBe(307);
      expect(response.headers()["location"], path).toContain("/login");
      expect(await response.text(), path).not.toMatch(PROTECTED_TEXT);
    }
  });

  test("API endpoints return 401 without a session", async ({ request }) => {
    for (const path of ["/api/stats", "/api/stats?days=7", "/api/votes/export", "/api/anything"]) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBe(401);
      expect(await response.json(), path).toEqual({ error: "Sign in required." });
    }
  });

  test("a forged session cookie is rejected", async ({ request }) => {
    const url = new URL(process.env.SUPABASE_URL ?? "https://aqcrogizevvlsveoeooh.supabase.co");
    const ref = url.hostname.split(".")[0];
    const fake = Buffer.from(
      JSON.stringify({
        access_token: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIiwicm9sZSI6ImF1dGhlbnRpY2F0ZWQifQ.forged",
        refresh_token: "forged",
        token_type: "bearer",
        user: { id: "00000000-0000-0000-0000-000000000000" },
      })
    ).toString("base64url");
    const headers = { cookie: `sb-${ref}-auth-token=base64-${fake}` };

    const api = await request.get("/api/stats", { headers, maxRedirects: 0 });
    expect(api.status()).toBe(401);
    const page = await request.get("/users", { headers, maxRedirects: 0 });
    expect(page.status()).toBe(307);
    expect(page.headers()["location"]).toContain("/login");
  });

  test("server actions can't be invoked without a session", async ({ request }) => {
    // Real action IDs from the local build, posted the way the browser does.
    const manifest = ".next/server/server-reference-manifest.json";
    test.skip(!!process.env.BASE_URL || !existsSync(manifest), "needs the local build's action IDs");
    const { node } = JSON.parse(readFileSync(manifest, "utf8")) as {
      node: Record<string, { exportedName?: string }>;
    };
    const ids = Object.entries(node)
      .filter(([, v]) => ["deletePost", "deleteCaption", "updateCaption", "updateContext", "generateMoreCaptions"].includes(v.exportedName ?? ""))
      .map(([id]) => id);
    expect(ids.length).toBeGreaterThanOrEqual(5);

    for (const id of ids) {
      const response = await request.post("/media", {
        headers: { "Next-Action": id, "Content-Type": "text/plain;charset=UTF-8" },
        data: JSON.stringify(["00000000-0000-0000-0000-000000000000", "00000000-0000-0000-0000-000000000000", "x"]),
        maxRedirects: 0,
      });
      expect(response.status(), id).toBe(307);
      expect(response.headers()["location"], id).toContain("/login");
    }
  });
});

test.describe("login and callback hardening", () => {
  test("login page renders and is not indexable", async ({ page }) => {
    const response = await page.goto("/login");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Admin Console" })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    expect(response?.headers()["x-frame-options"]).toBe("DENY");
    expect(response?.headers()["x-robots-tag"]).toContain("noindex");
  });

  test("?next= can't send people to another site", async ({ page }) => {
    for (const evil of ["//evil.example", "https://evil.example", "/\\evil.example"]) {
      await page.goto(`/login?next=${encodeURIComponent(evil)}`);
      await expect(page.locator('input[name="next"]')).toHaveValue("/");
    }
    await page.goto(`/login?next=${encodeURIComponent("/votes?type=up")}`);
    await expect(page.locator('input[name="next"]')).toHaveValue("/votes?type=up");
  });

  test("auth callback without a code goes back to login", async ({ request }) => {
    const response = await request.get("/auth/callback?next=//evil.example", { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers()["location"]).toMatch(/\/login\?error=missing_code$/);
  });

  test("Google button starts OAuth with the project's Supabase", async ({ page }) => {
    await page.goto("/login?next=/votes");
    const appOrigin = new URL(page.url()).origin;
    const [request] = await Promise.all([
      page.waitForRequest((r) => r.url().includes("supabase.co/auth/v1/authorize"), { timeout: 15_000 }),
      page.getByRole("button", { name: "Continue with Google" }).click(),
    ]);
    const url = new URL(request.url());
    expect(url.searchParams.get("provider")).toBe("google");
    const redirectTo = new URL(url.searchParams.get("redirect_to")!);
    expect(redirectTo.pathname).toBe("/auth/callback");
    expect(redirectTo.searchParams.get("next")).toBe("/votes");
    expect(redirectTo.origin).toBe(appOrigin);
  });

  test("robots.txt disallows everything", async ({ request }) => {
    const response = await request.get("/robots.txt");
    expect(await response.text()).toMatch(/Disallow: \//);
  });
});

test.describe("no secrets in the browser", () => {
  test("client bundles don't contain server-only env values", async ({ page }) => {
    const secrets = [process.env.SUPABASE_ANON_KEY, process.env.GEMINI_API_KEY].filter(
      (s): s is string => !!s && s.length > 10
    );
    test.skip(secrets.length === 0, "env not loaded");
    const bodies: string[] = [];
    page.on("response", async (r) => {
      if (/\.(js|css)$|\/login/.test(new URL(r.url()).pathname)) bodies.push(await r.text().catch(() => ""));
    });
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    expect(bodies.length).toBeGreaterThan(2);
    for (const body of bodies) for (const s of secrets) expect(body.includes(s)).toBe(false);
  });
});
