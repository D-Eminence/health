# Health ID offline cards

An opt-in Playwright kit for the offline-first work: it automates test cards T1 to T20 of
[`docs/OFFLINE-CONTRACT.md`](../../docs/OFFLINE-CONTRACT.md) section 2.15 (amendments A1 to A8 apply) and lists R1 to R3
as manual checklists.

**The cards write to production.** A person runs them on their own computer, in visible browser windows, against
`ehr.`, `migrate.` and `app.healthidentitydirectory.com`, inside the sealed, fictional demo tenant (Demo Hospital).
A guard stops the whole run on the first thing that is not that tenant.

- Never part of CI. `npm test` at the root does not collect anything here; no workflow runs it. CI never points at
  production.
- A standalone package (not an npm workspace): its own `package.json`, lock file and `tsconfig.json`. No app code
  imports it, and it imports nothing from `apps/` or `packages/` (strings are mirrored in `support/selectors.ts`).
- Logins come from environment variables only, and never reach a report, a step title or a file.

## Set up (once per computer)

You need Node 22 or later, a computer with a display (macOS, Windows or a Linux desktop), and the demo logins the
coordinator gives you privately.

```bash
cd e2e/offline
```

```bash
npm ci
```

```bash
npx playwright install chromium
```

## The variables

Names only; the coordinator gives you the values privately. Set each secret so it never lands in your shell history:
`read -rs NAME && export NAME`, then type or paste the value and press Enter (nothing is shown). Never
`export NAME=value`.

| Variable | Required | What it is |
| --- | --- | --- |
| `HID_DEMO_STAFF_EMAIL` | yes (secret) | The demo staff login (must be the Demo Operations login) |
| `HID_DEMO_STAFF_PASSWORD` | yes (secret) | Its password |
| `HID_DEMO_PATIENT1_EMAIL` | yes (secret) | Demo Patient One's login (HID-ZDEMAAA2) |
| `HID_DEMO_PATIENT1_PASSWORD` | yes (secret) | Its password |
| `HID_DEMO_PATIENT2_EMAIL` | yes (secret) | Demo Patient Two's login (HID-ZDEMAAA3) |
| `HID_DEMO_PATIENT2_PASSWORD` | yes (secret) | Its password |
| `HID_E2E_RUN_ID` | yes | A new id for every invocation, for example `day1-main`, `day1-t7`, `day1-t16` (letters, digits, `.`, `-`, `_`) |
| `HID_E2E_T7_MODE` | no | `revoke` or `wait`: runs T7 only (see the run order). Set only when the coordinator says so |
| `HID_E2E_RELEASE_CARD` | no | `T16`, `T17` or `T19`: runs that release card only |
| `HID_E2E_OFFLINE_MODE` | no | `cdp` to simulate offline with `Network.emulateNetworkConditions` instead of `context.setOffline` (see first-run checks) |

```bash
read -rs HID_DEMO_STAFF_EMAIL && export HID_DEMO_STAFF_EMAIL
```

```bash
read -rs HID_DEMO_STAFF_PASSWORD && export HID_DEMO_STAFF_PASSWORD
```

Do the same for `HID_DEMO_PATIENT1_EMAIL`, `HID_DEMO_PATIENT1_PASSWORD`, `HID_DEMO_PATIENT2_EMAIL` and
`HID_DEMO_PATIENT2_PASSWORD`. In PowerShell 7.1 or later: `$env:HID_DEMO_STAFF_PASSWORD = Read-Host -MaskInput`.

The run id is not a secret:

```bash
export HID_E2E_RUN_ID=day1-main
```

`E2E_SELFTEST_FAKE_SECRET` is set by the kit itself for the selftest (a random throwaway value); never set it.

## Run the cards

```bash
npm run cards
```

`npm run cards` refuses to start, and names only what is wrong, unless every required variable is set, the card
projects run headed on a machine with a display, `CI` is not set, and `out/runs/<HID_E2E_RUN_ID>/` does not exist yet.
It then claims that run id. The first failure ends the run (`--max-failures=1`, no retries: a retry would repeat
production writes).

Keep the browser windows on screen and do not minimize them: the staff workspace locks as soon as its page is hidden.
Each device is its own window (its own profile), never a tab.

### The human check (Turnstile)

Production sign-in is protected by Cloudflare Turnstile, and the kit never tries to get around it. When the terminal
says `please complete the human check in this window`, complete the check in that window within 3 minutes; the kit
then signs in. Sign-ins per run: ehr. device A, ehr. device B, migrate. device A, the portal once per demo patient used,
T1's fresh profile, and again after T9 (device B) and T10 (device A) sign out.

The sign-in fields stay empty until the check is done. **If the check keeps looping (Turnstile may refuse a token to a
browser driven by automation), stop the run and report it to the coordinator. There is no workaround.** The kit never
retries a sign-in: five wrong passwords in 15 minutes lock a shared login for everyone for 15 minutes.

### Run order

Each line is its own invocation with a new `HID_E2E_RUN_ID`. Unset `HID_E2E_T7_MODE` and `HID_E2E_RELEASE_CARD`
between them (`unset HID_E2E_T7_MODE HID_E2E_RELEASE_CARD`).

1. **Main run**: `npm run cards`. T1 runs first (its own fresh profile), then T2 to T14 and T20 on ehr., T15 on
   migrate., T18 last. T9 runs on device B, after T5 (B's only card that needs a readable copy), so device A keeps its
   copy for the cards after it. T7, T16, T17 and T19 are skipped here; R1 to R3 are listed as manual.
2. **T7, last** (only if the coordinator decides T7 may revoke Patient Two's Demo Hospital share):

   ```bash
   export HID_E2E_RUN_ID=day1-t7 HID_E2E_T7_MODE=revoke
   ```

   ```bash
   npm run cards -- cards/T07
   ```

   `wait` mode instead needs the Demo Hospital share already gone, and waits about an hour for a 60-minute grant to
   expire while device A is offline.
3. **T16, T17, T19**: each its own invocation, started **before** the coordinator's release. For example T16:

   ```bash
   export HID_E2E_RUN_ID=day1-t16 HID_E2E_RELEASE_CARD=T16
   ```

   ```bash
   npm run cards -- cards/T16
   ```

   Phase 1 queues changes with the window offline, then waits (up to 5 hours). When the coordinator says the release
   is live, create the marker file from another terminal in `e2e/offline`:

   ```bash
   touch out/runs/day1-t16/release-live
   ```

   Phase 2 goes online and observes. The cards never change config or deploy anything. T17 is the kill-switch release
   (offline mode `off`), T19 the release that removes Demo Hospital from the pilot list.

### The cards

| Card | How | Device | What it does (every written row carries `E2E <run id>`, fictional content only) |
| --- | --- | --- | --- |
| T1 | automated | ehr. A-t1 (fresh profile) | Accepts the one-time offline choice (A5), keeps a chart, reloads offline: offline sign-in and "Saved copy from" |
| T2 | automated | ehr. A | Visit, note, vitals, prescription offline; applied once; no duplicate after a second reload (A8.3 hold recorded) |
| T3 | automated | ehr. A | Drops the connection mid-save and mid-upload; one key per command, no loss, no duplicate |
| T4 | automated | ehr. A | Flapping every 5 s for 2 minutes with 10 queued changes; all applied |
| T5 | automated | ehr. A and B | The same note revised on both offline; B gets CC2 with both versions; B's entry discarded |
| T6 | automated | ehr. A, portal Patient One | Allergy added in the portal while a prescription waits: CC4 hold; prescription discarded, allergy text restored |
| T7 | automated, own invocation, last | ehr. A, portal Patient Two | Access ends offline: chart removed, note held (CC5), sent with the same key after a new approval |
| T8 | automated | ehr. A | Idle 5 minutes (page clock): locks, password reopens, form text kept (never saved) |
| T9 | automated | ehr. B | Five wrong offline passwords: cache wiped, outbox, audit and media kept; then sent after an online sign-in |
| T10 | automated | ehr. A | Sign out offline: `/auth/logout` first on the next online load; waiting note sent after sign-in |
| T11 | automated | ehr. A | Page clock 10 minutes back: offline unlock refused |
| T12 | automated | ehr. A | Plaintext scan of every store: 0 matches for the patient's name, Health ID and the note text |
| T13 | automated | ehr. A | Emergency access for HID-ZDEMBBB2 (no login): nothing cached |
| T14 | automated | ehr. A | A 9 KB note refused at save with the split message; nothing sent |
| T15 | automated | migrate. A | A fictional photo with fake EXIF captured offline; uploaded without EXIF; chunks gone after apply |
| T16 | observe-only after a release | ehr. A | Update banner; Update now disabled while sending (A7); no automatic reload; never clicks Update |
| T17 | observe-only after a release | ehr. A | Kill switch: cache and shell caches wiped, waiting changes still sent, vault deleted (A8.5) |
| T18 | automated, read-only | ehr., migrate. A; portal Patient One | CSP report-only: header presence, console messages, securitypolicyviolation events |
| T19 | observe-only after a release | ehr. A | Demo Hospital removed from the pilot list: treated as the kill switch |
| T20 | automated, read-only | ehr. A, portal Patient One | Audit: offline `ehr.record.read` with offline details (read from `GET /api/v1/audit/events`), and the patient's access log |
| R1 to R3 | manual | real devices | See "Manual cards" below |

No card closes or revokes any grant of Demo Patient One, and "Close my grant" is never pressed.

## What the guard checks

Before any card acts, and for every request of every device (`support/guard.ts`):

- **Navigations**: a main-frame navigation may go only to the three Health ID hosts. Subframes (the Turnstile iframe)
  and page resources pass.
- **Staff session**: `actor.accountId` and `actor.id` (the account subject) are the demo staff's, `actor.email` is
  `HID_DEMO_STAFF_EMAIL` and the Demo Operations login, `actor.facility` is Demo Hospital and every
  `actor.facilities[]` is one of the four demo facilities. Checked after every sign-in and on every session the app
  reads. If a "Where are you working?" question appears, the kit chooses Demo Hospital and checks again.
- **Patient session**: the portal's signed-in Health ID (from `GET /api/v1/identity/me`) is HID-ZDEMAAA2 or
  HID-ZDEMAAA3, and the one that device is for.
- **Writes** (any method but GET and HEAD under `/api/v1/`): aborted if `X-Facility-ID` is not Demo Hospital, if the
  body names a Health ID outside the demo tenant, on any grant close, on any revoke from Patient One (and from
  Patient Two except T7's one Demo Hospital share), on any online sign-in during T9 and T11, on emergency access for
  a patient with a login, on a change to a demo patient's account settings, and on any write from a read-only card.
  Bodies are never changed: a request is continued or aborted.
- **Service worker writes**: a request watcher applies the same rules to everything the browser reports, service
  worker requests included, and stops the run if a bad write got past routing.

A refusal writes `out/runs/<id>/guard-stopped.txt`, closes every device and ends the run; every later card refuses to
start. Refusals never print a value.

## Reports

Everything one invocation writes is under `out/runs/<HID_E2E_RUN_ID>/`:

- `summary.md`: each card's result, notes and screenshot paths, the kit's own step titles, and the secret scan;
- `html/`: the Playwright report (`npx playwright show-report out/runs/<id>/html`);
- `results.json` and `test-results/` (screenshots, error context).

At the end of every invocation the kit searches every file in the run folder for every secret value set (raw,
escaped, inside base64, and inside the HTML report's embedded zip). A match fails the run and names the file: delete
that run folder, tell the coordinator, and share nothing from it.

Playwright 1.64 copies a password field's value into the page snapshots it stores when an assertion fails and when a
failed test ends; the selftest found this. So the kit waits for the human check with the fields empty, makes no
assertion while a secret is in a field, and empties password fields (and any field holding a secret) before
Playwright's end-of-test snapshot. Screenshots show passwords as dots; the email typed into a sign-in field is visible
in a screenshot only if the run stops in the few seconds between entering it and the sign-in answer.

## First-run checks (report each to the coordinator)

- **Offline emulation and the service worker**: whether `context.setOffline` also cuts off the active `/sw.js` is
  unverified. If T1's offline reload still reaches Health ID, run again with `HID_E2E_OFFLINE_MODE=cdp` (which covers
  pages but not the worker) and report it.
- **Routing and the service worker**: Playwright routing may not see requests a service worker handles. On this kit's
  localhost selftest (Playwright 1.64.1, Chromium 156) a write made by a service worker was routed and aborted; confirm
  on the first real run (the request watcher stops the run either way, but by then the write has left).
- **Turnstile**: whether it issues a token to the kit's browser (all requests are routed through the guard). If it
  loops, stop and report it.
- **Slow connection** (T3, T16): latency is added with CDP on each page; check that it holds while offline emulation
  is switched off and on.

## Restoring after T7

T7 in revoke mode removes Patient Two's seeded Demo Hospital share, which is never re-seeded; until Patient Two shares
again nobody can write to Patient Two's chart at Demo Hospital. After the 24-hour recovery hold: Patient Two signs in to
the portal, opens Access, chooses **Share my records**, and shares with the demo login at Demo Hospital (level
clinical collaboration, until revoked). Do not touch the Demo Outreach share.

## After the test day

Delete `out/`: the profiles under `out/profiles/` hold session cookies and the offline copies.

```bash
rm -rf out
```

## Manual cards

- **R1, low-end Android**: install nothing; open `ehr.` in Chrome on the phone, sign in at Demo Hospital, keep an
  offline copy, open Demo Patient One and keep it offline. Turn Wi-Fi and mobile data off, reload, and time the offline
  sign-in from tapping "Open offline copy" to the chart: under 3 seconds. Note the phone model and Android version.
  (The R1 entry in `cards/R1-R3.spec.ts` has an optional approximation with CPU throttling on a computer; it is not a
  substitute.)
- **R2, iPhone Safari installed to the Home Screen**: add `ehr.` to the Home Screen, open it from there, sign in, keep an
  offline copy, and open Offline and sync: note whether storage is kept ("The browser may clear this offline copy..."
  is shown when `persist()` was refused). Turn Wi-Fi off and check the offline sign-in. This cannot be automated here.
- **R3, shared ward PC**: two staff accounts on one computer profile, each signing in, keeping a copy and signing out in
  turn; neither can open the other's copy offline. Needs a second demo staff login, which does not exist yet.

## The selftest (localhost only)

```bash
npm run selftest
```

Runs on `127.0.0.1` only, headless, with no `HID_*` variable set. It proves the guard refuses (1) a session whose
facility is not Demo Hospital, (2) a facilities list with a non-demo id, (3) a wrong accountId or subject, (4) a write
with another `X-Facility-ID`, (5) a body naming a non-demo Health ID, (6) a grant close, (7) a missing variable (named,
never printed) and (8) a main-frame navigation to another host while a subframe to one still loads; and that a valid
demo session and write pass. It also checks the gate, `setSecret`, a service worker's write, and runs a separate
invocation that signs in with a throwaway password and fails on purpose with it in the field, then searches that run's
whole folder (HTML report zip, results.json, summary.md, error context, screenshots) for it.

`npm run list` lists every test with no variable set.

## After Stream B merges

Search for `TODO(stream-b)`: `support/selectors.ts` (the offline copy, ids and routes, mirrored from
`origin/offline/stream-b`), `support/devices.ts` (selecting a visit saved on the device) and T15 (the capture page's
visit list). Re-check each against the merged code and `copy.ts`, then run the selftest and `npm run list` again.

## Files

- `playwright.config.ts`: projects `selftest` (and `selftest-leak`, started by the selftest), `ehr-cards`,
  `migrate-cards` and `portal-cards`; outputs under `out/runs/<id>/`.
- `support/env.ts` (variables, read lazily), `guard.ts`, `devices.ts` (profiles, network and clock, sign-in, EHR and
  portal steps, fixtures), `storage.ts` (read-only storage report and plaintext scan), `selectors.ts`, `report.ts`
  (summary and secret scan), `global-setup.ts` (the cards gate).
- `cards/`: one spec per card; `selftest/`: the localhost selftest.
