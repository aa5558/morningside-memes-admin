-- ROLLBACK for 20261026000000_ai_studio_access_images.sql.
--
-- Only for recovery: run this in the Supabase SQL Editor if you need to undo
-- the AI Studio migration after it was applied. It returns the schema to
-- exactly what 20261019000000_admin_dashboard.sql left (tested on PGlite by
-- `npm run test:db`, which compares the full catalog before and after).
--
-- What it removes: the 13 AI Studio / access / image-library tables and
-- everything in them (run logs, terms, examples, models, providers, signup
-- lists, library image records), generations.source_image_id, the signup
-- trigger on auth.users, the new functions and storage policies.
-- What it keeps: every post, caption, vote, profile and user, and the
-- admin_audit_log entries written while the migration was live.
--
-- If the migration itself failed part-way, you do NOT need this: the
-- migration runs in one transaction, so a failure leaves nothing behind.

begin;

-- Signups: remove the gate first, so new accounts can never be blocked.
drop trigger if exists enforce_signup_allowlist on auth.users;

-- Storage policies for the library bucket.
drop policy if exists "Superadmins can list library images" on storage.objects;
drop policy if exists "Superadmins can upload library images" on storage.objects;
drop policy if exists "Superadmins can replace library images" on storage.objects;
drop policy if exists "Superadmins can delete library images" on storage.objects;

-- Functions added by the migration.
drop function if exists public.begin_caption_request(text, text, uuid, uuid);
drop function if exists public.log_llm_response(uuid, uuid, text, text, text, integer, text, integer, integer, integer);
drop function if exists public.finish_caption_request(uuid, boolean, text, uuid);
drop function if exists public.battle_result(uuid);
drop function if exists public.signup_rules();
drop function if exists public.admin_update_chain_mix(jsonb);
drop function if exists public.admin_list_prompt_chains();
drop function if exists public.admin_list_generation_requests(text, uuid, text, integer, integer);
drop function if exists public.admin_get_generation_request(uuid);
drop function if exists public.admin_list_llm_responses(text, text, text, integer, integer);
drop function if exists public.admin_ai_stats(integer);
drop function if exists public.admin_image_usage();
drop function if exists public.admin_promote_caption_to_example(uuid, text);
drop function if exists public.runnable_chain_ids();

-- admin_list_media back to its previous signature and body.
drop function if exists public.admin_list_media(text, uuid, date, date, text, text, integer, integer, text);
create or replace function public.admin_list_media(
  p_search text default null,
  p_user uuid default null,
  p_from date default null,
  p_to date default null,
  p_caption_type text default null,
  p_sort text default 'newest',
  p_limit integer default 24,
  p_offset integer default 0
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
      max(c.score) as best_score
    from public.generations g
    left join public.captions c on c.generation_id = g.id
    where (p_user is null or g.user_id = p_user)
      and (p_from is null or (g.created_at at time zone 'America/New_York')::date >= p_from)
      and (p_to is null or (g.created_at at time zone 'America/New_York')::date <= p_to)
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
revoke execute on function public.admin_list_media(text, uuid, date, date, text, text, integer, integer) from public, anon;
grant execute on function public.admin_list_media(text, uuid, date, date, text, text, integer, integer) to authenticated;

-- The new column on generations (nullable; nothing else depends on it).
alter table public.generations drop column if exists source_image_id;

-- Tables, children first.
drop table if exists public.llm_responses;
drop table if exists public.generation_requests;
drop table if exists public.prompt_chain_mix;
drop table if exists public.prompt_chain_steps;
drop table if exists public.prompt_chains;
drop table if exists public.llm_models;
drop table if exists public.llm_providers;
drop table if exists public.terms;
drop table if exists public.ai_generation_examples;
drop table if exists public.allowed_signup_domains;
drop table if exists public.whitelisted_emails;
drop table if exists public.signup_settings;
drop table if exists public.images;

-- Trigger functions and helpers (their triggers went with the tables).
drop function if exists public.enforce_signup_allowlist();
drop function if exists public.signup_allowed(text);
drop function if exists public.normalize_access_entry();
drop function if exists public.audit_admin_change();
drop function if exists public.set_updated_at();

-- The empty bucket. Supabase may refuse direct deletes from storage tables;
-- if so, delete the "images" bucket from Dashboard → Storage instead. That
-- doesn't affect the rest of this rollback.
do $$
begin
  if not exists (select 1 from storage.objects where bucket_id = 'images') then
    delete from storage.buckets where id = 'images';
  else
    raise notice 'The images bucket still has files: empty and delete it from Dashboard -> Storage.';
  end if;
exception when others then
  raise notice 'Could not delete the images bucket here (%): delete it from Dashboard -> Storage.', sqlerrm;
end;
$$;

notify pgrst, 'reload schema';

commit;
