# Health ID Outreach on Vercel + Supabase (temporary)

Outreach on its own, running on Vercel with its records in Supabase, until the AWS backend serves Outreach.
The screens are the Health ID Outreach screens unchanged. `gateway.mjs` answers their `/api/v1` calls from Supabase
in the browser, with the same request and response shapes, so moving to AWS later means switching this off.

## Set up (about 10 minutes)

### 1. Supabase
1. In your Supabase project: **SQL Editor → New query**. Paste `schema.sql` and run it.
2. Open `seed.sql`. Change the organisation name and **your email**, then run it. This makes you the organiser.
3. **Authentication → Sign In / Providers → Email**: keep Email on, turn **Confirm email off**, and save.
   Sign-in is by **email only**: anyone whose email is on a campaign's team gets in. Nobody types a password.
   If accounts were made before, run `reset-passwords.sql` once.
4. **Project Settings → API**: copy the **Project URL** and the **anon public** key.
   Never use the `service_role` key here.

### 2. Vercel
1. **Add New → Project** and import this repository. Vercel reads `vercel.json`, so leave the framework as "Other".
2. **Environment Variables**: add
   - `VITE_SUPABASE_URL`: the Project URL
   - `VITE_SUPABASE_ANON_KEY`: the anon public key
3. Deploy. Open the site and sign in with the email from `seed.sql`.

## On the day
- **Organiser:** Overview → **Create your first campaign** (9 short steps), then More (⋯) → **Campaign record** → **Open campaign**.
- **Team:** campaign → **Team** → **Invite**. Enter each worker's **email**, their roles, site and station.
  They open the site and sign in with that email.
- **Capturing:** **Start capturing** → pick the site and station → work.
- **Offline:** sign in once with signal. After that the app opens and works with no signal: campaigns, team and the records
  this phone last read are kept on it, and what is captured waits on the phone ("To send") and goes when the signal returns.
  Two phones offline don't see each other's work until both are back online. Signing out clears what the phone kept.

## What this setup does not do
- **Text messages** (consent codes, slips by text): there is no SMS service. Use "They agreed out loud" and printed slips.
- **"Old password" or "waiting for an email check" when signing in:** run `reset-passwords.sql` in Supabase.
- **Checking identity against NIN:** records are marked "identity not yet checked", as in the full system.

## Security
- Each organisation's records are readable only by the emails listed for it (`outreach_access`), enforced in the database by row level security.
- Every insert and update is kept in `outreach_audit`.
- Sign-in is by email only (owner's choice): anyone who types an email on a team gets in. Keep team emails private, remove people who leave (delete their row in `outreach_access`), and check `outreach_audit` for changes.
- Supabase keeps the sign-in on the phone so a refresh doesn't sign people out. On a shared phone, sign out when you finish.

## Moving to AWS
Everything is in `outreach_docs`: one row per campaign, plan, team and visit, as JSON in the shapes the Health ID API uses.
Export it from Supabase (Table Editor → Export, or `pg_dump`) and import it into the Outreach service.

## Check locally without Supabase
`npx vite build --config outreach-supabase/test/vite.check.config.ts` builds with an in-memory stand-in (`test/fake-supabase.mjs`).
The test sign-in is `organiser@example.test` with any password of 8 or more characters.
