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

// More realistic "existing" data, as it looks in production today: several
// users (one superadmin), human and AI captions, votes both ways, an avatar,
// and admin audit history.
await db.exec(`
insert into auth.users (id, email, created_at, last_sign_in_at) values
  ('33333333-3333-3333-3333-333333333333', 'second@gmail.com', now() - interval '9 days', now()),
  ('44444444-4444-4444-4444-444444444444', 'admin@columbia.edu', now() - interval '30 days', now());
update public.profiles set first_name = 'Sec', last_name = 'Ond', avatar_url = 'https://x/a.png' where id = '33333333-3333-3333-3333-333333333333';
update public.profiles set first_name = 'Ad', last_name = 'Min', is_superadmin = true where id = '44444444-4444-4444-4444-444444444444';
insert into public.captions (generation_id, user_id, author_type, text, created_at) values
  ('22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333', 'human', 'a human caption', now() - interval '2 days');
insert into public.caption_votes (user_id, caption_id, vote)
  select '33333333-3333-3333-3333-333333333333', id, -1 from public.captions where author_type = 'ai';
insert into public.caption_votes (user_id, caption_id, vote)
  select '44444444-4444-4444-4444-444444444444', id, 1 from public.captions where author_type = 'human';
insert into public.admin_audit_log (admin_id, action, target_type, target_id, details)
  values ('44444444-4444-4444-4444-444444444444', 'edit_post', 'generation', '22222222-2222-2222-2222-222222222222', '{"old_context": null}');
insert into storage.objects (bucket_id, name) values ('generations', '11111111-1111-1111-1111-111111111111/a.jpg');
`);

// Every row of every pre-existing table, hashed. generations is hashed
// without the one column the migration adds.
const fingerprint = async () =>
  (
    await db.query(`select
      (select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by t.id), '')) from auth.users t) users,
      (select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by t.id), '')) from public.profiles t) profiles,
      (select md5(coalesce(string_agg((to_jsonb(t) - 'source_image_id')::text, '|' order by t.id), '')) from public.generations t) generations,
      (select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by t.id), '')) from public.captions t) captions,
      (select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by t.user_id, t.caption_id), '')) from public.caption_votes t) votes,
      (select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by t.id), '')) from public.admin_audit_log t) audit,
      (select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by t.caption_id), '')) from public.caption_prompts t) caption_prompts,
      (select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by t.id), '')) from public.movies t) movies,
      (select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by t.name), '')) from storage.objects t) objects,
      (select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by t.id), '')) from storage.buckets t where id <> 'images') buckets`)
  ).rows[0];

// The security-relevant catalog: policies, grants, functions, triggers,
// columns and RLS flags.
const catalog = async () => {
  const q = async (sql) => (await db.query(sql)).rows.map((r) => JSON.stringify(r)).sort();
  return {
    tables: await q(`select n.nspname, c.relname, c.relrowsecurity rls from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind = 'r' and n.nspname in ('public', 'auth', 'storage')`),
    columns: await q(`select table_schema, table_name, column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema in ('public', 'auth', 'storage')`),
    policies: await q(`select schemaname, tablename, policyname, cmd, roles::text, qual, with_check from pg_policies`),
    tableGrants: await q(`select table_schema, table_name, grantee, privilege_type from information_schema.role_table_grants where grantee in ('anon', 'authenticated')`),
    columnGrants: await q(`select table_schema, table_name, column_name, grantee, privilege_type from information_schema.column_privileges where grantee in ('anon', 'authenticated')`),
    functions: await q(`select p.oid::regprocedure::text sig, md5(p.prosrc) src, p.prosecdef, p.proacl::text acl from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`),
    triggers: await q(`select tgrelid::regclass::text tbl, tgname, tgfoid::regprocedure::text fn, tgenabled from pg_trigger where not tgisinternal`),
  };
};

const seeded = await snapshot();
const preData = await fingerprint();
const preCatalog = await catalog();

const studioSql = readFileSync(`${ADMIN}/migrations/20261026000000_ai_studio_access_images.sql`, "utf8");
await db.exec(studioSql);
console.log("applied 20261026000000_ai_studio_access_images.sql");
await db.exec(studioSql);
console.log("re-applied AI studio migration (idempotent)");

const fail = (msg) => {
  console.error("FAIL:", msg);
  process.exit(1);
};
const postData = await fingerprint();
if (JSON.stringify(preData) !== JSON.stringify(postData)) {
  fail(`existing rows changed:\n${JSON.stringify(preData)}\n${JSON.stringify(postData)}`);
}
console.log("OK: every existing row is byte-for-byte unchanged:", Object.keys(preData).join(", "));

// Everything that existed before must still exist, identical. The only
// allowed differences are additions, plus admin_list_media (intentionally
// replaced with a version that has one more optional filter) and the new
// column's own grants.
const postCatalog = await catalog();
for (const [kind, rows] of Object.entries(preCatalog)) {
  const now = new Set(postCatalog[kind]);
  const missing = rows.filter(
    (r) => !now.has(r) && !r.includes("admin_list_media") && !(kind === "columns" && r.includes("source_image_id"))
  );
  if (missing.length) fail(`${kind} changed or removed:\n${missing.join("\n")}`);
}
const added = (kind) => postCatalog[kind].filter((r) => !preCatalog[kind].includes(r));
const addedPolicies = added("policies").map((r) => JSON.parse(r));
if (addedPolicies.some((p) => !["llm_providers", "llm_models", "prompt_chains", "prompt_chain_steps", "prompt_chain_mix", "terms", "ai_generation_examples", "allowed_signup_domains", "whitelisted_emails", "signup_settings", "images"].includes(p.tablename) && !(p.tablename === "objects" && /library images/.test(p.policyname)))) {
  fail(`unexpected new policy on an existing table: ${JSON.stringify(addedPolicies)}`);
}
const generationsGrants = added("tableGrants").filter((r) => /"generations"|"captions"|"caption_votes"|"profiles"/.test(r));
if (generationsGrants.length) fail(`new table grants on existing tables: ${generationsGrants}`);
console.log(`OK: no existing policy, grant, function (except the replaced admin_list_media), trigger or column changed; ${addedPolicies.length} policies added, all on new tables or the new bucket`);

const [{ restrict_signups, classic, others }] = (
  await db.query(`select (select restrict_signups from public.signup_settings) restrict_signups,
    (select weight from public.prompt_chain_mix m join public.prompt_chains c on c.id = m.chain_id where c.slug = 'classic') classic,
    (select sum(weight) from public.prompt_chain_mix m join public.prompt_chains c on c.id = m.chain_id where c.slug <> 'classic') others`)
).rows;
if (restrict_signups !== false) fail("signup gate is not off after the migration");
if (classic !== 100 || Number(others) !== 0) fail("Classic is not 100% of the mix");
const [{ n: auditAdded }] = (await db.query(`select count(*)::int n from public.admin_audit_log`)).rows;
console.log(`OK: signup gate OFF, mix = Classic 100%, audit log rows ${auditAdded} (unchanged by the migration)`);

// A brand-new Google signup still works with the gate off.
await db.exec(`insert into auth.users (id, email, created_at) values ('55555555-5555-5555-5555-555555555555', 'anyone@yahoo.com', now())`);
const [{ ok }] = (await db.query(`select exists (select 1 from public.profiles where id = '55555555-5555-5555-5555-555555555555') ok`)).rows;
if (!ok) fail("a new signup with the gate off did not get a profile");
await db.exec(`delete from auth.users where id = '55555555-5555-5555-5555-555555555555'`);
console.log("OK: with the gate off, a new account from any domain is created normally");

const after = await snapshot();
console.log("existing data before/after:", JSON.stringify(before), JSON.stringify(seeded), JSON.stringify(after));
if (JSON.stringify(seeded) !== JSON.stringify(after)) throw new Error("migration changed existing data");

for (const file of ["admin_security_tests.sql", "ai_studio_security_tests.sql"]) {
  try {
    await db.exec(readFileSync(`${ADMIN}/tests/${file}`, "utf8"));
    console.log("UNEXPECTED: test script did not raise:", file);
    process.exit(1);
  } catch (e) {
    console.log(`RESULT (${file}):`, e.message);
    if (!e.message.startsWith("ALL ")) process.exit(1);
  }
}

const final = await snapshot();
console.log("data after tests:", JSON.stringify(final));
if (JSON.stringify(seeded) !== JSON.stringify(final)) throw new Error("tests left data behind");
console.log("OK: tests rolled back cleanly");

// Recovery: the rollback script returns the schema to exactly what it was
// before the migration and keeps every existing row, and the migration can
// be applied again afterwards.
await db.exec(readFileSync(`${ADMIN}/rollback/20261026000000_ai_studio_access_images.down.sql`, "utf8"));
const rolledBack = await catalog();
for (const kind of Object.keys(preCatalog)) {
  const a = JSON.stringify(preCatalog[kind]);
  const b = JSON.stringify(rolledBack[kind]);
  if (a !== b) {
    const extra = rolledBack[kind].filter((r) => !preCatalog[kind].includes(r));
    const gone = preCatalog[kind].filter((r) => !rolledBack[kind].includes(r));
    fail(`rollback left ${kind} different:\n+ ${extra.join("\n+ ")}\n- ${gone.join("\n- ")}`);
  }
}
if (JSON.stringify(await fingerprint()) !== JSON.stringify(preData)) fail("rollback changed existing rows");
console.log("OK: rollback restores the exact pre-migration schema; existing rows untouched");
await db.exec(studioSql);
console.log("OK: migration re-applies cleanly after a rollback");
