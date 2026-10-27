-- Security and behavior tests for 20261026000000_ai_studio_access_images.sql.
-- Paste into the Supabase SQL Editor and run AFTER that migration.
--
-- Creates throwaway users (a superadmin and two regular users), then checks
-- what anon, a regular user, and a superadmin can do with the new tables and
-- functions through the same roles and JWT claims the REST API uses.
--
-- Nothing is kept: the script ALWAYS ends with an error, which rolls back
-- every test row (including any signup-setting change). Success looks like:
--   ERROR: P0001: ALL n AI STUDIO TESTS PASSED (this error is intentional:
--   it rolls back all test data)
-- A failure looks like: ERROR: P0001: FAIL: <what went wrong>

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_user uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_gen uuid := gen_random_uuid();
  v_req jsonb;
  v_req_id uuid;
  v_step uuid;
  v_term uuid;
  v_count bigint;
  v_json jsonb;
  v_bool boolean;
  v_text text;
  v_passed integer := 0;
  v_classic uuid := '5eed0000-0000-4000-8000-000000000201';
  v_scan uuid := '5eed0000-0000-4000-8000-000000000202';
  v_room uuid := '5eed0000-0000-4000-8000-000000000203';
begin
  -- -------------------------------------------------------------------------
  -- Fixtures (as the database owner). Signups are open while we create them.
  -- -------------------------------------------------------------------------
  update public.signup_settings set restrict_signups = false where id;
  insert into auth.users (id, email, created_at, aud, role) values
    (v_admin, 'admin-' || v_admin || '@example.invalid', now(), 'authenticated', 'authenticated'),
    (v_user, 'user-' || v_user || '@example.invalid', now(), 'authenticated', 'authenticated'),
    (v_other, 'other-' || v_other || '@example.invalid', now(), 'authenticated', 'authenticated');
  update public.profiles set is_superadmin = true where id = v_admin;

  -- Seeds are in place and the default mix adds up.
  select coalesce(sum(weight), 0) into v_count from public.prompt_chain_mix;
  if v_count <> 100 then
    raise exception 'FAIL: seeded mix totals % instead of 100', v_count;
  end if;
  select count(*) into v_count from public.runnable_chain_ids();
  if v_count < 3 then
    raise exception 'FAIL: expected the 3 seeded chains to be runnable, got %', v_count;
  end if;
  v_passed := v_passed + 2;

  -- -------------------------------------------------------------------------
  -- Anonymous visitors
  -- -------------------------------------------------------------------------
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';

  begin
    perform count(*) from public.terms;
    raise exception 'FAIL: anon read terms';
  exception when insufficient_privilege then v_passed := v_passed + 1;
  end;
  begin
    perform count(*) from public.llm_providers;
    raise exception 'FAIL: anon read llm_providers';
  exception when insufficient_privilege then v_passed := v_passed + 1;
  end;
  begin
    perform count(*) from public.whitelisted_emails;
    raise exception 'FAIL: anon read whitelisted_emails';
  exception when insufficient_privilege then v_passed := v_passed + 1;
  end;
  begin
    perform count(*) from public.generation_requests;
    raise exception 'FAIL: anon read generation_requests';
  exception when insufficient_privilege then v_passed := v_passed + 1;
  end;
  begin
    insert into public.allowed_signup_domains (domain) values ('evil.example');
    raise exception 'FAIL: anon added a signup domain';
  exception when insufficient_privilege then v_passed := v_passed + 1;
  end;
  begin
    update public.signup_settings set restrict_signups = false;
    raise exception 'FAIL: anon changed signup settings';
  exception when insufficient_privilege then v_passed := v_passed + 1;
  end;
  begin
    perform public.begin_caption_request('columbia');
    raise exception 'FAIL: anon started a caption request';
  exception when insufficient_privilege then v_passed := v_passed + 1;
  end;
  begin
    perform public.admin_list_prompt_chains();
    raise exception 'FAIL: anon called admin_list_prompt_chains()';
  exception when insufficient_privilege then v_passed := v_passed + 1;
  end;
  begin
    perform public.signup_allowed('x@example.com');
    raise exception 'FAIL: anon called the internal signup_allowed()';
  exception when insufficient_privilege then v_passed := v_passed + 1;
  end;

  -- The two public helpers work for anon and leak no emails.
  v_json := public.signup_rules();
  if v_json ? 'emails' or not (v_json ? 'restricted') then
    raise exception 'FAIL: signup_rules() returned the wrong shape: %', v_json;
  end if;
  perform * from public.battle_result(gen_random_uuid());
  v_passed := v_passed + 2;

  -- anon may read released library images but not who uploaded them.
  begin
    perform uploaded_by from public.images;
    raise exception 'FAIL: anon read images.uploaded_by';
  exception when insufficient_privilege then v_passed := v_passed + 1;
  end;

  execute 'reset role';

  -- -------------------------------------------------------------------------
  -- A regular signed-in user
  -- -------------------------------------------------------------------------
  insert into public.generations (id, user_id, image_path, vibe, model, prompt)
  values (v_gen, v_user, v_user || '/' || gen_random_uuid() || '.jpg', 'columbia', 'm', 'p');

  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- RLS hides admin tables (no rows, not an error) and blocks writes.
  select count(*) into v_count from public.terms;
  if v_count <> 0 then
    raise exception 'FAIL: a regular user can read % terms', v_count;
  end if;
  select count(*) into v_count from public.llm_models;
  if v_count <> 0 then
    raise exception 'FAIL: a regular user can read llm_models';
  end if;
  select count(*) into v_count from public.prompt_chain_steps;
  if v_count <> 0 then
    raise exception 'FAIL: a regular user can read prompt_chain_steps';
  end if;
  v_passed := v_passed + 3;

  begin
    insert into public.whitelisted_emails (email) values ('me@gmail.com');
    raise exception 'FAIL: a regular user whitelisted an email';
  exception when insufficient_privilege then v_passed := v_passed + 1;
  end;
  begin
    insert into public.allowed_signup_domains (domain) values ('gmail.com');
    raise exception 'FAIL: a regular user added a signup domain';
  exception when insufficient_privilege then v_passed := v_passed + 1;
  end;

  update public.signup_settings set restrict_signups = false;
  get diagnostics v_count = row_count;
  if v_count <> 0 then
    raise exception 'FAIL: a regular user changed signup settings';
  end if;
  v_passed := v_passed + 1;

  begin
    insert into public.llm_providers (slug, name) values ('rogue', 'Rogue');
    raise exception 'FAIL: a regular user added a provider';
  exception when insufficient_privilege then v_passed := v_passed + 1;
  end;
  begin
    perform count(*) from public.llm_responses;
    raise exception 'FAIL: a regular user read llm_responses';
  exception when insufficient_privilege then v_passed := v_passed + 1;
  end;
  begin
    perform public.admin_update_chain_mix(jsonb_build_object(v_classic, 100, v_scan, 0, v_room, 0));
    raise exception 'FAIL: a regular user changed the chain mix';
  exception when insufficient_privilege then v_passed := v_passed + 1;
  end;
  begin
    perform * from public.admin_list_generation_requests();
    raise exception 'FAIL: a regular user listed generation requests';
  exception when insufficient_privilege then v_passed := v_passed + 1;
  end;
  begin
    perform public.admin_promote_caption_to_example(gen_random_uuid(), 'scene');
    raise exception 'FAIL: a regular user promoted an example';
  exception when insufficient_privilege then v_passed := v_passed + 1;
  end;
  begin
    insert into public.images (storage_path, title, alt_text, mime_type, byte_size)
    values (gen_random_uuid() || '.png', 't', 'alt text', 'image/png', 10);
    raise exception 'FAIL: a regular user added a library image';
  exception when insufficient_privilege then v_passed := v_passed + 1;
  end;
  begin
    insert into storage.objects (bucket_id, name) values ('images', gen_random_uuid() || '.png');
    raise exception 'FAIL: a regular user uploaded into the images bucket';
  exception when insufficient_privilege then v_passed := v_passed + 1;
  end;
  select count(*) into v_count from storage.objects where bucket_id = 'images';
  if v_count <> 0 then
    raise exception 'FAIL: a regular user can list the images bucket';
  end if;
  v_passed := v_passed + 1;

  -- Still can't make themselves a superadmin.
  begin
    update public.profiles set is_superadmin = true where id = v_user;
    raise exception 'FAIL: a regular user promoted themselves';
  exception when insufficient_privilege then v_passed := v_passed + 1;
  end;

  -- A regular user can't pick a chain or log against an existing post.
  begin
    perform public.begin_caption_request('columbia', 'main_app', v_classic);
    raise exception 'FAIL: a regular user chose a chain';
  exception when insufficient_privilege then v_passed := v_passed + 1;
  end;
  begin
    perform public.begin_caption_request('columbia', 'admin');
    raise exception 'FAIL: a regular user started an admin request';
  exception when insufficient_privilege then v_passed := v_passed + 1;
  end;

  -- The real pipeline: begin, log each step, finish.
  v_req := public.begin_caption_request('columbia');
  v_req_id := (v_req ->> 'request_id')::uuid;
  if v_req_id is null or jsonb_array_length(v_req -> 'steps') < 1 then
    raise exception 'FAIL: begin_caption_request returned %', v_req;
  end if;
  if (v_req -> 'steps' -> -1 ->> 'kind') <> 'caption' then
    raise exception 'FAIL: chosen chain does not end in a caption step';
  end if;
  if v_req::text like '%sk-%' or (v_req -> 'steps' -> 0 ->> 'api_key_env_var') <> 'GEMINI_API_KEY' then
    raise exception 'FAIL: steps should carry the key variable name only';
  end if;
  v_passed := v_passed + 3;

  v_step := (v_req -> 'steps' -> 0 ->> 'id')::uuid;
  perform public.log_llm_response(v_req_id, v_step, 'prompt', '["a","b"]', 'ok', 200, null, 1234, 100, 20);

  -- A step from a different chain is rejected.
  begin
    perform public.log_llm_response(v_req_id,
      (select s.id from public.prompt_chain_steps s
       where s.chain_id <> (v_req -> 'chain' ->> 'id')::uuid limit 1),
      'p', 'r', 'ok');
    raise exception 'FAIL: logged a step from another chain';
  exception when invalid_parameter_value then v_passed := v_passed + 1;
  end;

  insert into public.captions (generation_id, user_id, author_type, text)
  values (v_gen, v_user, 'ai', 'pipeline caption ' || v_gen);
  perform public.finish_caption_request(v_req_id, true, null, v_gen);

  -- Another user can't log into or close this request.
  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  begin
    perform public.log_llm_response(v_req_id, v_step, 'p', 'r', 'ok');
    raise exception 'FAIL: another user logged into someone else''s request';
  exception when no_data_found then v_passed := v_passed + 1;
  end;
  begin
    perform public.finish_caption_request(v_req_id, false, 'x');
    raise exception 'FAIL: another user closed someone else''s request';
  exception when no_data_found then v_passed := v_passed + 1;
  end;
  -- ...and can't claim success with a post they don't own.
  v_req := public.begin_caption_request('online');
  begin
    perform public.finish_caption_request((v_req ->> 'request_id')::uuid, true, null, v_gen);
    raise exception 'FAIL: finished a request with someone else''s post';
  exception when invalid_parameter_value then v_passed := v_passed + 1;
  end;

  execute 'reset role';

  select caption_ids, status into v_json, v_text
  from (select to_jsonb(caption_ids) caption_ids, status from public.generation_requests where id = v_req_id) r;
  if v_text <> 'succeeded' or jsonb_array_length(v_json) <> 1 then
    raise exception 'FAIL: request not closed with its caption (status %, captions %)', v_text, v_json;
  end if;
  select count(*) into v_count from public.llm_responses where request_id = v_req_id and model_key = 'gemini-flash-latest';
  if v_count <> 1 then
    raise exception 'FAIL: llm response not logged with the step''s model';
  end if;
  v_passed := v_passed + 2;

  -- Rate limit: 25 runs a day.
  insert into public.generation_requests (user_id, source, chain_slug, status, started_at)
  select v_user, 'main_app', 'classic', 'failed', now() from generate_series(1, 25);
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.begin_caption_request('columbia');
    raise exception 'FAIL: rate limit not enforced';
  exception when check_violation then v_passed := v_passed + 1;
  end;
  execute 'reset role';

  -- -------------------------------------------------------------------------
  -- Superadmin
  -- -------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- CRUD on terms, with the change audited.
  insert into public.terms (term, definition, category) values ('Test term ' || v_admin, 'A definition', 'campus')
  returning id into v_term;
  update public.terms set definition = 'A better definition' where id = v_term;
  delete from public.terms where id = v_term;
  v_passed := v_passed + 1;

  -- Can't forge authorship on insert.
  begin
    insert into public.terms (term, definition, created_by) values ('x' || v_admin, 'y', v_user);
    raise exception 'FAIL: admin set created_by by hand';
  exception when insufficient_privilege then v_passed := v_passed + 1;
  end;

  -- Providers can't name an arbitrary server secret.
  begin
    insert into public.llm_providers (slug, name, adapter, api_key_env_var)
    values ('bad', 'Bad', 'gemini', 'SUPABASE_SERVICE_ROLE_KEY');
    raise exception 'FAIL: provider accepted a non-API-key env var';
  exception when check_violation then v_passed := v_passed + 1;
  end;

  -- Deleting a model that chain steps use is refused.
  begin
    delete from public.llm_models where id = '5eed0000-0000-4000-8000-000000000101';
    raise exception 'FAIL: deleted a model that chains depend on';
  exception when restrict_violation or foreign_key_violation then v_passed := v_passed + 1;
  end;

  -- Mix: must total 100, and must cover every chain.
  begin
    perform public.admin_update_chain_mix(jsonb_build_object(v_classic, 50, v_scan, 20, v_room, 20));
    raise exception 'FAIL: mix accepted a total of 90';
  exception when invalid_parameter_value then v_passed := v_passed + 1;
  end;
  begin
    perform public.admin_update_chain_mix(jsonb_build_object(v_classic, 100));
    raise exception 'FAIL: mix accepted a partial list';
  exception when invalid_parameter_value then v_passed := v_passed + 1;
  end;
  perform public.admin_update_chain_mix(jsonb_build_object(v_classic, 40, v_scan, 40, v_room, 20));
  select weight into v_count from public.prompt_chain_mix where chain_id = v_scan;
  if v_count <> 40 then
    raise exception 'FAIL: mix update did not apply';
  end if;
  v_passed := v_passed + 1;

  -- Admin can choose a chain and read the run log.
  v_req := public.begin_caption_request('newyorker', 'admin', v_room, v_gen);
  if (v_req -> 'chain' ->> 'slug') <> 'writers-room' then
    raise exception 'FAIL: admin chain choice ignored';
  end if;
  select count(*) into v_count from public.admin_list_generation_requests();
  if v_count < 2 then
    raise exception 'FAIL: admin can''t list generation requests';
  end if;
  v_json := public.admin_get_generation_request(v_req_id);
  if jsonb_array_length(v_json -> 'responses') <> 1 then
    raise exception 'FAIL: admin request detail missing its responses';
  end if;
  select count(*) into v_count from public.admin_list_llm_responses();
  if v_count < 1 then
    raise exception 'FAIL: admin can''t list llm responses';
  end if;
  v_json := public.admin_list_prompt_chains();
  if jsonb_array_length(v_json) < 3 then
    raise exception 'FAIL: admin can''t list chains';
  end if;
  v_json := public.admin_ai_stats(30);
  if (v_json ->> 'requests')::int < 2 then
    raise exception 'FAIL: admin_ai_stats missed requests';
  end if;
  v_passed := v_passed + 6;

  -- Access lists: normalized, validated, audited.
  insert into public.allowed_signup_domains (domain) values ('  Example-School.EDU ');
  select count(*) into v_count from public.allowed_signup_domains where domain = 'example-school.edu';
  if v_count <> 1 then
    raise exception 'FAIL: signup domain not normalized';
  end if;
  begin
    insert into public.allowed_signup_domains (domain) values ('not a domain');
    raise exception 'FAIL: invalid domain accepted';
  exception when check_violation then v_passed := v_passed + 1;
  end;
  insert into public.whitelisted_emails (email) values ('Guest.Speaker@Gmail.com');
  begin
    insert into public.whitelisted_emails (email) values ('nope');
    raise exception 'FAIL: invalid email accepted';
  exception when check_violation then v_passed := v_passed + 1;
  end;
  update public.signup_settings set restrict_signups = true where id;
  v_passed := v_passed + 1;

  execute 'reset role';

  select count(*) into v_count from public.admin_audit_log
  where admin_id = v_admin
    and action in ('create_term', 'update_term', 'delete_term', 'create_signup_domain',
                   'create_whitelisted_email', 'update_signup_settings', 'update_chain_mix');
  if v_count <> 7 then
    raise exception 'FAIL: expected 7 audit entries for the admin''s changes, got %', v_count;
  end if;
  v_passed := v_passed + 1;

  -- -------------------------------------------------------------------------
  -- The signup gate (restricted above): runs inside Supabase Auth's insert.
  -- -------------------------------------------------------------------------
  begin
    insert into auth.users (id, email, aud, role)
    values (gen_random_uuid(), 'stranger-' || v_admin || '@gmail.com', 'authenticated', 'authenticated');
    raise exception 'FAIL: restricted signups let a stranger in';
  exception when insufficient_privilege then v_passed := v_passed + 1;
  end;
  insert into auth.users (id, email, aud, role)
    values (gen_random_uuid(), 'student-' || v_admin || '@example-school.edu', 'authenticated', 'authenticated');
  insert into auth.users (id, email, aud, role)
    values (gen_random_uuid(), 'guest.speaker@gmail.com', 'authenticated', 'authenticated');
  begin
    insert into auth.users (id, email, aud, role)
    values (gen_random_uuid(), 'x-' || v_admin || '@sub.example-school.edu', 'authenticated', 'authenticated');
    raise exception 'FAIL: subdomain allowed without include_subdomains';
  exception when insufficient_privilege then v_passed := v_passed + 1;
  end;
  -- Existing accounts are unaffected: they can still update their profile.
  update public.profiles set first_name = 'Still' where id = v_user;
  v_passed := v_passed + 2;

  if not (public.signup_rules() ->> 'restricted')::boolean
     or not (public.signup_rules() -> 'domains') ? 'example-school.edu' then
    raise exception 'FAIL: signup_rules() out of date';
  end if;
  v_passed := v_passed + 1;

  -- -------------------------------------------------------------------------
  -- Sweep: EVERY admin_* function in the database refuses a regular user
  -- and anon, found from the catalog rather than a hand-written list.
  -- -------------------------------------------------------------------------
  for v_text, v_json in
    select p.oid::regprocedure::text,
           to_jsonb(array(select format_type(t, null) from unnest(p.proargtypes::oid[]) t))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'admin\_%'
  loop
    foreach v_bool in array array[true, false] loop
      if v_bool then
        perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
        execute 'set local role authenticated';
      else
        perform set_config('request.jwt.claims', '{"role":"anon"}', true);
        execute 'set local role anon';
      end if;
      begin
        execute format('select %s(%s)', split_part(v_text, '(', 1),
          coalesce((select string_agg(format('null::%s', a), ', ') from jsonb_array_elements_text(v_json) a), ''));
        raise exception 'FAIL: % ran % without being a superadmin', case when v_bool then 'a regular user' else 'anon' end, v_text;
      exception when insufficient_privilege then v_passed := v_passed + 1;
      end;
      execute 'reset role';
    end loop;
  end loop;

  -- anon can execute exactly the two public helpers among the new functions.
  select count(*) into v_count
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('set_updated_at', 'audit_admin_change', 'normalize_access_entry', 'signup_allowed',
                      'enforce_signup_allowlist', 'runnable_chain_ids', 'begin_caption_request',
                      'log_llm_response', 'finish_caption_request')
    and has_function_privilege('anon', p.oid, 'execute');
  if v_count <> 0 then
    raise exception 'FAIL: anon can execute % internal or signed-in-only function(s)', v_count;
  end if;
  if not has_function_privilege('anon', 'public.signup_rules()', 'execute')
     or not has_function_privilege('anon', 'public.battle_result(uuid)', 'execute') then
    raise exception 'FAIL: public helpers not executable by anon';
  end if;
  v_passed := v_passed + 2;

  raise exception 'ALL % AI STUDIO TESTS PASSED (this error is intentional: it rolls back all test data)', v_passed;
end;
$$;
