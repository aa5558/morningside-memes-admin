-- Morningside Memes Admin: superadmin flag, admin audit log, and the
-- admin-only functions the dashboard reads and writes through.
--
-- Run this once in the Supabase SQL Editor, after the three migrations in
-- the hello-world-nextjs repo. Safe to re-run. No existing rows, policies, or
-- grants for ordinary users are changed, except that profile UPDATEs are now
-- limited to the columns the main app actually edits.
--
-- Security model
-- --------------
-- The admin app uses the same anon key and Google session as the main app.
-- It never gets a service-role key. Every admin capability is a
-- SECURITY DEFINER function below that starts with assert_superadmin(), which
-- looks up profiles.is_superadmin for auth.uid() (taken from the caller's own
-- signed JWT). A regular user calling these functions directly through the
-- REST API gets "forbidden", and anon can't call them at all.
--
-- Functions are used instead of "admin can select" RLS policies because
-- caption authorship is hidden with column grants on the whole
-- `authenticated` role; a policy can't re-grant those columns to one user.

begin;

-- ---------------------------------------------------------------------------
-- profiles.is_superadmin
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists is_superadmin boolean not null default false;

-- Users could previously UPDATE any column of their own profile. Limit that
-- to the columns the main app edits, so nobody can set their own
-- is_superadmin (or spoof updated_at) through the API.
revoke update on public.profiles from anon, authenticated;
grant update (first_name, last_name, avatar_url) on public.profiles to authenticated;
revoke insert on public.profiles from anon, authenticated;

-- Belt and braces: even if a future grant re-opens the column, API roles
-- still can't change the flag. Only the SQL Editor (postgres) can.
create or replace function public.protect_superadmin_flag()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' and new.is_superadmin then
      raise exception 'is_superadmin can only be set by a database administrator'
        using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and new.is_superadmin is distinct from old.is_superadmin then
      raise exception 'is_superadmin can only be set by a database administrator'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_superadmin_flag on public.profiles;
create trigger protect_superadmin_flag
  before insert or update on public.profiles
  for each row execute function public.protect_superadmin_flag();

-- True when the signed-in caller is a superadmin. Security definer so it can
-- be used inside policies without recursing into profiles RLS.
create or replace function public.is_superadmin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.is_superadmin from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

create or replace function public.assert_superadmin()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if not public.is_superadmin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin-only tables
-- ---------------------------------------------------------------------------

-- Every admin change, with the before/after values, so edits to other
-- people's content stay traceable. RLS on with no policies: only the admin
-- functions below can read or write it.
create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  admin_id uuid references auth.users (id) on delete set null,
  action text not null,
  target_type text not null,
  target_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_log_created_at_idx
  on public.admin_audit_log (created_at desc);
alter table public.admin_audit_log enable row level security;
revoke all on public.admin_audit_log from anon, authenticated;

-- The prompt and model behind captions an admin generated for an existing
-- photo. (Captions written when the photo was posted use generations.prompt.)
create table if not exists public.caption_prompts (
  caption_id uuid primary key references public.captions (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  model text not null,
  prompt text not null,
  created_at timestamptz not null default now()
);
alter table public.caption_prompts enable row level security;
revoke all on public.caption_prompts from anon, authenticated;

create or replace function public.admin_log(
  p_action text,
  p_target_type text,
  p_target_id uuid,
  p_details jsonb
)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  insert into public.admin_audit_log (admin_id, action, target_type, target_id, details)
  values (auth.uid(), p_action, p_target_type, p_target_id, coalesce(p_details, '{}'::jsonb));
$$;

-- ---------------------------------------------------------------------------
-- Storage: superadmins may delete photos of posts they remove
-- ---------------------------------------------------------------------------

drop policy if exists "Superadmins can delete generation images" on storage.objects;
create policy "Superadmins can delete generation images"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'generations' and public.is_superadmin());

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.admin_display_name(p_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
    split_part(u.email, '@', 1),
    'Unknown user'
  )
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.id = p_user;
$$;

-- ---------------------------------------------------------------------------
-- Dashboard statistics (read-only)
-- ---------------------------------------------------------------------------
-- Days are New York calendar days, matching the main app's daily challenge.

create or replace function public.admin_dashboard_stats(p_days integer default 30)
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

  with
  days as (
    select d::date as day from generate_series(v_start, v_today, interval '1 day') d
  ),
  cap as (
    select c.*, g.user_id as owner_id
    from public.captions c join public.generations g on g.id = c.generation_id
  ),
  activity as (
    select user_id, (created_at at time zone 'America/New_York')::date as day
      from public.generations
    union all
    select user_id, (created_at at time zone 'America/New_York')::date
      from public.captions where author_type = 'human'
    union all
    select user_id, (created_at at time zone 'America/New_York')::date
      from public.caption_votes
    union all
    select user_id, (updated_at at time zone 'America/New_York')::date
      from public.caption_votes
  ),
  per_photo as (
    select generation_id,
      max(score) filter (where author_type = 'human') as best_human,
      max(score) filter (where author_type = 'ai') as best_ai
    from public.captions
    group by generation_id
    having count(*) filter (where author_type = 'human') > 0
  )
  select jsonb_build_object(
    'range_days', v_days,
    'range_start', v_start,
    'today', v_today,
    'totals', jsonb_build_object(
      'users', (select count(*) from auth.users),
      'photos', (select count(*) from public.generations),
      'ai_captions', (select count(*) from public.captions where author_type = 'ai'),
      'human_captions', (select count(*) from public.captions where author_type = 'human'),
      'votes', (select count(*) from public.caption_votes),
      'upvotes', (select count(*) from public.caption_votes where vote = 1),
      'downvotes', (select count(*) from public.caption_votes where vote = -1),
      'superadmins', (select count(*) from public.profiles where is_superadmin)
    ),
    'period', jsonb_build_object(
      'new_users', (select count(*) from auth.users
                    where (created_at at time zone 'America/New_York')::date >= v_start),
      'photos', (select count(*) from public.generations
                 where (created_at at time zone 'America/New_York')::date >= v_start),
      'human_captions', (select count(*) from public.captions
                         where author_type = 'human'
                           and (created_at at time zone 'America/New_York')::date >= v_start),
      'votes', (select count(*) from public.caption_votes
                where (created_at at time zone 'America/New_York')::date >= v_start),
      'active_users', (select count(distinct user_id) from activity where day >= v_start)
    ),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'day', d.day,
        'active_users', (select count(distinct a.user_id) from activity a where a.day = d.day),
        'new_users', (select count(*) from auth.users u
                      where (u.created_at at time zone 'America/New_York')::date = d.day),
        'photos', (select count(*) from public.generations g
                   where (g.created_at at time zone 'America/New_York')::date = d.day),
        'human_captions', (select count(*) from public.captions c
                           where c.author_type = 'human'
                             and (c.created_at at time zone 'America/New_York')::date = d.day),
        'upvotes', (select count(*) from public.caption_votes v
                    where v.vote = 1 and (v.created_at at time zone 'America/New_York')::date = d.day),
        'downvotes', (select count(*) from public.caption_votes v
                      where v.vote = -1 and (v.created_at at time zone 'America/New_York')::date = d.day)
      ) order by d.day), '[]'::jsonb)
      from days d
    ),
    'human_vs_ai', (
      select jsonb_build_object(
        'human_votes', coalesce(sum(upvotes + downvotes) filter (where author_type = 'human'), 0),
        'ai_votes', coalesce(sum(upvotes + downvotes) filter (where author_type = 'ai'), 0),
        'human_upvotes', coalesce(sum(upvotes) filter (where author_type = 'human'), 0),
        'ai_upvotes', coalesce(sum(upvotes) filter (where author_type = 'ai'), 0),
        'human_avg_score', round(avg(score) filter (where author_type = 'human'), 2),
        'ai_avg_score', round(avg(score) filter (where author_type = 'ai'), 2),
        'human_avg_score_voted', round(avg(score) filter (where author_type = 'human' and upvotes + downvotes > 0), 2),
        'ai_avg_score_voted', round(avg(score) filter (where author_type = 'ai' and upvotes + downvotes > 0), 2),
        'battles', (select count(*) from per_photo),
        'human_wins', (select count(*) from per_photo
                       where best_human > 0 and best_human > coalesce(best_ai, 0)),
        'ai_wins', (select count(*) from per_photo
                    where best_ai > 0 and best_ai > best_human)
      )
      from public.captions
    ),
    'top_captions', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select c.id, c.text, c.author_type, c.score, c.upvotes, c.downvotes,
               c.generation_id, g.image_path,
               case when c.author_type = 'human' then public.admin_display_name(c.user_id) end as author_name
        from public.captions c join public.generations g on g.id = c.generation_id
        where c.upvotes + c.downvotes > 0
        order by c.score desc, c.upvotes desc, c.created_at asc
        limit 8
      ) t
    ),
    'top_human_captions', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select c.id, c.text, c.score, c.upvotes, c.downvotes, c.generation_id, g.image_path,
               public.admin_display_name(c.user_id) as author_name
        from public.captions c join public.generations g on g.id = c.generation_id
        where c.author_type = 'human' and c.upvotes + c.downvotes > 0
        order by c.score desc, c.upvotes desc, c.created_at asc
        limit 5
      ) t
    ),
    'top_ai_captions', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select c.id, c.text, c.score, c.upvotes, c.downvotes, c.generation_id, g.image_path,
               g.vibe
        from public.captions c join public.generations g on g.id = c.generation_id
        where c.author_type = 'ai' and c.upvotes + c.downvotes > 0
        order by c.score desc, c.upvotes desc, c.created_at asc
        limit 5
      ) t
    ),
    'popular_posts', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select g.id, g.image_path, g.context, g.daily_prompt, g.created_at,
               public.admin_display_name(g.user_id) as owner_name,
               count(c.id) as captions,
               coalesce(sum(c.upvotes + c.downvotes), 0) as votes,
               coalesce(sum(c.upvotes), 0) as upvotes
        from public.generations g
        left join public.captions c on c.generation_id = g.id
        group by g.id
        having coalesce(sum(c.upvotes + c.downvotes), 0) > 0
        order by votes desc, upvotes desc, g.created_at desc
        limit 6
      ) t
    ),
    'active_users', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select * from (
          select u.id, public.admin_display_name(u.id) as name, p.avatar_url, u.created_at,
                 (select count(*) from public.generations g where g.user_id = u.id) as photos,
                 (select count(*) from public.captions c
                   where c.user_id = u.id and c.author_type = 'human') as captions,
                 (select count(*) from public.caption_votes v where v.user_id = u.id) as votes
          from auth.users u
          left join public.profiles p on p.id = u.id
        ) counted
        where photos + captions + votes > 0
        order by photos + captions + votes desc, created_at asc
        limit 8
      ) t
    ),
    'recent_activity', (
      select coalesce(jsonb_agg(t order by t.happened_at desc), '[]'::jsonb) from (
        (select 'photo' as kind, g.created_at as happened_at, public.admin_display_name(g.user_id) as who,
                coalesce(g.context, g.daily_prompt) as what, g.id as generation_id
         from public.generations g order by g.created_at desc limit 8)
        union all
        (select 'caption', c.created_at, public.admin_display_name(c.user_id), c.text, c.generation_id
         from public.captions c where c.author_type = 'human' order by c.created_at desc limit 8)
        union all
        (select case when v.vote = 1 then 'upvote' else 'downvote' end, v.updated_at,
                public.admin_display_name(v.user_id), c.text, c.generation_id
         from public.caption_votes v join public.captions c on c.id = v.caption_id
         order by v.updated_at desc limit 8)
        order by happened_at desc
        limit 12
      ) t
    )
  ) into v_result;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Users (read-only)
-- ---------------------------------------------------------------------------

create or replace function public.admin_list_users(
  p_search text default null,
  p_sort text default 'joined',
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  id uuid,
  first_name text,
  last_name text,
  display_name text,
  email text,
  avatar_url text,
  is_superadmin boolean,
  joined_at timestamptz,
  last_sign_in_at timestamptz,
  photos bigint,
  human_captions bigint,
  votes_cast bigint,
  upvotes_cast bigint,
  downvotes_cast bigint,
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
      u.id,
      p.first_name,
      p.last_name,
      public.admin_display_name(u.id) as display_name,
      u.email::text as email,
      p.avatar_url,
      coalesce(p.is_superadmin, false) as is_superadmin,
      u.created_at as joined_at,
      u.last_sign_in_at,
      (select count(*) from public.generations g where g.user_id = u.id) as photos,
      (select count(*) from public.captions c where c.user_id = u.id and c.author_type = 'human') as human_captions,
      (select count(*) from public.caption_votes v where v.user_id = u.id) as votes_cast,
      (select count(*) from public.caption_votes v where v.user_id = u.id and v.vote = 1) as upvotes_cast,
      (select count(*) from public.caption_votes v where v.user_id = u.id and v.vote = -1) as downvotes_cast
    from auth.users u
    left join public.profiles p on p.id = u.id
    where v_search is null
       or concat_ws(' ', p.first_name, p.last_name) ilike '%' || v_search || '%'
       or u.email ilike '%' || v_search || '%'
  )
  select b.*, count(*) over () as total_count
  from base b
  order by
    case when p_sort = 'name' then lower(b.display_name) end asc nulls last,
    case when p_sort = 'activity' then b.photos + b.human_captions + b.votes_cast end desc nulls last,
    case when p_sort = 'last_seen' then b.last_sign_in_at end desc nulls last,
    b.joined_at desc
  limit least(greatest(coalesce(p_limit, 25), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

create or replace function public.admin_get_user(p_user uuid)
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
    'id', u.id,
    'first_name', p.first_name,
    'last_name', p.last_name,
    'display_name', public.admin_display_name(u.id),
    'email', u.email,
    'avatar_url', p.avatar_url,
    'is_superadmin', coalesce(p.is_superadmin, false),
    'joined_at', u.created_at,
    'last_sign_in_at', u.last_sign_in_at,
    'provider', u.raw_app_meta_data ->> 'provider',
    'stats', jsonb_build_object(
      'photos', (select count(*) from public.generations g where g.user_id = u.id),
      'human_captions', (select count(*) from public.captions c where c.user_id = u.id and c.author_type = 'human'),
      'human_caption_score', (select coalesce(sum(c.score), 0) from public.captions c where c.user_id = u.id and c.author_type = 'human'),
      'votes_cast', (select count(*) from public.caption_votes v where v.user_id = u.id),
      'upvotes_cast', (select count(*) from public.caption_votes v where v.user_id = u.id and v.vote = 1),
      'downvotes_cast', (select count(*) from public.caption_votes v where v.user_id = u.id and v.vote = -1),
      'votes_received', (select coalesce(sum(c.upvotes + c.downvotes), 0) from public.captions c
                         where c.user_id = u.id and c.author_type = 'human')
    ),
    'photos', (
      select coalesce(jsonb_agg(t order by t.created_at desc), '[]'::jsonb) from (
        select g.id, g.image_path, g.context, g.daily_prompt, g.created_at,
               (select count(*) from public.captions c where c.generation_id = g.id) as captions,
               (select coalesce(sum(c.upvotes + c.downvotes), 0) from public.captions c where c.generation_id = g.id) as votes
        from public.generations g where g.user_id = u.id
        order by g.created_at desc limit 24
      ) t
    ),
    'captions', (
      select coalesce(jsonb_agg(t order by t.created_at desc), '[]'::jsonb) from (
        select c.id, c.text, c.score, c.upvotes, c.downvotes, c.created_at, c.generation_id
        from public.captions c where c.user_id = u.id and c.author_type = 'human'
        order by c.created_at desc limit 50
      ) t
    ),
    'votes', (
      select coalesce(jsonb_agg(t order by t.updated_at desc), '[]'::jsonb) from (
        select v.caption_id, v.vote, v.created_at, v.updated_at, c.text, c.author_type, c.generation_id
        from public.caption_votes v join public.captions c on c.id = v.caption_id
        where v.user_id = u.id
        order by v.updated_at desc limit 50
      ) t
    )
  )
  into v_result
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.id = p_user;

  return v_result;
end;
$$;

-- Lightweight list for filter dropdowns.
create or replace function public.admin_user_options()
returns table (id uuid, display_name text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_superadmin();
  return query
    select u.id, public.admin_display_name(u.id)
    from auth.users u
    order by 2;
end;
$$;

-- ---------------------------------------------------------------------------
-- Media (photos + captions)
-- ---------------------------------------------------------------------------

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

create or replace function public.admin_list_captions(
  p_search text default null,
  p_user uuid default null,
  p_from date default null,
  p_to date default null,
  p_author_type text default null,
  p_sort text default 'newest',
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  generation_id uuid,
  text text,
  author_type text,
  author_id uuid,
  author_name text,
  upvotes integer,
  downvotes integer,
  score integer,
  created_at timestamptz,
  image_path text,
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
    c.id, c.generation_id, c.text, c.author_type, c.user_id,
    public.admin_display_name(c.user_id),
    c.upvotes, c.downvotes, c.score, c.created_at, g.image_path,
    count(*) over ()
  from public.captions c
  join public.generations g on g.id = c.generation_id
  where (p_author_type is null or c.author_type = p_author_type)
    -- "user" means the caption's author for human captions, and the photo's
    -- poster for AI captions.
    and (p_user is null or c.user_id = p_user)
    and (p_from is null or (c.created_at at time zone 'America/New_York')::date >= p_from)
    and (p_to is null or (c.created_at at time zone 'America/New_York')::date <= p_to)
    and (v_search is null or c.text ilike '%' || v_search || '%')
  order by
    case when p_sort = 'score' then c.score end desc nulls last,
    case when p_sort = 'lowest' then c.score end asc nulls last,
    case when p_sort = 'popular' then c.upvotes + c.downvotes end desc nulls last,
    case when p_sort = 'oldest' then c.created_at end asc,
    c.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

create or replace function public.admin_get_media(p_generation uuid)
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
    'id', g.id,
    'image_path', g.image_path,
    'image_source', g.image_source,
    'image_prompt', g.image_prompt,
    'context', g.context,
    'vibe', g.vibe,
    'daily_prompt', g.daily_prompt,
    'challenge_date', g.challenge_date,
    'model', g.model,
    'prompt', g.prompt,
    'created_at', g.created_at,
    'owner_id', g.user_id,
    'owner_name', public.admin_display_name(g.user_id),
    'captions', (
      select coalesce(jsonb_agg(t order by t.author_type, t.score desc, t.created_at), '[]'::jsonb) from (
        select c.id, c.text, c.author_type, c.user_id as author_id,
               public.admin_display_name(c.user_id) as author_name,
               c.upvotes, c.downvotes, c.score, c.created_at,
               cp.prompt as extra_prompt, cp.model as extra_model,
               public.admin_display_name(cp.created_by) as generated_by
        from public.captions c
        left join public.caption_prompts cp on cp.caption_id = c.id
        where c.generation_id = g.id
      ) t
    ),
    'history', (
      select coalesce(jsonb_agg(t order by t.created_at desc), '[]'::jsonb) from (
        select l.action, l.details, l.created_at, public.admin_display_name(l.admin_id) as admin_name
        from public.admin_audit_log l
        where l.target_id = g.id
           or (l.details ->> 'generation_id')::uuid = g.id
        order by l.created_at desc limit 50
      ) t
    )
  )
  into v_result
  from public.generations g
  where g.id = p_generation;

  return v_result;
end;
$$;

-- Creates a post owned by the calling admin, with its AI captions, in one
-- transaction. The photo must already be uploaded into the admin's own
-- folder (storage policies enforce that too).
create or replace function public.admin_create_generation(
  p_image_path text,
  p_context text,
  p_vibe text,
  p_daily_prompt text,
  p_model text,
  p_prompt text,
  p_captions text[]
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_context text := nullif(btrim(regexp_replace(coalesce(p_context, ''), '\s+', ' ', 'g')), '');
  v_caption text;
  v_count integer := 0;
begin
  perform public.assert_superadmin();

  if p_image_path is null or split_part(p_image_path, '/', 1) <> auth.uid()::text
     or p_image_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|webp)$' then
    raise exception 'invalid_image_path' using errcode = '22023';
  end if;
  if char_length(v_context) > 200 then
    raise exception 'invalid_context' using errcode = '22023';
  end if;
  if p_vibe not in ('midwest', 'online', 'columbia', 'newyorker') then
    raise exception 'invalid_vibe' using errcode = '22023';
  end if;
  if coalesce(array_length(p_captions, 1), 0) not between 1 and 8 then
    raise exception 'invalid_captions' using errcode = '22023';
  end if;

  insert into public.generations
    (user_id, image_path, context, vibe, daily_prompt, model, prompt, image_source)
  values
    (auth.uid(), p_image_path, v_context, p_vibe, p_daily_prompt, p_model, p_prompt, 'upload')
  returning id into v_id;

  foreach v_caption in array p_captions loop
    v_caption := btrim(v_caption);
    if char_length(v_caption) between 1 and 300 then
      insert into public.captions (generation_id, user_id, author_type, text)
      values (v_id, auth.uid(), 'ai', v_caption);
      v_count := v_count + 1;
    end if;
  end loop;

  if v_count = 0 then
    raise exception 'invalid_captions' using errcode = '22023';
  end if;

  perform public.admin_log('create_post', 'generation', v_id,
    jsonb_build_object('image_path', p_image_path, 'model', p_model, 'captions', v_count));

  return v_id;
end;
$$;

-- Adds freshly generated AI captions to any existing photo. The captions
-- keep the photo owner as user_id (as AI captions always have), and the
-- prompt used is saved in caption_prompts.
create or replace function public.admin_add_ai_captions(
  p_generation uuid,
  p_captions text[],
  p_model text,
  p_prompt text
)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_caption text;
  v_caption_id uuid;
  v_ids uuid[] := '{}';
begin
  perform public.assert_superadmin();

  select user_id into v_owner from public.generations where id = p_generation;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if coalesce(array_length(p_captions, 1), 0) not between 1 and 8
     or coalesce(btrim(p_prompt), '') = '' or coalesce(btrim(p_model), '') = '' then
    raise exception 'invalid_captions' using errcode = '22023';
  end if;

  foreach v_caption in array p_captions loop
    v_caption := btrim(v_caption);
    if char_length(v_caption) between 1 and 300
       and not exists (select 1 from public.captions
                       where generation_id = p_generation and lower(text) = lower(v_caption)) then
      insert into public.captions (generation_id, user_id, author_type, text)
      values (p_generation, v_owner, 'ai', v_caption)
      returning id into v_caption_id;
      insert into public.caption_prompts (caption_id, created_by, model, prompt)
      values (v_caption_id, auth.uid(), p_model, p_prompt);
      v_ids := v_ids || v_caption_id;
    end if;
  end loop;

  if coalesce(array_length(v_ids, 1), 0) > 0 then
    perform public.admin_log('add_ai_captions', 'generation', p_generation,
      jsonb_build_object('caption_ids', v_ids, 'model', p_model));
  end if;

  return coalesce(array_length(v_ids, 1), 0);
end;
$$;

-- Edits the text of an AI caption. Human captions belong to their authors and
-- can only be deleted by an admin, not reworded. The old text is kept in the
-- audit log.
create or replace function public.admin_update_caption(p_caption uuid, p_text text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_text text := btrim(regexp_replace(coalesce(p_text, ''), '\s+', ' ', 'g'));
  v_old public.captions%rowtype;
begin
  perform public.assert_superadmin();

  select * into v_old from public.captions where id = p_caption for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_old.author_type <> 'ai' then
    raise exception 'human_caption' using errcode = '42501';
  end if;
  if char_length(v_text) not between 1 and 300 then
    raise exception 'invalid_length' using errcode = '22023';
  end if;
  if v_text = v_old.text then
    return;
  end if;
  if exists (select 1 from public.captions
             where generation_id = v_old.generation_id and id <> p_caption
               and lower(text) = lower(v_text)) then
    raise exception 'duplicate' using errcode = '23505';
  end if;

  update public.captions set text = v_text where id = p_caption;

  perform public.admin_log('edit_caption', 'caption', p_caption,
    jsonb_build_object('generation_id', v_old.generation_id,
                       'old_text', v_old.text, 'new_text', v_text,
                       'votes_at_edit', v_old.upvotes + v_old.downvotes));
end;
$$;

-- Edits a post's context line. The generation record itself (prompt, model,
-- voice, owner, challenge day) is history and stays read-only.
create or replace function public.admin_update_generation(p_generation uuid, p_context text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_context text := nullif(btrim(regexp_replace(coalesce(p_context, ''), '\s+', ' ', 'g')), '');
  v_old text;
begin
  perform public.assert_superadmin();

  select context into v_old from public.generations where id = p_generation for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if char_length(v_context) > 200 then
    raise exception 'invalid_context' using errcode = '22023';
  end if;
  if v_context is not distinct from v_old then
    return;
  end if;

  update public.generations set context = v_context where id = p_generation;

  perform public.admin_log('edit_post', 'generation', p_generation,
    jsonb_build_object('old_context', v_old, 'new_context', v_context));
end;
$$;

-- Deletes one caption (AI or human, e.g. for moderation). Its votes go with
-- it through ON DELETE CASCADE; nothing else's totals change.
create or replace function public.admin_delete_caption(p_caption uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_old public.captions%rowtype;
begin
  perform public.assert_superadmin();

  delete from public.captions where id = p_caption returning * into v_old;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  perform public.admin_log('delete_caption', 'caption', p_caption,
    jsonb_build_object('generation_id', v_old.generation_id, 'text', v_old.text,
                       'author_type', v_old.author_type, 'author_id', v_old.user_id,
                       'upvotes', v_old.upvotes, 'downvotes', v_old.downvotes));
end;
$$;

-- Deletes a whole post with its captions and votes. Returns the photo's
-- storage path so the app can remove the file (via the storage policy above).
create or replace function public.admin_delete_generation(p_generation uuid)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_old public.generations%rowtype;
  v_captions integer;
  v_votes integer;
begin
  perform public.assert_superadmin();

  select count(*), coalesce(sum(upvotes + downvotes), 0)
    into v_captions, v_votes
    from public.captions where generation_id = p_generation;

  delete from public.generations where id = p_generation returning * into v_old;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  perform public.admin_log('delete_post', 'generation', p_generation,
    jsonb_build_object('owner_id', v_old.user_id, 'image_path', v_old.image_path,
                       'context', v_old.context, 'prompt', v_old.prompt,
                       'captions', v_captions, 'votes', v_votes));

  return v_old.image_path;
end;
$$;

-- ---------------------------------------------------------------------------
-- Votes (read-only)
-- ---------------------------------------------------------------------------

create or replace function public.admin_list_votes(
  p_user uuid default null,
  p_caption uuid default null,
  p_vote integer default null,
  p_from date default null,
  p_to date default null,
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  voter_id uuid,
  voter_name text,
  caption_id uuid,
  caption_text text,
  author_type text,
  generation_id uuid,
  image_path text,
  vote smallint,
  created_at timestamptz,
  updated_at timestamptz,
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
    v.user_id, public.admin_display_name(v.user_id),
    v.caption_id, c.text, c.author_type, c.generation_id, g.image_path,
    v.vote, v.created_at, v.updated_at,
    count(*) over ()
  from public.caption_votes v
  join public.captions c on c.id = v.caption_id
  join public.generations g on g.id = c.generation_id
  where (p_user is null or v.user_id = p_user)
    and (p_caption is null or v.caption_id = p_caption)
    and (p_vote is null or v.vote = p_vote)
    and (p_from is null or (v.created_at at time zone 'America/New_York')::date >= p_from)
    and (p_to is null or (v.created_at at time zone 'America/New_York')::date <= p_to)
    and (v_search is null or c.text ilike '%' || v_search || '%')
  order by v.updated_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 1000)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- Totals and a per-day trend for the same filters as admin_list_votes().
create or replace function public.admin_vote_stats(
  p_user uuid default null,
  p_caption uuid default null,
  p_vote integer default null,
  p_from date default null,
  p_to date default null,
  p_search text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_result jsonb;
begin
  perform public.assert_superadmin();

  with filtered as (
    select v.*, c.author_type, (v.created_at at time zone 'America/New_York')::date as day
    from public.caption_votes v
    join public.captions c on c.id = v.caption_id
    where (p_user is null or v.user_id = p_user)
      and (p_caption is null or v.caption_id = p_caption)
      and (p_vote is null or v.vote = p_vote)
      and (p_from is null or (v.created_at at time zone 'America/New_York')::date >= p_from)
      and (p_to is null or (v.created_at at time zone 'America/New_York')::date <= p_to)
      and (v_search is null or c.text ilike '%' || v_search || '%')
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'upvotes', (select count(*) from filtered where vote = 1),
    'downvotes', (select count(*) from filtered where vote = -1),
    'voters', (select count(distinct user_id) from filtered),
    'captions', (select count(distinct caption_id) from filtered),
    'on_human', (select count(*) from filtered where author_type = 'human'),
    'on_ai', (select count(*) from filtered where author_type = 'ai'),
    'changed', (select count(*) from filtered where updated_at > created_at + interval '1 second'),
    'daily', (
      select coalesce(jsonb_agg(t order by t.day), '[]'::jsonb) from (
        select day,
               count(*) filter (where vote = 1) as upvotes,
               count(*) filter (where vote = -1) as downvotes
        from filtered group by day
      ) t
    )
  ) into v_result;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Audit log (read-only)
-- ---------------------------------------------------------------------------

create or replace function public.admin_list_audit(p_limit integer default 20)
returns table (
  id bigint,
  admin_name text,
  action text,
  target_type text,
  target_id uuid,
  details jsonb,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_superadmin();
  return query
    select l.id, public.admin_display_name(l.admin_id), l.action, l.target_type,
           l.target_id, l.details, l.created_at
    from public.admin_audit_log l
    order by l.created_at desc
    limit least(greatest(coalesce(p_limit, 20), 1), 200);
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------
-- Supabase grants EXECUTE on new functions to anon and authenticated by
-- default. Admin functions: signed-in callers only (and then
-- assert_superadmin() decides). Internal helpers: nobody through the API.

revoke execute on function public.protect_superadmin_flag() from public, anon, authenticated;
revoke execute on function public.admin_log(text, text, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.admin_display_name(uuid) from public, anon, authenticated;
revoke execute on function public.assert_superadmin() from public, anon;
grant execute on function public.assert_superadmin() to authenticated;
revoke execute on function public.is_superadmin() from public, anon;
grant execute on function public.is_superadmin() to authenticated;

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
