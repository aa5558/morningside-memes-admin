import { existsSync, readFileSync } from "node:fs";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { sessionCookie } from "../mock/session.mjs";
import { ADMIN_ID, REGULAR_ID, USERS } from "../mock/seed.mjs";

const MOCK = "http://localhost:54399";
const POST_ID = "c0000000-0000-4000-8000-000000000003";
const OTHER_POST_ID = "c0000000-0000-4000-8000-000000000004";
const PAGES = ["/", "/analytics", "/users", `/users/${USERS[3].id}`, "/media", "/media?view=captions", `/media/${POST_ID}`, "/media/new", "/votes", "/audit"];

async function sql<T = Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T[]> {
  const res = await fetch(`${MOCK}/__debug/query`, { method: "POST", body: JSON.stringify({ sql: query, params }) });
  return res.json();
}

async function signIn(context: BrowserContext, userId: string) {
  const user = USERS.find((u: { id: string }) => u.id === userId);
  await context.addCookies([{ ...sessionCookie(user), domain: "localhost", path: "/" }]);
}

const snapshot = () =>
  sql(`select
    (select count(*) from public.generations where id <> '${POST_ID}') other_posts,
    (select count(*) from public.captions where generation_id <> '${POST_ID}') other_captions,
    (select count(*) from public.caption_votes v join public.captions c on c.id = v.caption_id
      where c.generation_id <> '${POST_ID}') other_votes,
    (select count(*) from public.profiles) profiles,
    (select count(*) from public.profiles where is_superadmin) admins`);

function actionIds() {
  const { node } = JSON.parse(readFileSync(".next/server/server-reference-manifest.json", "utf8")) as {
    node: Record<string, { exportedName?: string }>;
  };
  return Object.fromEntries(Object.entries(node).map(([id, v]) => [v.exportedName, id]));
}

test.describe("a signed-in regular user", () => {
  test.beforeEach(({ context }) => signIn(context, REGULAR_ID));

  test("sees Access Denied (403) on every admin page", async ({ page }) => {
    for (const path of PAGES) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(403);
      await expect(page.getByRole("heading", { name: "Access denied" }), path).toBeVisible();
      await expect(page.locator("body"), path).not.toContainText(/Registered users|Danger zone|Votes cast|Gemini captions \(/);
    }
  });

  test("gets 403 from the API endpoints", async ({ page }) => {
    for (const path of ["/api/stats", "/api/votes/export"]) {
      const response = await page.request.get(path);
      expect(response.status(), path).toBe(403);
      expect(await response.json()).toEqual({ error: "Superadmin access required." });
    }
  });

  test("can't run admin server actions by posting to them directly", async ({ page }) => {
    test.skip(!existsSync(".next/server/server-reference-manifest.json"), "needs build");
    const before = await sql(`select text from public.captions where generation_id = $1 order by id`, [POST_ID]);
    const ids = actionIds();
    const calls: [string, unknown[]][] = [
      ["deletePost", [POST_ID]],
      ["deleteCaption", [before.length ? (await sql(`select id from public.captions where generation_id = $1 limit 1`, [POST_ID]))[0].id : "", POST_ID]],
      ["updateContext", [POST_ID, "hacked by a regular user"]],
      ["updateCaption", [(await sql(`select id from public.captions where generation_id = $1 and author_type = 'ai' limit 1`, [POST_ID]))[0].id, POST_ID, "hacked"]],
    ];
    for (const [name, args] of calls) {
      expect(ids[name], name).toBeTruthy();
      const response = await page.request.post(`/media/${POST_ID}`, {
        headers: { "Next-Action": ids[name], "Content-Type": "text/plain;charset=UTF-8", Accept: "text/x-component" },
        data: JSON.stringify(args),
      });
      expect(await response.text(), name).toContain("Superadmin access required.");
    }
    const after = await sql(`select text from public.captions where generation_id = $1 order by id`, [POST_ID]);
    expect(after).toEqual(before);
    const [post] = await sql(`select context from public.generations where id = $1`, [POST_ID]);
    expect(post.context).not.toBe("hacked by a regular user");
  });
});

test.describe("a superadmin", () => {
  test.beforeEach(({ context }) => signIn(context, ADMIN_ID));

  test("can open every page, with no horizontal scrolling on a phone", async ({ page }) => {
    for (const path of PAGES) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(200);
    }
    await page.setViewportSize({ width: 375, height: 800 });
    for (const path of PAGES) {
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });

  test("overview totals match the database", async ({ page }) => {
    const [db] = await sql<{ users: number; photos: number; votes: number }>(
      `select (select count(*) from auth.users) users, (select count(*) from public.generations) photos,
              (select count(*) from public.caption_votes) votes`
    );
    await page.goto("/");
    for (const [label, value] of [
      ["Registered users", db.users],
      ["Photos uploaded", db.photos],
      ["Total votes", db.votes],
    ] as const) {
      await expect(page.getByText(label, { exact: true }).locator("..")).toContainText(value.toLocaleString("en-US"));
    }
    const api = await page.request.get("/api/stats?days=7");
    expect(api.status()).toBe(200);
    expect((await api.json()).totals.users).toBe(db.users);
  });

  test("can browse and search all users, and open a profile", async ({ page }) => {
    await page.goto("/users");
    await expect(page.locator("tbody tr")).toHaveCount(USERS.length);
    await page.getByLabel("Search by name or email").fill("Maya");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await page.getByRole("link", { name: /Maya Chen/ }).click();
    await expect(page.getByRole("heading", { name: "Maya Chen" })).toBeVisible();
    await expect(page.getByText("Voting activity")).toBeVisible();
  });

  test("can read all votes, filter them, and export CSV", async ({ page }) => {
    const [{ downs }] = await sql<{ downs: number }>(`select count(*) downs from public.caption_votes where vote = -1`);
    await page.goto("/votes?type=down");
    await expect(page.getByText("Downvotes", { exact: true }).first().locator("..")).toContainText(String(downs));
    const badges = page.locator("tbody").getByText(/Upvote|Downvote/);
    expect(await badges.count()).toBeGreaterThan(0);
    await expect(page.locator("tbody").getByText("▲ Upvote")).toHaveCount(0);
    expect(await page.locator("tbody").getByText("▼ Downvote").count()).toBe(Math.min(50, downs));

    const csv = await page.request.get("/api/votes/export?type=down");
    expect(csv.status()).toBe(200);
    expect(csv.headers()["content-type"]).toContain("text/csv");
    const lines = (await csv.text()).trim().split("\n");
    expect(lines[0]).toContain("voter_name");
    expect(lines.length - 1).toBe(downs);
  });

  test("can edit an AI caption and the post context, with an audit trail", async ({ page }) => {
    const before = await snapshot();
    await page.goto(`/media/${POST_ID}`);
    const firstAi = page.locator("li", { has: page.getByText("Gemini", { exact: true }) }).first();
    await firstAi.getByRole("button", { name: "Edit" }).click();
    await firstAi.locator("textarea").fill("Edited by the admin e2e test");
    await firstAi.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("“Edited by the admin e2e test”").first()).toBeVisible();

    await page.getByLabel(/Photo context/).fill("context edited by e2e");
    await page.getByRole("button", { name: "Save context" }).click();
    await expect(page.getByText("Context updated.")).toBeVisible();

    const [row] = await sql(`select context from public.generations where id = $1`, [POST_ID]);
    expect(row.context).toBe("context edited by e2e");
    const log = await sql(`select action from public.admin_audit_log order by id`);
    expect(log.map((l) => l.action)).toEqual(expect.arrayContaining(["edit_caption", "edit_post"]));

    await page.goto("/audit");
    await expect(page.getByText("edited a caption").first()).toBeVisible();
    expect(await snapshot()).toEqual(before);
  });

  test("can't reword a human caption (no Edit button, and the DB refuses)", async ({ page }) => {
    await page.goto(`/media/${POST_ID}`);
    const humanCard = page.locator("section", { has: page.getByRole("heading", { name: /Human captions/ }) });
    await expect(humanCard.getByRole("button", { name: "Edit" })).toHaveCount(0);
  });

  test("can delete a caption after confirming; its votes go with it, nothing else changes", async ({ page }) => {
    const before = await snapshot();
    const [target] = await sql<{ id: string; text: string; votes: number }>(
      `select c.id, c.text, (select count(*) from public.caption_votes v where v.caption_id = c.id) votes
       from public.captions c where c.generation_id = $1 and c.author_type = 'human' limit 1`,
      [POST_ID]
    );
    expect(target).toBeTruthy();
    await page.goto(`/media/${POST_ID}`);
    const item = page.locator("li", { hasText: target.text });
    await item.getByRole("button", { name: "Delete" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Delete this caption?");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    expect((await sql(`select 1 from public.captions where id = $1`, [target.id])).length).toBe(1);

    await item.getByRole("button", { name: "Delete" }).click();
    await dialog.getByRole("button", { name: "Delete caption" }).click();
    const humanCard = page.locator("section", { has: page.getByRole("heading", { name: /Human captions/ }) });
    await expect(humanCard.getByText(`“${target.text}”`)).toHaveCount(0);
    // The change history keeps the deleted text.
    await expect(page.locator("section", { hasText: "Change history" }).getByText(`“${target.text}”`)).toBeVisible();
    expect((await sql(`select 1 from public.captions where id = $1`, [target.id])).length).toBe(0);
    expect((await sql(`select 1 from public.caption_votes where caption_id = $1`, [target.id])).length).toBe(0);
    expect(await snapshot()).toEqual(before);
  });

  test("can generate more Gemini captions for someone else's photo", async ({ page }) => {
    test.skip(!process.env.GEMINI_API_KEY, "GEMINI_API_KEY not set");
    const [{ n: before }] = await sql<{ n: number }>(`select count(*) n from public.captions where generation_id = $1`, [OTHER_POST_ID]);
    await page.goto(`/media/${OTHER_POST_ID}`);
    await page.getByRole("button", { name: /Generate more AI captions/ }).click();
    await expect(page.getByText(/Added \d+ new Gemini caption/)).toBeVisible({ timeout: 60_000 });
    const rows = await sql<{ user_id: string; prompt: string; owner: string }>(
      `select c.user_id, p.prompt, g.user_id owner from public.captions c
       join public.caption_prompts p on p.caption_id = c.id join public.generations g on g.id = c.generation_id
       where c.generation_id = $1`,
      [OTHER_POST_ID]
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.user_id === r.owner)).toBe(true); // ownership preserved
    expect(rows[0].prompt).toContain("Write 4 different captions");
    const [{ n: after }] = await sql<{ n: number }>(`select count(*) n from public.captions where generation_id = $1`, [OTHER_POST_ID]);
    expect(after).toBe(before + rows.length);
  });

  test("can upload a photo, get Gemini captions, then delete the whole post", async ({ page }) => {
    test.skip(!process.env.GEMINI_API_KEY, "GEMINI_API_KEY not set");
    const png = await (await fetch(`${MOCK}/storage/v1/object/public/generations/${(await sql(`select image_path from public.generations where id = $1`, [POST_ID]))[0].image_path}`)).arrayBuffer();

    await page.goto("/media/new");
    await page.locator('input[type="file"]').setInputFiles({ name: "test.png", mimeType: "image/png", buffer: Buffer.from(png) });
    await page.getByRole("textbox", { name: /Context/ }).fill("An abstract gradient, e2e test");
    await page.getByRole("button", { name: "Upload & generate captions" }).click();
    await expect(page).toHaveURL(/\/media\/[0-9a-f-]{36}\?created=1/, { timeout: 60_000 });
    const newId = page.url().match(/media\/([0-9a-f-]{36})/)![1];

    const [post] = await sql<{ user_id: string; image_path: string; prompt: string }>(
      `select user_id, image_path, prompt from public.generations where id = $1`,
      [newId]
    );
    expect(post.user_id).toBe(ADMIN_ID);
    expect(post.image_path.startsWith(`${ADMIN_ID}/`)).toBe(true);
    expect(post.prompt).toContain("An abstract gradient, e2e test");
    expect((await sql(`select 1 from public.captions where generation_id = $1 and author_type = 'ai'`, [newId])).length).toBeGreaterThan(0);

    // Delete: requires typing DELETE.
    await page.getByRole("button", { name: "Delete post" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Delete post" })).toBeDisabled();
    await dialog.getByRole("textbox").fill("DELETE");
    await dialog.getByRole("button", { name: "Delete post" }).click();
    await expect(page).toHaveURL(/\/media\?deleted=1/);
    expect((await sql(`select 1 from public.generations where id = $1`, [newId])).length).toBe(0);
    const deletedFiles = await (await fetch(`${MOCK}/__debug/deleted-files`)).json();
    expect(deletedFiles).toContain(post.image_path);
  });

  test("can delete another user's post, including its photo file", async ({ page }) => {
    const victim = "c0000000-0000-4000-8000-000000000010";
    const [post] = await sql<{ image_path: string; user_id: string }>(`select image_path, user_id from public.generations where id = $1`, [victim]);
    expect(post.user_id).not.toBe(ADMIN_ID);
    const [{ others }] = await sql<{ others: number }>(`select count(*) others from public.generations where id <> $1`, [victim]);

    await page.goto(`/media/${victim}`);
    await page.getByRole("button", { name: "Delete post" }).click();
    await page.getByRole("dialog").getByRole("textbox").fill("delete");
    await page.getByRole("dialog").getByRole("button", { name: "Delete post" }).click();
    await expect(page).toHaveURL(/\/media\?deleted=1/);

    expect((await sql(`select 1 from public.generations where id = $1`, [victim])).length).toBe(0);
    expect((await sql(`select 1 from public.captions where generation_id = $1`, [victim])).length).toBe(0);
    const [{ others: after }] = await sql<{ others: number }>(`select count(*) others from public.generations`);
    expect(after).toBe(others);
    expect(await (await fetch(`${MOCK}/__debug/deleted-files`)).json()).toContain(post.image_path);
    const [log] = await sql<{ details: { owner_id: string } }>(`select details from public.admin_audit_log where action = 'delete_post' and target_id = $1`, [victim]);
    expect(log.details.owner_id).toBe(post.user_id);
  });

  test("media filters narrow the results", async ({ page }) => {
    await page.goto("/media?view=captions&type=ai");
    await expect(page.locator("tbody").getByText("Human", { exact: true })).toHaveCount(0);
    await page.goto("/media?view=captions&type=human&sort=score");
    await expect(page.locator("tbody").getByText("Gemini", { exact: true })).toHaveCount(0);
    await page.goto(`/media?user=${USERS[2].id}`);
    const cards = page.locator("main ul > li");
    expect(await cards.count()).toBeGreaterThan(0);
    for (const text of await cards.allInnerTexts()) expect(text).toContain("Maya Chen");
  });

  async function signOut(page: Page) {
    await page.goto("/");
    await page.getByRole("button", { name: "Sign out" }).first().click({ force: true });
  }

  test("signing out returns to the login screen", async ({ page }) => {
    await signOut(page);
    await expect(page).toHaveURL(/\/login/);
  });
});
