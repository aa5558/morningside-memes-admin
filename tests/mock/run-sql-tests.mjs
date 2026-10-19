import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Applies the main app's migrations and the admin migration (twice, to prove
// it's re-runnable) to PGlite, checks existing rows survive, then runs
// supabase/tests/admin_security_tests.sql and checks it rolled back.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const MAIN = process.env.MAIN_MIGRATIONS ?? join(ROOT, "../hello-world-nextjs/supabase/migrations");
const ADMIN = join(ROOT, "supabase");

// Minimal stand-ins for what Supabase provides.
const SUPABASE_STUB = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
grant anon, authenticated, service_role to current_user;
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated;
create table auth.users (
  id uuid primary key, email varchar(255), created_at timestamptz, last_sign_in_at timestamptz,
  raw_app_meta_data jsonb, aud varchar(255), role varchar(255)
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated;

create schema storage;
grant usage on schema storage to anon, authenticated;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
grant all on storage.objects to anon, authenticated;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;

-- Pretend some real data already exists, to prove migrations keep it.
create table public.movies (id serial primary key, title text);
`;

const db = new PGlite();
await db.exec(SUPABASE_STUB);

for (const f of [
  `${MAIN}/20260928000000_profiles.sql`,
  `${MAIN}/20261005000000_captions_votes_rls.sql`,
]) {
  await db.exec(readFileSync(f, "utf8"));
  console.log("applied", f.split("/").pop());
}

// Seed "existing" data before the battles + admin migrations.
await db.exec(`
insert into auth.users (id, email, created_at) values
  ('11111111-1111-1111-1111-111111111111', 'real@example.com', now() - interval '20 days');
update public.profiles set first_name = 'Real', last_name = 'Person' where id = '11111111-1111-1111-1111-111111111111';
insert into public.generations (id, user_id, image_path, vibe, model, prompt, created_at) values
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
   '11111111-1111-1111-1111-111111111111/a.jpg', 'columbia', 'm', 'p', now() - interval '3 days');
insert into public.captions (generation_id, user_id, text) values
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'old caption');
insert into public.caption_votes (user_id, caption_id, vote)
  select '11111111-1111-1111-1111-111111111111', id, 1 from public.captions;
`);

const snapshot = async () =>
  (
    await db.query(`select
      (select count(*) from public.profiles) profiles,
      (select count(*) from public.generations) generations,
      (select count(*) from public.captions) captions,
      (select count(*) from public.caption_votes) votes,
      (select sum(upvotes) from public.captions) upvotes`)
  ).rows[0];

await db.exec(readFileSync(`${MAIN}/20261012000000_human_vs_ai_battles.sql`, "utf8"));
console.log("applied 20261012000000_human_vs_ai_battles.sql");
const before = await snapshot();

const adminSql = readFileSync(`${ADMIN}/migrations/20261019000000_admin_dashboard.sql`, "utf8");
await db.exec(adminSql);
console.log("applied 20261019000000_admin_dashboard.sql");
await db.exec(adminSql);
console.log("re-applied admin migration (idempotent)");

const after = await snapshot();
console.log("existing data before/after:", JSON.stringify(before), JSON.stringify(after));
if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("migration changed existing data");

try {
  await db.exec(readFileSync(`${ADMIN}/tests/admin_security_tests.sql`, "utf8"));
  console.log("UNEXPECTED: test script did not raise");
  process.exit(1);
} catch (e) {
  console.log("RESULT:", e.message);
  if (!e.message.startsWith("ALL ")) process.exit(1);
}

const final = await snapshot();
console.log("data after tests:", JSON.stringify(final));
if (JSON.stringify(before) !== JSON.stringify(final)) throw new Error("tests left data behind");
console.log("OK: tests rolled back cleanly");
