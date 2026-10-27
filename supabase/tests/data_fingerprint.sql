-- Read-only checksum of the data that existed before the AI Studio
-- migration. Run it in the SQL Editor before and after applying
-- 20261026000000_ai_studio_access_images.sql: every row should be identical.
-- (Columns that change on their own, like last sign-in time, are left out.
-- If someone posts, votes or edits their profile in between, those rows will
-- legitimately differ.)

select 'auth.users' as table_name, count(*) as row_count,
       md5(coalesce(string_agg(id::text || '|' || coalesce(email, '') || '|' || created_at::text, ',' order by id), '')) as checksum
  from auth.users
union all
select 'profiles', count(*), md5(coalesce(string_agg(to_jsonb(t)::text, ',' order by id), '')) from public.profiles t
union all
select 'generations', count(*), md5(coalesce(string_agg((to_jsonb(t) - 'source_image_id')::text, ',' order by id), '')) from public.generations t
union all
select 'captions', count(*), md5(coalesce(string_agg(to_jsonb(t)::text, ',' order by id), '')) from public.captions t
union all
select 'caption_votes', count(*), md5(coalesce(string_agg(to_jsonb(t)::text, ',' order by user_id, caption_id), '')) from public.caption_votes t
union all
select 'caption_prompts', count(*), md5(coalesce(string_agg(to_jsonb(t)::text, ',' order by caption_id), '')) from public.caption_prompts t
union all
select 'admin_audit_log', count(*), md5(coalesce(string_agg(to_jsonb(t)::text, ',' order by id), '')) from public.admin_audit_log t
union all
select 'superadmins', count(*), md5(coalesce(string_agg(id::text, ',' order by id), '')) from public.profiles where is_superadmin
union all
select 'storage files', count(*), md5(coalesce(string_agg(bucket_id || '/' || name || '|' || coalesce(owner::text, ''), ',' order by bucket_id, name), '')) from storage.objects where bucket_id <> 'images'
order by 1;
