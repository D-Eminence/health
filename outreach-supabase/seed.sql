-- Your organisation and you as its organiser. Change the two values, then run it once in the Supabase SQL editor.
-- Sign in to the app with this email (the first sign-in sets your password).
with org as (
  insert into public.outreach_orgs (name) values ('Ajegunle Health Volunteers') returning id
)
insert into public.outreach_access (org_id, email, name, role)
select id, lower('you@example.com'), 'Your name', 'organiser' from org;
