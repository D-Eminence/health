-- The team code: everyone types it to sign in, then taps their name (owner, 14 Nov 2026).
-- Change YOUR-CODE (letters and numbers, at least 4; not case-sensitive) and run once. Tell the team the code out loud.
-- Needs sign-in-function.sql run first.
insert into public.outreach_access (org_id, email, name, role)
select id, 'team-' || left(encode(extensions.digest(lower(trim('YOUR-CODE')), 'sha256'), 'hex'), 20) || '@outreach.local', 'Team code', 'volunteer'
from public.outreach_orgs limit 1
on conflict do nothing;

-- To stop a code working (for example after the day): delete public.outreach_access where name = 'Team code';
