-- Sign-in by email only, with no email ever sent (owner, 14 Nov 2026).
-- The app calls this before signing in: for an email on a team it makes the Supabase account (or resets its password)
-- directly in the database, already confirmed, with the password the app works out from the email. Supabase's own
-- sign-up (which sends emails and hits the email limit) is never used. For an email on no team it does nothing.
-- Run once in the SQL Editor (safe to run again).
create extension if not exists pgcrypto with schema extensions;

create or replace function public.outreach_prepare_sign_in(p_email text) returns boolean
language plpgsql security definer set search_path = public, extensions, auth as $$
declare
  e text := lower(trim(coalesce(p_email, '')));
  uid uuid;
  pw text;
  col text;
begin
  if e = '' or not exists (select 1 from public.outreach_access where email = e) then
    return false;
  end if;
  pw := extensions.crypt(encode(extensions.digest(e || ':health-id-outreach-2026', 'sha256'), 'hex'), extensions.gen_salt('bf'));
  select id into uid from auth.users where lower(email) = e limit 1;
  if uid is null then
    uid := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', e, pw, now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), uid, uid::text, jsonb_build_object('sub', uid::text, 'email', e, 'email_verified', true),
      'email', now(), now(), now());
  else
    update auth.users set encrypted_password = pw, email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now()
    where id = uid;
  end if;
  -- Supabase's sign-in can't read empty (null) token columns: give the ones this project has an empty value.
  for col in select column_name from information_schema.columns
    where table_schema = 'auth' and table_name = 'users' and data_type in ('character varying', 'text')
      and column_name in ('confirmation_token', 'recovery_token', 'email_change_token_new', 'email_change',
        'email_change_token_current', 'phone_change', 'phone_change_token', 'reauthentication_token')
  loop
    execute format('update auth.users set %I = '''' where id = $1 and %I is null', col, col) using uid;
  end loop;
  return true;
end $$;

revoke all on function public.outreach_prepare_sign_in(text) from public;
grant execute on function public.outreach_prepare_sign_in(text) to anon, authenticated;
