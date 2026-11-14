-- Health ID Outreach on Supabase (temporary, until the AWS backend serves Outreach).
-- Run this once in the Supabase SQL editor. Then run seed.sql with your organisation's name and your email.
--
-- Who can see what: a signed-in person sees only the organisations their email is listed in (outreach_access).
-- Everything an organisation records is a row in outreach_docs; every insert and update is written to outreach_audit.

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

-- The organisations the signed-in person's email is listed in.
create or replace function public.outreach_my_orgs() returns setof uuid
language sql stable security definer set search_path = public as $$
  select org_id from public.outreach_access where email = lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

create or replace function public.outreach_is_organiser(target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.outreach_access
    where org_id = target and email = lower(coalesce(auth.jwt() ->> 'email', '')) and role = 'organiser')
$$;

-- Every change to the records is kept: who, when, what.
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
-- Anyone in the organisation may add a volunteer (a coordinator adding their team); only organisers add organisers.
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
-- No deletes from the app: records are kept.

drop policy if exists audit_read on public.outreach_audit;
create policy audit_read on public.outreach_audit for select to authenticated
  using (public.outreach_is_organiser(org_id));
