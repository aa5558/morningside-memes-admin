import { existsSync, readFileSync } from "node:fs";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { sessionCookie } from "../mock/session.mjs";
import { ADMIN_ID, REGULAR_ID, USERS } from "../mock/seed.mjs";

const MOCK = "http://localhost:54399";
const POST_ID = "c0000000-0000-4000-8000-000000000003";
const OTHER_POST_ID = "c0000000-0000-4000-8000-000000000004";
const PAGES = [
  "/", "/analytics", "/users", `/users/${USERS[3].id}`, "/media", "/media?view=captions", "/media?source=ai",
  `/media/${POST_ID}`, "/media/new", "/votes", "/audit",
  "/studio", "/studio/requests", "/studio/responses", "/studio/examples", "/models", "/terms", "/images", "/access",
];

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
      await expect(page.locator("body"), path).not.toContainText(/Registered users|Danger zone|Votes cast|Gemini captions \(|GEMINI_API_KEY|Low Steps, first snow|Butler Library, the main|The mix/);
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
      ["saveRecord", ["domains", null, {}, {}]],
      ["deleteRecord", ["terms", (await sql(`select id from public.terms limit 1`))[0].id]],
      ["setActive", ["models", "5eed0000-0000-4000-8000-000000000101", false]],
      ["updateChainMix", [{ "5eed0000-0000-4000-8000-000000000201": 100, "5eed0000-0000-4000-8000-000000000202": 0, "5eed0000-0000-4000-8000-000000000203": 0 }]],
      ["setSignupRestriction", [true]],
      ["deleteImage", ["f0000000-0000-4000-8000-000000000001"]],
      ["promoteToExample", [(await sql(`select id from public.captions limit 1`))[0].id, POST_ID, "a scene"]],
      ["generateMoreCaptions", [POST_ID, null]],
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
    const [state] = await sql(`select
      (select restrict_signups from public.signup_settings) restricted,
      (select weight from public.prompt_chain_mix where chain_id = '5eed0000-0000-4000-8000-000000000201') classic,
      (select is_active from public.llm_models where id = '5eed0000-0000-4000-8000-000000000101') model_active,
      (select count(*) from public.images) images,
      (select count(*) from public.terms) terms,
      (select count(*) from public.admin_audit_log where admin_id = '${REGULAR_ID}') audit_by_user`);
    expect(state).toEqual({ restricted: false, classic: 100, model_active: true, images: 4, terms: 18, audit_by_user: 0 });
  });

  test("the main-app tables behind the console return nothing to them", async ({ page }) => {
    const { cookies } = await page.context().storageState();
    const auth = cookies.find((c) => c.name.startsWith("sb-"))!;
    const token = JSON.parse(Buffer.from(auth.value.replace(/^base64-/, ""), "base64url").toString()).access_token;
    const headers = { apikey: "mock-anon-key", Authorization: `Bearer ${token}` };
    for (const table of ["terms", "llm_models", "llm_providers", "prompt_chains", "prompt_chain_steps", "allowed_signup_domains", "whitelisted_emails"]) {
      const res = await fetch(`${MOCK}/rest/v1/${table}?select=*`, { headers });
      expect(await res.json(), table).toEqual([]);
    }
    for (const table of ["generation_requests", "llm_responses"]) {
      const res = await fetch(`${MOCK}/rest/v1/${table}?select=*`, { headers });
      expect(res.status, table).toBe(403);
    }
    // Only released library images: tomorrow's Daily Drop stays hidden.
    const res = await fetch(`${MOCK}/rest/v1/images?select=title`, { headers });
    const titles = (await res.json()).map((r: { title: string }) => r.title);
    expect(titles).toContain("Low Steps, first snow");
    expect(titles).not.toContain("Tomorrow's surprise");
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
    await page.getByRole("button", { name: /Generate more/ }).click();
    await expect(page.getByText(/Added \d+ new caption/)).toBeVisible({ timeout: 70_000 });
    const rows = await sql<{ user_id: string; prompt: string; owner: string }>(
      `select c.user_id, p.prompt, g.user_id owner from public.captions c
       join public.caption_prompts p on p.caption_id = c.id join public.generations g on g.id = c.generation_id
       where c.generation_id = $1`,
      [OTHER_POST_ID]
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.user_id === r.owner)).toBe(true); // ownership preserved
    expect(rows[0].prompt).toMatch(/caption/i);
    // The run is logged with each model call and linked to the new captions.
    const [run] = await sql<{ status: string; captions: number; calls: number }>(
      `select status, coalesce(array_length(caption_ids, 1), 0) captions,
              (select count(*) from public.llm_responses l where l.request_id = r.id) calls
       from public.generation_requests r where generation_id = $1 and source = 'admin' order by started_at desc limit 1`,
      [OTHER_POST_ID]
    );
    expect(run).toMatchObject({ status: "succeeded" });
    expect(run.captions).toBe(rows.length);
    expect(run.calls).toBeGreaterThan(0);
    const [{ n: after }] = await sql<{ n: number }>(`select count(*) n from public.captions where generation_id = $1`, [OTHER_POST_ID]);
    expect(after).toBe(before + rows.length);
  });

  test("Gemini out of quota: generating shows a clear message and saves nothing", async ({ page }) => {
    test.skip(process.env.REAL_GEMINI === "1", "uses the Gemini stand-in");
    await fetch(`${MOCK}/__debug/gemini`, { method: "POST", body: JSON.stringify({ mode: "quota" }) });
    try {
      const count = async () => (await sql<{ n: number }>(`select count(*) n from public.captions where generation_id = $1`, [POST_ID]))[0].n;
      const before = await count();
      await page.goto(`/media/${POST_ID}`);
      await page.getByRole("button", { name: /Generate more/ }).click();
      await expect(page.getByRole("alert").filter({ hasText: "over its usage quota" })).toBeVisible({ timeout: 30_000 });
      expect(await count()).toBe(before);
      const [run] = await sql<{ status: string }>(`select status from public.generation_requests where generation_id = $1 and source = 'admin' order by started_at desc limit 1`, [POST_ID]);
      expect(run.status).toBe("failed");
    } finally {
      await fetch(`${MOCK}/__debug/gemini`, { method: "POST", body: JSON.stringify({ mode: "ok" }) });
    }
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

// A tiny valid PNG (1x1), for upload tests.
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

async function auditCount(action: string) {
  const [{ n }] = await sql<{ n: number }>(`select count(*) n from public.admin_audit_log where action = $1 and admin_id = $2`, [action, ADMIN_ID]);
  return Number(n);
}

async function dialog(page: Page, name: string | RegExp) {
  const d = page.getByRole("dialog", { name });
  await expect(d).toBeVisible();
  return d;
}

test.describe("a superadmin in the AI Studio and content tools", () => {
  test.beforeEach(({ context }) => signIn(context, ADMIN_ID));

  test("prompt chains: explorer shows every chain and step, and the mix saves only at 100%", async ({ page }) => {
    await page.goto("/studio");
    for (const name of ["Classic one-shot", "Scene scan → riff", "Writers' room"]) {
      await expect(page.getByRole("heading", { name })).toBeVisible();
    }
    await expect(page.getByText("Head writer pass").first()).toBeVisible();
    await page.getByText("Step 1 prompt template").first().click();
    await expect(page.locator("mark", { hasText: "{{voice}}" }).first()).toBeVisible();

    const classic = page.getByRole("spinbutton", { name: "Classic one-shot share in percent" });
    const scan = page.getByRole("spinbutton", { name: "Scene scan → riff share in percent" });
    const room = page.getByRole("spinbutton", { name: "Writers' room share in percent" });
    await classic.fill("50");
    await room.fill("15");
    await expect(page.getByText("Total 65%", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save mix" })).toBeDisabled();
    await scan.fill("35");
    await expect(page.getByText("Total 100%", { exact: true })).toBeVisible();
    const before = await auditCount("update_chain_mix");
    await page.getByRole("button", { name: "Save mix" }).click();
    await expect(page.getByText(/Mix saved/)).toBeVisible();
    const weights = await sql<{ slug: string; weight: number }>(
      `select c.slug, m.weight from public.prompt_chain_mix m join public.prompt_chains c on c.id = m.chain_id order by c.slug`
    );
    expect(weights).toEqual([
      { slug: "classic", weight: 50 },
      { slug: "scene-scan", weight: 35 },
      { slug: "writers-room", weight: 15 },
    ]);
    expect(await auditCount("update_chain_mix")).toBe(before + 1);
  });

  test("generation runs and LLM responses: list, filter, and open a timeline", async ({ page }) => {
    await page.goto("/studio/requests?status=failed");
    const rows = page.locator("tbody tr");
    // The seeded failure, plus any real Gemini failures from earlier tests.
    await expect(rows.filter({ hasText: "overloaded" }).first()).toBeVisible();
    expect(await rows.filter({ hasText: /^(?![\s\S]*succeeded)/ }).count()).toBe(await rows.count());
    await page.goto("/studio/requests?status=succeeded");
    await rows.first().getByRole("link").click();
    await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
    await expect(page.getByText("Prompt sent").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Captions saved" })).toBeVisible();

    await page.goto("/studio/responses?status=error");
    await expect(page.getByText("⚠ The model is overloaded.").first()).toBeVisible();
    await page.goto("/studio/responses?q=Laptop");
    await expect(page.getByText(/Laptop glow/).first()).toBeVisible();
  });

  test("terms: create, edit, switch off, and delete, each audited", async ({ page }) => {
    const name = `Joe Coffee ${Date.now()}`;
    await page.goto("/terms");
    await page.getByRole("button", { name: "+ New term" }).click();
    let d = await dialog(page, "New term");
    await d.getByLabel("Term").fill(name);
    await d.getByLabel("What it means").fill("The coffee shop in Northwest Corner.");
    await d.getByLabel("Category").selectOption("campus");
    await d.getByRole("button", { name: "Add term" }).click();
    await expect(d).toBeHidden();
    const row = page.locator("li", { hasText: name });
    await expect(row).toBeVisible();
    const [created] = await sql<{ id: string; is_active: boolean }>(`select id, is_active from public.terms where term = $1`, [name]);
    expect(created.is_active).toBe(true);

    await row.getByRole("button", { name: "Edit" }).click();
    d = await dialog(page, "Edit term");
    await d.getByLabel("What it means").fill("The coffee shop in the Northwest Corner Building.");
    await d.getByRole("button", { name: "Save" }).click();
    await expect(row).toContainText("Northwest Corner Building");

    await row.getByRole("switch").click();
    await expect.poll(async () => (await sql<{ a: boolean }>(`select is_active a from public.terms where id = $1`, [created.id]))[0].a).toBe(false);

    await row.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(row).toBeHidden();
    expect(await sql(`select 1 from public.terms where id = $1`, [created.id])).toHaveLength(0);
    const log = await sql<{ action: string }>(`select action from public.admin_audit_log where target_id = $1 order by id`, [created.id]);
    expect(log.map((l) => l.action)).toEqual(["create_term", "update_term", "update_term", "delete_term"]);
  });

  test("terms: invalid input is rejected with a clear message", async ({ page }) => {
    await page.goto("/terms");
    await page.getByRole("button", { name: "+ New term" }).click();
    const d = await dialog(page, "New term");
    await d.getByLabel("Term").fill("Butler"); // already exists (case-insensitive unique)
    await d.getByLabel("What it means").fill("Duplicate");
    await d.getByRole("button", { name: "Add term" }).click();
    await expect(d.getByRole("alert")).toContainText("already exists");
  });

  test("examples: create, edit, delete, and promote a real caption", async ({ page }) => {
    await page.goto("/studio/examples");
    await page.getByRole("button", { name: "+ New example" }).click();
    let d = await dialog(page, "New example");
    await d.getByLabel("Voice").selectOption("online");
    await d.getByLabel("The photo").fill("A squirrel eating a bagel on College Walk");
    await d.getByLabel("The caption").fill("he has a 9am too");
    await d.getByRole("button", { name: "Add example" }).click();
    await expect(d).toBeHidden();
    const card = page.locator("section", { hasText: "he has a 9am too" });
    await card.getByRole("button", { name: "Edit" }).click();
    d = await dialog(page, "Edit example");
    await d.getByLabel("The caption").fill("he also has a 9am");
    await d.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("“he also has a 9am”").first()).toBeVisible();
    const edited = page.locator("section", { hasText: "he also has a 9am" });
    await edited.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(edited).toBeHidden();
    expect(await sql(`select 1 from public.ai_generation_examples where caption like 'he %9am%'`)).toHaveLength(0);

    // Promote a caption from a post.
    await page.goto(`/media/${POST_ID}`);
    await page.getByRole("button", { name: "★ Save as example" }).first().click();
    await page.getByLabel(/Describe the photo for the model/).fill("A gradient that looks like a sunset over Low");
    await page.getByRole("button", { name: "Save as example", exact: true }).click();
    await expect(page.getByText(/Saved as an example/)).toBeVisible();
    expect(await sql(`select 1 from public.ai_generation_examples where scene = 'A gradient that looks like a sunset over Low'`)).toHaveLength(1);
  });

  test("models and providers: create, edit, protect in-use rows, delete", async ({ page }) => {
    await page.goto("/models");
    await expect(page.getByText("● set on this server").or(page.getByText("● not set on this server"))).toBeVisible();
    await expect(page.locator("body")).not.toContainText(process.env.GEMINI_API_KEY || "never-matches-anything");

    await page.getByRole("button", { name: "+ New provider" }).click();
    let d = await dialog(page, "New provider");
    await d.getByLabel("Name").fill("Test Provider");
    await d.getByLabel("Slug").fill("test-provider");
    await d.getByLabel("Runtime adapter").selectOption("gemini");
    await d.getByLabel("API key environment variable").fill("SUPABASE_SERVICE_ROLE_KEY");
    await d.getByRole("button", { name: "Add provider" }).click();
    // The browser refuses the non-API-key variable before it's sent (and
    // the server and database would refuse it too).
    await expect(d).toBeVisible();
    expect(await d.getByLabel("API key environment variable").evaluate((el: HTMLInputElement) => el.validity.patternMismatch)).toBe(true);
    await d.getByLabel("API key environment variable").fill("TEST_PROVIDER_API_KEY");
    await d.getByRole("button", { name: "Add provider" }).click();
    await expect(d).toBeHidden();
    await expect(page.locator("tr", { hasText: "Test Provider" })).toBeVisible();

    await page.getByRole("button", { name: "+ New model" }).click();
    d = await dialog(page, "New model");
    await d.getByLabel("Provider").selectOption({ label: "Test Provider" });
    await d.getByLabel("Display name").fill("Test Model");
    await d.getByLabel(/Model id/).fill("test-model-1");
    await d.getByLabel("Default temperature").fill("0.7");
    await d.getByRole("button", { name: "Add model" }).click();
    await expect(d).toBeHidden();
    const card = page.locator("section", { hasText: "test-model-1" });
    await expect(card).toContainText("Not used by any chain step");

    await card.getByRole("button", { name: "Edit" }).click();
    d = await dialog(page, "Edit model");
    await d.getByLabel("Display name").fill("Test Model v2");
    await d.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Test Model v2").first()).toBeVisible();

    // The provider still has a model, so deleting it is refused.
    const providerRow = page.locator("tr", { hasText: "Test Provider" });
    await providerRow.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(providerRow.getByRole("alert")).toContainText("still in use");

    // The seeded model is used by chains: refused as well.
    const seeded = page.locator("section", { hasText: "gemini-flash-latest" });
    await seeded.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(seeded.getByRole("alert")).toContainText("still in use");

    await page.locator("section", { hasText: "test-model-1" }).getByRole("button", { name: "Delete" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(page.locator("section", { hasText: "test-model-1" })).toBeHidden();
    await page.reload();
    await page.locator("tr", { hasText: "Test Provider" }).getByRole("button", { name: "Delete" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(page.locator("tr", { hasText: "Test Provider" })).toBeHidden();
    expect(await sql(`select 1 from public.llm_providers where slug = 'test-provider'`)).toHaveLength(0);
    expect(await auditCount("create_llm_provider")).toBeGreaterThan(0);
    expect(await auditCount("delete_llm_model")).toBeGreaterThan(0);
  });

  test("signup access: domains and emails CRUD, and the gate toggles", async ({ page }) => {
    await page.goto("/access");
    await expect(page.getByText("Signups are open")).toBeVisible();

    await page.getByRole("button", { name: "+ Add" }).first().click();
    let d = await dialog(page, "Allow a domain");
    await d.getByLabel("Email domain").fill("Columbia.EDU");
    await d.getByRole("button", { name: "Allow domain" }).click();
    await expect(d).toBeHidden();
    await expect(page.getByText("columbia.edu", { exact: true }).first()).toBeVisible();

    await page.getByRole("button", { name: "+ Add" }).nth(1).click();
    d = await dialog(page, "Whitelist an email");
    await d.getByLabel("Email address").fill("Guest.Lecturer@Gmail.com");
    await d.getByLabel("Note").fill("Visiting speaker");
    await d.getByRole("button", { name: "Whitelist" }).click();
    await expect(d).toBeHidden();
    await expect(page.getByText("guest.lecturer@gmail.com").first()).toBeVisible();

    const email = page.locator("li", { hasText: "guest.lecturer@gmail.com" });
    await email.getByRole("button", { name: "Edit" }).click();
    d = await dialog(page, "Edit email");
    await d.getByLabel("Note").fill("Visiting speaker, Nov 2");
    await d.getByRole("button", { name: "Save" }).click();
    await expect(email).toContainText("Nov 2");

    await page.getByRole("switch", { name: /Restrict signups/ }).click();
    await expect.poll(async () => (await sql<{ r: boolean }>(`select restrict_signups r from public.signup_settings`))[0].r).toBe(true);
    await page.reload();
    await expect(page.getByText("Signups are restricted")).toBeVisible();

    // The gate now really applies to new accounts.
    const blocked = await sql(`select public.signup_allowed('stranger@yahoo.com') ok`);
    const allowed = await sql(`select public.signup_allowed('student@columbia.edu') a, public.signup_allowed('guest.lecturer@gmail.com') b`);
    expect(blocked[0]).toEqual({ ok: false });
    expect(allowed[0]).toEqual({ a: true, b: true });

    await page.getByRole("switch", { name: /Restrict signups/ }).click();
    await expect.poll(async () => (await sql<{ r: boolean }>(`select restrict_signups r from public.signup_settings`))[0].r).toBe(false);
    await email.getByRole("button", { name: "Remove" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(email).toBeHidden();
    const domain = page.locator("li", { hasText: "columbia.edu" });
    await domain.getByRole("button", { name: "Remove" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(domain).toBeHidden();
    expect(await auditCount("update_signup_settings")).toBe(2);
    expect(await auditCount("delete_whitelisted_email")).toBe(1);
  });

  test("image library: upload, schedule as a Daily Drop, edit, and delete (file too)", async ({ page }) => {
    await page.goto("/images");
    await expect(page.getByText("Today's drop: Low Steps, first snow")).toBeVisible();

    // A non-image renamed to .png is rejected by its bytes.
    await page.getByRole("button", { name: "+ Upload image" }).click();
    let d = await dialog(page, "Upload an image");
    await d.locator('input[type="file"]').setInputFiles({ name: "evil.png", mimeType: "image/png", buffer: Buffer.from("<script>alert(1)</script>") });
    await d.getByLabel("Title").fill("Not an image");
    await d.getByLabel("Alt text").fill("Should be rejected");
    await d.getByRole("button", { name: "Upload" }).click();
    await expect(d.getByText(/isn't a PNG, JPEG, or WEBP/)).toBeVisible();

    await d.locator('input[type="file"]').setInputFiles({ name: "dot.png", mimeType: "image/png", buffer: PNG_1PX });
    await d.getByLabel("Title").fill("E2E dot");
    await d.getByLabel("Alt text").fill("A single blue pixel");
    await d.getByLabel("Tags").fill("test, Tiny");
    await d.getByRole("button", { name: "Upload" }).click();
    await expect(d).toBeHidden();
    const card = page.locator("article", { hasText: "E2E dot" });
    await expect(card).toContainText("#tiny");
    const [row] = await sql<{ id: string; storage_path: string; mime_type: string }>(`select id, storage_path, mime_type from public.images where title = 'E2E dot'`);
    expect(row.mime_type).toBe("image/png");
    expect(await sql(`select 1 from storage.objects where bucket_id = 'images' and name = $1`, [row.storage_path])).toHaveLength(1);

    // Same Daily Drop date as an existing image is refused.
    await card.getByRole("button", { name: "Edit" }).click();
    d = await dialog(page, "Edit image");
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
    await d.getByLabel("Daily Drop date").fill(today);
    await d.getByRole("button", { name: "Save" }).click();
    await expect(d.getByText(/already the Daily Drop on that date/)).toBeVisible();
    await d.getByLabel("Daily Drop date").fill("2030-01-01");
    await d.getByLabel("Title").fill("E2E dot (scheduled)");
    await d.getByRole("button", { name: "Save" }).click();
    await expect(d).toBeHidden();
    await expect(page.locator("article", { hasText: "E2E dot (scheduled)" })).toContainText("drops Jan 1");

    await page.locator("article", { hasText: "E2E dot (scheduled)" }).getByRole("button", { name: "Delete" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(page.locator("article", { hasText: "E2E dot" })).toBeHidden();
    expect(await sql(`select 1 from public.images where id = $1`, [row.id])).toHaveLength(0);
    const deleted = await (await fetch(`${MOCK}/__debug/deleted-files`)).json();
    expect(deleted).toContain(`images/${row.storage_path}`);
    expect(await auditCount("create_image")).toBeGreaterThan(0);
    expect(await auditCount("delete_image")).toBeGreaterThan(0);
  });

  test("AI media: filter posts by photo source and see which chain wrote them", async ({ page }) => {
    await page.goto("/media?source=ai");
    await expect(page.getByText("No posts match these filters")).toBeVisible();
    await page.goto("/media");
    await expect(page.locator("main").getByText(/^classic$|^scene-scan$|^writers-room$/).first()).toBeVisible();
  });

  test("the audit log describes the new kinds of changes", async ({ page }) => {
    await page.goto("/audit");
    await expect(page.getByText("changed the prompt chain mix").first()).toBeVisible();
    await expect(page.getByText("uploaded a library image").first()).toBeVisible();
    await expect(page.getByText("changed the signup gate").first()).toBeVisible();
  });
});
