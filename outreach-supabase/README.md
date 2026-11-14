# Health ID Outreach on Vercel + Supabase (temporary)

Outreach on its own, running on Vercel with its records in Supabase, until the AWS backend serves Outreach.
The screens are the Health ID Outreach screens unchanged. `gateway.mjs` answers their `/api/v1` calls from Supabase
in the browser, with the same request and response shapes, so moving to AWS later means switching this off.

## Set up (about 10 minutes)

### 1. Supabase
1. In your Supabase project: **SQL Editor → New query**. Paste `schema.sql` and run it.
2. Open `seed.sql`. Change the organisation name and **your email**, then run it. This makes you the organiser.
3. **Authentication → Sign In / Providers → Email**: keep Email on, turn **Confirm email off**, and save.
   Workers sign in with the email their coordinator adds. Their first sign-in sets their password.
4. **Project Settings → API**: copy the **Project URL** and the **anon public** key.
   Never use the `service_role` key here.

### 2. Vercel
1. **Add New → Project** and import this repository. Vercel reads `vercel.json`, so leave the framework as "Other".
2. **Environment Variables**: add
   - `VITE_SUPABASE_URL`: the Project URL
   - `VITE_SUPABASE_ANON_KEY`: the anon public key
3. Deploy. Open the site and sign in with the email from `seed.sql`. Choose your password the first time.

## On the day
- **Organiser:** Overview → **Create your first campaign** (9 short steps), then More (⋯) → **Campaign record** → **Open campaign**.
- **Team:** campaign → **Team** → **Invite**. Enter each worker's **email**, their roles, site and station.
  They open the site, sign in with that email and choose a password.
- **Capturing:** **Start capturing** → pick the site and station → work.
- **Offline:** open the site once while online. After that, work done without signal stays on the phone ("N waiting to send") and goes when the signal returns.

## What this setup does not do
- **Text messages** (consent codes, slips by text): there is no SMS service. Use "They agreed out loud" and printed slips.
- **Forgot password:** delete the user in Supabase (Authentication → Users). Their next sign-in sets a new password.
- **Checking identity against NIN:** records are marked "identity not yet checked", as in the full system.

## Security
- Each organisation's records are readable only by the emails listed for it (`outreach_access`), enforced in the database by row level security.
- Every insert and update is kept in `outreach_audit`.
- Because email confirmation is off, the first person to sign in with a listed email sets its password. Add workers just before they sign in, and check **Team** shows them as joined.
- Supabase keeps the sign-in on the phone so a refresh doesn't sign people out. On a shared phone, sign out when you finish.

## Moving to AWS
Everything is in `outreach_docs`: one row per campaign, plan, team and visit, as JSON in the shapes the Health ID API uses.
Export it from Supabase (Table Editor → Export, or `pg_dump`) and import it into the Outreach service.

## Check locally without Supabase
`npx vite build --config outreach-supabase/test/vite.check.config.ts` builds with an in-memory stand-in (`test/fake-supabase.mjs`).
The test sign-in is `organiser@example.test` with any password of 8 or more characters.
