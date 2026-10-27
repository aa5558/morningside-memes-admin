# Morningside Memes Admin

A separate, superadmin-only dashboard for [Morningside Memes](https://github.com/aa5558/hello-world-nextjs), the Columbia "Humans vs. AI" caption-battle app. It shares the main app's Supabase project, tables and Google sign-in, but is its own Next.js app and Vercel project.

| Page | What it does |
| --- | --- |
| **Overview** `/` | KPI cards (users, photos, AI/human captions, votes, up/down), an activity explorer, the Humans vs. Gemini leaderboard, top captions, recent activity, recent admin changes |
| **Analytics** `/analytics` | Daily active users, new users, posts and votes per day (7/30/90 days), most active users, most popular posts, highest-rated captions, Human vs. AI vote share, average score and battle wins, top human and top Gemini captions |
| **Users** `/users` | All accounts, search by name or email, join date, last sign-in, photo/caption/vote counts, a per-user profile page. **Read-only** |
| **Prompt chains** `/studio` | Visual explorer of every caption chain (photo → steps → captions) with each step's model, temperature and highlighted prompt template; per-chain runs, success rate, average caption score and wins vs. humans; the **mix editor** (share of new posts per chain, must total 100%) |
| **Generation runs** `/studio/requests` | Every caption run (main app and console) with status, chain, requester, calls, tokens and duration; a per-run timeline of every model call with the exact prompt and response |
| **LLM responses** `/studio/responses` | Raw output of every model call, searchable, with per-model call/error/latency/token cards |
| **Examples** `/studio/examples` | CRUD for few-shot caption examples (`{{examples}}`); any real caption can be promoted from a post |
| **Models & providers** `/models` | CRUD for LLM models and providers, usage per model, which chain steps use each model, and whether each provider's key variable is set on this server (yes/no only) |
| **Posts & AI media** `/media` | Browse every post or every caption; filter by user, date, caption type, popularity, and photo source (uploaded / AI-generated / library). Per post: the chain that wrote it, the exact prompt; edit AI captions and the context line; generate more captions with any chain; save a caption as an example; delete captions or the whole post (photo file included). **New AI post** uploads a photo and captions it through the pipeline |
| **Image library** `/images` | Upload (checked by file signature, 5 MB max), edit, schedule as a Daily Drop, hide, and delete curated photos used by the main app's Daily Drop, Surprise Me and Meme Studio |
| **Terms** `/terms` | CRUD for the campus/NYC/internet glossary sent to the model as `{{terms}}` |
| **Signup access** `/access` | The signup gate, plus CRUD for allowed email domains and whitelisted emails |
| **Votes** `/votes` | Every vote, with voter, caption and direction, filters, trend and CSV export. **Read-only** |
| **Audit log** `/audit` | Every admin create, edit and delete, with before and after values |

## Design

Same brand as the main app: icy baby blue `#B8DCFF`, powder `#E3F2FF`, sky `#69B5FF`, navy ink `#16263D` on `#F8FCFF`. Bricolage Grotesque headlines, Geist body text, glossy pill buttons, a floating glass sidebar, and light-only surfaces. Chart colors (Humans `#3D8FF0`, Gemini `#E5539A`, downvotes `#EC5B37`) were checked for color-blind separation and contrast on the page backgrounds.

## Security model

Google login alone gets you nothing. Access requires `profiles.is_superadmin = true` in the database.

1. **`src/proxy.ts`** sends signed-out visitors to `/login` (or returns 401 for `/api/*`).
2. **`src/lib/auth.ts`** is called by every page (`requireAdmin`), server action (`requireAdminAction`) and route handler (`requireAdminApi`). It validates the session with Supabase Auth (`getUser()`), then asks the database `is_superadmin()`. Non-admins get the Access Denied page with HTTP 403. Errors fail closed.
3. **The database decides anyway.** All admin reads and writes go through `admin_*` `SECURITY DEFINER` functions that start with `assert_superadmin()`, which reads the flag for `auth.uid()` from the caller's signed JWT. A regular user calling them directly through the Supabase REST API gets `forbidden`; anon can't execute them at all.

There is **no service-role key**: the app uses the anon key plus the signed-in admin's own session, server-side only (no `NEXT_PUBLIC_` variables). Admin-specific *table* policies weren't enough on their own. The main app hides caption authorship with column grants on the whole `authenticated` role, and a policy can't re-grant columns to one user. Narrow, audited functions were the least-privileged option. Other safeguards:

- Users can no longer update `is_superadmin` (or anything but `first_name`, `last_name`, `avatar_url`) on their own profile: a column grant, plus a trigger as a second layer. Only the SQL Editor can grant admin.
- No existing policy for ordinary users was loosened. The only new policy lets superadmins delete photos in the `generations` storage bucket (to clean up deleted posts).
- Users and votes are read-only. Admins can reword **AI** captions only; human captions can be deleted (moderation) but never reworded. Vote totals stay trigger-maintained.
- Every admin write is recorded in `admin_audit_log` with the old values (RLS on, no policies, so only the functions touch it).
- All input is validated in the app *and* in SQL. Post-login `?next=` redirects are same-site only. Pages are `noindex`, unframeable and `no-store`.

### AI Studio, access and image library (`20261026000000_ai_studio_access_images.sql`)

- **New tables:** `llm_providers`, `llm_models`, `prompt_chains`, `prompt_chain_steps`, `prompt_chain_mix`, `terms`, `ai_generation_examples`, `generation_requests`, `llm_responses`, `allowed_signup_domains`, `whitelisted_emails`, `signup_settings`, `images`; one new nullable column, `generations.source_image_id`; one new public storage bucket, `images`.
- **The pipeline is real.** Both apps caption photos by calling `begin_caption_request()` (the database picks a runnable chain by the mix and returns its steps, models, terms and examples), run each step against Gemini, log every call with `log_llm_response()`, and close the run with `finish_caption_request()`, which links the captions it wrote. Regular users get 25 runs a day. If the functions are missing, the apps fall back to the original prompt.
- **Admin tables** have RLS with `is_superadmin()` policies and column-level grants (ids, timestamps and `created_by` can't be set by hand). Every insert, update and delete is written to `admin_audit_log` by a trigger. Run logs are only reachable through `admin_*` functions.
- **API keys are never stored.** A provider names the server env var that holds its key, and the name must match `*_API_KEY`, so a provider record can't make the server send another secret.
- **Signup gate.** A `BEFORE INSERT` trigger on `auth.users` blocks new accounts when signups are restricted and the email isn't on an allowed domain or the whitelist. It starts **open** (`restrict_signups = false`); existing accounts are never affected. Only superadmins can change the lists or the gate.
- **Images.** Writes to the `images` bucket and table are superadmin-only. The public sees active images whose Daily Drop date has arrived, never future drops, and never who uploaded them.

## Setup

1. **Database.** In the Supabase SQL Editor, run [`supabase/migrations/20261019000000_admin_dashboard.sql`](supabase/migrations/20261019000000_admin_dashboard.sql), then [`supabase/migrations/20261026000000_ai_studio_access_images.sql`](supabase/migrations/20261026000000_ai_studio_access_images.sql). Both are safe to re-run and keep all existing data.
2. **Verify.** Run [`supabase/tests/admin_security_tests.sql`](supabase/tests/admin_security_tests.sql) and [`supabase/tests/ai_studio_security_tests.sql`](supabase/tests/ai_studio_security_tests.sql). They should end with `ALL 44 SECURITY TESTS PASSED` and `ALL 117 AI STUDIO TESTS PASSED`; those errors are intentional and roll back all test data.
   **Recovery:** the AI Studio migration runs in one transaction, so a failure leaves nothing behind. To undo it after it succeeded, run [`supabase/rollback/20261026000000_ai_studio_access_images.down.sql`](supabase/rollback/20261026000000_ai_studio_access_images.down.sql); it restores the previous schema exactly and keeps every post, caption, vote and user.
3. **Grant yourself admin** (sign in to Morningside Memes once first, so your account exists):
   ```sql
   update public.profiles set is_superadmin = true
   where id = (select id from auth.users where email = 'you@example.com');
   ```
   Check with `select u.email, p.is_superadmin from auth.users u join public.profiles p using (id) where p.is_superadmin;`. Revoke with `set is_superadmin = false`.
4. **Redirect URLs.** In Supabase → Authentication → URL Configuration, add `https://morningside-memes-admin.vercel.app/**`, `https://morningside-memes-admin-*.vercel.app/**` and `http://localhost:3001/**`.
5. **Env vars** (`.env.local` and Vercel): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `GEMINI_API_KEY`. Optional: `GEMINI_MODEL`, `MAIN_APP_URL`.

```bash
npm install
npm run dev -- -p 3001
```

## Tests

| Command | What it checks |
| --- | --- |
| `npm run typecheck` / `npm run lint` / `npm run build` | Types, lint, production build |
| `npm run test:db` | Applies the main app's migrations and both admin migrations to PGlite (in-memory Postgres), proves existing rows survive and each migration is re-runnable, checks every pre-existing row is byte-for-byte unchanged and no existing policy, grant, function or trigger changed, runs the 44 + 117 SQL security tests (including a sweep that calls every `admin_*` function as a regular user and as anon), then applies the rollback script and checks the schema is exactly as before |
| `npm test` | Playwright, signed out (desktop and mobile): every page redirects to login, APIs return 401, forged cookies and direct server-action POSTs are rejected, `?next=` can't redirect off-site, no secrets in client bundles. `BASE_URL=https://… npm test` runs it against a deployment |
| `npm run test:e2e` | Playwright, signed in, against the real app and a local Supabase stand-in ([`tests/mock`](tests/mock)) running the real migrations with RLS: regular users get 403 everywhere (including direct server-action calls), and superadmins can view, filter and export, edit AI captions and context, generate captions with Gemini, upload, and delete captions and posts (photo file included), with nothing else changed. The AI Studio, models/providers, terms, examples, image library and signup-access screens are exercised end to end (create, edit, delete, validation, audit entries). No horizontal scrolling at phone width |

The mock in [`tests/mock`](tests/mock) also stands in for the Gemini API (switchable to out-of-quota or overloaded), so caption tests are deterministic; `REAL_GEMINI=1` uses the real API instead. It also supports the main app's queries (embedded relations, filters, upserts); the main app's own Playwright suite uses it. The `test:db` and `test:e2e` commands expect the main app checked out next to this repo (`../hello-world-nextjs`), or `MAIN_MIGRATIONS` pointing at its `supabase/migrations`.

### Manual check with a real Google account

1. In an incognito window, open the admin URL: you land on the login page.
2. Sign in with a non-admin Google account: **Access denied** (403).
3. Sign in with your account *before* granting admin: **Access denied**. Grant admin (step 3 above), reload: the dashboard loads.

## Metric notes

- **Daily active users** counts users who posted, captioned or voted that day. The app doesn't log page views, and Supabase keeps only each user's *last* sign-in, so browse-only visits can't be counted.
- **Votes per day** uses each vote's first-cast time; a flipped vote only keeps its current direction.
- **Battles** use the main app's rule: photos with at least one human caption, won by the side with the single highest-scoring caption above 0.
