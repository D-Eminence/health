# Integration log

## 2026-10-04: unified portal integration

- Audited the frontend against `hid-system` commit `c4b5445`. `Dashboard.zip`,
  `HID.html` and `hid-1.0` were used as visual/workflow references; backend
  routes and DTOs came from `hid-system`.
- Kept the public Next.js site separate from one Vite authenticated portal
  origin. Patient routes, `/provider/*` and `/admin/*` now mount under that
  portal. Public calls use the commercial pricing and demo endpoints; quote
  prices remain quotes.
- Connected supported patient, provider and platform screens to registered
  `/api/v1` browser requests, cookie sessions, CSRF and permission-aware UI.
  Provider coverage includes clinical records and versioned status changes,
  active Lab order creation, prescription handoff, Lab accession/specimen
  custody and execution/results, pharmacy, OCR and staff outreach.
- Added patient NIN re-verification, provider facility audit with server
  pagination, and provider registration-case review/enrollment by case ID.
  The registration screen checks the backend's NIN capability before offering
  new case creation. Staff and platform password reset use the existing public
  OTP service with their respective Turnstile actions.
- Added direct-route portal tests covering patient, provider and admin entry
  points. Local checks and builds are code-level verification; no deployed
  browser or staging acceptance is recorded.
- Confirmed with the user that no staging environment exists. Production needs
  same-origin `/api/v1` forwarding for host-only Strict cookies. A portal host
  outside the backend Turnstile allowlist needs a backend configuration change.
- Recorded patient consent and organization application backend defects,
  emergency detailed-chart restriction, non-persistent facility selection,
  Lab draft activation, registration-case continuity, cross-origin CORS
  mismatches, provider configuration gates and missing reference workflow contracts in
  [open questions](./OPEN-QUESTIONS.md).

## 2026-10-08: Phase 4 Stage 2B platform admin security

- Wired `apps/patient-web/src/admin` to the hid-system Stage 2A backend
  (`phase-4-stage-2-backend-security` at `7cbbf98`).
  - MFA sign-in, enrolment with one-time recovery codes, and recovery-code
    sign-in.
  - Step-up on `STEP_UP_REQUIRED`, which repeats the same command once.
  - Two-person approvals.
  - Own and per-account session management.
  - A restricted, confirmed export.
  - Backend problem codes mapped to messages; expiry warning and session-end
    notices.
- Shared transport:
  - download responses;
  - a refresh opt-out for one-time codes;
  - a fix so a cancelled shared read no longer cancels it for another caller.
- Verified with unit/component tests and a local Chromium run against the
  Stage 2A Identity API. Details and remaining items:
  [Phase 4 Stage 2B](./PHASE_4_STAGE_2B_FRONTEND_SECURITY.md).

## 2026-10-08: Phase 4 Stage 3 admin consolidation

- Consolidated `apps/patient-web/src/admin` as the one platform admin, with:
  - a grouped navigation map that also guards routes and sub-pages;
  - not-found and access-denied pages;
  - one module per area.
- Completed the backend-supported surfaces:
  - an overview of backend totals and waiting work;
  - application review (verify CAC, approve into a new or existing
    organization, reject);
  - facility filters, paging and detail;
  - users and roles search and paging;
  - the full audit filters and fields;
  - integration settings, history and route choices;
  - demo, review and delivery-failure views.
- Hardening:
  - confirmations survive the refresh after a change;
  - 409 refusals are explained;
  - settings are shown only for allow-listed keys;
  - user search terms are kept out of URLs;
  - the session warning no longer misses a window recorded just before it
    subscribed.
- No backend, dependency or Stage 2 security change. Verified with component
  tests and local Chromium runs against the Stage 2A Identity API. These found
  two backend defects in platform controls (a missing runtime grant, and a
  change command that always fails), fixed in D-Eminence/hid-system#20
  (merged into `phase-3-patient-safety`, not deployed). Details and gaps:
  [Phase 4 Stage 3](./PHASE_4_STAGE_3_ADMIN_CONSOLIDATION.md).

## 2026-10-09: Phase 4 governed access for providers

- Selected by an evidence-based capability audit of both repositories as the
  highest-priority unfinished capability: providers could not see their own
  access requests. Through hid-system `aa72e83` that route answered `403` for
  every clinician because of a missing runtime grant. The backend fix is
  D-Eminence/hid-system#26.
- Access requests: status filter (sent to the backend), and plain wording for a
  refusal (`CONSENT_COMMAND_DENIED`, facility errors), also on the dashboard tile.
- Patient access: the grant that opened a record comes from the lookup's
  `consentGrantId`, so a record opened from an approved request can be closed.
  Before, only a PIN or emergency grant opened during the same page visit could.
  The lookup types now match the backend (`consentGrantId`, `gender`, `version`).
- Clinical record: change forms appear only when `POST /identity/consent-status`
  reports `writeAllowed`, and stay hidden if the check fails. A patient PIN
  grants reading only, so the forms used to fail with `403 CONSENT_REQUIRED`.
- Component tests cover each behaviour; five of the seven fail on the previous
  pages. No staging or browser acceptance against a deployed backend.
- Access requests also show what became of each approval: the grant's outcome
  (active until a time, expired, closed by you, revoked), how access was given
  (patient approval or PIN), and **Close access** for an active grant. These
  fields come from hid-system migration 0074; with an earlier Identity build
  the page shows the request status as before.
- Merged to `main`, not deployed: D-Eminence/Health-id#18 and
  D-Eminence/Health-id#19 here, and D-Eminence/hid-system#26 and
  D-Eminence/hid-system#28 in the backend. The hid-system release checklist
  (`docs/PHASE_4_STAGE_5_RELEASE_READINESS.md`) lists the deployment order:
  0074, then the role bootstrap at once, then Identity. It also lists the
  staging browser check of the full request, approve, close and revoke loop.

## 2026-10-09: Phase 4 Stage 6 OCR backend (no portal code change)

- hid-system D-Eminence/hid-system#30 (migration 0075) affects the provider
  portal's OCR pages without any change here:
  - patient confirmation and publication had always failed under the
    least-privilege OCR runtime, because row-level security refused their
    outbox insert. They now commit;
  - a second confirmation of the same job version answers
    `409 OCR_PATIENT_ALREADY_CONFIRMED`, which the confirmation form shows as
    an error;
  - the job lookup by document, the validation list and the publication list
    are now audited and linked to the patient on the server.
- Response shapes are unchanged, and every OCR call already sends
  `X-Facility-ID` and `X-Purpose-Of-Use`. Verification was local only (unit,
  SQL and synthetic rehearsal in hid-system). The staging OCR check is S4b of
  the hid-system release checklist.

## 2026-10-09: Phase 4 Stage 7 backend (no portal code change)

- D-Eminence/hid-system#32 (migration 0076) changes three backend behaviours
  that the portal already handles:
  - **Admin console MFA.** A sign-in, step-up, recovery-code regeneration or
    enrolment could deadlock with a second Super Admin's approval of an MFA reset
    of the same account, and then failed with `500`. It now waits for the
    approval and is refused with
    `401 MFA_CHALLENGE_INVALID`, for a sign-in or enrolment, or
    `403 PLATFORM_SESSION_REQUIRED`, for a step-up or regeneration. The console
    already restarts sign-in on the first (`SignIn.tsx`) and treats the second
    as an ended platform session (`admin/api.ts`).
  - **Parallel MFA attempts.** MFA requests of one administrator now run one at
    a time. Parallel second-factor attempts, such as a double-submitted
    step-up, are checked against the failure limit one after another, so the
    limit holds; past it the console shows its existing `MFA_RATE_LIMITED`
    message (`admin/problems.ts`). A second password step supersedes the
    first's challenge, as a sequential one already did.
  - **OCR patient confirmation and validation.** The database now refuses a
    confirmation or validation when it cannot read a compared value (the source
    document, the extraction, or the session's account or membership). It also
    refuses a confirmation that names another member than the signed-in one.
    The portal always sends the signed-in member's own context, so its requests
    are unchanged. Under a database owner that cannot read the source document
    (hid-system release checklist P8), every confirmation now fails (`500`),
    where before one for any patient was accepted.
- Verification was local only: unit tests, a two-connection race in the
  Identity runtime verifier, a SQL suite and the synthetic rehearsal in
  hid-system. No staging run exists.

This log records implementation scope, not a release sign-off. The reference
[gap map](./HEALTH_ID_COMPLETE_FRONTEND_GAP_MAP.md) is a baseline audit rather
than a live completion tracker.

## 2026-10-11: launch-readiness review (patient portal, EHR, Migrate/OCR)

- Compared every browser route in the registry with hid-system `main` at
  `54f79d2`: all 172 exist (the two gateway health checks are served by
  nginx). Request bodies for patient, EHR and OCR calls match their DTOs under
  the services' strict validation.
- Recorded the launch blockers found in hid-system in
  [open questions](./OPEN-QUESTIONS.md): patient-scoped reads refused for cookie
  sessions, the OCR purpose of use, the OCR runtime locks, OCR review and
  publication retry, and logout after an idle period.
- Fixed in this repository (branch `claude/launch-readiness-fixes`):
  - Patient sign-out after more than 15 minutes idle ends the server session.
    It restores the session once and repeats the logout, but never for another
    account.
  - Linking Google during enrollment keeps the patient at the step they had
    reached, instead of sending them back to the contact step.
  - A clinical record closes when the access check is refused with 403 or 404,
    as when a grant has expired, been revoked or been closed. Before, the chart
    stayed open with each action failing.
  - OCR: a job is offered for creation only after a lookup has answered that
    none exists, so a failed lookup cannot create a duplicate. A clean
    clinical document links to OCR, handing over its IDs in router state, not
    in the URL.
- Component tests only. No browser, staging or deployed-backend run.

## 2026-10-11: EHR clinical corrections

- Checked against hid-system `main` at `54f79d2` (`ehr/shared/clinical.dto.ts`
  and the diagnoses, vitals and lab-requests services and migrations).
- A diagnosis can be changed: clinical status, verification (including entered
  in error) and notes, with the loaded row version and a reason. Only changed
  fields are sent, because `UpdateDiagnosisDto` has no `status` and EHR refuses
  unknown fields. A diagnosis marked entered in error offers no further change.
- Vitals can be corrected. EHR appends a correction and keeps the recorded
  values, so the record shows the latest correction as current and the
  recorded values beneath it. A correction is prefilled with the current values
  and a retry reuses its idempotency key. If the correction cannot be read, the
  record says so and offers no further correction.
- A lab request's status can change only while it is a draft (cancel, mark
  entered in error). EHR does not pass status changes to Lab, so nothing is
  offered for an active or on-hold request, and draft to active is not offered
  because it never reaches Lab.
- Recorded the backend gaps in [open questions](./OPEN-QUESTIONS.md): changes
  to a request Lab has accepted, and corrected vitals in the patient's record.
- Builds on D-Eminence/Health-id#29 (vitals input limits), merged into this
  branch.
- Component tests only. No browser, staging or deployed-backend run.

## 2026-10-11: clinical record paging

- Checked against hid-system `main` at `54f79d2`. Encounters and each
  encounter's notes, vitals, diagnoses, prescriptions and lab requests come 50
  to a page, newest first, with an opaque `nextCursor` and no total. Documents,
  note revisions and vital corrections are not paged by the backend.
- The clinical record showed only the first 50 of each. It now pages encounters
  and record lists the way the reference design (`Dashboard.zip`, record lists
  in `src/workflows.tsx`) does: "Previous page", "Page N" and "Next page" in a
  navigation landmark, shown only when there is more than one page and disabled
  at either end. The backend gives no total, so there is no "of M".
- A change re-reads the page shown, as a request of its own, so it never takes
  the answer of a read started before the change. A new encounter or record
  goes back to the first page, where it is. Changing the patient, facility,
  encounter or tab starts at the first page. A cursor the backend no longer
  accepts starts the list again, and says so.
- Paging never changes the encounter being documented: only choosing a row or
  starting an encounter does. A new encounter is documented even when its start
  time puts it past the first page. An unsaved record draft is cleared when
  another encounter is chosen, instead of being saved against it. The list marks
  the encounter being documented and says when it is on another page; a refresh,
  or a status change refused because the encounter changed meanwhile, reads that
  encounter again, so its status and version stay current.
- The pager sits above the list. Its buttons are marked unavailable rather than
  disabled, so the one pressed keeps keyboard focus, and the page reached is
  announced. A failed page read is reported beside the list.
- Fixed a race found on the way: a re-read after a change that finished after
  the clinician had moved to another tab replaced that tab's rows. A re-read
  after a change reads the page last asked for, so a page move made while the
  change was saving is not undone.
- Recorded in [open questions](./OPEN-QUESTIONS.md) that EHR's cursor keeps only
  milliseconds, so rows within the same millisecond as a page's last row can be
  skipped.

## 2026-10-11: OCR patient confirmation retry

- Checked against hid-system `main` at `54f79d2` (`ocr.service.ts`
  `confirmPatient`). OCR takes one patient confirmation per job version, and
  answers a second with `409 OCR_PATIENT_ALREADY_CONFIRMED`. It replays a
  confirmation sent again with the same `Idempotency-Key`.
- The portal sent a new key on every attempt, so a retry after a confirmation
  that had been recorded (for example, when the response was lost) was refused
  with that 409 and the form stayed. A retry of the same confirmation now
  reuses its key, and if the job turns out to be confirmed already the page
  reloads the job and says so. The job status shows when its source patient
  was confirmed.
- Component tests only. No browser, staging or deployed-backend run.

## 2026-10-11: staff session landing (#25, #30)

- Checked against hid-system `main` at `54f79d2`. A staff session that ends,
  expires or is revoked gets only a generic `401 AUTHENTICATION_REQUIRED`, every
  refresh rotates the session, a refresh token presented twice revokes the whole
  session (`token.service.ts`), and logout ends whichever session the cookies
  carry.
- Lands D-Eminence/Health-id#25 (session end) and D-Eminence/Health-id#30
  (session lock) through D-Eminence/Health-id#34, with `main` merged in. The
  provider portal confirms a refused session with the server before acting,
  locks the workspace while it asks, ends it cleanly once the server confirms,
  and keeps each session's requests to itself. It locks when the page is hidden
  or left, and hears sign-ins and sign-outs from other tabs and the patient
  portal. The full behaviour is in [open questions](./OPEN-QUESTIONS.md),
  "Staff session end".
- Fixed in review before landing:
  - Refreshes take turns across windows, with the patient portal's, where the
    browser supports Web Locks. A window that waited reads the session the
    other refresh left before refreshing again, so two windows do not present
    the same refresh token.
  - Signing in (staff, patient password, patient Google) waits its turn, so
    another window's refresh cannot replace the new session's cookies.
  - Sign-out from a locked workspace asks the server first and signs out only a
    session that is still this account's.
  - A session change announced while the portal is still opening is checked
    once the workspace opens, instead of being missed.
  - A document handed from an encounter's Documents to OCR opens there only
    for the same account and facility, and only once, so it is not reapplied
    by back or forward navigation or after another account signs in.
- Recorded in [open questions](./OPEN-QUESTIONS.md): logout cannot be limited
  to the session the portal means to end, so a sign-in in another window
  between the check and the logout is still signed out. hid-system branch
  `claude/session-logout-and-refresh-kind` (unmerged) proposes `X-HID-Client`
  on refresh; the portals will send it once that is deployed.
- Component tests only. No browser, staging or deployed-backend run; Web Locks
  and `BroadcastChannel` are stubbed in the tests.

## 2026-10-11: Markdown audit against `main`

- Checked every Markdown file in the repository against `main` at `101cd62`,
  and backend claims against hid-system `main` at `54f79d2`. Each stale claim
  was checked a second time before it was changed. Dated records (this log and
  the phase reports) keep their original text, with a "since changed" note
  where they read as current.
- The provider organization application has no backend argument mismatch:
  hid-system migration `0052_authoritative_cac_identity.sql` replaced the
  six-argument function with the five-argument one the service calls. The
  architecture notes, gap map and open questions said submission was blocked.
  The public `/provider/apply` page sends providers to the portal's
  `/provider/enroll`; the form that submits an application directly is not on
  any page.
- The gap map now marks as built what `main` has: patient and provider
  sign-in and sessions, Google sign-in and enrollment, the single portal, the
  clinical record (encounters, vitals with corrections, notes with revisions,
  diagnoses, prescriptions and lab requests, all paged), and OCR validation and
  patient confirmation. It no longer says patient grant revocation, account
  deletion and consent decisions lack patient-scoped routes.
- The architecture notes describe the per-host Turnstile actions hid-system
  accepts and the action staff sign-in sends; README and architecture name the
  hid-system commits the integration was checked against.
- Open questions now say the patient consent fixes are on hid-system `main`
  (not deployed), the staff sign-in host action is on `main`, and neither
  portal sends `X-HID-Client` yet. The Stage 2B report notes the backend gaps
  hid-system Stage 4A has since closed.
- `apps/public-web/AGENTS.md` again matches the block `next dev` writes, so
  running it no longer rewrites the file. The motion README lists the
  components that exist and drops the removed tilt card.
- Docs only; no code change.

## 2026-10-11: sign-out in the session turn

- Found by the final review of D-Eminence/Health-id#34; the gap predates it.
  hid-system's logout, once accepted, clears the session cookies in its answer
  (`auth.controller.ts`; a refused logout clears nothing), and ends whichever
  session the cookies carry. A sign-out in one window answered after a sign-in
  in another, so the new sign-in was lost and that window showed "Your session
  has ended".
- Staff and patient sign-outs now take the same Web Locks turn as refreshes and
  sign-ins (`signOutInTurn`), and so does provider enrollment activation, which
  also signs in. Before the logout, the server is asked whose session the
  browser holds, and the logout is sent only while it is still this account's.
  Another account signed in meanwhile, staff or patient, is left alone: logout
  would otherwise end it. The provider portal asks when its sign-out had to
  wait; the patient portal, which does not hear other windows sign in, always
  asks.
- A refused question is handled as a refused sign-out: the session is restored,
  and its account confirmed, before the logout is sent again. hid-system also
  answers 401 when it cannot check a session, so a 401 is not taken as this
  account's. Any other failure stops the sign-out, and the page reports it as
  failed.
- hid-system's staff actor carries no `kind`; only patient and platform actors
  do. The patient portal now recognises its own session by `kind: 'patient'`
  and the subject, in the new check and in the existing restore after an idle
  sign-out, so it never ends a staff session of the same person (one account
  can hold both). The provider sign-out names its account when it starts, and
  checks the session against it and against any session it restores, so
  leaving the workspace while it waits does not drop it.
- Recorded in [open questions](./OPEN-QUESTIONS.md): a sign-out that waited for
  another window's sign-in leaves the session it meant to end alive on the
  server until its idle limit, though it is no longer in this browser.
- The patient sign-out tests now mock the environment as one object, as the
  real getter caches it; a new object each render had rebuilt the client and
  checked the session again on every render.
- Component and unit tests only, with fake Web Locks. No browser, multi-window,
  staging or deployed-backend run.

## 2026-10-12: provider password recovery from product sites

- Checked against hid-system `main` at `54f79d2` (`turnstile.service.ts`).
  `staff-reset`, the check that starts a staff password reset, is accepted only
  on `www.healthidentitydirectory.com` and `staging.healthidentitydirectory.com`.
  Each staff product host accepts only its own sign-in action, so the
  "Forgot your password?" link on the provider sign-in page, which stayed on
  the product host, led to a recovery page the backend refuses. That applied to
  `ehr` as well as `lab`, `pharmacy`, `migrate` and `outreach`.
- Decided: recovery stays on the main site, and the backend allowlist is
  unchanged. On a staff product host, in production or staging, the link now
  goes to the main site's `/provider/recover` and says resets are done there.
  The admin site gets the same link: it accepts only `admin-login` and
  `admin-reset`. Elsewhere (www, staging, local) it stays on the site.
  `/provider/recover` opened directly on a product or admin host (a bookmark,
  history) shows that notice and link instead of a form the backend refuses,
  and the admin approval message no longer says product-site setup is coming. The link is built only
  from fixed addresses (`staffRecoveryHref` in `productHostname.ts`, shared with
  the admin approval message and the route), copies nothing from the hostname
  and carries no return address. The recovery page follows no return address
  either, and after a reset its sign-in link stays on the main site.
- The recovery flow itself (requests, Turnstile action, success and failure)
  is unchanged. The gap map's password recovery row, still marked BUILD, now
  says BUILT.
- Component and unit tests only. hid-system's Cloudflare configuration serves
  www with its own `apps/web` today, not this portal, so the links cannot be
  checked live until the portal is deployed there. No browser, staging or
  production run.

## 2026-10-12: narrow screens and keyboard focus (accessibility audit, first batch)

- The gap map has no accessibility row; its only responsive row is "Shared
  visual system/responsiveness", marked IMPROVE. An audit of the launch screens
  (patient sign-in, enrollment, recovery and records; provider sign-in, the
  workspace and the clinical record; OCR) against WCAG 2.2 AA and the reference
  design's rules found 51 issues; a second reviewer confirmed 49 and refuted 2.
  Each was checked in the code, and the layout ones measured in headless
  Chromium against a build of `main` with the API mocked.
- This batch fixes the narrow-screen layout and focus visibility (audit ids
  PEHR-01, A11Y-BR-01, A11Y-BR-03, PR-01, PA-09, PA-01, PR-02, A11Y-BR-02):
  - Below 900px the provider workspace grew to its navigation strip's width
    (573 to 614px at 320 to 390px), so every provider page scrolled sideways.
    The single column is now `minmax(0, 1fr)`, as are the two-column forms
    below 700px.
  - Long values without spaces widened the page: file and facility names in
    the patient records (415px at 320px) and access (390px at 320px) lists and
    the clinical record's documents, and a long email repeated on enrollment's
    code step (472px at 320 to 390px). They now wrap. A list item's trailing
    note wraps anywhere only on a phone, where the item is one column; beside
    the title column it wraps between words, because wrapping anywhere there
    split short notes ("Uncontrolle" / "d").
  - Cloudflare's Turnstile widget is at least 300px wide, so at 320px every
    sign-in and recovery page was wider than the screen (354px; 340px for
    provider sign-in). A slot narrower than 300px now gets the compact widget
    (`turnstileSize` in `Turnstile.tsx`, also used by provider sign-in).
  - Tabbing backwards put focused controls under the sticky patient header and
    provider top bar: one to three focus stops per patient page, and the
    facility selector on the clinical record at 390px. The page now keeps 80px
    clear at the top (`scroll-padding-top`), more than any sticky header
    (patient 67px, provider 62px, admin mobile 56px).
  - Below 900px the navigation is a horizontal strip, and Chromium leaves a
    focused link that is partly showing where it is, so tabbing backwards left
    links as slivers at the strip's edge. For keyboard focus only, the strip,
    and never the page, now scrolls by the part cut off (`revealFocusedLink`).
- The review of the first version found that it scrolled the page from the
  focus event: presses on a nav link near the top of the screen were lost (48
  of 132 in the reviewer's test) and the page jumped back to the navigation
  when the tab or window was focused again. Moving the strip under a pointer
  press lost the click too. All three are fixed and measured: no lost presses
  on patient or provider links at 390 and 1280px, including on a link only
  partly showing, and no page movement on refocus.
- Measured after the change, in headless Chromium: no page overflow at 320,
  360, 390, 768 or 1280px on eleven screens (`/sign-in`, `/enroll`, `/recover`,
  `/provider/sign-in`, `/provider/recover`, `/records`, `/access`, `/settings`,
  `/provider/patients`, `/provider/ocr`, and `/provider/clinical` with a patient
  open on the Documents tab; 19 of the 55 overflowed before), nor on
  enrollment's code step at 320 to 390px; no word split in list notes from 320
  to 1440px; and no focus stop hidden or partly visible when tabbing backwards
  through patient settings and overview and the provider clinical record at
  390 and 1280px. The widget renders compact (146px tall) at 320px and full
  size at 390px.
- Regression tests guard the stylesheet rules by the value that wins at each
  width (`NarrowLayout.test.ts`, since jsdom lays nothing out), the widget size
  (`TurnstileSize.test.tsx`, provider sign-in tests) and the navigation strip
  (`NavStripFocus.test.tsx`, the staff session tests).
- Remaining confirmed findings, by audit id, most severe first (41):
  - High: OCR-A11Y-01 (focus lost after each OCR step); PEHR-02 (the facility
    selector switches facility as soon as its value changes); PEHR-03 (the
    Health ID field disables its buttons without saying why).
  - Medium: PA-07, OCR-A11Y-05, PEHR-08 (input borders 1.28:1); A11Y-BR-05,
    OCR-A11Y-03, PEHR-07, A11Y-BR-06 (success and warning badges and text below
    4.5:1); PEHR-06 (provider links look like plain text); PR-03 (patient
    actions drop focus to the page); PA-02, PA-03, PA-04, A11Y-BR-04 (focus
    after a step change in enrollment and recovery); PA-05, PEHR-04,
    OCR-A11Y-02 (errors not tied to their fields); PEHR-05 (one page title for
    every provider page).
  - Low: A11Y-BR-07, PEHR-12 (faint small text); OCR-A11Y-08, PA-08
    (placeholder contrast); PEHR-09, A11Y-BR-08 (two h1 headings on the clinical
    record); OCR-A11Y-09, PEHR-13 (states with no h1 or main landmark);
    OCR-A11Y-06 (Patient ID required only visually); PEHR-10 (tab roles without
    tab panels); PEHR-11 (focus after opening a patient); PEHR-14 (Field hint
    and error ids never referenced); PA-06, PR-08 (field errors for NIN, code
    and password); PA-10 ('Request another code' clears the contact); PA-11 (the
    Google button's disabled state); PA-12, PR-06 (page titles); PR-04, PR-05
    (focus after 'Try again' and 'Revoke access'); PR-07 (the Access PIN field
    does not say 4 to 8 digits).
- Headless Chromium on this machine only; no other browser, assistive
  technology, device, staging or production run.
