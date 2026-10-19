-- Security tests for the admin migration. Paste into the Supabase SQL Editor
-- and run AFTER 20261019000000_admin_dashboard.sql.
--
-- It creates three throwaway users (a superadmin, a regular user, and a
-- second regular user) with a post, captions, and votes, then checks what
-- anon, a regular user, and a superadmin can and can't do through the same
-- roles and JWT claims the REST API uses.
--
-- Nothing is kept: the script ALWAYS ends with an error, which rolls back
-- every test row. Success looks like:
--   ERROR: P0001: ALL 44 SECURITY TESTS PASSED (this error is intentional:
--   it rolls back all test data)
-- A failure looks like: ERROR: P0001: FAIL: <what went wrong>

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_user uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_gen uuid := gen_random_uuid();
  v_ai_cap uuid := gen_random_uuid();
  v_human_cap uuid := gen_random_uuid();
  v_new_gen uuid;
  v_count bigint;
  v_rows bigint;
  v_json jsonb;
  v_text text;
  v_passed integer := 0;
begin
  -- -------------------------------------------------------------------------
  -- Fixtures (as the database owner)
  -- -------------------------------------------------------------------------
  insert into auth.users (id, email, created_at, aud, role) values
    (v_admin, 'admin-' || v_admin || '@example.invalid', now(), 'authenticated', 'authenticated'),
    (v_user, 'user-' || v_user || '@example.invalid', now(), 'authenticated', 'authenticated'),
    (v_other, 'other-' || v_other || '@example.invalid', now(), 'authenticated', 'authenticated');

  -- handle_new_user() should have created the profiles, as non-admins.
  select count(*) into v_count from public.profiles
    where id in (v_admin, v_user, v_other) and is_superadmin = false;
  if v_count <> 3 then
    raise exception 'FAIL: new profiles are not created with is_superadmin = false (got %)', v_count;
  end if;
  v_passed := v_passed + 1;

  update public.profiles set first_name = 'Test', last_name = 'Admin', is_superadmin = true where id = v_admin;
  update public.profiles set first_name = 'Test', last_name = 'User' where id = v_user;
  update public.profiles set first_name = 'Test', last_name = 'Other' where id = v_other;

  insert into public.generations (id, user_id, image_path, context, vibe, daily_prompt, model, prompt)
  values (v_gen, v_user, v_user || '/' || gen_random_uuid() || '.jpg', 'test context', 'columbia',
          'test prompt', 'test-model', 'test generation prompt');
  insert into public.captions (id, generation_id, user_id, author_type, text) values
    (v_ai_cap, v_gen, v_user, 'ai', 'test ai caption ' || v_gen),
    (v_human_cap, v_gen, v_other, 'human', 'test human caption ' || v_gen);
  insert into public.caption_votes (user_id, caption_id, vote) values
    (v_user, v_human_cap, 1),
    (v_other, v_ai_cap, -1);

  -- -------------------------------------------------------------------------
  -- Anonymous visitors
  -- -------------------------------------------------------------------------
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';

  begin
    perform public.admin_dashboard_stats(30);
    raise exception 'FAIL: anon called admin_dashboard_stats()';
  exception when insufficient_privilege then v_passed := v_passed + 1;
  end;

  begin
    perform * from public.admin_list_users(null, 'joined', 10, 0);
    raise exception 'FAIL: anon called admin_list_users()';
  exception when insufficient_privilege then v_passed := v_passed + 1;
  end;

  begin
    perform * from public.admin_list_votes();
    raise exception 'FAIL: anon called admin_list_votes()';
  exception when insufficient_privilege then v_passed := v_passed + 1;
  end;

  begin
    perform public.admin_delete_generation(v_gen);
    raise exception 'FAIL: anon called admin_delete_generation()';
  exception when insufficient_privilege then v_passed := v_passed + 1;
  end;

  begin
    perform * from public.admin_audit_log;
    raise exception 'FAIL: anon read admin_audit_log';
  exception when insufficient_privilege then v_passed := v_passed + 1;
  end;

  select count(*) into v_count from public.profiles;
  if v_count <> 0 then
    raise exception 'FAIL: anon can read % profiles', v_count;
  end if;
  v_passed := v_passed + 1;

  execute 'reset role';

  -- -------------------------------------------------------------------------
  -- A signed-in regular user
  -- -------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  if public.is_superadmin() then
    raise exception 'FAIL: regular user is_superadmin() returned true';
  end if;
  v_passed := v_passed + 1;

  begin
    perform public.admin_dashboard_stats(30);
    raise exception 'FAIL: regular user read dashboard stats';
  exception when insufficient_privilege then v_passed := v_passed + 1;
  end;

  begin
    perform * from public.admin_list_users(null, 'joined', 10, 0);
    raise exception 'FAIL: regular user listed users';
  exception when insufficient_privilege then v_passed := v_passed + 1;
  end;

  begin
    perform public.admin_get_user(v_other);
    raise exception 'FAIL: regular user read another profile via admin_get_user()';
  exception when insufficient_privilege then v_passed := v_passed + 1;
  end;

  begin
    perform * from public.admin_list_votes();
    raise exception 'FAIL: regular user listed all votes';
  exception when insufficient_privilege then v_passed := v_passed + 1;
  end;

  begin
    perform * from public.admin_list_media();
    raise exception 'FAIL: regular user listed admin media';
  exception when insufficient_privilege then v_passed := v_passed + 1;
  end;

  begin
    perform public.admin_update_caption(v_ai_cap, 'hacked');
    raise exception 'FAIL: regular user edited a caption through the admin API';
  exception when insufficient_privilege then v_passed := v_passed + 1;
  end;

  begin
    perform public.admin_delete_caption(v_human_cap);
    raise exception 'FAIL: regular user deleted a caption through the admin API';
  exception when insufficient_privilege then v_passed := v_passed + 1;
  end;

  begin
    perform public.admin_delete_generation(v_gen);
    raise exception 'FAIL: regular user deleted a post through the admin API';
  exception when insufficient_privilege then v_passed := v_passed + 1;
  end;

  -- Privilege escalation: setting your own flag.
  begin
    update public.profiles set is_superadmin = true where id = v_user;
    raise exception 'FAIL: regular user set their own is_superadmin';
  exception when insufficient_privilege then v_passed := v_passed + 1;
  end;

  begin
    insert into public.profiles (id, is_superadmin) values (gen_random_uuid(), true);
    raise exception 'FAIL: regular user inserted a superadmin profile';
  exception when insufficient_privilege then v_passed := v_passed + 1;
  end;

  -- The main app's profile form must still work.
  update public.profiles set first_name = 'Renamed' || left(v_user::text, 8), last_name = 'User', avatar_url = null
    where id = v_user;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'FAIL: regular user can no longer edit their own name';
  end if;
  v_passed := v_passed + 1;

  -- Existing ownership rules still hold.
  select count(*) into v_count from public.profiles;
  if v_count <> 1 then
    raise exception 'FAIL: regular user can see % profiles (expected only their own)', v_count;
  end if;
  v_passed := v_passed + 1;

  select count(*) into v_count from public.caption_votes;
  if v_count <> 1 then
    raise exception 'FAIL: regular user can see % votes (expected only their own)', v_count;
  end if;
  v_passed := v_passed + 1;

  begin
    perform author_type from public.captions limit 1;
    raise exception 'FAIL: regular user can read captions.author_type';
  exception when insufficient_privilege then v_passed := v_passed + 1;
  end;

  begin
    perform * from public.caption_prompts;
    raise exception 'FAIL: regular user can read caption_prompts';
  exception when insufficient_privilege then v_passed := v_passed + 1;
  end;

  execute 'reset role';

  -- The second user can't touch the first user's post or caption.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  update public.generations set context = 'hacked' where id = v_gen;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'FAIL: a user edited someone else''s post';
  end if;
  v_passed := v_passed + 1;

  delete from public.generations where id = v_gen;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'FAIL: a user deleted someone else''s post';
  end if;
  v_passed := v_passed + 1;

  begin
    perform public.edit_human_caption(v_ai_cap, 'hacked');
    raise exception 'FAIL: a user edited someone else''s caption';
  exception when no_data_found then v_passed := v_passed + 1;
  end;

  update public.captions set upvotes = 999 where id = v_human_cap;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'FAIL: a user changed vote totals directly';
  end if;
  v_passed := v_passed + 1;

  begin
    insert into public.caption_votes (user_id, caption_id, vote) values (v_user, v_ai_cap, 1);
    raise exception 'FAIL: a user voted as someone else';
  exception when insufficient_privilege then v_passed := v_passed + 1;
  end;

  execute 'reset role';

  -- -------------------------------------------------------------------------
  -- A superadmin
  -- -------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  if not public.is_superadmin() then
    raise exception 'FAIL: superadmin is_superadmin() returned false';
  end if;
  v_passed := v_passed + 1;

  v_json := public.admin_dashboard_stats(30);
  if (v_json -> 'totals' ->> 'users')::int < 3 or (v_json -> 'totals' ->> 'votes')::int < 2
     or jsonb_array_length(v_json -> 'daily') <> 30 then
    raise exception 'FAIL: dashboard stats look wrong: %', v_json -> 'totals';
  end if;
  v_passed := v_passed + 1;

  select count(*) into v_count from public.admin_list_users('Renamed' || left(v_user::text, 8), 'joined', 10, 0);
  if v_count <> 1 then
    raise exception 'FAIL: superadmin search by name found % users', v_count;
  end if;
  v_passed := v_passed + 1;

  v_json := public.admin_get_user(v_other);
  if (v_json -> 'stats' ->> 'human_captions')::int <> 1 or (v_json -> 'stats' ->> 'votes_cast')::int <> 1 then
    raise exception 'FAIL: admin_get_user stats wrong: %', v_json -> 'stats';
  end if;
  v_passed := v_passed + 1;

  select count(*) into v_count from public.admin_list_votes(p_caption => v_human_cap);
  if v_count <> 1 then
    raise exception 'FAIL: superadmin could not read another user''s vote';
  end if;
  v_passed := v_passed + 1;

  v_json := public.admin_get_media(v_gen);
  if jsonb_array_length(v_json -> 'captions') <> 2 then
    raise exception 'FAIL: admin_get_media returned % captions', jsonb_array_length(v_json -> 'captions');
  end if;
  v_passed := v_passed + 1;

  -- Updates are validated and audited.
  begin
    perform public.admin_update_caption(v_ai_cap, '   ');
    raise exception 'FAIL: empty caption text was accepted';
  exception when invalid_parameter_value then v_passed := v_passed + 1;
  end;

  begin
    perform public.admin_update_caption(v_human_cap, 'reworded human caption');
    raise exception 'FAIL: superadmin reworded a human-written caption';
  exception when insufficient_privilege then v_passed := v_passed + 1;
  end;

  perform public.admin_update_caption(v_ai_cap, 'edited ai caption ' || v_gen);
  perform public.admin_update_generation(v_gen, 'edited context');
  select count(*) into v_count from public.admin_list_audit(50)
    where target_id in (v_ai_cap, v_gen) and action in ('edit_caption', 'edit_post');
  if v_count <> 2 then
    raise exception 'FAIL: edits were not written to the audit log';
  end if;
  v_passed := v_passed + 1;

  -- Superadmins still can't escalate or forge through the tables.
  begin
    update public.profiles set is_superadmin = true where id = v_user;
    raise exception 'FAIL: superadmin promoted another user through the API';
  exception when insufficient_privilege then v_passed := v_passed + 1;
  end;

  begin
    insert into public.caption_votes (user_id, caption_id, vote) values (v_user, v_ai_cap, 1);
    raise exception 'FAIL: superadmin cast a vote as another user';
  exception when insufficient_privilege then v_passed := v_passed + 1;
  end;

  -- Create: a post in the admin's own folder works; someone else's doesn't.
  v_new_gen := public.admin_create_generation(
    v_admin || '/' || gen_random_uuid() || '.jpg', 'admin post', 'online',
    'test prompt', 'test-model', 'test prompt text', array['caption one', 'caption two']);
  select count(*) into v_count from public.admin_get_media(v_new_gen) m,
    jsonb_array_elements(m -> 'captions');
  if v_count <> 2 then
    raise exception 'FAIL: admin_create_generation saved % captions', v_count;
  end if;
  v_passed := v_passed + 1;

  begin
    perform public.admin_create_generation(
      v_user || '/' || gen_random_uuid() || '.jpg', null, 'online',
      'p', 'm', 'p', array['x']);
    raise exception 'FAIL: admin_create_generation accepted a path in another user''s folder';
  exception when invalid_parameter_value then v_passed := v_passed + 1;
  end;

  if public.admin_add_ai_captions(v_gen, array['fresh ai caption ' || v_gen], 'test-model', 'test prompt') <> 1 then
    raise exception 'FAIL: admin_add_ai_captions did not add the caption';
  end if;
  v_passed := v_passed + 1;

  -- Delete: the caption's votes go with it, and the post's photo path comes back.
  perform public.admin_delete_caption(v_ai_cap);
  execute 'reset role';
  select count(*) into v_count from public.caption_votes where caption_id = v_ai_cap;
  if v_count <> 0 then
    raise exception 'FAIL: votes on a deleted caption were left behind';
  end if;
  v_passed := v_passed + 1;

  execute 'set local role authenticated';
  v_text := public.admin_delete_generation(v_gen);
  execute 'reset role';
  if v_text not like v_user || '/%' or exists (select 1 from public.captions where generation_id = v_gen) then
    raise exception 'FAIL: admin_delete_generation did not remove the post and its captions';
  end if;
  v_passed := v_passed + 1;

  raise exception 'ALL % SECURITY TESTS PASSED (this error is intentional: it rolls back all test data)', v_passed;
end;
$$;
