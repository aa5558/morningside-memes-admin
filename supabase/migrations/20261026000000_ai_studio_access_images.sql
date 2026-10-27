-- Morningside Memes 2.0: the AI Studio (models, providers, prompt chains and
-- their mix, terms, few-shot examples, generation requests, LLM responses),
-- signup access control (allowed domains + whitelisted emails), and the
-- curated image library behind the Daily Drop and Surprise Me.
--
-- Run this once in the Supabase SQL Editor, after
-- 20261019000000_admin_dashboard.sql. Safe to re-run: every object is created
-- with IF NOT EXISTS / OR REPLACE, seeds use ON CONFLICT DO NOTHING (so admin
-- edits survive a re-run), and no existing row is changed or deleted.
--
-- What this does NOT change
-- -------------------------
-- * No existing table loses a column, row, grant, or policy.
-- * generations gets one new nullable column (source_image_id); captions,
--   caption_votes and profiles are untouched.
-- * Signups stay open after this runs: signup_settings.restrict_signups
--   starts as false. An admin has to switch the gate on.
-- * The deployed apps keep working before their new code ships: the new code
--   falls back to the old built-in prompt when these functions are missing.
--
-- Security model (same as the admin migration)
-- --------------------------------------------
-- * Every new table has RLS on. anon gets nothing except the public read of
--   released library images and the two public helper functions.
-- * Admin-managed tables are readable/writable only when is_superadmin() is
--   true for the caller's JWT, enforced by RLS policies, with column-level
--   grants so ids, timestamps and authorship can't be forged.
-- * Every insert/update/delete on those tables is written to admin_audit_log
--   by a trigger, with the before/after values.
-- * Generation logs are written only through SECURITY DEFINER functions that
--   check the caller owns the request; they are read only by superadmins.
-- * Provider API keys are never stored. A provider names the server
--   environment variable that holds its key (e.g. GEMINI_API_KEY), and the
--   name must end in _API_KEY so it can't point at other server secrets.

begin;

-- ---------------------------------------------------------------------------
-- Shared trigger functions
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Logs every change to an admin-managed table. TG_ARGV[0] is the target type
-- used in the audit log ("term", "llm_model", ...). Updates only record the
-- columns that actually changed.
create or replace function public.audit_admin_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_key text := coalesce(v_row ->> 'id', v_row ->> 'chain_id');
  v_target uuid;
  v_details jsonb;
begin
  if v_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_target := v_key::uuid;
  end if;

  if tg_op = 'INSERT' then
    v_details := jsonb_build_object('new', to_jsonb(new));
  elsif tg_op = 'DELETE' then
    v_details := jsonb_build_object('old', to_jsonb(old));
  else
    select jsonb_object_agg(o.key, jsonb_build_object('old', o.value, 'new', n.value))
      into v_details
      from jsonb_each(to_jsonb(old)) o
      join jsonb_each(to_jsonb(new)) n using (key)
     where o.value is distinct from n.value
       and o.key not in ('updated_at', 'updated_by');
    if v_details is null then
      return new;
    end if;
    v_details := jsonb_build_object('changes', v_details);
  end if;

  insert into public.admin_audit_log (admin_id, action, target_type, target_id, details)
  values (
    auth.uid(),
    case tg_op when 'INSERT' then 'create_' when 'UPDATE' then 'update_' else 'delete_' end || tg_argv[0],
    tg_argv[0],
    v_target,
    v_details
  );
  return coalesce(new, old);
end;
$$;

-- ---------------------------------------------------------------------------
-- LLM providers and models
-- ---------------------------------------------------------------------------

create table if not exists public.llm_providers (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  -- How the apps call this provider. Only 'gemini' has a runtime adapter;
  -- 'none' providers are kept for the record and can't run in a chain.
  adapter text not null default 'none' check (adapter in ('gemini', 'none')),
  -- The NAME of the server environment variable holding the key. Never the
  -- key itself.
  api_key_env_var text check (api_key_env_var ~ '^[A-Z][A-Z0-9_]{0,50}_API_KEY$'),
  website_url text check (website_url ~ '^https://[^[:space:]]{3,200}$'),
  is_active boolean not null default true,
  notes text check (char_length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint llm_providers_runtime_needs_key check (adapter = 'none' or api_key_env_var is not null)
);

create table if not exists public.llm_models (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.llm_providers (id) on delete restrict,
  -- The id the provider's API expects, e.g. "gemini-flash-latest".
  model_key text not null check (model_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$'),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 80),
  supports_vision boolean not null default true,
  temperature numeric(3, 2) not null default 1 check (temperature between 0 and 2),
  -- null = the provider's default. Thinking models spend output tokens on
  -- reasoning, so a low cap can cut captions off.
  max_output_tokens integer check (max_output_tokens between 64 and 65536),
  is_active boolean not null default true,
  notes text check (char_length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_id, model_key)
);
create index if not exists llm_models_provider_idx on public.llm_models (provider_id);

-- ---------------------------------------------------------------------------
-- Prompt chains, their steps, and the mix
-- ---------------------------------------------------------------------------
-- A chain is an ordered list of model calls that turns a photo into
-- captions. Each step's instructions are a template; the app fills in
-- {{voice}}, {{context}}, {{image_prompt}}, {{daily_prompt}}, {{terms}},
-- {{examples}} and {{previous}} (the previous step's output). 'analyze'
-- steps return free text; 'caption' steps return a JSON array of strings.
-- The last step of a runnable chain is always a 'caption' step.

create table if not exists public.prompt_chains (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description text check (char_length(description) <= 500),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.prompt_chain_steps (
  id uuid primary key default gen_random_uuid(),
  chain_id uuid not null references public.prompt_chains (id) on delete cascade,
  position smallint not null check (position between 1 and 10),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  purpose text check (char_length(purpose) <= 300),
  kind text not null check (kind in ('analyze', 'caption')),
  model_id uuid not null references public.llm_models (id) on delete restrict,
  include_image boolean not null default true,
  -- null = the model's temperature.
  temperature numeric(3, 2) check (temperature between 0 and 2),
  instructions text not null check (char_length(instructions) between 1 and 6000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (chain_id, position)
);
create index if not exists prompt_chain_steps_model_idx on public.prompt_chain_steps (model_id);

-- Share of new posts each chain captions, in percent. Changed only through
-- admin_update_chain_mix(), which keeps the total at exactly 100.
create table if not exists public.prompt_chain_mix (
  chain_id uuid primary key references public.prompt_chains (id) on delete cascade,
  weight smallint not null default 0 check (weight between 0 and 100),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

-- ---------------------------------------------------------------------------
-- Terms and few-shot examples (fed into the prompts)
-- ---------------------------------------------------------------------------

-- A glossary the model sees as {{terms}}, so captions get campus and city
-- references right. Filtered by category to fit the chosen voice.
create table if not exists public.terms (
  id uuid primary key default gen_random_uuid(),
  term text not null check (char_length(btrim(term)) between 1 and 60),
  definition text not null check (char_length(btrim(definition)) between 1 and 300),
  example text check (char_length(example) <= 200),
  category text not null default 'general' check (category in ('campus', 'nyc', 'internet', 'general')),
  is_active boolean not null default true,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists terms_term_lower_key on public.terms (lower(term));

-- Captions that landed, shown to the model as {{examples}}. vibe null means
-- "any voice".
create table if not exists public.ai_generation_examples (
  id uuid primary key default gen_random_uuid(),
  vibe text check (vibe in ('midwest', 'online', 'columbia', 'newyorker')),
  scene text not null check (char_length(btrim(scene)) between 3 and 300),
  caption text not null check (char_length(btrim(caption)) between 1 and 200),
  notes text check (char_length(notes) <= 300),
  is_active boolean not null default true,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Generation requests and LLM responses (the run log)
-- ---------------------------------------------------------------------------

-- One row per attempt to caption a photo, successful or not.
create table if not exists public.generation_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  source text not null check (source in ('main_app', 'admin')),
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  chain_id uuid references public.prompt_chains (id) on delete set null,
  chain_slug text not null,
  vibe text,
  generation_id uuid references public.generations (id) on delete set null,
  caption_ids uuid[] not null default '{}',
  error_message text check (char_length(error_message) <= 500),
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists generation_requests_started_idx on public.generation_requests (started_at desc);
create index if not exists generation_requests_user_idx on public.generation_requests (user_id, started_at desc);
create index if not exists generation_requests_chain_idx on public.generation_requests (chain_id);
create index if not exists generation_requests_generation_idx on public.generation_requests (generation_id);

-- One row per model call within a request. Model and provider are copied in
-- so the log stays readable after a model is renamed or deleted.
create table if not exists public.llm_responses (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.generation_requests (id) on delete cascade,
  step_id uuid references public.prompt_chain_steps (id) on delete set null,
  step_position smallint,
  step_name text,
  model_id uuid references public.llm_models (id) on delete set null,
  model_key text not null,
  provider_slug text,
  prompt_text text not null check (char_length(prompt_text) <= 20000),
  response_text text check (char_length(response_text) <= 20000),
  status text not null check (status in ('ok', 'error')),
  http_status integer,
  error_message text check (char_length(error_message) <= 500),
  latency_ms integer check (latency_ms >= 0),
  input_tokens integer check (input_tokens >= 0),
  output_tokens integer check (output_tokens >= 0),
  created_at timestamptz not null default now()
);
create index if not exists llm_responses_request_idx on public.llm_responses (request_id, step_position);
create index if not exists llm_responses_created_idx on public.llm_responses (created_at desc);
create index if not exists llm_responses_model_idx on public.llm_responses (model_id);

-- ---------------------------------------------------------------------------
-- Signup access control
-- ---------------------------------------------------------------------------

create table if not exists public.allowed_signup_domains (
  id uuid primary key default gen_random_uuid(),
  domain text not null unique check (
    char_length(domain) <= 253
    and domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$'
  ),
  include_subdomains boolean not null default false,
  note text check (char_length(note) <= 200),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.whitelisted_emails (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (
    char_length(email) <= 254
    and email ~ '^[a-z0-9._%+-]+@([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$'
  ),
  note text check (char_length(note) <= 200),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A single row: whether signups are limited to the lists above.
create table if not exists public.signup_settings (
  id boolean primary key default true check (id),
  restrict_signups boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
insert into public.signup_settings (id, restrict_signups) values (true, false)
on conflict (id) do nothing;

-- Lowercases and trims domains and emails before the format checks run.
create or replace function public.normalize_access_entry()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_table_name = 'allowed_signup_domains' then
    new.domain := lower(btrim(regexp_replace(new.domain, '^@', '')));
  else
    new.email := lower(btrim(new.email));
  end if;
  return new;
end;
$$;

-- True when this email may create an account right now.
create or replace function public.signup_allowed(p_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with e as (
    select lower(btrim(coalesce(p_email, ''))) as email,
           split_part(lower(btrim(coalesce(p_email, ''))), '@', 2) as domain
  )
  select
    not coalesce((select restrict_signups from public.signup_settings where id), false)
    or exists (select 1 from public.whitelisted_emails w, e where w.email = e.email)
    or exists (
      select 1 from public.allowed_signup_domains d, e
      where e.domain <> ''
        and (e.domain = d.domain or (d.include_subdomains and e.domain like '%.' || d.domain))
    );
$$;

-- Runs inside Supabase Auth's insert of a new account. Existing accounts are
-- never affected; only brand-new signups are checked.
create or replace function public.enforce_signup_allowlist()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.signup_allowed(new.email) then
    raise exception 'signup_not_allowed' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_signup_allowlist on auth.users;
create trigger enforce_signup_allowlist
  before insert on auth.users
  for each row execute function public.enforce_signup_allowlist();

-- What the login page tells people: whether the gate is on, and which
-- domains are welcome. Never lists whitelisted emails.
create or replace function public.signup_rules()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'restricted', coalesce((select restrict_signups from public.signup_settings where id), false),
    'domains', coalesce((select jsonb_agg(domain order by domain) from public.allowed_signup_domains), '[]'::jsonb)
  );
$$;

-- ---------------------------------------------------------------------------
-- Image library (Daily Drop + Surprise Me)
-- ---------------------------------------------------------------------------

create table if not exists public.images (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null unique check (storage_path ~ '^[0-9a-f-]{36}\.(png|jpg|webp)$'),
  title text not null check (char_length(btrim(title)) between 1 and 80),
  alt_text text not null check (char_length(btrim(alt_text)) between 3 and 300),
  tags text[] not null default '{}' check (cardinality(tags) <= 8),
  mime_type text not null check (mime_type in ('image/png', 'image/jpeg', 'image/webp')),
  byte_size integer not null check (byte_size between 1 and 5242880),
  is_active boolean not null default true,
  -- The New York day this image is the Daily Drop. One image per day.
  featured_on date unique,
  uploaded_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists images_active_idx on public.images (is_active, created_at desc);

-- Which library image a post was made from, if any.
alter table public.generations
  add column if not exists source_image_id uuid references public.images (id) on delete set null;
create index if not exists generations_source_image_idx on public.generations (source_image_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('images', 'images', true, 5 * 1024 * 1024, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

-- Files are served through the public bucket URL, so nobody needs to list
-- the bucket except admins. Storage also needs SELECT to delete a file.
drop policy if exists "Superadmins can list library images" on storage.objects;
create policy "Superadmins can list library images"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'images' and public.is_superadmin());

drop policy if exists "Superadmins can upload library images" on storage.objects;
create policy "Superadmins can upload library images"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'images' and public.is_superadmin());

drop policy if exists "Superadmins can replace library images" on storage.objects;
create policy "Superadmins can replace library images"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'images' and public.is_superadmin())
  with check (bucket_id = 'images' and public.is_superadmin());

drop policy if exists "Superadmins can delete library images" on storage.objects;
create policy "Superadmins can delete library images"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'images' and public.is_superadmin());

-- ---------------------------------------------------------------------------
-- Grants and row level security
-- ---------------------------------------------------------------------------
-- Supabase grants everything on new tables to anon and authenticated by
-- default. Start from nothing and add back exactly what each table needs.

do $$
declare
  t text;
begin
  foreach t in array array[
    'llm_providers', 'llm_models', 'prompt_chains', 'prompt_chain_steps', 'prompt_chain_mix',
    'terms', 'ai_generation_examples', 'generation_requests', 'llm_responses',
    'allowed_signup_domains', 'whitelisted_emails', 'signup_settings', 'images'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end;
$$;

-- Admin-managed CRUD tables: superadmins only, and only the editable columns.
grant select, delete on public.llm_providers, public.llm_models, public.terms,
  public.ai_generation_examples, public.allowed_signup_domains, public.whitelisted_emails
  to authenticated;

grant insert (slug, name, adapter, api_key_env_var, website_url, is_active, notes),
      update (slug, name, adapter, api_key_env_var, website_url, is_active, notes)
  on public.llm_providers to authenticated;
grant insert (provider_id, model_key, display_name, supports_vision, temperature, max_output_tokens, is_active, notes),
      update (provider_id, model_key, display_name, supports_vision, temperature, max_output_tokens, is_active, notes)
  on public.llm_models to authenticated;
grant insert (term, definition, example, category, is_active),
      update (term, definition, example, category, is_active)
  on public.terms to authenticated;
grant insert (vibe, scene, caption, notes, is_active),
      update (vibe, scene, caption, notes, is_active)
  on public.ai_generation_examples to authenticated;
grant insert (domain, include_subdomains, note),
      update (domain, include_subdomains, note)
  on public.allowed_signup_domains to authenticated;
grant insert (email, note),
      update (email, note)
  on public.whitelisted_emails to authenticated;

grant select, update (restrict_signups) on public.signup_settings to authenticated;
grant select on public.prompt_chains, public.prompt_chain_steps, public.prompt_chain_mix to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'llm_providers', 'llm_models', 'terms', 'ai_generation_examples',
    'allowed_signup_domains', 'whitelisted_emails'
  ] loop
    execute format('drop policy if exists "Superadmins manage %1$s" on public.%1$I', t);
    execute format('create policy "Superadmins manage %1$s" on public.%1$I
                    for all to authenticated
                    using (public.is_superadmin()) with check (public.is_superadmin())', t);
  end loop;

  foreach t in array array['prompt_chains', 'prompt_chain_steps', 'prompt_chain_mix'] loop
    execute format('drop policy if exists "Superadmins read %1$s" on public.%1$I', t);
    execute format('create policy "Superadmins read %1$s" on public.%1$I
                    for select to authenticated using (public.is_superadmin())', t);
  end loop;
end;
$$;

drop policy if exists "Superadmins read signup settings" on public.signup_settings;
create policy "Superadmins read signup settings"
  on public.signup_settings for select
  to authenticated
  using (public.is_superadmin());
drop policy if exists "Superadmins change signup settings" on public.signup_settings;
create policy "Superadmins change signup settings"
  on public.signup_settings for update
  to authenticated
  using (public.is_superadmin())
  with check (public.is_superadmin());

-- generation_requests / llm_responses: no table access at all. Written by
-- the caption-pipeline functions below, read by admin functions.

-- images: everyone can see active images that have been released (not a
-- future Daily Drop); superadmins see and manage everything.
grant select (id, storage_path, title, alt_text, tags, featured_on, created_at)
  on public.images to anon;
grant select on public.images to authenticated;
grant insert (storage_path, title, alt_text, tags, mime_type, byte_size, is_active, featured_on),
      update (title, alt_text, tags, is_active, featured_on),
      delete
  on public.images to authenticated;

drop policy if exists "Released library images are public" on public.images;
create policy "Released library images are public"
  on public.images for select
  to anon, authenticated
  using (
    is_active
    and (featured_on is null or featured_on <= (now() at time zone 'America/New_York')::date)
  );
drop policy if exists "Superadmins read all library images" on public.images;
create policy "Superadmins read all library images"
  on public.images for select
  to authenticated
  using (public.is_superadmin());
drop policy if exists "Superadmins add library images" on public.images;
create policy "Superadmins add library images"
  on public.images for insert
  to authenticated
  with check (public.is_superadmin());
drop policy if exists "Superadmins edit library images" on public.images;
create policy "Superadmins edit library images"
  on public.images for update
  to authenticated
  using (public.is_superadmin())
  with check (public.is_superadmin());
drop policy if exists "Superadmins delete library images" on public.images;
create policy "Superadmins delete library images"
  on public.images for delete
  to authenticated
  using (public.is_superadmin());

-- ---------------------------------------------------------------------------
-- Seed data: the pipeline the app already runs, plus two new chains
-- ---------------------------------------------------------------------------
-- Fixed ids so a re-run recognizes its own rows. Nothing here overwrites a
-- row an admin has since edited.

insert into public.llm_providers (id, slug, name, adapter, api_key_env_var, website_url, notes)
values ('5eed0000-0000-4000-8000-000000000001', 'google-gemini', 'Google Gemini API', 'gemini',
        'GEMINI_API_KEY', 'https://ai.google.dev',
        'The provider both apps have used since launch.')
on conflict do nothing;

insert into public.llm_models (id, provider_id, model_key, display_name, supports_vision, temperature, notes)
values ('5eed0000-0000-4000-8000-000000000101', '5eed0000-0000-4000-8000-000000000001',
        'gemini-flash-latest', 'Gemini Flash (latest)', true, 1,
        'The model behind every caption so far.')
on conflict do nothing;

insert into public.prompt_chains (id, slug, name, description) values
  ('5eed0000-0000-4000-8000-000000000201', 'classic', 'Classic one-shot',
   'One call: the photo and the brief go in, four captions come out. The original Morningside Memes prompt.'),
  ('5eed0000-0000-4000-8000-000000000202', 'scene-scan', 'Scene scan → riff',
   'First the model lists what is actually in the photo and where the jokes are, then writes captions from those notes. Aims for more specific captions.'),
  ('5eed0000-0000-4000-8000-000000000203', 'writers-room', 'Writers'' room',
   'Eight quick drafts, then a head-writer pass keeps and sharpens the best four.')
on conflict do nothing;

insert into public.prompt_chain_steps (id, chain_id, position, name, purpose, kind, model_id, include_image, temperature, instructions)
values
  ('5eed0000-0000-4000-8000-000000000301', '5eed0000-0000-4000-8000-000000000201', 1,
   'Write captions', 'Four captions in the chosen voice.', 'caption',
   '5eed0000-0000-4000-8000-000000000101', true, null,
$p$You write captions for photos posted by Columbia University students on a caption-voting app. The funniest captions get upvoted.

Voice: {{voice}}.

{{context}}

{{image_prompt}}

Today's photo prompt is "{{daily_prompt}}". Lean into it if the photo fits, but don't force it.

{{terms}}

{{examples}}

Write 4 different captions for this photo. Each one must be under 140 characters, refer to something actually in the photo, and take a different comedic angle. Be funny, not mean: never mock a real person's appearance. No hashtags. Your captions will compete head-to-head against captions written by real students, so make them sound like something a student would actually post.

Return only a JSON array of 4 strings.$p$),

  ('5eed0000-0000-4000-8000-000000000302', '5eed0000-0000-4000-8000-000000000202', 1,
   'Scan the scene', 'Notes on the specific, joke-worthy details in the photo.', 'analyze',
   '5eed0000-0000-4000-8000-000000000101', true, 0.4,
$p$You are scouting a photo for a comedy writer. The photo was posted by a Columbia University student.

{{context}}

{{image_prompt}}

List the 6 most specific details in this photo that a funny caption could point at (objects, expressions, signs, setting, anything slightly off). Then list 3 comedic angles a college student would recognize. Describe people only by what they are doing, never by how they look.

Plain text, under 150 words. No captions yet.$p$),

  ('5eed0000-0000-4000-8000-000000000303', '5eed0000-0000-4000-8000-000000000202', 2,
   'Riff on the notes', 'Four captions built on the scout''s notes.', 'caption',
   '5eed0000-0000-4000-8000-000000000101', true, null,
$p$You write captions for photos posted by Columbia University students on a caption-voting app. The funniest captions get upvoted.

Voice: {{voice}}.

A scout studied this photo and left these notes:
{{previous}}

Today's photo prompt is "{{daily_prompt}}". Lean into it if the photo fits, but don't force it.

{{terms}}

{{examples}}

Write 4 different captions, each built on a different detail or angle from the notes. Each must be under 140 characters. Be funny, not mean: never mock a real person's appearance. No hashtags. They will compete against captions written by real students, so make them sound like something a student would actually post.

Return only a JSON array of 4 strings.$p$),

  ('5eed0000-0000-4000-8000-000000000304', '5eed0000-0000-4000-8000-000000000203', 1,
   'Rough drafts', 'Eight fast, varied first drafts.', 'caption',
   '5eed0000-0000-4000-8000-000000000101', true, 1.2,
$p$You are in a writers' room captioning a photo posted by a Columbia University student on a caption-voting app.

Voice: {{voice}}.

{{context}}

{{image_prompt}}

Today's photo prompt is "{{daily_prompt}}".

{{terms}}

Pitch 8 rough caption drafts. Go for range: observational, absurd, self-deprecating, a callback to campus life, a one-word punchline. Each under 140 characters, about something actually in the photo. Never mock a real person's appearance. No hashtags.

Return only a JSON array of 8 strings.$p$),

  ('5eed0000-0000-4000-8000-000000000305', '5eed0000-0000-4000-8000-000000000203', 2,
   'Head writer pass', 'Keeps the best four and tightens them.', 'caption',
   '5eed0000-0000-4000-8000-000000000101', true, 0.7,
$p$You are the head writer. Here are 8 rough caption drafts for this photo:
{{previous}}

Voice: {{voice}}.

{{examples}}

Pick the 4 funniest, most specific drafts. Tighten each one: cut filler words, land the punchline at the end, keep it under 140 characters and in the voice above. You may combine two drafts into one. Never mock a real person's appearance. No hashtags.

Return only a JSON array of 4 strings.$p$)
on conflict do nothing;

-- Starts at 100% classic: one model call per post, exactly like before this
-- migration. The two-step chains cost two calls each, which matters on
-- Gemini's free tier (a small daily request quota); turn them on from the
-- AI Studio's mix editor.
insert into public.prompt_chain_mix (chain_id, weight) values
  ('5eed0000-0000-4000-8000-000000000201', 100),
  ('5eed0000-0000-4000-8000-000000000202', 0),
  ('5eed0000-0000-4000-8000-000000000203', 0)
on conflict do nothing;

insert into public.terms (term, definition, category) values
  ('Butler', 'Butler Library, the main library on South Lawn. Packed and open late during midterms and finals.', 'campus'),
  ('Low Steps', 'The wide steps in front of Low Library where everyone sits when it''s sunny.', 'campus'),
  ('Alma Mater', 'The bronze statue on Low Steps. There is supposedly a tiny owl hidden in her robe.', 'campus'),
  ('Lit Hum', 'Literature Humanities, the first-year Core class that assigns a whole epic a week.', 'campus'),
  ('CC', 'Contemporary Civilization, the second-year Core class about political philosophy.', 'campus'),
  ('John Jay', 'John Jay Dining Hall, the all-you-can-eat dining hall.', 'campus'),
  ('JJ''s Place', 'The late-night dining spot in the basement of John Jay.', 'campus'),
  ('Ferris', 'Ferris Booth Commons, the dining hall in Lerner Hall.', 'campus'),
  ('Lerner', 'Lerner Hall, the student center with the glass ramps.', 'campus'),
  ('Carman', 'A first-year dorm known for small rooms and suite-style living.', 'campus'),
  ('Pupin', 'Pupin Hall, the physics building, which has an observatory on the roof.', 'campus'),
  ('the 1 train', 'The subway line that stops at 116th St–Columbia University.', 'nyc'),
  ('bodega', 'A New York corner store, often with a resident cat.', 'nyc'),
  ('Hungarian Pastry Shop', 'The café on Amsterdam Ave where people write theses and never leave.', 'nyc'),
  ('Koronet', 'Koronet Pizza on Broadway, famous for giant slices.', 'nyc'),
  ('it''s giving', 'Slang: "it has the energy of", e.g. "it''s giving finals week".', 'internet'),
  ('main character energy', 'Acting like you''re the protagonist of a movie.', 'internet'),
  ('delulu', 'Short for delusional, usually about overly optimistic plans.', 'internet')
on conflict do nothing;

insert into public.ai_generation_examples (id, vibe, scene, caption) values
  ('5eed0000-0000-4000-8000-000000000401', 'columbia',
   'A student asleep on a pile of books in a library reading room.',
   'Lit Hum said read the Iliad and he took "absorb it through osmosis" literally'),
  ('5eed0000-0000-4000-8000-000000000402', 'newyorker',
   'A rat dragging a slice of pizza down subway stairs.',
   'Rent''s due on the first. He''s just being responsible.'),
  ('5eed0000-0000-4000-8000-000000000403', 'online',
   'A pigeon standing on a coffee shop table next to a latte.',
   'pigeon who has never paid for anything in his life ordering an oat milk latte'),
  ('5eed0000-0000-4000-8000-000000000404', 'midwest',
   'A crowded subway car at rush hour.',
   'Ope, just gonna live here now I guess')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
-- Created after the seed data, so seeding writes nothing to admin_audit_log.

do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('llm_providers', 'llm_provider'),
      ('llm_models', 'llm_model'),
      ('terms', 'term'),
      ('ai_generation_examples', 'ai_example'),
      ('allowed_signup_domains', 'signup_domain'),
      ('whitelisted_emails', 'whitelisted_email'),
      ('signup_settings', 'signup_settings'),
      ('images', 'image')
    ) as v(tbl, target)
  loop
    execute format('drop trigger if exists set_updated_at on public.%I', t.tbl);
    execute format('create trigger set_updated_at before update on public.%I
                    for each row execute function public.set_updated_at()', t.tbl);
    execute format('drop trigger if exists audit_admin_change on public.%I', t.tbl);
    execute format('create trigger audit_admin_change after insert or update or delete on public.%I
                    for each row execute function public.audit_admin_change(%L)', t.tbl, t.target);
  end loop;
end;
$$;

do $$
begin
  execute 'drop trigger if exists set_updated_at on public.prompt_chains';
  execute 'create trigger set_updated_at before update on public.prompt_chains
           for each row execute function public.set_updated_at()';
  execute 'drop trigger if exists set_updated_at on public.prompt_chain_steps';
  execute 'create trigger set_updated_at before update on public.prompt_chain_steps
           for each row execute function public.set_updated_at()';
end;
$$;

drop trigger if exists normalize_access_entry on public.allowed_signup_domains;
create trigger normalize_access_entry
  before insert or update on public.allowed_signup_domains
  for each row execute function public.normalize_access_entry();
drop trigger if exists normalize_access_entry on public.whitelisted_emails;
create trigger normalize_access_entry
  before insert or update on public.whitelisted_emails
  for each row execute function public.normalize_access_entry();

-- ---------------------------------------------------------------------------
-- Caption pipeline functions (called by both apps' servers as the user)
-- ---------------------------------------------------------------------------

-- Chains that can actually run: active, last step writes captions, and every
-- step's model and provider are active and callable.
create or replace function public.runnable_chain_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.id
  from public.prompt_chains c
  where c.is_active
    and exists (select 1 from public.prompt_chain_steps s where s.chain_id = c.id)
    and (select s.kind from public.prompt_chain_steps s
         where s.chain_id = c.id order by s.position desc limit 1) = 'caption'
    and not exists (
      select 1
      from public.prompt_chain_steps s
      join public.llm_models m on m.id = s.model_id
      join public.llm_providers p on p.id = m.provider_id
      where s.chain_id = c.id
        and not (m.is_active and p.is_active and p.adapter = 'gemini'
                 and (m.supports_vision or not s.include_image))
    );
$$;

-- Starts a caption run: picks a chain by the mix (or the one an admin
-- asked for), records the request, and returns everything the app needs to
-- run it. Regular users are limited to 25 runs a day.
create or replace function public.begin_caption_request(
  p_vibe text,
  p_source text default 'main_app',
  p_chain uuid default null,
  p_generation uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_chain public.prompt_chains%rowtype;
  v_request uuid;
  v_categories text[];
begin
  if v_user is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_vibe not in ('midwest', 'online', 'columbia', 'newyorker') then
    raise exception 'invalid_vibe' using errcode = '22023';
  end if;

  if p_source = 'admin' then
    perform public.assert_superadmin();
    if p_generation is not null and not exists (select 1 from public.generations where id = p_generation) then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
  elsif p_source = 'main_app' then
    if p_chain is not null or p_generation is not null then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    if (select count(*) from public.generation_requests
        where user_id = v_user and started_at > now() - interval '24 hours') >= 25 then
      raise exception 'rate_limited' using errcode = '23514';
    end if;
  else
    raise exception 'invalid_source' using errcode = '22023';
  end if;

  if p_chain is not null then
    select * into v_chain from public.prompt_chains
    where id = p_chain and id in (select public.runnable_chain_ids());
  else
    -- Weighted pick over runnable chains with weight > 0; if the mix
    -- leaves nothing runnable, fall back to any runnable chain.
    with eligible as (
      select c.id, c.slug, m.weight
      from public.prompt_chains c
      join public.prompt_chain_mix m on m.chain_id = c.id
      where m.weight > 0 and c.id in (select public.runnable_chain_ids())
    ),
    ranked as (
      select id, sum(weight) over (order by slug) as upto, sum(weight) over () as total
      from eligible
    ),
    roll as (select random() as r)
    select c.* into v_chain
    from ranked, roll, public.prompt_chains c
    where c.id = ranked.id and ranked.upto > roll.r * ranked.total
    order by ranked.upto
    limit 1;

    if not found then
      select * into v_chain from public.prompt_chains
      where id in (select public.runnable_chain_ids())
      order by slug = 'classic' desc, slug
      limit 1;
    end if;
  end if;

  if v_chain.id is null then
    raise exception 'no_chain_available' using errcode = 'P0002';
  end if;

  insert into public.generation_requests (user_id, source, chain_id, chain_slug, vibe, generation_id)
  values (v_user, p_source, v_chain.id, v_chain.slug, p_vibe, p_generation)
  returning id into v_request;

  v_categories := case p_vibe
    when 'columbia' then array['campus', 'general']
    when 'newyorker' then array['nyc', 'general']
    when 'online' then array['internet', 'general']
    else array['campus', 'nyc', 'general']
  end;

  return jsonb_build_object(
    'request_id', v_request,
    'chain', jsonb_build_object('id', v_chain.id, 'slug', v_chain.slug, 'name', v_chain.name),
    'steps', (
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'position', s.position, 'name', s.name, 'kind', s.kind,
        'include_image', s.include_image, 'instructions', s.instructions,
        'temperature', coalesce(s.temperature, m.temperature),
        'max_output_tokens', m.max_output_tokens,
        'model_key', m.model_key, 'api_key_env_var', p.api_key_env_var
      ) order by s.position)
      from public.prompt_chain_steps s
      join public.llm_models m on m.id = s.model_id
      join public.llm_providers p on p.id = m.provider_id
      where s.chain_id = v_chain.id
    ),
    'terms', coalesce((
      select jsonb_agg(jsonb_build_object('term', t.term, 'definition', t.definition))
      from (select term, definition from public.terms
            where is_active and category = any (v_categories)
            order by random() limit 20) t
    ), '[]'::jsonb),
    'examples', coalesce((
      select jsonb_agg(jsonb_build_object('scene', e.scene, 'caption', e.caption))
      from (select scene, caption from public.ai_generation_examples
            where is_active and (vibe is null or vibe = p_vibe)
            order by vibe is null, random() limit 4) e
    ), '[]'::jsonb)
  );
end;
$$;

-- Records one model call for a run the caller started. The model and
-- provider are taken from the step, not from the caller.
create or replace function public.log_llm_response(
  p_request uuid,
  p_step uuid,
  p_prompt text,
  p_response text,
  p_status text,
  p_http_status integer default null,
  p_error text default null,
  p_latency_ms integer default null,
  p_input_tokens integer default null,
  p_output_tokens integer default null
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_req public.generation_requests%rowtype;
begin
  select * into v_req from public.generation_requests where id = p_request;
  if not found or v_req.user_id is distinct from auth.uid() or auth.uid() is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_req.status <> 'running' or v_req.started_at < now() - interval '15 minutes' then
    raise exception 'request_closed' using errcode = '23514';
  end if;
  if (select count(*) from public.llm_responses where request_id = p_request) >= 12 then
    raise exception 'too_many_responses' using errcode = '23514';
  end if;
  if p_status not in ('ok', 'error') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  insert into public.llm_responses (
    request_id, step_id, step_position, step_name, model_id, model_key, provider_slug,
    prompt_text, response_text, status, http_status, error_message, latency_ms,
    input_tokens, output_tokens
  )
  select p_request, s.id, s.position, s.name, m.id, m.model_key, p.slug,
         left(coalesce(p_prompt, ''), 20000), left(p_response, 20000), p_status,
         p_http_status, left(p_error, 500), greatest(p_latency_ms, 0),
         greatest(p_input_tokens, 0), greatest(p_output_tokens, 0)
  from public.prompt_chain_steps s
  join public.llm_models m on m.id = s.model_id
  join public.llm_providers p on p.id = m.provider_id
  where s.id = p_step and s.chain_id = v_req.chain_id;

  if not found then
    raise exception 'invalid_step' using errcode = '22023';
  end if;
end;
$$;

-- Closes a run. On success, links the AI captions written for this run so
-- the dashboard can score each chain by how its captions do in votes.
create or replace function public.finish_caption_request(
  p_request uuid,
  p_succeeded boolean,
  p_error text default null,
  p_generation uuid default null
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_req public.generation_requests%rowtype;
  v_gen uuid;
begin
  select * into v_req from public.generation_requests where id = p_request for update;
  if not found or v_req.user_id is distinct from auth.uid() or auth.uid() is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_req.status <> 'running' then
    return;
  end if;

  v_gen := coalesce(v_req.generation_id, p_generation);
  if p_succeeded then
    if v_gen is null or not exists (
      select 1 from public.generations g
      where g.id = v_gen and (g.user_id = auth.uid() or v_req.source = 'admin')
    ) then
      raise exception 'invalid_generation' using errcode = '22023';
    end if;
  end if;

  update public.generation_requests r
  set status = case when p_succeeded then 'succeeded' else 'failed' end,
      finished_at = now(),
      error_message = case when p_succeeded then null else left(coalesce(p_error, 'unknown error'), 500) end,
      generation_id = case when p_succeeded then v_gen else r.generation_id end,
      caption_ids = case when p_succeeded then coalesce((
        select array_agg(c.id order by c.created_at)
        from public.captions c
        where c.generation_id = v_gen
          and c.author_type = 'ai'
          and c.created_at >= v_req.started_at
          and not exists (select 1 from public.generation_requests o
                          where o.id <> r.id and c.id = any (o.caption_ids))
      ), '{}') else '{}' end
  where r.id = p_request;
end;
$$;

-- ---------------------------------------------------------------------------
-- Public battle result for finished challenge days
-- ---------------------------------------------------------------------------
-- Same rules as battle_scoreboard(), for one photo. Like daily_winner(), it
-- only answers once the photo's challenge day is over, so it never gives
-- away who wrote which caption while voting is open.
create or replace function public.battle_result(p_generation uuid)
returns table (winner text, best_human integer, best_ai integer, human_captions integer, ai_captions integer)
language sql
stable
security definer
set search_path = public
as $$
  with s as (
    select
      max(c.score) filter (where c.author_type = 'human') as best_human,
      max(c.score) filter (where c.author_type = 'ai') as best_ai,
      (count(*) filter (where c.author_type = 'human'))::integer as humans,
      (count(*) filter (where c.author_type = 'ai'))::integer as ais
    from public.captions c
    join public.generations g on g.id = c.generation_id
    where g.id = p_generation
      and g.challenge_date < (now() at time zone 'America/New_York')::date
    having count(*) > 0
  )
  select
    case
      when humans = 0 then 'no_contest'
      when best_human > 0 and best_human > coalesce(best_ai, 0) then 'human'
      when best_ai > 0 and best_ai > best_human then 'ai'
      else 'tie'
    end,
    best_human, best_ai, humans, ais
  from s;
$$;

-- ---------------------------------------------------------------------------
-- Admin functions
-- ---------------------------------------------------------------------------

-- Sets the whole mix at once. p_weights is {"<chain id>": <0-100>, ...}
-- and must cover every chain and add up to exactly 100.
create or replace function public.admin_update_chain_mix(p_weights jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_old jsonb;
  v_total integer := 0;
  v_key text;
  v_value jsonb;
begin
  perform public.assert_superadmin();

  if jsonb_typeof(p_weights) <> 'object' then
    raise exception 'invalid_mix' using errcode = '22023';
  end if;
  for v_key, v_value in select * from jsonb_each(p_weights) loop
    if jsonb_typeof(v_value) <> 'number' or (v_value::text)::numeric <> trunc((v_value::text)::numeric)
       or (v_value::text)::integer not between 0 and 100
       or v_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or not exists (select 1 from public.prompt_chains where id = v_key::uuid) then
      raise exception 'invalid_mix' using errcode = '22023';
    end if;
    v_total := v_total + (v_value::text)::integer;
  end loop;
  if v_total <> 100
     or exists (select 1 from public.prompt_chains c where not p_weights ? c.id::text) then
    raise exception 'mix_must_total_100' using errcode = '22023';
  end if;
  -- Weight can only go to chains that can run.
  if exists (
    select 1 from jsonb_each(p_weights) w
    where (w.value::text)::integer > 0
      and w.key::uuid not in (select public.runnable_chain_ids())
  ) then
    raise exception 'chain_not_runnable' using errcode = '22023';
  end if;

  select coalesce(jsonb_object_agg(chain_id, weight), '{}'::jsonb) into v_old from public.prompt_chain_mix;

  insert into public.prompt_chain_mix (chain_id, weight, updated_at, updated_by)
  select w.key::uuid, (w.value::text)::smallint, now(), auth.uid()
  from jsonb_each(p_weights) w
  on conflict (chain_id) do update
    set weight = excluded.weight, updated_at = excluded.updated_at, updated_by = excluded.updated_by
    where prompt_chain_mix.weight is distinct from excluded.weight;

  perform public.admin_log('update_chain_mix', 'prompt_chain_mix', null,
    jsonb_build_object('old', v_old, 'new', p_weights));
end;
$$;

-- Chains with their steps, models, mix weight, runnability, and how each
-- chain's captions have done.
create or replace function public.admin_list_prompt_chains()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  perform public.assert_superadmin();

  select coalesce(jsonb_agg(x order by x.slug), '[]'::jsonb) into v_result from (
    select
      c.id, c.slug, c.name, c.description, c.is_active, c.created_at, c.updated_at,
      coalesce(mx.weight, 0) as weight,
      c.id in (select public.runnable_chain_ids()) as runnable,
      (select coalesce(jsonb_agg(jsonb_build_object(
          'id', s.id, 'position', s.position, 'name', s.name, 'purpose', s.purpose, 'kind', s.kind,
          'include_image', s.include_image, 'temperature', s.temperature, 'instructions', s.instructions,
          'model_id', m.id, 'model_key', m.model_key, 'model_name', m.display_name,
          'model_active', m.is_active, 'model_temperature', m.temperature,
          'provider_name', p.name, 'provider_active', p.is_active, 'provider_adapter', p.adapter
        ) order by s.position), '[]'::jsonb)
       from public.prompt_chain_steps s
       join public.llm_models m on m.id = s.model_id
       join public.llm_providers p on p.id = m.provider_id
       where s.chain_id = c.id) as steps,
      (select jsonb_build_object(
          'requests', count(*),
          'succeeded', count(*) filter (where r.status = 'succeeded'),
          'failed', count(*) filter (where r.status = 'failed'),
          'avg_seconds', round(avg(extract(epoch from r.finished_at - r.started_at))
                               filter (where r.status = 'succeeded')::numeric, 1),
          'last_run', max(r.started_at)
        ) from public.generation_requests r where r.chain_id = c.id) as runs,
      (select jsonb_build_object(
          'captions', count(*),
          'voted', count(*) filter (where cap.upvotes + cap.downvotes > 0),
          'avg_score', round(avg(cap.score) filter (where cap.upvotes + cap.downvotes > 0), 2),
          'upvotes', coalesce(sum(cap.upvotes), 0),
          'downvotes', coalesce(sum(cap.downvotes), 0)
        )
       from public.generation_requests r
       join public.captions cap on cap.id = any (r.caption_ids)
       where r.chain_id = c.id) as caption_stats,
      (select jsonb_build_object(
          'battles', count(*),
          'ai_wins', count(*) filter (where b.best_ai > 0 and b.best_ai > b.best_human),
          'human_wins', count(*) filter (where b.best_human > 0 and b.best_human > coalesce(b.best_ai, 0))
        )
       from (
         select g.id,
                max(cap.score) filter (where cap.author_type = 'human') as best_human,
                max(cap.score) filter (where cap.author_type = 'ai') as best_ai
         from public.generations g
         join public.captions cap on cap.generation_id = g.id
         where g.id in (select r.generation_id from public.generation_requests r
                        where r.chain_id = c.id and r.status = 'succeeded' and r.source = 'main_app')
         group by g.id
         having count(*) filter (where cap.author_type = 'human') > 0
       ) b) as battles
    from public.prompt_chains c
    left join public.prompt_chain_mix mx on mx.chain_id = c.id
  ) x;

  return v_result;
end;
$$;

create or replace function public.admin_list_generation_requests(
  p_status text default null,
  p_chain uuid default null,
  p_source text default null,
  p_limit integer default 30,
  p_offset integer default 0
)
returns table (
  id uuid,
  status text,
  source text,
  chain_id uuid,
  chain_slug text,
  chain_name text,
  vibe text,
  user_id uuid,
  user_name text,
  generation_id uuid,
  image_path text,
  captions integer,
  calls bigint,
  tokens bigint,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  duration_ms integer,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_superadmin();

  return query
  select
    r.id, r.status, r.source, r.chain_id, r.chain_slug, c.name, r.vibe,
    r.user_id, public.admin_display_name(r.user_id),
    r.generation_id, g.image_path,
    coalesce(array_length(r.caption_ids, 1), 0),
    (select count(*) from public.llm_responses l where l.request_id = r.id),
    (select coalesce(sum(coalesce(l.input_tokens, 0) + coalesce(l.output_tokens, 0)), 0)::bigint
       from public.llm_responses l where l.request_id = r.id),
    r.error_message, r.started_at, r.finished_at,
    (extract(epoch from r.finished_at - r.started_at) * 1000)::integer,
    count(*) over ()
  from public.generation_requests r
  left join public.prompt_chains c on c.id = r.chain_id
  left join public.generations g on g.id = r.generation_id
  where (p_status is null or r.status = p_status)
    and (p_chain is null or r.chain_id = p_chain)
    and (p_source is null or r.source = p_source)
  order by r.started_at desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

create or replace function public.admin_get_generation_request(p_request uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  perform public.assert_superadmin();

  select jsonb_build_object(
    'id', r.id, 'status', r.status, 'source', r.source, 'vibe', r.vibe,
    'chain_id', r.chain_id, 'chain_slug', r.chain_slug, 'chain_name', c.name,
    'user_id', r.user_id, 'user_name', public.admin_display_name(r.user_id),
    'generation_id', r.generation_id, 'image_path', g.image_path,
    'error_message', r.error_message, 'started_at', r.started_at, 'finished_at', r.finished_at,
    'captions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', cap.id, 'text', cap.text, 'score', cap.score,
        'upvotes', cap.upvotes, 'downvotes', cap.downvotes) order by cap.created_at), '[]'::jsonb)
      from public.captions cap where cap.id = any (r.caption_ids)
    ),
    'responses', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', l.id, 'step_position', l.step_position, 'step_name', l.step_name,
        'model_key', l.model_key, 'provider_slug', l.provider_slug,
        'prompt_text', l.prompt_text, 'response_text', l.response_text,
        'status', l.status, 'http_status', l.http_status, 'error_message', l.error_message,
        'latency_ms', l.latency_ms, 'input_tokens', l.input_tokens, 'output_tokens', l.output_tokens,
        'created_at', l.created_at) order by l.created_at), '[]'::jsonb)
      from public.llm_responses l where l.request_id = r.id
    )
  )
  into v_result
  from public.generation_requests r
  left join public.prompt_chains c on c.id = r.chain_id
  left join public.generations g on g.id = r.generation_id
  where r.id = p_request;

  return v_result;
end;
$$;

create or replace function public.admin_list_llm_responses(
  p_status text default null,
  p_model text default null,
  p_search text default null,
  p_limit integer default 30,
  p_offset integer default 0
)
returns table (
  id uuid,
  request_id uuid,
  step_position smallint,
  step_name text,
  model_key text,
  provider_slug text,
  chain_slug text,
  status text,
  http_status integer,
  error_message text,
  latency_ms integer,
  input_tokens integer,
  output_tokens integer,
  prompt_preview text,
  response_text text,
  created_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
begin
  perform public.assert_superadmin();

  return query
  select
    l.id, l.request_id, l.step_position, l.step_name, l.model_key, l.provider_slug, r.chain_slug,
    l.status, l.http_status, l.error_message, l.latency_ms, l.input_tokens, l.output_tokens,
    left(l.prompt_text, 280), left(l.response_text, 2000), l.created_at,
    count(*) over ()
  from public.llm_responses l
  join public.generation_requests r on r.id = l.request_id
  where (p_status is null or l.status = p_status)
    and (p_model is null or l.model_key = p_model)
    and (v_search is null or l.response_text ilike '%' || v_search || '%'
         or l.prompt_text ilike '%' || v_search || '%')
  order by l.created_at desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- Usage and health of the AI pipeline over the last p_days New York days.
create or replace function public.admin_ai_stats(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 365);
  v_today date := (now() at time zone 'America/New_York')::date;
  v_start date := v_today - (v_days - 1);
  v_result jsonb;
begin
  perform public.assert_superadmin();

  with req as (
    select r.*, (r.started_at at time zone 'America/New_York')::date as day
    from public.generation_requests r
    where (r.started_at at time zone 'America/New_York')::date >= v_start
  ),
  resp as (
    select l.* from public.llm_responses l
    where (l.created_at at time zone 'America/New_York')::date >= v_start
  )
  select jsonb_build_object(
    'range_days', v_days,
    'requests', (select count(*) from req),
    'succeeded', (select count(*) from req where status = 'succeeded'),
    'failed', (select count(*) from req where status = 'failed'),
    'running', (select count(*) from req where status = 'running'),
    'calls', (select count(*) from resp),
    'call_errors', (select count(*) from resp where status = 'error'),
    'input_tokens', (select coalesce(sum(input_tokens), 0) from resp),
    'output_tokens', (select coalesce(sum(output_tokens), 0) from resp),
    'avg_latency_ms', (select round(avg(latency_ms)) from resp where status = 'ok'),
    'p95_latency_ms', (select percentile_cont(0.95) within group (order by latency_ms) from resp where status = 'ok'),
    'last_request_at', (select max(started_at) from public.generation_requests),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'day', d.day,
        'succeeded', (select count(*) from req where req.day = d.day and status = 'succeeded'),
        'failed', (select count(*) from req where req.day = d.day and status = 'failed')
      ) order by d.day), '[]'::jsonb)
      from (select g::date as day from generate_series(v_start, v_today, interval '1 day') g) d
    ),
    'models', (
      select coalesce(jsonb_agg(t order by t.calls desc), '[]'::jsonb) from (
        select model_key, count(*) as calls,
               count(*) filter (where status = 'error') as errors,
               round(avg(latency_ms) filter (where status = 'ok')) as avg_latency_ms,
               coalesce(sum(input_tokens), 0) as input_tokens,
               coalesce(sum(output_tokens), 0) as output_tokens
        from resp group by model_key
      ) t
    ),
    'sources', (
      select coalesce(jsonb_object_agg(source, n), '{}'::jsonb)
      from (select source, count(*) as n from req group by source) s
    )
  ) into v_result;

  return v_result;
end;
$$;

-- Media list, now filterable by how the photo was made (upload / ai /
-- library). Replaces the previous signature, which had no p_image_source.
drop function if exists public.admin_list_media(text, uuid, date, date, text, text, integer, integer);
create or replace function public.admin_list_media(
  p_search text default null,
  p_user uuid default null,
  p_from date default null,
  p_to date default null,
  p_caption_type text default null,
  p_sort text default 'newest',
  p_limit integer default 24,
  p_offset integer default 0,
  p_image_source text default null
)
returns table (
  id uuid,
  image_path text,
  image_source text,
  context text,
  vibe text,
  daily_prompt text,
  model text,
  challenge_date date,
  created_at timestamptz,
  owner_id uuid,
  owner_name text,
  ai_captions bigint,
  human_captions bigint,
  votes bigint,
  upvotes bigint,
  best_score integer,
  source_image_id uuid,
  chain_slug text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
begin
  perform public.assert_superadmin();

  return query
  with base as (
    select
      g.id, g.image_path, g.image_source, g.context, g.vibe, g.daily_prompt, g.model,
      g.challenge_date, g.created_at, g.user_id as owner_id,
      public.admin_display_name(g.user_id) as owner_name,
      count(c.id) filter (where c.author_type = 'ai') as ai_captions,
      count(c.id) filter (where c.author_type = 'human') as human_captions,
      coalesce(sum(c.upvotes + c.downvotes), 0)::bigint as votes,
      coalesce(sum(c.upvotes), 0)::bigint as upvotes,
      max(c.score) as best_score,
      g.source_image_id,
      (select r.chain_slug from public.generation_requests r
        where r.generation_id = g.id and r.status = 'succeeded'
        order by r.started_at limit 1) as chain_slug
    from public.generations g
    left join public.captions c on c.generation_id = g.id
    where (p_user is null or g.user_id = p_user)
      and (p_from is null or (g.created_at at time zone 'America/New_York')::date >= p_from)
      and (p_to is null or (g.created_at at time zone 'America/New_York')::date <= p_to)
      and (
        p_image_source is null
        or (p_image_source = 'library' and g.source_image_id is not null)
        or (p_image_source in ('upload', 'ai') and g.image_source = p_image_source)
      )
      and (
        v_search is null
        or g.context ilike '%' || v_search || '%'
        or g.daily_prompt ilike '%' || v_search || '%'
        or g.prompt ilike '%' || v_search || '%'
        or exists (select 1 from public.captions s
                   where s.generation_id = g.id and s.text ilike '%' || v_search || '%')
      )
    group by g.id
  )
  select b.*, count(*) over () as total_count
  from base b
  where p_caption_type is null
     or (p_caption_type = 'human' and b.human_captions > 0)
     or (p_caption_type = 'ai_only' and b.human_captions = 0)
  order by
    case when p_sort = 'popular' then b.votes end desc nulls last,
    case when p_sort = 'score' then b.best_score end desc nulls last,
    case when p_sort = 'oldest' then b.created_at end asc,
    b.created_at desc
  limit least(greatest(coalesce(p_limit, 24), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- How many posts each library image has inspired.
create or replace function public.admin_image_usage()
returns table (image_id uuid, posts bigint, captions bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_superadmin();
  return query
    select g.source_image_id, count(distinct g.id), count(c.id)
    from public.generations g
    left join public.captions c on c.generation_id = g.id
    where g.source_image_id is not null
    group by g.source_image_id;
end;
$$;

-- Turns a real caption into a few-shot example, keeping its photo's voice.
create or replace function public.admin_promote_caption_to_example(p_caption uuid, p_scene text)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_scene text := btrim(regexp_replace(coalesce(p_scene, ''), '\s+', ' ', 'g'));
  v_id uuid;
begin
  perform public.assert_superadmin();
  if char_length(v_scene) not between 3 and 300 then
    raise exception 'invalid_scene' using errcode = '22023';
  end if;

  insert into public.ai_generation_examples (vibe, scene, caption, notes, created_by)
  select g.vibe, v_scene, left(c.text, 200),
         format('From a %s caption scoring %s%s', c.author_type, case when c.score > 0 then '+' else '' end, c.score),
         auth.uid()
  from public.captions c join public.generations g on g.id = c.generation_id
  where c.id = p_caption
  returning id into v_id;

  if v_id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.audit_admin_change() from public, anon, authenticated;
revoke execute on function public.normalize_access_entry() from public, anon, authenticated;
revoke execute on function public.enforce_signup_allowlist() from public, anon, authenticated;
revoke execute on function public.signup_allowed(text) from public, anon, authenticated;
revoke execute on function public.runnable_chain_ids() from public, anon, authenticated;

revoke execute on function public.begin_caption_request(text, text, uuid, uuid) from public, anon;
grant execute on function public.begin_caption_request(text, text, uuid, uuid) to authenticated;
revoke execute on function public.log_llm_response(uuid, uuid, text, text, text, integer, text, integer, integer, integer) from public, anon;
grant execute on function public.log_llm_response(uuid, uuid, text, text, text, integer, text, integer, integer, integer) to authenticated;
revoke execute on function public.finish_caption_request(uuid, boolean, text, uuid) from public, anon;
grant execute on function public.finish_caption_request(uuid, boolean, text, uuid) to authenticated;

grant execute on function public.signup_rules() to anon, authenticated;
grant execute on function public.battle_result(uuid) to anon, authenticated;

do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like 'admin\_%'
      and p.proname not in ('admin_log', 'admin_display_name')
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;

notify pgrst, 'reload schema';

commit;
