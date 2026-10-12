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
  asks. (Since changed: the patient portal now listens on the same channel and
  still always asks before signing out; see the 2026-10-12 readiness series.)
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

## 2026-10-12: portal-named session cookies, the three high accessibility findings, recovery hosting (accessibility audit, second batch)

- **Session cookies (`X-HID-Client`).** hid-system #39 (on `main` at `522fb2e`,
  not deployed) reads `X-HID-Client` on cookie `POST /api/v1/auth/refresh` and
  `/auth/logout`. While the other portal's sign-in could still be renewed, it
  refuses it with `403 SESSION_CLIENT_MISMATCH`, rotating and ending nothing and
  keeping the cookies. Health-id sent no header, so a provider tab that had not
  heard of a patient's sign-in could end it on sign-out, and either portal's
  refresh could rotate the other's.
  - `@hid/http`, in cookie mode, now sends the client's own `clientId`
    (`patient-web` or `staff-web`) on those two POSTs and on no other call. It
    is sent on every attempt, and a caller's header cannot replace it.
  - Patient portal: a sign-out refused this way ends only its local session
    and announces nothing, since the cookies did not change. A refresh refused
    this way already ended the session as a 401.
  - Provider portal: a refused refresh is the ended session it is (as
    `CSRF_VALIDATION_FAILED`), and a refused sign-out completes locally. Neither
    retries.
  - CSRF, Origin and cookie handling are unchanged. Expiry, a refused refresh
    (401), a missing refresh cookie (403 CSRF), network failures and 503s keep
    their own handling.
  - Tests: the shared client's header tests; patient and provider portal tests
    (`PatientSessionClient.test.tsx`, `staff/SessionClient.test.tsx`); and
    `SharedBrowserSession.test.tsx`, both real portals in one document against a
    model of #39's cookie contract. 18 fail on `main` `1b17b5c`.
  - Local integration: Health-id's client against a local Identity built from
    hid-system `522fb2e` (Postgres 16, migrations 0001 to 0077). One cookie jar
    was shared by both clients, with the Origin header, a real CORS preflight
    and the CSRF cookie. 138 of 140 checks passed:
    - each portal refreshes and signs out only its own sign-in;
    - the other portal's sign-in is refused with no cookie set and the refresh
      token unchanged;
    - the refresh-cookie path behaves the same;
    - the header appears only on the two POSTs;
    - the preflight admits `x-hid-client`.
  - The two failures are one backend defect (next item).
- **Backend contract mismatch, reported, not fixed here.** At `522fb2e`, a
  cookie sign-out whose live access cookie is a staff sign-in, refused for
  `SESSION_CLIENT_MISMATCH` or `CSRF_VALIDATION_FAILED`, answers
  `503 DEPENDENCY_UNAVAILABLE` instead of the documented 403.
  - Cause: the global `AuditInterceptor` audits the refusal as
    `api.post./api/v1/auth/logout` for the staff actor with no facility, which
    `AuditService.assertActorFacility` refuses.
  - Nothing is ended. The frontend does not treat a 503 as a mismatch.
  - See [open questions](./OPEN-QUESTIONS.md), "Refused staff cookie sign-out
    answers 503".
- **OCR-A11Y-01 (high).** Each OCR step removed the control that ran it, so
  focus fell to the page and nothing said whether the step worked.
  - After create, retry, validate or reject, confirm and publish, once the job
    and its evidence have been read again, focus moves to where the work
    continues: the source patient confirmation, the review and publication
    history, or Job status.
  - A status region mounted throughout says what was recorded, naming the next
    step only when it is shown.
  - A refused request keeps its message and values, and gives focus back to its
    control once that control is enabled again. A refused retry is reported in
    the retry form.
  - A field refused before sending shows its error at the field, tied to it,
    and takes focus. This also fixes OCR-A11Y-02 (medium).
  - The provider workspace moves focus to a new page's heading when a page
    change takes away the control the user was on: Back, Forward, or a
    document's Extract with OCR (`staff/pageFocus.ts`; since moved to
    `src/pageFocus.ts`, shared by both portals).
  - Tests: `OcrFocus.test.tsx` (31; 21 of the first 26 fail on `main`, and the
    five added after review fail before their fix; four refused-request cases
    need a real browser, because jsdom keeps focus on a disabled control).
- **PEHR-02 (high).** The "Working at" list switched facility as soon as its
  value changed, so one arrow key on a closed list closed the open patient.
  - Choosing a facility now only proposes it. A question names the current and
    proposed facilities, and that the open patient record will close.
  - Switch facility confirms it, with the same `POST /api/v1/auth/facility`.
    Cancel keeps the current facility and returns focus to the list.
  - The confirm button stays enabled while the switch runs, so focus stays on
    it. After the switch, focus moves to the overview's heading.
  - A proposal is dropped when the account or its facility changes (refresh,
    another tab, lock, next session).
  - Backend dependency: the choice is not kept across a reload. `/auth/session`
    resolves the primary facility, else the first by name (see open questions).
  - Tests: `FacilitySwitch.test.tsx` (9; 8 fail on `main`). The 14 switches in
    `SessionEnd.test.tsx` now choose and confirm, with unchanged assertions.
- **PEHR-03 (high).** A Health ID in the wrong format disabled both access
  buttons silently.
  - The format check is unchanged (HID_PATTERN, as hid-system's DTOs) and runs
    when either form is sent.
  - A hint states the format, and an empty or mistyped Health ID is reported at
    the field: marked invalid, tied to the message, focused, nothing sent.
  - The message is also an alert, new for each refusal, because Enter in the
    focused field does not move focus.
  - Tests: `PatientHealthIdField.test.tsx` (9; 6 of the first 8 fail on
    `main`, and the added one fails before its fix).
- **PEHR-11 (low)** is covered by the same page-change focus.
  - Opening a patient moves focus to the clinical record's heading, and a
    facility switch from the overview to its heading.
  - Tests: `staff/PageFocus.test.tsx` (4; 2 of the first 3 fail on `main`, and
    the added one fails before its fix).
- **Recovery and hosting.**
  - Checked in headless Chromium with the API mocked. On the six staff product
    and admin hosts, in production and staging, provider sign-in links to
    `/provider/recover` on www or staging. Opening `/provider/recover` there
    directly shows the notice and that link, not a form, and sends no request.
    A crafted `returnTo` or `next` never appears in a link. www and staging
    show the form, and the admin host keeps its platform recovery form.
  - The links are not live. At hid-system `522fb2e`, `www` and `staging` are
    served by the `hid-web` worker with hid-system's own `apps/web`, which has
    no `/provider/recover`: its catch-all redirects to `/`, and its staff reset
    is on `/hospital/auth`. Each product host is served by its own hid-system
    app, and Health-id has no deployment configuration.
  - The links work once this portal serves the product hosts and www (or at
    least `/provider/recover` there). D-Eminence/hid-system#41 (open) adds that
    fixed route to hid-system's `apps/web`, so they also work with today's
    hosting once it is released. Nothing was deployed and no DNS or hosting
    setting was changed.
- **Launch readiness, by workflow and level of evidence:**
  - Patient (enrollment, sign-in, records, access, sign-out): component tests.
    Headless Chromium, with the API mocked, only rendered the sign-in,
    enrollment (to its code step), recovery, records, access and settings
    screens at 320 to 1280px (layout and focus visibility), and checked the
    refresh header and a refused refresh on `/settings`. No patient workflow,
    sign-out included, was driven in a browser. The cookie refresh and sign-out
    contract is checked against a local Identity through Health-id's client,
    not through the patient screens. Not verified in staging or production.
  - Provider (sign-in, patient access, clinical record, facility switch,
    sign-out, recovery): component tests. Driven in headless Chromium with the
    API mocked: patient access (the Health ID field), the facility switch from
    the clinical record and from Patient access, the OCR steps, a sign-out
    refused as a mismatch, and the recovery links. Sign-in was not submitted
    in a browser. The local Identity run covers staff sign-in, refresh and
    sign-out through the client. Product-host recovery and sign-in await the
    hosting above. Not verified in staging or production.
  - Migrate/OCR: code level and headless Chromium with the API mocked only. No
    local OCR service was run, since extraction needs Textract. Migrate project
    and bulk work has no backend contract (`MigrateGap`). Not verified in
    staging or production.
- **Review.** An adversarial review, with each finding put to a second
  reviewer to refute, confirmed nine findings and refuted one. Session security
  had none: it also checked two real tabs with Web Locks and BroadcastChannel.
  The fixes are in their own commit, with tests that fail before it:
  - Major: after a refused request, focus went back to the submit control even
    when the user had gone to another field while it ran. Their typing was cut
    short, and a space then pressed the button, so a review or confirmation
    could be recorded with a cut-short reason. Focus now goes back only when it
    was lost.
  - A late step move took focus from a field the user had gone to, and a later
    lookup could bring back an old message. The move now leaves the user's
    focus alone, and a lookup or Document ID edit cancels it.
  - A step or a page change during a workspace lock lost its focus move. Both
    now wait for the workspace to open.
  - The Health ID error from Enter in the field was not announced. It is now an
    alert.
  - A switch from a page other than the overview briefly focused the old
    page's heading. It no longer does.
  - Docs: the facility a reload shows (the primary, else the first by name),
    and two claims of browser checks that had not been run. Both checks were
    added and pass.
  - Pre-existing, recorded in open questions: a publication that failed in its
    owning service cannot be retried from the portal.
- **Verification:**
  - `npm test`: 1007 tests passed.
  - `typecheck`, the patient app's `tsc --noEmit`, `lint`, `audit:boundaries`
    and `git diff --check` all passed.
  - Both builds passed. The public site was built in the main checkout at
    `8b56680`, before the review fixes, which change no file it uses;
    Turbopack does not build from this worktree's linked dependencies.
  - Headless Chromium on the built portal, with the API mocked, passed 39 of
    39 checks:
    - the headers;
    - by keyboard, each OCR step (find, create, validate, reject, confirm,
      publish, retry) and each refusal (find, create, review, confirm,
      publish, retry);
    - typing elsewhere during a refused request or a late step;
    - Back to OCR;
    - ArrowDown and the switch, from the clinical record and from Patient
      access;
    - the Health ID field and its alert;
    - the recovery links on 14 hosts.
  - The width matrix from the first batch showed no overflow at 320 to 1280px
    on its 55 screen and width pairs, and no focus stop hidden when tabbing
    backwards. The new question, Health ID error and OCR field error fit at
    320, 360 and 390px.
  - No other browser, assistive technology, device, staging or production run.
    This is not a claim of WCAG conformance.
- Remaining confirmed findings, by audit id, most severe first (36):
  - High: none.
  - Medium:
    - PA-07, OCR-A11Y-05, PEHR-08: input borders 1.28:1.
    - A11Y-BR-05, OCR-A11Y-03, PEHR-07, A11Y-BR-06: success and warning badges
      and text below 4.5:1.
    - PEHR-06: provider links look like plain text.
    - PR-03: patient actions drop focus to the page.
    - PA-02, PA-03, PA-04, A11Y-BR-04: focus after a step change in enrollment
      and recovery.
    - PA-05, PEHR-04: errors not tied to their fields.
    - PEHR-05: one page title for every provider page.
  - Low:
    - A11Y-BR-07, PEHR-12: faint small text.
    - OCR-A11Y-08, PA-08: placeholder contrast.
    - PEHR-09, A11Y-BR-08: two h1 headings on the clinical record.
    - OCR-A11Y-09, PEHR-13: states with no h1 or main landmark.
    - OCR-A11Y-06: Patient ID required only visually.
    - PEHR-10: tab roles without tab panels.
    - PEHR-14: Field hint and error ids never referenced.
    - PA-06, PR-08: field errors for NIN, code and password.
    - PA-10: 'Request another code' clears the contact.
    - PA-11: the Google button's disabled state.
    - PA-12, PR-06: page titles.
    - PR-04, PR-05: focus after 'Try again' and 'Revoke access'.
    - PR-07: the Access PIN field does not say 4 to 8 digits.
- **Second review, before publication.** A second adversarial review of the
  whole branch (session security, the focus fixes, the facility switch, the
  docs), each finding put to a second reviewer to refute, confirmed eight
  findings, all minor or nits, and refuted one. Session security again had
  none. Fixed, with tests that fail before the fix (six):
  - A refused OCR step answered while the workspace was locked never got focus
    back: the session check's heading counted as the user's own choice. The
    focus request now waits until the workspace opens, and is used once.
  - A facility switch made on the overview had neither the lock wait nor the
    user-focus guard: answered while locked it left focus on the page, and it
    took focus from a link the user had moved to. It now waits for the
    workspace and leaves the user's focus alone.
  - An unconfirmed facility stayed in the "Working at" list on every page,
    while every request still went to the facility in use. Opening another page
    now discards it, as Cancel does.
  - A Health ID refused from a button was spoken twice: focus moved to the
    field described by the message, which was also a new alert. It is an alert
    only when focus stays in the field (Enter).
  - Docs: the launch-readiness evidence above now says what was run in a
    browser; the OCR publication retry is folded into the existing open
    question with the correct backend codes; the facility a session read
    returns with `X-Facility-ID` is stated. The Document ID edit that cancels a
    pending step now has its own test (it fails at `b223151`).
- **Backend dependencies, as of this publication:**
  - hid-system #39 (on `main` `522fb2e`, not deployed): `X-HID-Client`. This
    branch works with earlier Identity builds on the same origin, which ignore
    the header.
  - D-Eminence/hid-system#42 (open): refused session-route requests answer
    their 400, 401 or 403 and are audited, instead of 503. The portals already
    handle those answers and never read a 503 as a mismatch.
  - D-Eminence/hid-system#41 (open): `/provider/recover` on hid-system's
    `apps/web`.
  - Facility kept across reloads: no backend contract yet; see
    [open questions](./OPEN-QUESTIONS.md), "Facility selection after reload".

## 2026-10-12: enrollment and password recovery, one step at a time (accessibility audit, third batch)

Eight findings from the second batch's list of 36, in the patient and provider
sign-up and recovery forms: PA-02, PA-03, PA-04 and A11Y-BR-04 (focus after a
step change), PA-05 (the password mismatch), PA-06 (field errors for the NIN,
code and password), PA-10 (the contact cleared for another code) and PA-12
(page titles). The forms are `/enroll`, `/recover`, `/provider/recover` (and
`/admin/recover`, the same component).

- **Focus after each step.** Each step replaced the form before it and the
  submit button was disabled while it ran, so focus fell to the page after every
  step and after every refusal. `useStepFocus` (`apps/patient-web/src/authSteps.ts`)
  now moves it, once the new step is on screen, to that step's field: the NIN,
  contact, code or password. At the end it moves to the confirmation heading
  ("Your Health ID is ready.", "Password reset complete."). After a refused step
  it goes back to the field. "Start again" (provider recovery) and "Request
  another code or change contact" (enrollment) move it too. Focus the person has
  moved elsewhere while a step runs, including another field of the same form,
  stays where it is. Opening the page, or resuming an enrollment already under
  way, moves nothing.
- **Field errors.** A refusal about the step's field is now tied to it: the field
  is marked `aria-invalid` and described by the error as well as its hint. That
  covers a value refused as malformed or wrong (`400`, `422`, such as
  `NIN_NOT_VERIFIED`, `OTP_INVALID` and `PASSWORD_INVALID`), a wrong or expired
  recovery code on the code step (`403 OTP_INVALID_OR_EXPIRED`), and a contact
  already used by a Health ID (`409 CONTACT_ALREADY_REGISTERED`). On the
  password step the same `403` means the verification ran out, so the password
  field stays valid. A missing security check (`400 TURNSTILE_REQUIRED`), a
  request key refused (`400 IDEMPOTENCY_KEY_INVALID`), rate limits and outages
  leave the field valid too. The error shows at the top of the form. It is an
  alert when it is not about the field, or when the step was sent with Enter in
  the field; sent from the button, focus moves to the field, whose description
  says it, so it is not also an alert (it would be spoken twice).
- **Password mismatch (provider and platform recovery).** "Passwords do not
  match." is now in a polite live region, announced once when it appears, and
  the confirm field is marked invalid and described by it. It appears once the
  confirmation differs from the password, not while it is still being typed and
  agrees so far.
- **Another code.** "Request another code or change contact" comes back to the
  contact just used, filled in, instead of an empty field. It cannot be used
  while a code is being checked.
- **Page titles.** Sign-in, enrollment and recovery name the tab ("Sign in ·
  Health ID", "Get your Health ID · Health ID", "Reset your password · Health ID",
  and "… · Health ID Provider" or "… Platform"), and give the earlier title back
  when they close. Patient portal pages and provider pages keep one title
  (PR-06, PEHR-05 below). (Since changed: every patient and provider page now
  names its tab; see the 2026-10-12 readiness series.)
- No request, contract or backend change. The Turnstile, the challenge and the
  verification token are handled as before.
- **Tests:** `apps/patient-web/src/__tests__/AuthStepFocus.test.tsx`, 21 cases.
  Each step is submitted with focus on its button, as a keyboard user does,
  unless the case is about Enter in the field. 11 of the first 13 fail against
  the forms before this change; the other two guard what must not change (focus
  moved elsewhere is kept; opening at a resumed stage moves nothing). The review
  below added 8: 6 fail on the reviewed commit (`aa2602a`), 1 more there was
  updated, and two guard that opening `/recover` and `/provider/recover` moves
  nothing.
- **Review.** An independent review found no blocker. Fixed: a verification that
  ran out on the password step marked the password invalid (major); focus was
  taken back from another field of the same form; a field error from the button
  was spoken twice; the security-check and request-key 400s counted as field
  errors and `CONTACT_ALREADY_REGISTERED` did not; the mismatch showed on the
  first keystroke; "Request another code" worked during a check; two test gaps.
- **Browser check:** headless Chromium against the built portal with the API
  mocked, at 390px, every step submitted from the keyboard, 19 of 19 checks:
  - each step's focus, including Chromium's own blur of the disabled button;
  - the invalid state and description after a wrong code and a refused NIN;
  - the mismatch live region;
  - the contact kept for another code;
  - the titles.
  No other browser, assistive technology or device. This is not a claim of WCAG
  conformance.
- **Remaining confirmed findings (28), by audit id, most severe first** (since
  changed: all 28 are fixed in source by the 2026-10-12 readiness series):
  - Medium:
    - PA-07, OCR-A11Y-05, PEHR-08: input borders 1.28:1.
    - A11Y-BR-05, OCR-A11Y-03, PEHR-07, A11Y-BR-06: success and warning badges
      and text below 4.5:1.
    - PEHR-06: provider links look like plain text.
    - PR-03: patient actions drop focus to the page.
    - PEHR-04: provider field errors not tied to their fields.
    - PEHR-05: one page title for every provider page.
  - Low:
    - A11Y-BR-07, PEHR-12: faint small text.
    - OCR-A11Y-08, PA-08: placeholder contrast.
    - PEHR-09, A11Y-BR-08: two h1 headings on the clinical record.
    - OCR-A11Y-09, PEHR-13: states with no h1 or main landmark.
    - OCR-A11Y-06: Patient ID required only visually.
    - PEHR-10: tab roles without tab panels.
    - PEHR-14: Field hint and error ids never referenced.
    - PR-08: the portal's NIN error.
    - PA-11: the Google button's disabled state.
    - PR-06: patient portal page titles.
    - PR-04, PR-05: focus after 'Try again' and 'Revoke access'.
    - PR-07: the Access PIN field does not say 4 to 8 digits.

## 2026-10-12: backend dependencies merged in hid-system (docs only)

No portal code change. The hid-system fixes this portal depends on are merged
into hid-system `main` (`6b49a06`). None is released or deployed, and no
staging or live run covers them; the next action for each is a hid-system
release.

- **D-Eminence/hid-system#42** (merged at `e4295d0`): a refused request on an
  Identity session route (sign-out, facility selection, session read, service
  session, Google link) answers its own 400, 401 or 403 and is audited as its
  `auth.*` session event, instead of `503`. The portals already handle those
  answers, and neither reads a `503` as a session mismatch.
- **D-Eminence/hid-system#46** (merged at `6b49a06`): EHR and OCR answer a
  staff refusal made before a facility is bound (`400 FACILITY_REQUIRED`,
  `403 FACILITY_ACCESS_DENIED`, and EHR's runtime-control refusals) with its
  own status, and audit it, instead of `503`. A database fault in EHR's
  runtime-control check answers `503 PLATFORM_CONTROL_UNAVAILABLE` instead of
  `401`, so the portal no longer reads it as a signed-out session.
- **D-Eminence/hid-system#41** (merged at `63201b1`): hid-system's `apps/web`,
  which serves `www` and `staging` today, has the fixed `/provider/recover`
  route that the product-host recovery links point to.
- **Still open: D-Eminence/hid-system#47** (ADR-046): Identity keeps the
  facility a staff sign-in chose across reload and refresh. Its migration was
  renumbered from 0079 to 0080 when hid-system #45 took 0079. It is up to date
  with `main` and its local checks pass, including the PostgreSQL verifier with
  #42's audit interceptor registered. It waits on the backend owner's release
  decision and deploy order (0080 and the role bootstrap before that Identity
  takes traffic). D-Eminence/Health-id#42 (draft) reads its
  `facilitySelection` and waits on it and on the product decision of when to
  ask. (Since changed: #42 merged into Health-id `main` before #47, since it
  works without the field; see the 2026-10-12 readiness series.)
- **Backend follow-ups found and not fixed:** patient-only routes
  (`GET /identity/me`, EHR `GET /ehr/me/records`) answer `503` to a staff
  sign-in instead of `403 PATIENT_SESSION_REQUIRED`; Identity's own
  runtime-control check can answer `401` on a database fault; and the audit
  rows for these refusals do not record the refusal code. See
  [open questions](./OPEN-QUESTIONS.md).

## 2026-10-12: the working facility across reloads

- **Backend contract (D-Eminence/hid-system#47, open, not merged).**
  `POST /auth/facility` checked the membership and audited the choice but
  stored nothing, so a reload moved a provider back to the primary facility.
  #47 (ADR-046, migration 0080) keeps the
  choice per sign-in and reports `facilitySelection` on staff session reads,
  refresh and sign-in: `selected`, `default` (none chosen) or `reselect` (the
  facility chosen is no longer one of the actor's active facilities, so the
  default is reported). The choice authorizes nothing: `X-Facility-ID` is still
  checked on every request. It is up to date with hid-system `main` `6b49a06`
  (#41, #42 and #46 merged), which carries #34's 0078 and #45's 0079 (the patient PIN actor window); #47's
  migration was renumbered from 0079 to 0080 when #45 merged. 0080 and the
  role bootstrap must be applied before that
  Identity takes traffic: without the table, staff session reads and refresh
  answer 503 (a refresh keeps its rotation), and no provider page loads. A
  failed selection read is a 503, never a facility the user did not choose;
  the portal shows its "Session unavailable" state with Try again.
- **Portal (`apps/patient-web/src/staff`).** The staff session type reads the
  optional field (`facilityChoiceNeeded` in `facilitySelection.ts`). While the facility is
  unresolved, `reselect`, or `default` for someone with more than one
  facility, the shell opens no page, sends no page request and hides "Working
  at"; it asks "Where are you working?" with the person's facilities as
  options, none preselected. Continue sends the same `POST /auth/facility` as a
  switch; a refusal (`403 FACILITY_ACCESS_DENIED` when the membership ended
  meanwhile, `400`) is shown and the question stays. After the choice the page
  asked for opens, its requests name that facility, and focus moves to its
  heading. With `selected`, a reload keeps the facility chosen. An Identity
  without the field (today's) behaves as before. Nothing about the facility is
  kept in browser storage. The choice belongs to the sign-in, so a session
  read can report another tab's later choice; a tab adopts a session only on
  load, sign-in or its own choice, so a refresh or session check never moves
  it to another facility.
- **Decision left open (product):** the portal asks at every sign-in when the
  person has more than one facility, since otherwise the server's default would
  be used without their choosing it. Asking only on `reselect` is the
  alternative.
- **Tests:** `apps/patient-web/src/staff/FacilityChoice.test.tsx`, 12 cases:
  reselect on reload (no page, no request, nothing preselected; then the
  chosen facility on every request and focus on the heading), reselect with one
  facility left after a membership ended, a choice refused as `403` and as
  `400`, Continue with nothing chosen, a page opened by its address, `default`
  with two facilities and with one, `selected` on reload, no field, a later
  switch, and a refresh that reports another tab's choice. 7 fail before the
  change; the other 5 guard what must not change.
- **Since changed, before #42 merged** (see the 2026-10-12 readiness series):
  the whole sidebar, not only "Working at", is left out while the portal asks;
  any `facilitySelection` value it does not know asks too, with `null` or no
  field as before; a refresh or session check never moves a tab to another
  facility, and when it finds the tab's own facility gone, the tab closes the
  open page and patient, cancels requests still naming it, and asks again,
  with or without the field; and `FacilityChoice.test.tsx` has 40 cases.

## 2026-10-12: readiness series (visual system, facility chooser, provider clinical, OCR and Outreach, patient portal, admin and public)

An audit of Health-id `main` at `c880421` against hid-system `main` at
`6b49a06` (read-only) recorded 340 findings: 91 frontend-actionable, 113
backend, 16 infrastructure, 32 product decisions, 41 stale doc statements, 43
already resolved and 4 not defects. A second reviewer confirmed 290, refuted 2
and left 1 uncertain (47 needed no verdict). The frontend findings were fixed
in six PRs; the backend, infrastructure and product items went to the
hid-system owner as the [backend hand-off](./BACKEND_OWNER_HANDOFF.md); this
entry's docs PR records both. hid-system was not changed.

- **#44, visual system (`claude/a11y-visual-system`, merged).**
  - Tokens (`packages/ui/src/tokens.css`): `--color-line-control` `#898989` for
    form-control boundaries (3.50:1 on white, 3.29 on `surface-sunk`, 3.24 on
    `surface-tint`; was `#e3e3e3`, 1.28:1); `--color-positive-ink` `#007a39`
    and `--color-caution-ink` `#8f5f00` for status text (Badge success 4.89:1
    and warning 5.06:1 on their tints over white, at least 4.52:1 over the
    other light surfaces a badge sits on; `.staff-success` 5.46:1);
    `--color-faint` `#7b7b7b` to `#6f6f6f` (5.02:1 on white down to 4.53:1 on
    `surface-hover`), also used for patient and admin placeholders. The dark
    palette has the new tokens; the unused `--color-soft` is gone.
  - Shared `Input`, `Select` and `Textarea` show a focus outline, brand or
    critical, since an invalid control is red at rest. A `Field` gives its
    error, otherwise its hint, to its control as `aria-describedby`, and an
    error sets `aria-invalid` and the critical border. The controls moved to
    the `'use client'` module `Field.tsx`, because a context in
    `primitives.tsx` fails `next build`.
  - Provider links are underlined in the brand colour; workspace modules are
    cards; section headings, toolbars and details have rules.
  - Public site: the demo dialog's and `/about`'s own controls use
    `line-control`; the search shortcut hint is 6.43:1; a refused demo service
    or notes field is marked invalid. Commit `d5e0aa2` says it fixed the
    `/provider/apply` application form; that form was never rendered, the
    change was reverted (`01475ba`), and the admin and public PR deletes it.
  - Fixes PA-07, PA-08, PEHR-06, PEHR-07, PEHR-08, PEHR-12, PEHR-14,
    OCR-A11Y-03, OCR-A11Y-05, OCR-A11Y-08, A11Y-BR-05, A11Y-BR-06 and
    A11Y-BR-07. Tests: `ColourContrast.test.tsx` (both apps),
    `StaffLinkStyles.test.ts`, `FieldDescription.test.tsx`; 44 of the first
    48 contrast cases, 8 link cases and 9 Field cases failed on `main` first.
- **#42, facility chooser (`claude/facility-selection`, merged).** While the
  facility is unresolved (`reselect`, `default` with more than one facility,
  or a `facilitySelection` value the portal does not know) no page and no
  sidebar show, and the question offers the person's facilities with nothing
  preselected; it takes focus once the workspace opens, holds its options
  while the choice saves, and words a `403 FACILITY_ACCESS_DENIED` as "You are
  no longer active at" the facility's name. Without the field (hid-system `main` today)
  load and sign-in are as before. With or without it, a refresh or session
  check that finds the tab's facility gone closes the open page and patient,
  cancels protected requests still naming it (any header case), and asks
  again. It merged before hid-system#47 for that reason. Tests:
  `FacilityChoice.test.tsx` (40 cases; 27 of the first 34 fail on `c880421`),
  `staff/session.test.ts` (3), `NarrowLayout.test.ts`.
- **#45, provider clinical (`claude/provider-clinical-readiness`, merged).**
  - Emergency summary: the sections EHR returns beyond encounters and notes
    (diagnoses, prescriptions, lab requests, documents) show only with each
    one's read permission, current entries first, with a truncation notice
    per section; documents are listed, never opened; vitals are left out
    because EHR sends them uncorrected; prescription dates show as calendar
    days. Emergency access and the PIN are offered only when the role can then
    open the record, Close my grant only with `identity.consent.write`, and a
    PIN typed with spaces is read as Identity reads it.
  - Safety warnings (hand-off A1, A3): an encounter's status form says its
    orders are not cancelled and Pharmacy and the Laboratory are not told; an
    active or on-hold prescription's status form says Pharmacy is not told and
    may still dispense the version it was sent; the lab-request form says a
    draft is never sent to the Laboratory.
  - Pharmacy's dispensing card shows route and instructions (PHARM-01). The
    Lab and Pharmacy lists say, at 200 items, that newer ones cannot be
    reached (A2). EHR forms mirror the DTO limits and name refused fields
    (EHR-FORMS-01). Document links must be `https` before an upload or
    download opens them (SEC-SIGNED-URL-SCHEME), and sizes sent as text are
    read as numbers (EHR-DOCS-01).
  - Accessibility: PEHR-04, PEHR-05, PEHR-09 with A11Y-BR-08, PEHR-10,
    PEHR-13, NEW-PEHR-ACTION-FOCUS (the provider counterpart of OCR-A11Y-01
    and PR-03), NEW-PEHR-DETAIL-RUNON and NEW-LAB-HISTORY-EXPANDED. Refresh
    buttons keep focus while their read runs.
  - Tests: `EmergencySummary`, `PatientAccess`, `ClinicalNotes`,
    `Prescriptions`, `ClinicalDocuments`, `RefreshFocus`,
    `FieldProblemsPerForm` and `OperationsActionFocus`.
- **#46, OCR and Outreach (`claude/ocr-outreach-readiness`, open).**
  - OCR publication keeps one Idempotency-Key per request in page memory
    (never browser storage), reads the history again after any refusal, and
    offers Retry publication with the same key after OCR's 15 s wait, or to
    resume a pending or processing publication; a publication names what it
    made, and imported Lab or Pharmacy evidence is read on request (OCR-02,
    OCR-04, GAP-L86, GAP-L87). OCR IDs are checked as UUIDs at their fields.
  - Outreach campaigns are read-only, saying campaign management is not yet
    available, because Identity refuses `outreach.campaign.write` (ADR-045;
    OUTREACH-01, GAP-L93). A registration case is resent with the same
    `localCommandId` and temporary ID, its fields checked after trimming
    (OUTREACH-02, GAP-L94).
  - Accessibility: OCR-A11Y-06, OCR-A11Y-09 (OCR and workspace state screens,
    the platform console's session screens included, are main landmarks;
    OCR's and the provider workspace's have an h1), NEW-OCR-CREATE-DISABLED,
    NEW-OCR-RAWTEXT-SCROLL, NEW-OCR-REVIEW-HINT and NEW-PEHR-REQUIRED-MISMATCH.
    A field refused from Enter in that field is announced as an alert.
  - Tests: `OcrPublication`, `OcrFields`, `Outreach`, `OcrConfirmation`,
    `OcrStateScreens`, `ocrOutreachApi`.
- **Patient portal PR (`claude/patient-portal-readiness`).**
  - Overview, records (every vital the aggregate returns, with units),
    notifications in words, the Access PIN's rules, and the NIN's 11 digits
    stated and tied to their fields. Every page names its tab. Focus after
    actions, Try again and page changes reaches what loaded; success notices
    are status regions mounted once; repeated buttons name their item.
  - The patient's own access decisions send no `X-Purpose-Of-Use`
    (PW-PATIENT-PURPOSE-HEADER). A provider's sign-in in the shared cookies
    leaves the portal signed out, not in error (PW-STAFF-SESSION-IN-PATIENT-PORTAL).
    Each tab is bound to the patient it shows (SEC-PATIENT-XTAB): it listens
    on `hid-session-change`, re-checks after a minute away or an announcement,
    restores only its own patient, and blames another tab only with evidence.
    `@hid/http` gained `RequestSpec.reportUnauthorized` so session questions
    judge their own 401.
  - Accessibility: PR-03, PR-04, PR-05, PR-06, PR-07, PR-08, PA-11,
    NEW-PORTAL-STATUS-NOTICES, NEW-ENROLL-NIN-FORMAT,
    NEW-PATIENT-LINK-PAGE-FOCUS, NEW-PATIENT-STATE-NO-H1,
    NEW-UNSTATED-INPUT-RULES and NEW-AMBIGUOUS-ACTION-NAMES. Its verifier
    narrowed NEW-PATIENT-STATE-NO-H1 to the session check; the wrong-portal
    and not-permitted screens cannot be reached from the patient session and
    are unchanged.
  - `staff/pageFocus.ts` moved to `src/pageFocus.ts`, shared by both portals;
    `ItemName` is in `src/ItemName.tsx`.
- **Admin and public PR (`claude/admin-public-readiness`).**
  - Public site: the demo role is held to 2 to 120 characters and focus goes
    to the first field to correct; the pricing parser leaves out a product the
    site does not present and still refuses a malformed row
    (PUB-PRICING-FAIL-CLOSED); the completion form checks the DTO's minimums
    and shows only the refusals hid-system words for the applicant
    (PUB-FORM-VALIDATION-DRIFT); the unused `ProviderApplicationForm` is
    removed and the portal's enrollment screen has a component test.
  - Console: the workspace is bound to the administrator who opened it
    (SEC-ADMIN-XTAB): a refresh for another administrator ends it, admin tabs
    announce on `hid-admin-session-change` as soon as the cookies change and
    re-check after 60 s away or a back/forward-cache restore, sign-out first
    asks whose session the cookies carry, and a closed workspace restores no
    session. `IDEMPOTENCY_KEY_REQUIRED` is mapped (ADMIN-IDEMPOTENCY-CODE).
    Controls and pricing writes have component tests; the admin suite is
    deterministic, and a "Load more" page clicked early is no longer dropped.
  - Build: the staging product and admin hosts open their workspaces, and the
    Vite dev and preview servers answer them; the portal build refuses a
    secret-like public variable (SEC-VITE-ENV-BUILD-GUARD) and reads each one
    by name from one record; it publishes no source maps
    (SEC-PUBLIC-SOURCEMAPS).
- **Accessibility outcome.** All 28 confirmed findings left after the third
  batch are fixed in source: 13 by #44, 6 by #45, 2 by #46 and 7 by the
  patient portal PR. So are the 13 NEW-* findings the audit added: 6 by the
  patient portal PR, 3 by #45 and 4 by #46. Remaining confirmed findings: 0.
  Checked for this entry against the combined tree (`9bff952`): the token
  values, the link and Field rules, a title for every patient and provider
  page, one h1 on the clinical record with a working tab set, a main landmark
  and h1 on each OCR and provider state screen and on the patient session
  check, the stated input rules, the Google button's disabled state and the
  OCR fields. Contrast is computed from the source token values (WCAG 2
  relative luminance), and the rest is checked in jsdom component tests. No
  browser, screen reader or other assistive technology was run in this
  series; this is not a claim of WCAG conformance. Residuals that are not
  audit findings (the console's session check has a main landmark but no h1,
  four provider layout classes without a rule, OCR step buttons using native
  `disabled`, a danger badge on tinted surfaces) are in
  [open questions](./OPEN-QUESTIONS.md).
- **Evidence.** Each branch ran `audit:boundaries`, `typecheck`, `lint`,
  `npm test` and the portal build on its final head:
  - #44 at `2f79377`: 87 files, 1157 tests. Its public-site Turbopack build
    could not run in the worktree (linked `node_modules`); the webpack build
    of the same tree passed.
  - #42 at `336d1e7`: 84 files, 1079 tests.
  - #45 at `cd55b33`: 102 files, 1231 tests.
  - #46 at `a29c252`: 89 files, 1113 tests; the public-site build passed at
    `2765940`, since the branch changes `packages/ui`.
  - Patient portal PR at `292aee7`: 1152 tests; 12 of 13 full-suite runs
    passed. The one failure captured was an admin list test under load, in
    code this PR does not touch, not checked against its base.
  - Admin and public PR at `88435bd`: 87 files, 1110 tests; both builds pass,
    the portal's `dist` holds no `.map` file, a build with
    `VITE_HID_STRIPE_SECRET=x` stops naming the key, and an unused variable is
    not inlined.
  - Combined tree `9bff952`, all six PRs joined by three integration merges
    whose conflicts kept both sides' behaviour: `audit:boundaries`,
    `typecheck`, `lint`, 130 files and 1684 tests, and both builds pass.
  - Every behaviour change has a test that failed on the code before it.
    Each PR had an adversarial review. The review text the provider and
    facility batches received was cut off part-way, so any finding after the
    cut was not seen.
- **Backend dependencies** ([hand-off](./BACKEND_OWNER_HANDOFF.md) ids): the
  warnings and the cap notice stand in for A1, A3 and A2; the emergency summary
  waits on A11 and on decisions E1 and then B1; OCR resume on B5, OCR's purpose
  on E3 and B4; Outreach writes on E5 and B10; Lab and Pharmacy queues on E2
  and B2; onboarded organizations on E4 and B3; the facility chooser on C1 and
  E7 (#47, open); everything merged on hid-system `main` but unreleased (#31
  and #33 to #46) on C2; hosting, Turnstile hosts, staging and secrets on D1 to D4.
  Items found after the hand-off was written are in open questions, "Found
  during the readiness series".
- **Not verified.** No staging environment exists, so nothing ran against a
  deployed backend, staging or production. No browser or assistive-technology
  run was made in this series (the headless Chromium runs in the earlier
  batches are not repeated). #46 and the two new PRs were not merged when
  this was written; their counts are from their branches and the combined
  tree.
- **Docs.** New `BACKEND_OWNER_HANDOFF.md`. The gap map, open questions,
  architecture notes and the Stage 2B and Stage 3 reports are brought in line
  with the combined tree and hid-system `6b49a06`, including every statement
  in `docs/` that the audit's 41 doc-only findings named. Outside `docs/` and
  unchanged here: the `c4b5445` baseline comments in
  `packages/contracts/src/registry.ts`, `packages/api/src/services.ts` and
  `apps/patient-web/src/api.ts` (the audit re-checked the registry's Identity,
  admin and commercial routes against `6b49a06`, and each is still served,
  the two gateway health routes by nginx), the #42 pull request description, and
  hid-system's own `INTERFACE_CONTRACT.md`. Earlier entries in this log keep
  their text, with "since changed" notes where they read as current.
