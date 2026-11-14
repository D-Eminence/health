-- Everything Outreach needs in Supabase, in one run (safe to run again): tables, rules, sign-in, and the team code AJEGUNLE26.

create extension if not exists pgcrypto;

create table if not exists public.outreach_orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.outreach_access (
  org_id uuid not null references public.outreach_orgs(id) on delete cascade,
  email text not null check (email = lower(email)),
  name text,
  role text not null default 'volunteer' check (role in ('organiser', 'volunteer')),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  primary key (org_id, email)
);

create table if not exists public.outreach_docs (
  org_id uuid not null references public.outreach_orgs(id) on delete cascade,
  kind text not null check (kind in ('campaign', 'plan', 'team', 'visit')),
  id text not null,
  campaign_id text,
  data jsonb not null,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (org_id, kind, id)
);
create index if not exists outreach_docs_campaign on public.outreach_docs (org_id, kind, campaign_id);

create table if not exists public.outreach_audit (
  id bigserial primary key,
  org_id uuid not null,
  at timestamptz not null default now(),
  by_user uuid default auth.uid(),
  by_email text default (auth.jwt() ->> 'email'),
  action text not null,
  kind text not null,
  doc_id text not null,
  version integer
);

create or replace function public.outreach_my_orgs() returns setof uuid
language sql stable security definer set search_path = public as $$
  select org_id from public.outreach_access where email = lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

create or replace function public.outreach_is_organiser(target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.outreach_access
    where org_id = target and email = lower(coalesce(auth.jwt() ->> 'email', '')) and role = 'organiser')
$$;

create or replace function public.outreach_audit_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.outreach_audit (org_id, action, kind, doc_id, version)
  values (new.org_id, lower(tg_op), new.kind, new.id, new.version);
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists outreach_docs_audit on public.outreach_docs;
create trigger outreach_docs_audit before insert or update on public.outreach_docs
  for each row execute function public.outreach_audit_change();

alter table public.outreach_orgs enable row level security;
alter table public.outreach_access enable row level security;
alter table public.outreach_docs enable row level security;
alter table public.outreach_audit enable row level security;

drop policy if exists orgs_read on public.outreach_orgs;
create policy orgs_read on public.outreach_orgs for select to authenticated
  using (id in (select public.outreach_my_orgs()));

drop policy if exists access_read on public.outreach_access;
create policy access_read on public.outreach_access for select to authenticated
  using (org_id in (select public.outreach_my_orgs()));
drop policy if exists access_add on public.outreach_access;
create policy access_add on public.outreach_access for insert to authenticated
  with check (org_id in (select public.outreach_my_orgs()) and (role = 'volunteer' or public.outreach_is_organiser(org_id)));
drop policy if exists access_change on public.outreach_access;
create policy access_change on public.outreach_access for update to authenticated
  using (public.outreach_is_organiser(org_id)) with check (public.outreach_is_organiser(org_id));
drop policy if exists access_remove on public.outreach_access;
create policy access_remove on public.outreach_access for delete to authenticated
  using (public.outreach_is_organiser(org_id));

drop policy if exists docs_read on public.outreach_docs;
create policy docs_read on public.outreach_docs for select to authenticated
  using (org_id in (select public.outreach_my_orgs()));
drop policy if exists docs_add on public.outreach_docs;
create policy docs_add on public.outreach_docs for insert to authenticated
  with check (org_id in (select public.outreach_my_orgs()));
drop policy if exists docs_change on public.outreach_docs;
create policy docs_change on public.outreach_docs for update to authenticated
  using (org_id in (select public.outreach_my_orgs())) with check (org_id in (select public.outreach_my_orgs()));

drop policy if exists audit_read on public.outreach_audit;
create policy audit_read on public.outreach_audit for select to authenticated
  using (public.outreach_is_organiser(org_id));

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

insert into public.outreach_orgs (name)
select 'Ajegunle Health Volunteers' where not exists (select 1 from public.outreach_orgs);

insert into public.outreach_access (org_id, email, name, role)
select id, 'team-2a91f395c266a84d1a53@outreach.local', 'Team code', 'volunteer' from public.outreach_orgs
on conflict (org_id, email) do update set name = 'Team code';

select a.email, a.name, a.role, public.outreach_prepare_sign_in(a.email) as ready
from public.outreach_access a;
