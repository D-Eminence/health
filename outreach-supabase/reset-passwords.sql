-- Sign-in is by email only. Run this once after switching, and again for anyone told "This email still has an old
-- password" or "waiting for an email check": it gives every account the password the app works out from the email,
-- and releases any account held for an email check. It changes no records.
create extension if not exists pgcrypto;
update auth.users
set encrypted_password = extensions.crypt(encode(extensions.digest(lower(email) || ':health-id-outreach-2026', 'sha256'), 'hex'), extensions.gen_salt('bf')),
    email_confirmed_at = coalesce(email_confirmed_at, now())
where email is not null;
