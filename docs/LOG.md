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
  ask. (Since changed: Health-id #42 merged into `main` before hid-system#47,
  since it works without the field; see the 2026-10-12 readiness series.)
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
  with or without the field; and `FacilityChoice.test.tsx` had 40 cases when
  #42 merged (41 in the final tree).

## 2026-10-12: readiness series (visual system, facility chooser, provider clinical, OCR and Outreach, patient portal, admin and public)

An audit of Health-id `main` at `c880421` against hid-system `main` at
`6b49a06` (read-only) recorded 340 findings: 91 frontend-actionable, 113
backend, 16 infrastructure, 32 product decisions, 41 stale doc statements, 43
already resolved and 4 not defects. A second reviewer confirmed 290, refuted 2
and left 1 uncertain (47 needed no verdict). The frontend findings were fixed
in six PRs, all merged into Health-id `main` (`0eda90f`); the backend,
infrastructure and product items went to the hid-system owner as the
[backend hand-off](./BACKEND_OWNER_HANDOFF.md); this entry's docs PR records
both. hid-system was not changed.

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
    change was reverted (`01475ba`), and #48 (admin and public) deletes it.
  - Fixes PA-07, PA-08, PEHR-06, PEHR-07, PEHR-08, PEHR-12, PEHR-14,
    OCR-A11Y-03, OCR-A11Y-05, OCR-A11Y-08, A11Y-BR-05, A11Y-BR-06 and
    A11Y-BR-07. Tests: `ColourContrast.test.tsx` (both apps),
    `StaffLinkStyles.test.ts`, `FieldDescription.test.tsx`. Failing first, per
    the batch record: 44 of the first 48 cases in the portal's
    `ColourContrast.test.tsx` failed on `main`, and its 9 later link-contrast
    cases failed without the link rules; 8 `StaffLinkStyles.test.ts` cases
    failed on `main`; and 9 checks across `FieldDescription.test.tsx`, the
    Outreach hint test in `Operations.test.tsx` and the registry-hint assertion
    in `ProviderCompletionForm.test.tsx` failed on `main`.
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
  `FacilityChoice.test.tsx` (40 cases at #42's head `336d1e7` and 41 in the
  final tree, one added in #45; 27 of the first 34 fail on `c880421`),
  `staff/session.test.ts` (6 cases, 3 of them added by #42),
  `NarrowLayout.test.ts`.
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
    draft is never sent to the Laboratory. These warnings hold for every
    released hid-system build; see "hid-system `main` moved on" below for what
    its `main` has since merged. (Since changed: the hid-system alignment PR, Health-id #49,
    rewords the prescription and lab-request warnings and offers activation to
    a role that may send to Lab; see the 2026-10-13 entry.)
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
- **#46, OCR and Outreach (`claude/ocr-outreach-readiness`, merged).**
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
- **#47, patient portal (`claude/patient-portal-readiness`, merged).**
  - Overview, records (every vital the aggregate returns, with units; EHR
    returns no vitals to a patient session, so none shows, see open
    questions),
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
- **#48, admin and public (`claude/admin-public-readiness`, merged).**
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
    secret-like public variable (SEC-VITE-ENV-BUILD-GUARD) and reads each
    public variable by name, never the env object whole; it publishes no
    source maps (SEC-PUBLIC-SOURCEMAPS).
- **Accessibility outcome.** All 28 confirmed findings left after the third
  batch are fixed in source: 13 by #44, 6 by #45, 2 by #46 and 7 by #47
  (patient portal). So are the 13 NEW-* findings the audit added: 6 by #47,
  3 by #45 and 4 by #46. Remaining confirmed findings: 0.
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
  - #47 (patient portal) at `292aee7`: 1152 tests; 12 of 13 full-suite runs
    passed. The one failure captured was an admin list test under load, in
    code this PR does not touch, not checked against its base.
  - #48 (admin and public) at `88435bd`: 87 files, 1110 tests; both builds
    pass, the portal's `dist` holds no `.map` file, a build with
    `VITE_HID_STRIPE_SECRET=x` stops naming the key, and an unused variable is
    not inlined.
  - Combined tree `9bff952`, all six PRs joined by three integration merges
    whose conflicts kept both sides' behaviour: `audit:boundaries`,
    `typecheck`, `lint`, 130 files and 1684 tests, and both builds pass.
  - The counts above are for the tested heads. #46 merged at `c84a6ee`
    (22:00:55Z, `56ab31a`), #47 at `699f37d` (22:05:17Z, `d478c21`) and #48
    at `e675870` (22:11:41Z, `0eda90f`). Each merged head adds only merge
    commits (of `main` or of the other readiness branches) to the head tested,
    and `699f37d` also drops a trailing blank line. Health-id `main` at
    `0eda90f` differs from the combined tree `9bff952` only by that blank
    line in `PortalFocus.test.tsx`.
  - Each batch reports a failing-first test for each behaviour change, and an
    adversarial review of its PR; neither was re-checked for this entry. The
    review text the provider and facility batches received was cut off
    part-way, so any finding after the cut was not seen.
- **Backend dependencies** ([hand-off](./BACKEND_OWNER_HANDOFF.md) ids): the
  warnings and the cap notice stand in for A1, A3 and A2; the emergency summary
  waits on A11 and on decisions E1 and then B1; OCR resume on B5, OCR's purpose
  on E3 and B4; Outreach writes on E5 and B10; Lab and Pharmacy queues on E2
  and B2; onboarded organizations on E4 and B3; the facility chooser on C1 and
  E7 (hid-system#47, open; its migration 0080 must be renumbered, since
  hid-system `main` gave 0080 to hid-system#48); everything merged on
  hid-system `main` but unreleased (#31, #33 to #46, #48 to #53 and #55 to
  #62) on C2; hosting, Turnstile hosts, staging and secrets on D1 to D4.
  Items found after the hand-off was written are in open questions, "Found
  during the readiness series".
- **hid-system `main` moved on.** Between 14:39Z and 19:09Z, before this entry
  was written, hid-system `main` went from `6b49a06` to `bbc6e89`
  (hid-system#48 to #53 and #55 to #62); none is released. Among them: #48
  refuses a dispense of a prescription EHR has since changed (A1); #49 maps
  the platform MFA key in CDK (D4); #52 withholds emergency summary categories
  the reader may not read and reports per-section limits (A11, except
  corrected vitals); #55 answers recovery starts alike (A13); #56 sends an
  activated draft, a resumed hold or an edited active request to Lab (A3, but
  not a cancel or hold after acceptance); #59 lets only the uploader complete
  a document (A15); #60 answers a missing purpose header with
  `400 PURPOSE_OF_USE_REQUIRED` (A14(c)). The portal's warnings stay, since
  they hold for every released build. (Since changed: the hid-system alignment
  PR reads these changes; see the 2026-10-13 entry.) The audit, the hand-off and the rest of
  this entry describe `6b49a06`; open questions and the gap map note these
  changes where they apply.
- **Not verified.** No staging environment exists, so nothing ran against a
  deployed backend, staging or production. No browser or assistive-technology
  run was made in this series (the headless Chromium runs in the earlier
  batches are not repeated). #46, #47 and #48 merged after their counts were
  taken; the counts are from their tested heads and the combined tree.
- **Docs.** New `BACKEND_OWNER_HANDOFF.md`. The gap map, open questions,
  architecture notes and the Stage 2B and Stage 3 reports are brought in line
  with the combined tree and hid-system `6b49a06` (and `bbc6e89` where its
  later merges change a statement), including every statement
  in `docs/` that the audit's 41 doc-only findings named. Outside `docs/` and
  unchanged here: the `c4b5445` baseline comments in
  `packages/contracts/src/registry.ts`, `packages/api/src/services.ts` and
  `apps/patient-web/src/api.ts` (the audit re-checked the registry's Identity,
  admin and commercial routes against `6b49a06`, and each is still served,
  the two gateway health routes by nginx), the #42 pull request description, and
  hid-system's own `INTERFACE_CONTRACT.md`. Earlier entries in this log keep
  their text, with "since changed" notes where they read as current.

## 2026-10-13: hid-system alignment (the portal reads hid-system#48 and #50 to #61)

hid-system `main` moved from `6b49a06` to `bbc6e89` while the readiness series
merged (hid-system#48 to #53 and #55 to #62; none released). Those PRs change
answers the portal reads: the record summaries name what they withhold, EHR
sends a lab request to Lab on activation and resumption and can send one
again, Lab serves released results by EHR order, Pharmacy refuses changed
prescriptions, OCR names workload refusals, and Identity budgets recovery and
enrollment codes. The hid-system alignment PR (`claude/hid-system-alignment`,
Health-id #49: 31 commits on `main` `0eda90f`, final head `e42a0a2`, merged as
`cf32087`) makes the portal read each
change, and still handle the answer of a build without it. hid-system was not
changed.

- **Patient records (hid-system#52).** A section named in `withheld` says "Not
  yet shared with patients in Health ID." instead of having no entries;
  `truncated` and `limits` say when only the most recent are shown; the
  opening line names only the released sections, and none while the record is
  read or after it could not be. Tests: `PatientRecords.test.tsx`,
  `PortalRecords.test.tsx`.
- **Emergency summary (hid-system#52, #51).** A section EHR withheld from a
  role that may read it says it is not included; the truncation notice follows
  `truncated`, and the cap guess applies only to an EHR that reports none; the
  documents note says the listed documents passed the virus scan; the vitals
  note shows only when EHR released vitals; each lab request but a draft offers
  its released results under the emergency purpose. The role's own permission
  still gates each section. Test: `EmergencySummary.test.tsx`.
- **Lab requests (hid-system#56).** For a role holding `lab.work-item.accept`:
  active creation, "Activate and send to Lab", "Resume and send to Lab", and
  Send to Lab (`POST …/lab-work-item`, one key per attempt). Each `labHandoff`
  state is said: `accepted`; `already_accepted` (Lab holds an earlier version,
  so the change is not in Lab); `failed` (send it again, or, for
  `LAB_ORDER_NOT_CURRENT`, check the request, which changed again);
  `not_sent`; and none, from an EHR before hid-system#56 (Lab was not asked,
  or, for a resumption, not told). A create answered
  `409 LAB_HANDOFF_REFUSED` or `502 LAB_HANDOFF_UNCONFIRMED` reloads the list,
  clears the form and its key, and moves focus to the saved request's Send to
  Lab; the request ID in the problem detail is used only for focus, never
  shown, and a 201 with no body reads as an EHR before hid-system#56. Any
  other role creates drafts only, and notes say who can activate, resume or
  send. Hold,
  cancel, completion and entered in error stay unoffered for an active or held
  request. A warning says the list could not be reloaded only when it could
  not, and that it was reloaded only where the request changed under the
  change (Send to Pharmacy likewise). Tests: `LabRequestHandoff.test.tsx`,
  `ClinicalCorrections.test.tsx`, `labHandoffApi.test.ts`, and two registry
  cases in `packages/contracts/src/__tests__/boundaries.test.ts`.
- **Released Lab results (hid-system#51).** "View released results" under each
  lab request but a draft, for `lab.result.released.read`, read only when
  opened or refreshed and never merged with a read in flight, since Lab audits
  each read. Nothing released, no work item the reader can see
  (`404 LAB_WORK_ITEM_NOT_FOUND`), a Lab without the route and a refusal are
  each said. The revision list moved to `staff/labRevisions.tsx`, shared with
  the Laboratory's result history, which now shows when each revision was
  released (`releasedAt`). Tests: `LabReleasedResults.test.tsx`,
  `Laboratory.test.tsx`.
- **Prescriptions and Pharmacy (hid-system#48).** The status-change warning
  and the `409 IDEMPOTENCY_CONFLICT` message say only what holds with or
  without migration 0080: `c182ad8` replaced `8785204`'s wording, which held
  only once 0080 is deployed and dropped "you must contact the pharmacy". Send
  to Pharmacy reads the list again when the prescription changed under it.
  Pharmacy marks work "Not dispensable" after
  `409 PHARMACY_PRESCRIPTION_NOT_DISPENSABLE`, saying the prescription is no
  longer active at the version Pharmacy accepted (`ead16b4`), and its capped
  list says such work stays listed. Tests: `Prescriptions.test.tsx`,
  `Pharmacy.test.tsx`.
- **Documents (hid-system#59).** A document left `initiated` says the upload
  was not completed, that only the person who started it can finish it, and to
  upload the file again. Test: `ClinicalDocuments.test.tsx`.
- **Break-glass (hid-system#58).** `400 INVALID_CONSENT_COMMAND` says emergency
  access may not be enabled for this deployment. `886b7c9` softened
  `8b4928e`'s "is not enabled", since Identity gives that answer for a bad
  duration or reason too. Test: `BreakGlassRefusal.test.tsx`.
- **OCR (hid-system#60).** The three `503 …_SERVICE_AUTH_UNAVAILABLE` answers
  read as a failed connection between Health ID services;
  `OCR_PUBLICATION_IN_PROGRESS` also names "no attempts remain"; the
  publication key names the signed-in account. Test: `OcrPublication.test.tsx`.
- **Recovery (hid-system#55).** After a refused code, what a spent code budget
  does; "Start again for a new code", announced, once `resendAfterSeconds` has
  passed; "Use a different work email" (patient: "email or Health ID") at
  once. `0f3d86e` restored the immediate way back that `817bb92` had held for
  the wait. Tests: `RecoveryCodeBudget.test.tsx`, `AuthStepFocus.test.tsx`.
- **Enrollment (hid-system#50, #61).** A step's `404 ENROLLMENT_NOT_FOUND`, or
  a check that finds no enrollment once the page reached a step, returns to
  the NIN step, to continue with the same NIN and start key; the sign-out note
  says a sign-out ends an enrollment in progress; a refused code adds the
  budget note, cleared for a new code (`88459c7`); `429 ENROLLMENT_RATE_LIMITED`
  at activation says to wait about 15 minutes. Tests: `EnrollmentEnded.test.tsx`,
  `EnrollmentLimits.test.tsx`.
- **Contracts.** `ehr.labRequestLabWorkItem` (`POST`, `ehr.lab-request.write`
  and `lab.work-item.accept`) and `lab.releasedResultsForOrder` (`GET`,
  `lab.result.released.read`) in `packages/contracts/src/registry.ts`; the
  first is added to the staff app's EHR route grants.
- **Review.** A review of `065a1f9` raised 15 items. 12 were fixed in full and
  item 1 for its prescription half; its Lab half is the deploy order below.
  Items 7 (docs) and 8 (squashing two commits) were not done, because that
  batch's rules forbade editing `docs/*.md` and rebasing; item 7 is this
  entry's docs update.
- **Deploy order (open).** "Activate and send to Lab", "Resume and send to Lab"
  and Send to Lab need an EHR with hid-system#56, deployed after the Lab with
  it. Against an older EHR, activation leaves the request active and unsent
  (the page says so) and Send to Lab answers 404. No flag was added: the
  repository has none, and splitting the commits needed a rebase. See
  [open questions](./OPEN-QUESTIONS.md), "Found during the hid-system
  alignment".
- **Evidence.** At `6128d00`, as the batch reports: `audit:boundaries`,
  `typecheck`, `lint`, `npm test` and the portal build pass; the public-site
  build is not reported. `npm test` was re-run for this entry: 137 files, 1781
  tests (1684 in the readiness combined tree). The fix batch reports a test that
  failed first for each behaviour change, and that each of its nine commits
  (`c99154b` to `6128d00`) passes `tsc --noEmit` alone; neither was re-checked
  here. Two earlier commits, `04a847d` and `8b4928e`, fail `tsc` (TS2322 at the
  note panel's `onChanged`), fixed by `065a1f9`; the PR was merged with a merge
  commit, so a bisect across them meets that error. `88459c7`'s message names
  hid-system's `sendContact`; the method is `startContact`. A final focused
  review then checked every clinical-safety sentence against both hid-system
  `bbc6e89` and `6b49a06`; its eight findings (the resume message on an older
  EHR, the notes for a role that cannot send to Lab, refused versus
  unconfirmed handoffs, the other identifier during a recovery wait, an active
  create saved behind an error, untested focus, the Pharmacy message and a 201
  without a body) are fixed in `7b2dfd8` to `e42a0a2`, with 24 tests that
  failed first. At `e42a0a2` every gate passes: 137 files, 1811 tests.
- **Not verified.** Component and API-client tests with the network stubbed;
  no browser, runtime, staging or live hid-system run, and hid-system#48 to #61
  are unreleased. Behind hid-system's gateway as it stands, a create's
  `502 LAB_HANDOFF_UNCONFIRMED` and OCR's `503 …_SERVICE_AUTH_UNAVAILABLE`
  arrive as `503 UPSTREAM_UNAVAILABLE` (hand-off A8, A25), so the portal's
  handling of those codes takes effect only once A8 is fixed.
- **Docs.** `BACKEND_OWNER_HANDOFF.md` is replaced by its refresh to hid-system
  `bbc6e89`: A13 fixed; A1, A3, A5, A11, A14, A15, B6 and D4 partly fixed; new
  A25, B14, D8, D9 and E17 to E20; hid-system#47 must take 0083. Its new header
  lists what Health-id has addressed. The architecture notes, the gap map and
  open questions say what the alignment PR changed and correct what hid-system
  `bbc6e89` made untrue: Pharmacy's refusal of changed prescriptions, the
  summaries' `withheld` and `limits`, the Lab send-again route, released
  results, the new refusal codes and hid-system#47's renumbering.

## 2026-10-13: hid-system#64 and #65 (encounter status closes its records; modules closed at launch)

A read-only watch of hid-system `main` from `bbc6e89` to `b69a6ab` (merge of
hid-system#65) checked hid-system#63, #64, #54 and #65 against Health-id
`main` `82b474e`. None is released. hid-system was not changed. Two of them
made the portal show something untrue, and Health-id #51
(`claude/hid-system-64-65-alignment`) changes only that:

- **hid-system#64 (migration 0084).** Changing an encounter's status now
  closes its records in the same transaction. Cancelling cancels its draft,
  active and on-hold prescriptions and lab requests. Entered in error marks
  those orders, and its notes and diagnoses, entered in error. The encounter
  status form had warned that the change cancels none of its orders, and to
  cancel each one by hand. It now says what the change does, and still says
  that Pharmacy and the Laboratory are not told. EHR answers with the
  encounter alone, so after Cancel or Mark entered in error the records list
  shown is read again. Before, it kept showing the old statuses and offering
  changes that would fail.
- **hid-system#65.** The gateway proxies only Identity and EHR at launch. Every
  Lab, Pharmacy, OCR and Outreach route answers `404 API_ROUTE_NOT_FOUND` with
  no detail, while those modules' read permissions stay seeded, so the
  workspaces still open. They used to say "We could not find what you were
  looking for." next to a Refresh button. Now each says that the module is not
  in service on this deployment and that refreshing will not help. A module's
  own 404 keeps its message.
- **Judged optional, not changed** (open questions, "Found watching hid-system
  after the alignment"):
  - retracting a completed encounter, which hid-system#64 allows and lists as
    a Health-id follow-up;
  - hiding the forms the EHR now refuses with `409 ENCOUNTER_NOT_OPEN`;
  - the `X-Real-IP` that a Health-id Worker must set.
  hid-system#63 and #54 need nothing from the portal.
- **Deploy order.** The new encounter warning is true only against an EHR with
  hid-system#64, so this portal is to be deployed with or after it.
- **Evidence.** Each behaviour change has a test that failed first: 9 tests
  (the three encounter warning cases, two record reloads and four closed
  workspaces). A 404 that a module sends with its own code was already shown
  correctly and still is. An independent review of the PR found nothing
  blocking. Its minor findings were fixed, each first shown failing: one new
  case (the tab switch), and a documents assertion in the three warning cases,
  for 10 failing-first cases in all:
  - the warning now also says documents are not changed;
  - the reload reads the tab shown when the change is answered, which the
    clinician may have changed meanwhile;
  - the Outreach test checks both lists;
  - the gap map row and three hand-off citations are corrected.
  Not changed: re-reading the records after a 409 that shows someone else
  closed the encounter, which is the same staleness as any concurrent change.
  At the branch head every gate passes:
  - `audit:boundaries`, `typecheck` and `lint`;
  - `npm test`: 138 files, 1819 tests;
  - both builds;
  - `npm audit`: 0 vulnerabilities.
- **Not verified.** Component tests with the network stubbed. Nothing was run
  in a browser, at runtime, on staging or against a live hid-system.
- **Docs.** The architecture notes and open questions describe the new
  warning, the record reload, the closed modules and the `X-Real-IP`
  requirement, and the gap map's encounter row matches them. The backend hand-off gains a note for `b69a6ab`:
  - hid-system#47 must now take migration 0085 and conflicts in eight files;
  - ADR-047 is accepted (D9);
  - hid-system#65 addresses A7, not re-verified;
  - a new ask, MOD-1: withdraw closed modules' read permissions, or expose
    the enabled modules.

## 2026-10-14: patient enrollment after hid-system#68 (closed registration, contact proved again, saving the HID)

Read at hid-system `main` `8f3eff1`: the enrollment controller and service,
`docs/INTERFACE_CONTRACT.md` ("Enrollment availability and the
closed-registration answer"), ADR-048 and `PHASE_3_LAUNCH_DECISIONS.md` N1
and N2. hid-system was not changed.

- **Availability (FE-4).** Production keeps NIN-only enrollment closed until
  hid-system's N1 holder step ships, so every start answers 503. The page
  still asked for a NIN and a security check, and showed the refusal only
  after both were spent. It now reads
  `GET /identity/patient-enrollments/availability` with the enrollment check
  and offers the NIN step and Google sign-up only on `200 { open: true }`.
  - Any other body: a notice in Identity's own words ("New Health ID
    registration is not open yet. If you already have a Health ID, sign
    in."), with Sign in and Forgot password? links, no security check and no
    step list.
  - A failed read, a 503 included: "We could not check whether new Health ID
    registration is open", with Try again; focus follows Try again as it does
    for the enrollment check. It is never taken for a sign-out.
  - Unchanged: an enrollment in progress continues and an activated one shows
    its HID, since only a start is refused while closed; an open registration
    behaves as before; the start's own refusals are shown as before. One that a
    sign-in or sign-out ended while registration is closed is not told to
    enter its NIN again, because a resume with the same key is refused too.
  - The route is registered (`enrollment.availability`, public `GET`) and
    granted to patient-web only.
  - **Deploy order.** An Identity without hid-system#68 answers the read with
    404, which the page shows as a failed check, and offers no start. Deploy
    this portal with or after an Identity carrying hid-system#68.
  - Not changed: the sign-in page's "Get your Health ID" link and the public
    site's sign-up entry do not read availability; they lead to the notice
    (open questions).
- **Evidence.** 9 tests failed first (8 in `EnrollmentAvailability.test.tsx`,
  the registry case in `boundaries.test.ts`); 3 more guard what is unchanged.
  The existing enrollment tests now answer the read as open. Gates:
  `typecheck`, `lint`, `audit:boundaries` and `build:patient-web` pass;
  `npm test`: 139 files, 1831 tests.
- **Contact proved again (N2(c), ADR-048).** An activation whose contact was
  proved more than 30 minutes earlier answers
  `409 ENROLLMENT_CONTACT_REVERIFY_REQUIRED`, and Identity has already sent the
  enrollment back to the contact step without its contact. The page showed the
  message at the password step, where a second try was refused as
  `409 ENROLLMENT_STAGE_INVALID`, so only a reload helped. It now returns to
  the contact step with the contact typed on the page kept, clears the code and
  password, moves focus to the contact field and says why in an alert. Other
  activation refusals stay at the password step.
- **Saving the HID (N2(a), N2(b)).** The completion screen showed the HID
  without saying it may not be shown again. The activation response expires
  the enrollment cookie, and `GET .../current` shows the HID only if that
  response was lost, for 15 minutes after activation. The screen now asks the
  patient to write it down or keep it somewhere safe, says it may not be shown
  again, and says that with a verified phone the HID is how they sign in and
  reset the password (hid-system has not shipped N2(a), which sends it to the
  verified contact).
- **Evidence.** 3 tests failed first in `EnrollmentActivation.test.tsx` (the
  re-verification round trip, and the save note at activation and on a
  re-display); a fourth guards that other refusals stay at the password step.
  Gates: `typecheck`, `lint`, `audit:boundaries` and `build:patient-web` pass;
  `npm test`: 140 files, 1835 tests.
- **Not verified.** Component tests with the network stubbed. Nothing was run
  in a browser, at runtime, on staging or against a live hid-system.

## 2026-10-15: patient enrollment after review (a lost re-verification answer, an enrollment that ended while no start is offered)

Read at hid-system `main` `8f3eff1` (`patient-enrollment.service.ts`
`activate`, `resetStaleContact`; `docs/INTERFACE_CONTRACT.md`).

- **A lost re-verification answer.** Activation that finds a stale contact
  sends the enrollment back to the contact step, then answers
  `409 ENROLLMENT_CONTACT_REVERIFY_REQUIRED`. When that answer never reached
  the page (lost on the network, or it answered the same enrollment's
  activation in another tab), every further try was refused as not at the
  password step (`409 ENROLLMENT_STAGE_INVALID`, "Contact verification is
  required") and the page stayed there until a reload.
  - Now that refusal reads `GET .../current` and the page goes to the step
    Identity has: the contact step, or the code step when another tab already
    sent a new code, with the re-verification alert (worded for the code step
    there) and focus on the step's field.
  - If Identity still has the password step (the database check's "Enrollment
    conditions are not complete"), the refusal is shown there as before; if
    the read fails, its failure is shown (a 404 returns to the NIN step), and
    the next try reads again.
  - Unchanged: the direct 409 path, which needs no read; every other
    activation refusal (503, 429) stays at the password step without a read.
  - Evidence: 4 tests failed first in `EnrollmentActivation.test.tsx`; the
    case that asserted the stuck page now guards a 503 and a 429.
- **An enrollment that ended while availability was unknown.** When the
  availability read had failed (a 503 after its retries, or the 404 of an
  Identity without hid-system#68) and an enrollment in progress then ended
  here (`404 ENROLLMENT_NOT_FOUND` at a step), the page went to the NIN step,
  which shows only Try again in that state. Focus fell to the page, since
  nothing there was the step's focus target, and the alert said "Enter the
  same NIN to continue it" with no NIN field.
  - Now Try again is the step's focus target in that state, so focus goes
    there, and the alert says only that the enrollment ended until a read
    finds registration open; then the NIN field is shown and the alert asks
    for the same NIN.
  - Unchanged: a failed read at load and a Try again that fails again, which
    already moved focus to Try again; a closed registration, whose heading
    takes focus.
  - Evidence: 1 test failed first in `EnrollmentAvailability.test.tsx`, on
    focus and, with the focus fix alone, on the wording.
- **Reconnecting Google with no Google control.** An enrollment that
  required Google (`googleOnboardingRequired: true`, no pending Google
  sign-up) and then ended here returned to the NIN step still saying
  "Reconnect the Google account used to start this enrollment.", while a
  closed or unknown registration hides the Google sign-up, so the patient
  could not do it.
  - Now that line is shown only where a start is offered, as the Google
    section and the "Google identity confirmed" line already were.
  - Unchanged: the requirement is kept, so once a read finds registration
    open the line returns with the Google sign-up (guarded by a test); an
    enrollment in progress still shows it at every step.
  - Evidence: 2 tests failed first in `EnrollmentAvailability.test.tsx`
    (closed and unknown); 1 more guards the open case.
- **Gates** at each of the three commits: `typecheck`, `lint`,
  `audit:boundaries` and `build:patient-web` pass; `npm test`: 140 files,
  1840, 1841 and 1844 tests.
- **Not verified.** Component tests with the network stubbed. Nothing was run
  in a browser, at runtime, on staging or against a live hid-system.

## 2026-10-15: staff sign-in with an authenticator, part 1 (hid-system#71)

hid-system `main` `8f3eff1` has staff sign-in with an authenticator
(hid-system#71, ADR-054, migration 0088), the `403 NO_ACTIVE_FACILITY_MEMBERSHIP`
answer of hid-system#76 and the Turnstile contract of hid-system#79. None is
deployed. Against it, Health-id `main` `077b85c` could not sign staff in: it
took the password step's `{ status, expiresAt }` for a session, none of the
`/auth/mfa/*` steps was registered, and a `403 STAFF_MFA_REQUIRED` was handled
as an ordinary refusal ("Session unavailable" at load, a locked or still open
workspace mid-session). This branch (`claude/staff-mfa-signin`) lays the
plumbing; the second-step screens follow in part 2.

- **Shared MFA pieces.** The platform console's setup-key grouping, six-digit
  code rules and recovery-code step move to `src/mfa/` (`codes.ts`,
  `RecoveryCodes.tsx`, drawn with each portal's classes, button and file
  name), and `saveFile` to `src/download.ts`. The console looks and behaves as
  before; a characterization test pins its recovery codes.
- **Contracts.** `auth.staffMfaVerify`, `auth.staffMfaEnrollEmailCode`,
  `auth.staffMfaEnrollStart` and `auth.staffMfaEnrollActivate` are registered
  and granted to `staff-web` only. Staff verify takes a recovery code; there
  is no separate staff recovery-code route.
- **Staff API.** `verifyMfa`, `sendEnrollmentCode`, `startEnrollment` (with the
  emailed code, or none after provider activation) and `activateEnrollment`.
  Verify and activation wait for a sign-out or refresh in flight and take the
  session turn. `login` reads the answer as the second step or, from an
  Identity before #71, the session; anything else opens nothing.
- **`403 STAFF_MFA_REQUIRED`.** Treated as the end of the session: at load the
  refresh ends it and the portal goes to sign-in; mid-session, after a refused
  request, a facility switch or another tab's announcement, the portal asks
  the server and shows the session-ended screen. Both screens say Health ID now
  asks for an authenticator code. The staff client notes the session that
  heard the refusal, since the refresh clears the cookies and later answers no
  longer say why. A 503 still leaves the session alone.
- **Provider.** `login` (the password step) changes no state; `verifyMfa` and
  `activateEnrollment` forget other tabs' announcements made before they were
  sent; `completeSignIn` opens the workspace. The sign-in page opens an older
  Identity's session and, against #71, says it cannot ask for the code yet.
  Identity's own detail is shown for `403 NO_ACTIVE_FACILITY_MEMBERSHIP` and
  `STAFF_MFA_FACTOR_UNPROVEN`; there is no staff Google sign-in.
- **Departures from the investigation.** The registry header keeps its basis;
  the new routes carry their own `8f3eff1` note, as other additions do. The
  reason for an end is a per-session note in `staff/session.ts`, not the
  refused refresh's cause, which the HTTP client drops when a protected
  request's own refresh fails. `RecoveryCodes` takes the portal's button so
  the staff step can use `@hid/ui`. Activation announces to other tabs at
  once. Not done here: the admin copy for
  `409 MFA_ENROLLMENT_STAFF_SIGN_IN_REQUIRED`, the provider enrollment
  continuation and the QR code (part 2 and owner decisions).
- **Evidence.** 55 tests failed first across the five commits (12 shared
  pieces, 1 contracts, 15 API steps, 13 `STAFF_MFA_REQUIRED`, 14 two-step
  sign-in); 9 more were written as guards that already passed (the console's
  recovery codes, an ordinary end, the older Identity's session, Identity's
  refusal details, no Google). At the branch head every gate passes:
  `typecheck`, `lint`, `npm test` (144 files, 1883 tests), `audit:boundaries`
  and `build:patient-web`.
- **Not verified.** Component and API-client tests with the network stubbed.
  Nothing was run in a browser, on staging or against a live hid-system.

## 2026-10-15: staff sign-in with an authenticator, part 2 (hid-system#71)

Part 1 laid the plumbing; against hid-system `main` `8f3eff1` (not deployed)
the provider sign-in page still stopped after the password, provider
enrollment activation still reloaded into a workspace with no session, and
the platform console answered the dual-role enrolment refusal with "This item
changed". This part (`claude/staff-mfa-signin`) builds the screens.

- **QR code.** `src/mfa/OtpauthQr.tsx` draws the `otpauth://` URI Identity
  returns at enrolment start as inline SVG (one path, a four-module quiet
  zone, dark on light, presentation attributes only, as `style-src 'self'`
  allows), with `qrcode-generator` 2.0.4 (MIT, no dependencies) pinned
  exactly. No remote service sees the secret. The drawn modules were decoded
  back to the URI with jsQR outside the repository.
- **Staff second step** (`staff/routes/StaffMfaSteps.tsx`). `mfa_required`: the
  six-digit code or one recovery code. `mfa_enrollment_required`: an
  explanation and "Email me a code" (sent only on the press; sends and setup
  starts count against 5 per 15 minutes; "Send a new code" replaces it), the
  emailed code, the setup (QR code, grouped key, open-in-app link, deadline),
  the first code, and the ten recovery codes shown once; the workspace opens
  after "I have stored these recovery codes", with a session that does not
  keep them. Refusals: a wrong code is cleared and said at its field; 429,
  `503 MFA_UNAVAILABLE` and `MFA_ENROLLMENT_CODE_UNDELIVERABLE` keep the step;
  `MFA_CHALLENGE_INVALID` and `STAFF_MFA_FACTOR_UNPROVEN` (two platform
  administrators must reset the authenticator) go back to the password step;
  `MFA_ENROLLMENT_PROOF_REQUIRED` to the email step;
  `MFA_ENROLLMENT_PROOF_COMPLETE` on to setup with no code;
  `MFA_ENROLLMENT_PROOF_UNAVAILABLE` stops. Each step's heading takes focus;
  "Start again" waits for a step on its way. The password step says
  `STAFF_MFA_FACTOR_UNPROVEN` and `MFA_UNAVAILABLE` in the portal's words.
- **Provider enrollment.** Activation continues into the same steps on its own
  page, with no emailed code (the activation is the proof); an account that
  has an authenticator is asked for its code; the page reloads into the
  workspace only after the recovery codes. A lapsed challenge sends the
  administrator to `/provider/sign-in`. An older Identity's session still
  opens the workspace at once.
- **Platform console.** `409 MFA_ENROLLMENT_STAFF_SIGN_IN_REQUIRED` goes back
  to the credentials step and says to set the authenticator up at staff
  sign-in first.
- **Departures from the investigation.** The steps live in one component that
  the sign-in page and provider enrollment both draw, each with its own
  heading level, classes and button, since enrollment sits outside the
  provider workspace. The provider's context also offers the email code and
  setup start. Provider activation's setup starts on "Begin setup", not on
  arrival, so a remount never spends a start. Our words, not Identity's, for
  `STAFF_MFA_FACTOR_UNPROVEN` at the password step. The console's copy names
  the Provider Portal rather than linking to it: the admin host accepts no
  staff sign-in check. No `PasswordInput` exists on this base, so the
  password field is unchanged.
- **Evidence.** 33 tests failed first (4 QR, 24 sign-in steps of which 2 were
  part 1's expectations of "cannot ask for the code yet", 3 provider
  enrollment, 2 console). At the branch head every gate passes: `typecheck`,
  `lint`, `npm test` (146 files, 1914 tests), `audit:boundaries` and
  `build:patient-web`. One full run before the last style commit failed once in
  `OcrFocus.test.tsx` ("a short retry reason takes focus", a 1-second
  `waitFor` under load); it passes alone (three runs) and in the full re-run.
- **Review fixes.** A review found two minor defects; each test failed first.
  - Provider enrollment never told the other tabs that verify or activation
    set the session: the staff announcer posted only on the channel the tab
    listens with, and `/provider/enroll`, outside the workspace, listens on
    none. Its test passed only because it mocked the announcer. The announcer
    now goes through `announceSessionChange`, which opens a channel for the
    message when the tab has none (the workspace, which listens, is
    unchanged), and an older Identity's activation announces too. The test
    stubs `BroadcastChannel` instead; 3 cases failed before the fix.
  - `.staff-mfa p` matched a Field's error paragraph and, being in no layer,
    beat its `text-critical`: a refused code showed in the steps' grey. The
    rule is `.staff-mfa > p`. The sign-in tests read the unlayered rules and
    pin each refused code's error (id, class, description, alert); 4 cases
    failed before the fix. `.staff-card p` (on `main` before this branch)
    does the same to Field errors in the workspace's cards, Registration's
    among them; it is not changed here.
  - Every gate passes after each fix: `typecheck`, `lint`, `npm test` (146
    files, 1914 tests), `audit:boundaries`, `build:patient-web`.
- **Not verified.** Component tests with the network stubbed; nothing was run
  in a browser, with a real authenticator app, on staging or against a live
  hid-system. The QR code's look on a phone camera, and the email delivery of
  enrolment codes (an operator item), are unchecked.

## 2026-10-15: launch alignment with hid-system `main` `8f3eff1`

hid-system `main` at `8f3eff1` is what production is to run. Read-only, its
contract (`docs/INTERFACE_CONTRACT.md`) and code show five things Health-id
`main` `077b85c` gets wrong or does not use. Each is fixed on
`claude/launch-alignment-fixes` in its own commit, with tests that failed
first. hid-system was not changed.

- **Admin principal search and export (A24, hid-system#76).** The console sent
  the search term (a name or an email address) and the export's audited reason
  in `GET` query strings, which access logs keep. The search is now
  `POST /admin/principals/search` with `{ query, page, pageSize, status? }` and
  the export `POST /admin/principals/export` with `{ reason, query?, status? }`,
  both with the platform CSRF token. The export keeps its download transport,
  its row headers and its no-retry; the search, now a `POST`, is not repeated
  automatically either. The registry drops the `GET` forms, so neither can be
  sent with its terms in the URL. The screens are unchanged. Failing first: 6
  tests (the admin API's search, export and route list, the registry and the
  registered client).
- **Encounter close since hid-system#74 (migration 0090).** The status form
  said that a retraction left completed orders, vitals and documents unchanged.
  Since 0090 marking an encounter entered in error also marks its final vitals,
  its completed prescriptions and lab requests and its initiated or uploaded
  documents entered in error; cancelling still changes only open orders. The
  warning now says so. A close that would change a kind of record the actor may
  not write answers `403 ENCOUNTER_RETRACTION_NOT_PERMITTED` with nothing
  written; the form showed EHR's terse detail, and now says the role may not
  make that change, that nothing changed and to ask a colleague whose role may
  change all of the encounter's records, naming no kind of record, as EHR does
  not. It is not read as a stale encounter: nothing is read again, and the
  choice and reason stay. Not changed: the Documents tab is not read again
  after a retraction (at launch no role may retract an encounter holding an
  uploaded document), and a completed encounter is still offered no
  retraction. Failing first: 5 tests (the three warning cases and the two
  refusals).
- **Vitals entered in error (hid-system#74).** A vital now carries `status`,
  and one entered in error keeps its values but takes no correction
  (`409 VITAL_NOT_AMENDABLE`). The Vitals tab showed such a vital as current and
  offered "Correct these vitals", which EHR would refuse. It is now marked
  "Entered in error", says not to use the values, and offers no correction; its
  earlier corrections are still shown. A retraction, like a correction, raises
  the vital's row version, which EHR checks first, so a correction sent at the
  version loaded before either answers `412 VERSION_CONFLICT`; the 409 answers
  only the version of a vital already entered in error. Either now reads the
  vitals again, says whether they were marked entered in error or changed
  otherwise, and moves focus to the vital; the 412 used to show EHR's detail in
  the form, with the list unchanged and every resubmission refused. An EHR
  before #74 sends no status, and every vital stays correctable. Not added: the
  single-vital retraction route. Failing first: 3 tests (the marker, the marker
  with a correction, the refused correction), and on review 2 more: the
  refused correction, which had a 409 EHR does not give there, now with EHR's
  412, and a 412 for a vital corrected meanwhile. A 409 whose list cannot be
  read again, added then, passed before the change.
- **Patient routes answering `403 PATIENT_SESSION_REQUIRED` (hid-system#74 and
  #76, ADR-059; hand-off A9).** Every patient-only route now refuses a provider's or
  administrator's session so, where it used to answer a retried `503`. With a
  provider's sign-in live in the shared cookies, the patient pages showed "An
  active patient session is required" as if the page had failed. Now such a
  refusal makes the portal ask `GET /auth/session` whose session the browser
  holds, the question it asks when another tab announces a change, and the
  refusal reaches the page only once that is answered: a provider's session
  signs the tab out, so the page goes to sign-in, which says the sign-in
  changed elsewhere. The 403 alone ends nothing; a check the server cannot
  answer (a `503`) or one that finds this patient's own session changes
  nothing, and the page shows the refusal. No other 403 asks anything. Failing
  first: 5 tests (the session client's three cases, the shared-browser case
  and the records page).
- **Health ID Migrate card (hid-system#75, migration 0091).** OCR is closed
  at launch, and since 0091 no role holds any `ocr.*` permission, so the
  Document OCR workspace is hidden. The provider dashboard still showed every
  role a "Health ID Migrate" card leading to it, and `/provider/migrate` opened
  for anyone with its own link to Document OCR. Both now show only with
  `ocr.job.read`, as the OCR workspace does; the page otherwise says it is
  unavailable, with its own main landmark and h1 (the investigation asked for
  the route as well as the card). Failing first: 2 tests (the card hidden, the
  page unavailable).
- **Evidence and gates.** Each commit's failing and passing runs are kept
  outside the repository. At each commit `typecheck`, `lint`,
  `audit:boundaries` and `build:patient-web` pass, and `npm test` passes in
  full (from 138 files and 1819 tests on `main` to 140 files and 1837 tests).
- **Not verified.** Component tests with the network stubbed. Nothing was run
  in a browser, at runtime, on staging or against a live hid-system.
- **Deploy order.** The admin console needs an Identity with hid-system#76,
  and the encounter and vitals wording an EHR with hid-system#74: this portal
  is to be deployed with or after hid-system `8f3eff1`.

## 2026-10-15: the portal build is checked against hid-system's staging refusals

hid-system's staging step (`infra/cloudflare/scripts/health-id-artifact.mjs`,
read at hid-system `main` `94889fd`) refuses a Health-id build that carries
Google sign-in, a service worker (a `service-worker.js`, `sw.js` or
`workbox*.js` file, or `serviceWorker` in a script), a web app manifest, a
source map, or any file other than `index.html` and content-hashed files under
`assets/`. Nothing in Health-id checked this, so a branch could build a portal
that staging refuses and CI would pass: a review of the PWA branch found its
build kept Google's script loader with no Google client ID.

- `npm run audit:launch-build` (`scripts/check-launch-build.mjs`) runs those
  rules over `apps/patient-web/dist`. CI runs it after the builds, which have
  no Google client ID, as at launch. The environment record and the
  `index.html` shell depend on the host being staged and are left to the
  staging step.
- **Evidence.** A build of `main` `598ddc0` passes (13 files). Seven altered
  copies of that build each fail with their own reason: an added source map
  file, a `service-worker.js`, a `health-id.webmanifest`, Google's
  `gsi/client` URL in a script, a `robots.txt`, a `serviceWorker` registration
  in a script, and a `sourceMappingURL` comment.
- **Not verified.** The hid-system stager itself was not run; the rules were
  copied from it and must be kept in step when it changes.

## 2026-10-15: patient sign-up against hid-system `main` `f9dbaf0` (the NIN holder step and the facility route)

hid-system `main` `f9dbaf0` merged ADR-061 (#82, migration 0092: a NIN record
without a date of birth or gender), the NIN holder step (#84, ADR-062,
migration 0093: before a contact or a password the patient proves they hold the
NIN by a code texted to the phone on the NIN record) and the facility route
(#85, ADR-063, migration 0094: or in person at a participating facility), and
#86 (integration status and the "Health-id alignment" list,
`PHASE_4_STAGE_5_RELEASE_READINESS.md` section 3). None is deployed. The
patient's side of that list, with the owner's decision of 2026-10-14 (both
routes discoverable from the start, no fake confirmation, an existing Health ID
sent to account recovery, a pending facility check explained), is on branch
`claude/patient-signup-online`, rebuilt on Health-id `main` `55a50b0`. Three
commits of an earlier draft against a hid-system branch that `main` did not
adopt (routes `holder/code`, `holder/cancel`, `contact/holder-phone`) were
dropped; the Retry-After helper, the split of the enrollment stages and the
ADR-061 password step were kept unchanged (same trees).

- **Routes and shared client (rows 1, 14, 15).** The registry and the
  patient-web grant name `POST .../holder`, `/holder/verify`, `/facility-code`
  and `GET .../participating-facilities`; staff-web and admin-web are not
  granted them. Availability is `{ open, online, facility }`, `open` the only
  gate. `@hid/contracts` (`wire.ts`) and `@hid/api` (`services.ts`) follow.
- **NIN step (row 14).** It says how the NIN will be proved: a code to the phone
  linked to the NIN, and, for someone who lost their SIM, changed their number,
  has no phone linked to the NIN or can't get the code, an in-person check at a
  participating facility, linking to the public `/enroll/facilities`; or that
  either is not available. The button is "Continue". `503
  PATIENT_REGISTRATION_NOT_OPEN` shows the closed notice; a NIN lookup that
  could not be completed and any outage keep the step.
- **The holder step (rows 2 and 3, P31, P33).** "Prove this NIN is yours" offers
  both routes and sends nothing until one is chosen. Online: the code, its
  expiry, the resend wait (`Retry-After` when sent, else `GET .../current`'s
  `online.resendAfterSeconds`; Identity sends no `Retry-After`) and the three
  codes; every answer of the contract table, `NIN_HOLDER_ROUTE_UNAVAILABLE`
  (409 and 503), `NIN_HOLDER_ROUTE_LIMITED`, `OTP_RESEND_COOLDOWN`,
  `OTP_INVALID`, `NIN_HOLDER_PROOF_CONFLICT`, `OTP_DELIVERY_UNAVAILABLE` and
  `404`, is said, with the facility where the code cannot help. Facility: an
  in-person check of one original photo ID comes first, what to bring and the
  facilities are listed, the desk code is asked for only on request, shown
  again after a reload and replaced only if staff ask; "I have been checked"
  reads `GET .../current`, and its `404` (or one after any facility action)
  offers account recovery, sign-in or starting again, never "the same NIN". A
  Google sign-up is offered at the NIN step and after the proof, not while the
  NIN is being proved, and starting again carries nothing typed (the contact
  included) into the next registration.
- **Endings (rows 8, 9, 10).** `409 NIN_ALREADY_REGISTERED`, after a correct code
  or at activation: account recovery, sign-in and Health ID support with the
  problem's `correlationId`, the start key dropped. `409
  ENROLLMENT_HOLDER_PROOF_REQUIRED`: the NIN step with a new key. `404
  ENROLLMENT_NOT_FOUND` names its other causes (a later proof elsewhere, the
  24-hour expiry).
- **Date of birth and gender (row 6).** The password step asks for the fields
  `requiredProfileFields` names and shows ADR-061's three `400` refusals at them
  (kept commit).
- **Verify NIN (row 13).** The profile page's card is hidden until P27:
  hid-system answers it `503 QOREID_PATIENT_NIN_BINDING_DISABLED` by default.
- **Docs and comments (row 17).** The comments and docs that said a new start
  key is refused `409 NIN_ALREADY_REGISTERED`, the registry header citing
  `c4b5445` for every route, and hand-off E20(d) keeping the facility route out
  of scope are corrected.
- **Not on this branch.** The staff in-person check (row 4), the admin
  designation (row 5), the problem `fields` member (row 7) and the provider rows
  (11, 12, 16). Health ID support has no address yet (SUPPORT-CONTACT), so the
  page names it without a link.
- **Evidence and gates.** Each new commit's tests were written first and failed
  before its change: 5 (contracts and API), 13 (the NIN step, the public list,
  the route test and the 320px rule), 34 and a 320px rule (the holder step and
  the facility stage), 3 (activation refusals and the `404` text), 3 (the
  Verify NIN card) and 6 (fixes from a review of the branch: a `404` after a
  facility action, a cooldown or a `409 NIN_HOLDER_ROUTE_UNAVAILABLE` whose
  re-read finds the registration moved on or gone, the facility route closing
  before "I have been checked", Google while the NIN is proved, and a contact
  carried into a new registration). At each commit `audit:boundaries`, `typecheck`, `lint`,
  `vitest`, `build:patient-web` (local environment) and `audit:launch-build`
  pass; `vitest` went from 152 files and 1975 tests (after the routes) to 157
  files and 2028 tests. One full run failed two provider session-end tests on
  their 5-second timeout under load; they passed alone and on the next full
  run.
- **Compatibility.** Against today's deployed Identity, which answers
  availability `{ open: false }` and refuses every start, the page shows its
  closed notice as before. An Identity before #84 that answers `{ open: true }`
  gets the NIN step without the routes, and its `verify_contact` start goes on
  to the contact step as before.
- **Not verified.** Component tests with the network stubbed. Nothing was run in
  a browser, with a screen reader, at runtime, on staging or against a live
  hid-system; the 320px layout is checked from the stylesheet rules only.

## 2026-10-15: patient sign-up after a second review (the facility stage's start key, a completed registration, the holder proof conflict, announcements)

A second review of branch `claude/patient-signup-online` against hid-system
`main` `f9dbaf0` (`INTERFACE_CONTRACT.md`, "The NIN holder step" and
"Facility-assisted registration"; `patient-enrollment.service.ts`; 0094) found
six defects. Five commits fix them, each with failing tests written first.

- **The facility stage dropped the start key on a `404` (`826d396`; Health-id
  alignment row 10, P31).** A sign-in, refresh or sign-out in the browser
  expires only `hid_enrollment` (`auth.controller.ts` `clearEnrollmentCookie`).
  A start with the same key and NIN resumes the registration, with any
  recorded in-person check and no new NIN lookup (`resume`). The
  facility-stage `404` called `freshStart`. So after the sign-out note ("continue
  it by entering the same NIN"), Check again and the same NIN cost a second paid
  lookup and a second check at the facility, and an online proof was then
  refused `409 NIN_HOLDER_PROOF_CONFLICT`. The `404` now keeps the key and
  clears what was typed. "This registration has ended" still gives the staff
  member's direction first. It also names a sign-in or sign-out in this
  browser, and its Start again keeps the key. A `404` found by Check again just
  after the sign-out note goes to the NIN step, as the note says. A
  registration that is gone starts afresh with either key, and another NIN
  gets a new key. "Use a different NIN" and `429 ASSISTED_DESK_CODE_LIMITED`
  still start with a new key. 3 tests failed first.
- **The start's `409 IDEMPOTENCY_KEY_REUSED` invited a new paid start
  (`1205617`).** `resume` answers it only for another NIN or an active row, and
  the page binds the key to the NIN. So it means the registration this page
  started was activated (a lost activation answer, or another tab). The page
  said "That registration has ended. Select Continue to start again". It now
  shows "This registration was completed", with sign-in and account recovery,
  no NIN field and no new start. 1 test failed first; the branch had none for
  this answer.
- **`409 NIN_HOLDER_PROOF_CONFLICT` sent the registration to "Get my desk code"
  (`a8d26f7`).** 0094 answers it only when another registration of the NIN was
  already checked in person and is waiting for its contact and password.
  The page said "show your desk code" for a registration that had none. A second
  check would cost the staff and facility daily budgets and delete the
  registration already checked. The page now stays at the choice. It says to
  finish that registration on the phone used at the facility, and keeps the
  facility as the fallback. The text message route says why it can't help.
  The existing test was rewritten and failed first. The contract's looser
  wording is in [open questions](./OPEN-QUESTIONS.md).
- **A refusal after Enter in the password field was not announced
  (`74fe26a`; ADR-061, P29).** With a profile field on the step, that field is
  the focus target, and `onTarget()` was false in the password field. So a date
  refused on the page, `DATE_OF_BIRTH_INVALID`, `ENROLLMENT_PROFILE_REQUIRED`
  for another field and `PASSWORD_INVALID` were not alerts while focus stayed
  put. `sentFromField` (`authSteps.ts`) reads where focus really is. 4 tests
  failed first.
- **The facility check confirmation was a live region inserted with its text
  (`2504d72`).** The page's notice region now stays mounted, and the contact
  field that focus moves to is described by the notice. 1 test failed first.
- **Gates.** At each commit, `audit:boundaries`, `typecheck`, `lint`, `vitest`,
  `build:patient-web` (local environment) and `audit:launch-build` pass.
  `vitest` went from 157 files and 2028 tests to 157 files and 2037 tests.
- **Not verified.** These are component tests with the network stubbed. Nothing
  was run in a browser, with a screen reader, on staging or against a live
  hid-system. How each screen reader reads the mounted status region and the
  description is not checked.

## 2026-10-15: facility-assisted registration, staff and console (hid-system#85)

Read at hid-system `main` `f9dbaf0` (D-Eminence/hid-system#84, #85 and #86;
migration 0094, ADR-063): `docs/INTERFACE_CONTRACT.md` ("Facility-assisted
registration", and section 6 on a problem's `fields`),
`services/identity-api/src/identity/{assisted-verification.controller,assisted-verification.service,assisted-registration.guard,assisted-match,desk-code}.ts`,
`identity/dto/assisted-verification.dto.ts`,
`services/identity-api/src/admin/{admin.controller,admin.service,admin-command-error,high-risk-policy}.ts`
and `admin/dto/admin-command.dto.ts`. These are the staff and console rows of
the Health-id alignment list (rows 1, 4, 5 and 7); the patient rows (1 to 3,
6, 8 and 9) are on the patient sign-up branch.

- **Routes (row 1).** The registry names `POST /identity/assisted-verifications`
  (`identity.patient.assisted_registration`) and `GET` and `POST
  /admin/facilities/:facilityId/assisted-registration` (`platform.facility.read`,
  `platform.facility.manage`). The provider portal is granted the check, and
  the patient portal, public site and console are refused it; only the console
  may call the designation.
- **Problem fields (row 7).** `@hid/http` keeps a problem's `fields` member as
  `HidApiError.fields`: field names to short result codes (up to 64 characters
  of `[A-Za-z0-9_.-]`), never a value; any other shape is dropped, and the
  member stays out of log summaries. No code read it before, so nothing
  depended on its absence.
- **Staff in-person check (row 4).** `/provider/in-person-check`, after Patient
  registration in the navigation, for a role holding the permission (doctor,
  clinician, nurse); others see "In-person check unavailable" and nothing is
  sent. The desk code (read as Identity reads it), method, document type,
  names and optional date of birth as written on the document, and the five
  attestations are refused at their field before sending. One
  `Idempotency-Key` per submission, held in memory and reused only while the
  answer is unknown and the details unchanged. Every answer in the contract is
  handled, the `422` per field (`match`, `no_match`, `not_in_record`) with no
  record value; no answer restores, ends or signs out the session; nothing
  typed reaches storage, the address or router state; focus moves to each
  stage's heading and errors are announced.
- **Designation (row 5).** "Registration in person" on the console's facility
  page reads the designation and, with `platform.facility.manage`, designates
  (always active, as `If-Match: 0` requires), changes or suspends it under
  step-up with a reason. `adminApi.command` refused version 0 and dropped
  `If-Match` for it, so the first designation could not be sent; it now takes
  `creates`, sends `If-Match: "0"` for such a command and still refuses 0 for
  every other. `admin/problems.ts` has `FACILITY_NOT_ACTIVE` and
  `ADMIN_FACILITY_NOT_FOUND`; the panel words the command's other refusals and
  reads the designation again after `VERSION_CONFLICT`.
- **Evidence.** The tests were written before the code: 71 new tests in 8
  files (http 5, contracts 2, staff request 8, staff screen 30, staff page 3,
  console request 4, console panel 17, layout 2). The http, contracts, staff
  request, staff page and both console files were run failing first. The staff
  screen's were run once its code existed, and checked by reverting its key
  handling (always a new key: 4 tests fail; never a new key after a definitive
  answer: 2 fail); `If-Match: 0` by reverting it (1 fails) and the 320px rules
  by removing them (2 fail). At each commit
  `audit:boundaries`, `typecheck`, `lint`, `vitest run`, `build:patient-web`
  and `audit:launch-build` pass. Three full runs while other worktrees loaded
  the machine each timed out one test this change does not touch
  (`PatientSessionRequired`, staff `SessionEnd`, `OcrFields`); each passes
  alone and in the next full run.
- **Not verified.** Component tests with the network stubbed. Nothing was run
  in a browser, against a live Identity or on staging (S4v).
- **Deploy order.** The staff entry shows only for a role holding
  `identity.patient.assisted_registration`, which 0094 seeds. The console's
  panel needs an Identity with #85: an earlier one answers the read with a 404,
  which the panel shows as a failed read. `ASSISTED_REGISTRATION_ENABLED` must
  stay off until the patient screens are deployed too (hid-system P31, P33).

## 2026-10-15: facility-assisted staff and console screens after review (hid-system#85)

Six review findings on the screens of the entry above, checked again against
hid-system `main` `f9dbaf0` (`docs/INTERFACE_CONTRACT.md` "Facility-assisted
registration", `identity/assisted-registration.guard.ts`,
`identity/assisted-verification.service.ts`, `identity/assisted-match.ts` and
migration 0094's `auth.staff_session_is_mfa`). Two of the six are the same
defect (a partly typed date of birth), so five changes were made; none was
found wrong.

- **A partly typed date of birth (two findings).** A date control holding an
  unfinished or impossible date (31 February) reports an empty value, and only
  `validity.badInput` says so. The check was sent without the date, counted
  toward the daily budgets (20 per staff member, 100 per facility, every
  outcome) and, when the NIN record has a date, answered `422` with "None was
  typed". It is now refused at the field before sending: "Enter the whole date
  of birth as written on the document, or clear the field if the document
  shows none."
- **`503 ASSISTED_REGISTRATION_DISABLED`.** The contract's next step is "None;
  the route is closed", but any `5xx` kept the key and turned the button into
  "Check again". This answer is now final: the button stays "Check the details"
  and the next check takes a new key.
- **`403 ASSISTED_REGISTRATION_NOT_AUTHORIZED`.** The message named three of
  the four causes. It now says: "the facility must take part, and you need an
  active account, a sign-in confirmed with your authenticator, an attested
  clinical grant and an active membership here", which is what
  `docs/OPEN-QUESTIONS.md` and `docs/BACKEND_OWNER_HANDOFF.md` already said.
- **Designation focus.** A save, or a `409 VERSION_CONFLICT`, reads the
  designation again; its new version replaces the form and the focused button,
  so focus fell to the page. It now moves to the panel's heading, also after a
  step-up dialog closes; a refusal that leaves the form in place keeps focus on
  the button.
- **Designation announcements.** The panel never cleared its error or notice
  when a submission started, so the same answer twice (two saves of one status,
  `ADMIN_STATE_CONFLICT` twice, a cancelled step-up twice) changed nothing and
  was not announced. The form now clears them as it sends, each answer is a new
  numbered element, and the notice appears inside a status region that is
  always present. Two `503`s in a row were already announced: each carries a
  new reference.
- **Evidence.** 8 new tests and 2 changed; 9 were run failing first. The staff
  check: 2 new (the partly typed date; the next check after the closed route
  takes a new key) and 2 changed (the closed route's test now asserts the
  button; the 403 row asserts the new message), all 4 failing first. The
  designation panel: 6 new, 5 failing first (focus after a first designation,
  after a step-up and after a version conflict; the notice and the alert
  cleared and shown anew); the sixth, focus kept on the button after a refusal
  that leaves the form in place, passes before and after. At each commit `audit:boundaries`, `typecheck`, `lint`,
  `vitest run` (158 files, 2038 tests at the second), `build:patient-web` and
  `audit:launch-build` pass. One full run while other worktrees loaded the
  machine (load average 14) timed out `OcrFields` once, a test this change does
  not touch; it passes alone and in the next full run.
- **Not verified.** Component tests with the network stubbed; `validity.badInput`
  is stubbed, since jsdom does not set it. Nothing was run in a browser, with a
  screen reader, against a live Identity or on staging (S4v). A cancelled
  step-up still leaves focus on the page, as everywhere in the console: the
  step-up dialog does not return focus when it closes.

## 2026-10-15: facility-assisted screens, second review (hid-system#85)

Five review findings on the screens of the two entries above, checked against
hid-system `main` `f9dbaf0` (`docs/INTERFACE_CONTRACT.md` section 6 and
"Facility-assisted registration", `identity-api/src/common/problem.ts`,
`admin/admin.controller.ts`, `admin/admin.service.ts` and migration 0094's
`facility_assisted_registration_participating` and
`list_participating_facilities`). None was found wrong; each was fixed.

- **Problem fields.** `@hid/http` kept any `fields` value of up to 64
  characters of `[A-Za-z0-9_.-]`, which a surname (`OKAFOR`) or a date of
  birth (`1990-04-02`) also is, so the entry above overstated it ("never a
  value"). It now keeps only `match`, `no_match` and `not_in_record`, the
  three words the contract and `ProblemDetails.fields` define; a new code must
  be added to the list first. The in-person check already showed only those
  words and "no result given" for anything else; a test now covers that.
- **An Identity without #85.** The facility page reads the designation on
  every facility, flag or not. An Identity without #85 answers the unknown
  route with its default `404 NOT_FOUND` ("Cannot GET /api/v1/admin/..."),
  which the panel showed as a raw alert with a Refresh. Any `404` but
  `ADMIN_FACILITY_NOT_FOUND` is now a quiet note: "Registration in person is
  not available on this Identity service yet." The entry above's deploy order
  ("shows a failed read") is replaced by this; `docs/OPEN-QUESTIONS.md` has a
  "Deploy order for the designation read" row.
- **An old answer beside a new refusal.** A press of Save refused before
  sending (an empty reason after a version conflict, or a second change after
  "Saved.") left the earlier alert or notice on screen. Each press now clears
  it first, as the staff check does.
- **The page's Refresh.** It re-read the facility and the audit excerpts but
  not the designation, so a change made by another administrator stayed hidden
  and the next change was refused `409 VERSION_CONFLICT`. The page's Refresh,
  and a change of the facility's status, now read the designation again; the
  form is kept unless the version changed.
- **Not in effect.** Identity counts an active designation only for a
  verified, active facility of an active organization, and nothing suspends it
  when the facility's status changes. The panel now gets the facility's status
  and says "Not in effect: the facility must be verified and active, in an
  active organization." beside an active status when the facility is not
  verified; its description names the condition. An inactive organization or
  `facility.active` false is not in the console's facility read, so the panel
  cannot say those.
- **Evidence.** 11 new tests: http 1, staff screen 1, designation panel 9
  (one `it.each` of 3). 10 were run failing first (http 1, panel 9). The staff
  screen's passes before and after, since the screen already allow-listed the
  words; making it show an unknown value fails it. The panel's test file now
  resets its mocks before each test, so an answer one test queued and did not
  use cannot reach the next (while the new tests failed, one reached an
  existing test). At each commit `audit:boundaries`, `typecheck`, `lint`,
  `vitest run` (158 files; 2040 tests after the http change, 2049 after the
  panel's), `build:patient-web` and `audit:launch-build` pass.
- **Not verified.** Component tests with the network stubbed. Nothing was run
  in a browser, with a screen reader, against a live Identity (with or without
  #85) or on staging (S4v).

## 2026-10-15: clinician self sign-up, the applicant's pages (hid-system ADR-064)

Owner decision 2 of 2026-10-14: doctors and nurses sign up themselves and two
HID administrators approve. hid-system built the backend on branch
`claude/clinician-self-signup` (head `fa58e2b`, migration `0094` to be
renumbered `0096`, ADR-064 proposed): **not pushed, merged or deployed**. This
branch (`claude/clinician-signup-pages`, from `main` `55a50b0`) builds the
applicant's side against that branch's contract; the administrators' queue is
not built.

- **Contracts.** Sixteen public routes (`enrollment.clinician*`: availability,
  the sign-up email code and its check, facility search, the submit, the five
  authenticator steps, the status page's email code and its check, the
  applications, withdraw, apply again, the end of the page), granted to the
  provider portal (`staff-web`) only. The public site's enrollment grant now
  names the routes it could reach before, so it cannot reach these; a new
  enrollment route for the public site must be added to that list.
  `staff/clinicianApplicationApi.ts` has a client of its own that restores no
  staff session on a 401 and reports nothing to the workspace: a 401 means
  only that the application page or its authenticator step ended. Commands
  are sent once with the page's Idempotency-Key; withdraw sends `If-Match`.
- **Sign-up, `/provider/join`** (`staff/routes/ClinicianSignUp.tsx`), outside
  the provider workspace and its session. Only `200 { open: true }` shows the
  form; otherwise "Clinician sign-up isn't open yet", with Retry after an
  outage. Email, then code (the same words for every address; a new security
  check, `clinician-application`, for every send; the wait for a new code said
  once, with no countdown); details (name, doctor or nurse with MDCN or NMCN
  derived, never typed, licence number and expiry, a facility searched from 3
  letters with the count announced); password and the two declarations; one
  submit with a key kept in memory. Then the authenticator with no session
  (`staff/clinician/ClinicianAuthenticator.tsx`): the emailed proof, the QR
  code and setup key (`src/mfa/OtpauthQr.tsx`), the first code and the
  recovery codes once (`src/mfa/RecoveryCodes.tsx`), or a code when the account
  has one, and "Start again" (P9) when a step expired. "Application
  submitted" never says verified or approved.
- **Status, `/provider/join/status`** (`staff/routes/ClinicianApplicationStatus.tsx`):
  an email code (`clinician-application-status`), then the authenticator code
  or its setup; each application's state in fixed words (decision codes for a
  rejected one, the access state of an approved one, the licence's last four
  characters); withdraw in a dialog that holds focus, with `If-Match` (a 409
  reloads and says it changed); apply to another facility; "Close this page".
- **Ways in.** Provider sign-in and provider enrollment ask for availability
  (`staff/clinician/ClinicianSignUpEntry.tsx`) and offer "Sign up as a
  clinician" only on `{ open: true }`, otherwise "Clinician sign-up isn't open
  yet"; both link the status page. Sign-in after a right password for an
  account with no active facility (`403 NO_ACTIVE_FACILITY_MEMBERSHIP`) keeps
  Identity's words and points an applicant to the status page. Enrollment says
  its administrator account cannot also hold a clinical role. On a staff
  product host or the admin site every clinician link goes to the main site,
  the only host whose Turnstile accepts the two actions.
- **Refusals.** Every code in the contract has words: intake closed, the rate
  limits (no countdown), the address in use (sign in, reset, status page),
  facility busy or unavailable, a signed-in browser, the email proof expired,
  the authenticator set up at platform sign-in, the 0088 codes (a refused code
  cleared at its field, an expired step opened again, an email proof already
  used restarted through P9), a changed application. A 503 or a network
  failure keeps the page and what was typed and signs no one out. Nothing is
  written to browser storage or the address; step headings take focus and
  errors are alerts; the CSS keeps both pages inside 320px.
- **Departures from the design.** The applicant authenticator is its own
  component reusing `src/mfa/`, not a generic `StaffMfaSteps`, so staff
  sign-in is unchanged. The entry says "Sign up as a clinician" as asked, not
  the design's "Apply to join your facility". Sign-in keeps Identity's detail
  for `NO_ACTIVE_FACILITY_MEMBERSHIP` and adds a line. The password fields use
  `@hid/ui` `Input`: the shared `PasswordInput` is on the unmerged branch
  `claude/turnstile-password-pwa-push`, not on `main`.
- **Evidence.** Each commit's tests failed first: the boundary test and the
  API module; the sign-up page's 42 tests and its route test; the status page's
  50 and its route test; 9 entry tests; 1 authenticator test (17 more cover
  0088 answers the page already handled). At each commit `audit:boundaries`,
  `typecheck`, `lint`, `npx vitest run`, `build:patient-web` and
  `audit:launch-build` pass. `npx vitest run`: `main` 150 files, 1957 tests;
  this branch 156 files, 2118 tests. The staff sign-in integration tests that
  list every request now stub the availability read, and the clinician pages'
  title checks wait for the title effect (one failed once under load).
- **Not verified.** Component tests with the network stubbed, against the
  backend branch's code and its RESULT notes; nothing was run in a browser,
  with an authenticator app, or against a running Identity.
- **Deploy order.** hid-system merges ADR-064 and deploys 0094 (renumbered),
  the role bootstrap and Identity; then this portal. Against an Identity
  without ADR-064 the availability read answers 404, so sign-up and the
  provider pages say sign-up isn't open yet, but the status page (always
  linked) says it couldn't load the applications, with Retry.
  Intake must stay off (`clinician_signup_enabled`) until the administrators'
  queue ships: without it no application can be approved.

## 2026-10-15: clinician self sign-up, the administrators' queue (hid-system ADR-064)

The same branch (`claude/clinician-signup-pages`) adds the platform console's
clinician verification queue, against hid-system's unmerged branch
`claude/clinician-self-signup` (`fa58e2b`): its RESULT contract §4.3 (A1-A5),
`ClinicianApplicationAdminService`, `admin-command-error.ts` and
`identity.admin_get_clinician_application` (C18). Until this, no application
could be approved.

- **Contracts.** Five admin routes (`admin.clinicianApplications`,
  `admin.clinicianApplication`, `admin.clinicianApplicationAttest`,
  `...Approve`, `...Reject`), each `platform.workforce.manage`, reached by the
  console through its `admin` grant only. `admin/api.ts` lists by state with
  the cursor and limit only when given, and sends the three commands through
  `adminApi.command` with `If-Match`, the submission's `Idempotency-Key` and
  the platform CSRF token.
- **Queue, `/admin/clinicians`** (`admin/ClinicianApplications.tsx`, "People
  and access", shown for `platform.workforce.manage`): Open (the three
  undecided states, oldest first) and each state, newest first, as
  `aria-pressed` filters kept in the address; Load more with that state's
  cursor. Each card: applicant, profession and regulator, licence and expiry,
  facility and organisation, dates, authenticator, and who recorded step 1
  ("You", with "Needs a different Super Admin").
- **Application, `/admin/clinicians/:applicationId`** (by ID only, never a
  name, email or licence in the address): every field in a `dl`; Identity's
  warnings in words; the account, its other facilities and its
  authenticator ("Set up on", "Not set up: step 1 is unavailable", "Set up
  after a password reset"); the facility with its CAC hint and its
  administrators "(not sufficient alone to confirm employment)"; the step-1
  record, the approval and the decision with both reasons.
- **Step 1 (A3)**, shown while the application is submitted and the caller's
  hint allows it (otherwise the reason in words): the licence, identity and
  employment checklist in fieldsets, the applicant's live code read out on
  the call (`autocomplete="off"`, so the browser never offers the reviewer's
  own one-time code), the evidence reference, the verification date and a
  reason. The date defaults to the earlier of the licence expiry and a year,
  is limited to the licence expiry and three years, and is sent as the end
  of that day in Lagos (`T23:59:59+01:00`), the cap the backend applies. A
  refused or rate-limited code clears and focuses only that field.
- **Step 2 (A4)** is never offered to the administrator who recorded step 1,
  whatever a hint says. It names the grant ("Grants Doctor at {facility} to
  {name}"), the role's permissions in plain words, and explains
  `CLINICIAN_APPLICATION_SECOND_ADMIN_REQUIRED` and an authenticator reset
  after step 1 (reject with "Other").
- **Reject (A5)**: the nine decision codes, each with the words the applicant
  will see (the status page's copy, now exported from
  `staff/clinician/copy.ts` as `decisionCopy`), an internal reason, and for
  `identity_not_confirmed` that the account cannot apply again, with a link
  to Users & roles to lock it.
- **Outcomes.** A focused notice, then the application is read again. A
  replay says it was already done with that submission; `VERSION_CONFLICT` or
  `CLINICIAN_APPLICATION_STATE_INVALID` reloads and says the application
  changed; an answer that was lost (a network failure or a 5xx) reloads and
  says the outcome is unconfirmed, never success or failure. The step-up
  repeats the same submission (same key and body), as everywhere in the
  console. `admin/problems.ts` words every refusal of the three commands and
  the workforce codes step 2 can return.
- **Controls.** `clinician_signup_enabled` gets a note on the Platform controls
  page (what it opens, and to open it only when the queue is staffed); it is
  turned on and off like any other control.
- **Departures from the design.** The code field is labelled "Applicant’s
  authenticator code" (the step-up dialog's own field is "Authenticator
  code"). C18 gives only a flag for a facility administrator with the
  applicant's name, so the warning names no administrator; the facility's
  administrators are listed below it. A retry after a lost answer is a new
  submission with a new key, as the console's other commands are; the
  reload shows whether the first went through. The Overview has no clinician
  tile.
- **An Identity without the queue.** Its bare `404 NOT_FOUND` (whose detail
  names the route) is read by `admin/api.ts`, on the list and on one
  application, as `CLINICIAN_QUEUE_UNAVAILABLE`, which says the queue is not
  deployed; the queue's own `CLINICIAN_APPLICATION_NOT_FOUND` is kept.
- **Evidence.** Failing first: the boundary test, three API tests and the
  problems test (`381561d`); the queue's 30 tests (the page missing), and the
  controls, navigation and route tests (`0b3b798`); the bare-404 API test and
  its problems row (`3c82383`). At each commit `audit:boundaries`,
  `typecheck`, `lint`, `npx vitest run`, `build:patient-web` and
  `audit:launch-build` pass. `npx vitest run`: before the queue 156 files and
  2118 tests; now 157 files and 2157 tests.
- **Not verified.** Component tests with the network stubbed, against the
  backend branch's code; nothing was run in a browser or against a running
  Identity, and no step was taken by two real administrators.
- **Deploy order.** As for the applicant pages: Identity with ADR-064 first.
  Against an Identity without it the queue says it is not deployed there.
  `clinician_signup_enabled` stays off until the release checklist's P25
  conditions hold; this queue was one of them.

## 2026-10-15: clinician self sign-up, review fixes (hid-system ADR-064)

The same branch (`claude/clinician-signup-pages`) after a review of its
applicant pages and a re-check against hid-system's review fixes on
`claude/clinician-self-signup` (`5dd639c` to `fc29731`, after the `fa58e2b`
the pages and the queue were built on; still not merged or deployed).

- **A changed password is a new submission** (`1464b59`). Identity's submit
  digest leaves the password out, so a retry with the same key and another
  password replayed the first submission and kept the first password. The
  key now follows a SHA-256 digest of the password as well as the details
  (only the digest is kept, in memory); a replayed answer says the
  application was received from the earlier attempt, with the password
  entered then.
- **Recovery codes of a lost activation** (`81de3f9`). P7 is the only answer
  with the ten recovery codes. When an activation went through but its
  answer was lost, the retry's `409 CLINICIAN_APPLICATION_AUTHENTICATOR_READY`
  now shows "Your authenticator is set up" and says the codes can't be shown
  again, before the person goes on.
- **Details changed during a facility search** (`c31d076`) are kept: every
  change to the details is made to the current value, so a late search
  answer no longer puts back the profession, licence, date or facility.
- **Focus after a refusal that keeps the form** (`33d962c`): the cleared
  password field (sign-up submit); the facility search, the licence number or
  "Send application" (apply to another facility); the not-open screen's
  heading, with why, when sign-up closes after the page opened.
- **Close the page after sign-up** (`932cfde`). The last sign-up step says the
  page stays open on this device for up to 30 minutes and offers "Close this
  page" (P15), as the status page does.
- **Status page** (`73f81c8`): a 401 after an outage on a first visit shows the
  form with nothing said (the "closed after 30 minutes" notice is only for a
  page that held a capability); Retry meeting the same failure says it again
  and gives focus back to Retry; a failed close says so beside its own button.
- **hid-system's review fixes** (`7387c94`): `403
  CLINICIAN_APPLICATION_STAFF_SIGN_IN_REQUIRED` (a reset authenticator of an
  approved clinician or staff member) gives Identity's fixed words at the
  status code check (P11), activation (P7) and a new step (P9) instead of an
  outage message; `403 CLINICIAN_APPLICATION_ACCOUNT_INELIGIBLE` on a read
  (P12) or a withdrawal (P13) leaves for the email form saying the account
  can't be used, with no Retry. The queue needed no change: no admin answer
  changed shape, and step 1's concurrent replay and refusals before the code
  are answers it already handles.
- **Evidence.** Failing first per commit: 1 (`81de3f9`, two more tests cover
  behaviour already there), 1 (`c31d076`), 13 (`33d962c`), 2 (`932cfde`), 4
  (`73f81c8`, a fifth guards a case already right) and 6 (`7387c94`). At each
  commit `audit:boundaries`, `typecheck`, `lint`, `npx vitest run`,
  `build:patient-web` and `audit:launch-build` pass. Two full runs each had one
  failure in a file this branch does not change (`FieldProblemsPerForm`,
  registration; `StaffMfaRequired`, the facility switch's request order);
  each passed alone three times and in the full rerun before the commit.
  `npx vitest run`: 157 files and 2191 tests (2157 after the queue).
- **Not verified.** As before: no browser, no running Identity, no
  two-administrator run.

## 2026-10-15: clinician self sign-up, second review fixes (hid-system ADR-064)

The same branch (`claude/clinician-signup-pages`) after a second review of
the applicant pages and the queue. Ten findings, all minor; each was checked
against the code (and the backend branch where it mattered) before it was
fixed.

- **Licence dates in Lagos** (`f105895`). Identity refuses a licence date not
  after today, or later than today plus five years, in Africa/Lagos (0094, P4
  and P14), after it has charged the network's submit quota. The details step
  took "today" from the device; it now takes it in Lagos (the queue's
  `lagosToday`, moved to `staff/clinician/copy.ts`), and five years from
  29 February ends on 28 February, as Postgres adds the interval.
- **Focus** (`3a7e2c6`): the withdraw dialog's button is only marked disabled
  (`aria-disabled`) while its request runs, so a browser no longer drops focus
  outside the modal dialog (Tab and Escape were lost after a refused
  withdrawal); "Use a different email" gives focus to the email step on both
  pages; Cancel in "Apply to another facility" gives it back to the button
  that opened the form; sign-up's availability Retry gives it to the step
  shown next.
- **A change said when the list can't be read after it** (`b1fb0fa`): a
  withdrawal (P13) or a new application (P14) that went through is said, and
  shown as Identity answered it, beside the load failure and its Retry.
- **Authenticator setup from the list** (`a901cd1`) when the account must
  enrol but no application waits for it (a reset after submitting, or its
  waiting applications closed): the list says so and offers "Set up
  authenticator".
- **Close waits for the apply form** (`a47f3ce`): "Close this page" and the
  list's Retry are disabled while another application or a facility search
  is being sent, so a late answer no longer reaches a closed page.
- **Close at the authenticator step** (`3429610`): both pages offer "Close
  this page" (P15), with the 30-minute warning, below every authenticator step
  but the recovery codes; an authenticator answer that arrives after closing
  changes nothing.
- **The queue**: a client-side timeout (`HidApiError` 408 `REQUEST_TIMEOUT`)
  on step 1, step 2 or a rejection is reloaded and said unconfirmed, as a lost
  answer is (`a674e82`); approve and reject say what they still need beside
  their disabled button, tied to it by `aria-describedby`, as step 1 did
  (`aecf657`).
- **Evidence.** Failing first per commit: 2 (`f105895`), 5 (`3a7e2c6`), 2
  (`b1fb0fa`), 2 (`a901cd1`, a third guards a case already right), 2
  (`a47f3ce`), 7 (`3429610`), 3 (`a674e82`) and 2 (`aecf657`). At each commit
  `audit:boundaries`, `typecheck`, `lint`, `npx vitest run`,
  `build:patient-web` and `audit:launch-build` pass. Two full runs each had one
  failure that passed alone and in the full rerun before the commit:
  `FieldProblemsPerForm` (registration, not changed here), and the queue's
  replayed step 1 and step 2 test, which typed into step 2's form before the
  reload drew it; it now waits for the form (`a674e82`). `npx vitest run`: 157
  files and 2217 tests (2191 before).
- **Not verified.** No browser (the focus a browser drops from a disabled
  button is reasoned from the HTML focus rules; jsdom keeps it), no running
  Identity, no two-administrator run.

## 2026-10-16: clinician self sign-up after main's #56 and #57, and hid-system's second review round (`9e981e4`)

The same branch (`claude/clinician-signup-pages`, not pushed), with `main`
`a59b23a` merged in and the pages and queue re-checked against the backend
branch `claude/clinician-self-signup` from `fc29731` to `9e981e4` (its second
review round: `e57aa98` to `9e981e4`, read in `services/identity-api` and
`docs/INTERFACE_CONTRACT.md`). The backend branch is still not merged or
deployed.

- **Merge of `main`** (`1b93602`, a merge commit; no rebase). Conflicts, each
  resolved keeping both sides: `admin/problems.ts` (the queue's codes and the
  designation panel's `FACILITY_NOT_ACTIVE` and `ADMIN_FACILITY_NOT_FOUND`),
  `admin/style.css` (both blocks), `__tests__/UnifiedPortalRoutes.test.tsx`
  (the clinician availability mock and main's participating-facilities mock)
  and this log (main's entries first, then the clinician ones). One merge that
  applied cleanly needed a change: this branch lists the public site's
  enrollment routes instead of granting the whole service, so main's four new
  patient routes (`enrollment.holder`, `holderVerify`, `facilityCode`,
  `participatingFacilities`) were added to that list, which the public site
  could reach on `main` (`packages/contracts/src/boundaries.ts` and its test).
- **The intake gate before the capability** (backend `354917c`). P3, P4 and
  P14 now answer a closed intake (`503 CLINICIAN_SIGNUP_CLOSED`) before they
  read the capability, whatever cookie is sent or missing, so the answer no
  longer shows that the page is still open. Sign-up's facility search keeps
  the details and says to try again later, as its submit did; the status
  page's "Apply to another facility" closes (what was typed is kept), the
  applications are read again, and the status line says no application was
  sent. That read shows the email form if the page has closed meanwhile, or
  the list with "New clinician applications aren't open right now." in place
  of the apply button; if it fails, the list stays with that change and the
  failure's Retry (`47b604c`). "Close this page" and the list's Retry wait
  for that read, as they wait for the form's own requests, so its answer
  never reaches a closed page (the commit after `d14bff2`).
- **Five hashed submissions per draft** (`8dac32f`). P4 answers `401
  CLINICIAN_APPLICATION_SESSION_INVALID` once a draft has had five
  submissions hashed, as it does for an expired draft; the page cannot tell
  them apart, so "Confirm your email again" now says the confirmation "lasts
  an hour and covers up to five attempts to submit" (`47b604c`). P4's 400 and
  409 refusals are answered without hashing and the draft stays usable: the
  page already kept the step for them, and a replay (not hashed) still shows
  "already received ... with the password you entered then".
- **The caps where the application is created** (`b13410e`). A `429
  CLINICIAN_APPLICATION_RATE_LIMITED` at P4 or P14 can now be the platform's
  daily cap met inside the creating transaction (nothing is created), so it
  is said as "Too many applications have been sent, from your network or to
  Health ID today", with the details kept (`47b604c`). `409
  CLINICIAN_APPLICATION_FACILITY_BUSY` held under concurrency changes no
  answer: both pages already said it and kept the form.
- **Step 1's pre-check** (`b8c5739`). Before the applicant's code is checked,
  step 1 now also refuses the request's own fields (`400
  CLINICIAN_APPLICATION_COMMAND_INVALID`: `validUntil` range and the licence's
  end, the checklist, a blank evidence reference or reason), a key already
  used for a credential attestation (`409 IDEMPOTENCY_CONFLICT`), and an
  account or staff record the attestation cannot be recorded for (`409
  WORKFORCE_ACCOUNT_INELIGIBLE`, `409 WORKFORCE_STAFF_INELIGIBLE`, `404
  WORKFORCE_STAFF_NOT_FOUND`). The console says for each that nothing was
  recorded and the code was not checked (so it did not count against the
  applicant), keeps the code and the form, and names the next step; a `404`
  no longer shows Identity's bare detail (`8ac7106`).
- **`403 CLINICIAN_APPLICATION_STAFF_SIGN_IN_REQUIRED`** (round 1, unchanged
  by round 2) now has its next step: at the status page's code check (P11) the
  code step gives way to "Your authenticator can't be set up here" with a link
  to provider sign-in and "Check another email address"; the authenticator
  step's blocked screen (P7, P9) links to provider sign-in for this answer
  only (`47b604c`).
- **Unchanged by round 2, checked:** P3's `409
  CLINICIAN_APPLICATION_REQUIRES_SIGN_OUT` for a draft in a signed-in browser
  (now after the gate; the same words); P5-P13's `401` for a missing or
  malformed cookie (already "this page closed", or the email form before a
  capability was held); P4's `400 PASSWORD_INVALID` and pairing refusal moved
  to the body checks (the same answers); the SQLSTATE assertions of
  `1e15213` and the tests of `c1af25a` and `c64909f` (backend only).
- **Past `9e981e4`, not handled here.** The local backend branch has since
  merged hid-system `main`, renumbered its migration to `0096` (`168f64d`) and
  answers P3's spent search budget with `429
  CLINICIAN_APPLICATION_SEARCH_LIMITED` and no `Retry-After` (`7cd8038`, head
  `1d6ff6f`); the search would show that code's fallback, "We couldn't search
  for facilities right now. Try again." (OPEN-QUESTIONS).
- **Evidence.** Failing first: 5 for the console (`8ac7106`), 11 for the
  applicant pages (`47b604c`: 3 sign-up, 6 status page, 2 authenticator) and
  2 for Close during the read after intake closed. At each commit
  `audit:boundaries`, `typecheck`, `lint`, `npx vitest run`,
  `build:patient-web` and `audit:launch-build` pass. `npx vitest run`: 172
  files and 2389 tests after the merge, 2394 after the console, 2399 after
  the pages, 2401 after the Close fix. The first full run after the merge had one failure,
  `OcrFields.test.tsx` "NEW-OCR-CREATE-DISABLED" (not changed here), which
  passed alone and in the full rerun.
- **Not verified.** No browser, no running Identity (with or without the
  clinician routes), no two-administrator run, and no run against the backend
  branch's head past `9e981e4`.

## 2026-10-16: clinician facility search once its searches are used up (hid-system `7cd8038`)

The same branch (`claude/clinician-signup-pages`, not pushed), from a review
finding against the backend branch's local head `1d6ff6f`, which contains
`7cd8038`. That head is not pushed, merged or deployed.

- **The refusal.** P3 allows 30 searches per capability: a sign-up draft or
  the status page's ready capability. The 31st search now gets `429
  CLINICIAN_APPLICATION_SEARCH_LIMITED` with no `Retry-After` ("Too many
  searches in this session. Verify your email address again to continue.").
  Before `7cd8038` it was `429 CLINICIAN_APPLICATION_RATE_LIMITED` with
  `Retry-After: 3600`. The searches never come back for that capability.
  Neither page took this code over, and `refusalCopy` has no entry for it, so
  both said "We couldn't search for facilities right now. Try again." A retry
  could never succeed.
- **The fix** (`b10d11a`). The facility search now handles the code after the
  page's own refusals and before `refusalCopy`. It turns Search off for that
  capability and shows the page's words for spent searches:
  - Sign-up: "You've used all the facility searches for this email
    confirmation. To search again, confirm your email again: your details stay
    on this page." "Confirm email again" (`confirmEmailAgain`) is offered
    beside the search.
  - Status page: "You've used all the facility searches for this page. To
    search again, close this page, then enter your email for a new code; what
    you've typed here isn't kept." "Close this page" is still below the list.

  A facility chosen before then can still be continued with (sign-up) or sent
  (status page). After a new email confirmation the search is offered again,
  and the details are kept. The network quota's `429
  CLINICIAN_APPLICATION_RATE_LIMITED` (`Retry-After: 86400`) keeps "Too many
  searches. Try again later." The `enrollment.clinicianFacilitySearch`
  registry note names the 30-search limit and the code.
- **The rest of the backend past `9e981e4`, for the applicant routes.**
  Between `9e981e4` and `1d6ff6f`, `clinician-application.service.ts` changes
  only this answer and a migration number in a comment;
  `clinician-application.controller.ts` and the clinician DTOs do not change.
  `0096_clinician_self_signup.sql` is `0094` renumbered.
  - The merged launch fixes name a refused nested field by its dotted path.
    That changes nothing the pages read, because they read no field list from
    `VALIDATION_FAILED`.
  - The merged launch fixes also change the `Retry-After` values. That changes
    nothing either, because the pages show no countdown.
  - The console's queue was not re-checked past `9e981e4`.
- **Evidence.**
  - Failing first: 3 tests (sign-up 2, status page 1), each failing on the
    fallback words or the missing "Confirm email again". A fourth test
    (sending a facility already chosen on the status page) passed before the
    fix and guards that path.
  - The status page test waits for "Close this page" to be enabled before
    pressing it. Close waits for the search's answer, which reaches the page
    in an effect after the form draws. Without the wait, the test failed
    once in four runs.
  - At each commit `audit:boundaries`, `typecheck`, `lint`, `npx vitest run`,
    `build:patient-web` (local environment) and `audit:launch-build` pass.
  - `npx vitest run`: 172 files and 2405 tests (2401 before).
- **Not verified.** No browser, no running Identity, and no 31st search
  against a real capability.

## 2026-10-13: one Turnstile check per submission, password Show toggle, installable portal, web push readiness

Branch `claude/turnstile-password-pwa-push`, from `main` `077b85c`. Not merged:
the product owner asked that new work stay on branches until the staging
integration is finished. hid-system was only read (`b69a6ab`). Four read-only
audits, each checked by a second agent, came first.

- **Turnstile appeared twice** on the patient enrollment page's NIN step whenever
  Google sign-up was configured. The NIN form (action `patient-enrollment`) and
  the Google section (`patient-login`) each rendered a widget. hid-system pins
  each endpoint to its own action, and tokens are single use, so both checks
  are needed, but not together. This was not a React mounting fault: each
  widget renders once into its own container, under StrictMode too. The NIN step
  now shows one path at a time. "Continue with Google" replaces the NIN form and
  its check with Google's, and "Verify your NIN without Google" brings back the
  form with a fresh check. Other findings:
  - The provider and administration sign-in pages added their own copy of
    Cloudflare's script, two under StrictMode and three after moving between
    portals before it loaded. They now share the portal's loader, which also
    removes a failed script so the next page retries, and reports a script
    that loaded without Turnstile.
  - The shared widget no longer re-renders and drops its token when a page
    passes a new callback.
  - On the public site, the demo dialog rendered its check while closed, so
    `/provider/complete` had a second, hidden widget, and a dialog closed after
    its check was solved could not be sent when reopened. The check now exists
    only while the dialog is open.
  - A blank Google client ID counts as none, on every page that offers Google.
  Regression tests: `TurnstileOnePerPage.test.tsx`, `TurnstileScriptOnce.test.tsx`
  and `DemoDialogTurnstile.test.tsx`.
- **Password visibility.** `@hid/ui` `PasswordInput` puts a Show button beside
  the field, never inside its label (inside it, Chromium names the field
  "Password Show password"). The button's name stays "Show password", and
  `aria-pressed` says whether the password is shown. Showing the password
  changes only how it is displayed, a pointer press leaves focus in the field,
  and the caret keeps its place. The field is masked again when its form is
  sent, the page is left, or the person switches to another tab or app; Edge's
  own reveal button is hidden. Where a form has two password fields, each toggle
  is named for its own field. It is used on all nine password fields, on eight
  screens; PIN and NIN fields are unchanged. In headless Chromium 141 with the
  real component:
  - a mouse click and a touch tap both kept the caret (typing after Show gave
    `abcXYdef`);
  - Tab reached the toggle and Space showed the password;
  - Enter in the field submitted and masked it again;
  - the field was named "Password" and the toggle "Show password", with its
    pressed state exposed;
  - a page hide masked the field at once.
- **PWA.** Nothing existed before.
  - The portal now has a web app manifest (`health-id.webmanifest`, standalone,
    `start_url` `/`), icons cropped from the supplied mark, a theme colour and
    an apple touch icon.
  - The public site has a tab icon and an apple touch icon, but no manifest.
  - Health ID registers no service worker, and nothing is kept offline.
  - Both apps serve `/service-worker.js`, which only retires an earlier HID
    worker: it deletes the `hid-` caches and unregisters itself. It takes over
    at once, so an open hid-system EHR tab, which reloads when its worker
    changes, reloads once. A HID worker was observed on the apex on 2026-10-13
    with a read-only request (cache `hid-static-v2026-04-29-1`); the apex must
    answer that path itself, not redirect it (hand-off D1).
  - ESLint now forbids service worker registration, the Cache API, push
    subscription, system notifications and notification prompts, where they are
    used plainly, through a property or by destructuring; computed or aliased
    access is left to review. The hand-off had claimed lint already forbade
    them; it covered only browser storage and IndexedDB.
  - Chromium 141 reported no installability errors for the built portal, with
    no service worker registered.
- **Web push.** hid-system has no route that accepts a registration (hand-off
  B15), so the portal offers no push and asks for no permission. B15 gives the
  contract for the backend owner. It assumes FCM, as accepted ADR-033 requires,
  and covers configuration, registration, status, removal, sign-out
  revocation and generic, PHI-free delivery.
- **Review.** A second review, by area, each finding checked by another
  agent, found nothing blocking. The minor findings it confirmed are fixed:
  - patient sign-in still read a blank Google client ID as set;
  - after "Check again" on the Google path, focus fell to the page;
  - the password was masked on leaving the page but not on switching tabs;
  - a password field was lighter than the field above it, and taller beside it
    on the provider and administrator pages;
  - Edge showed its own reveal button as well;
  - the lint rules missed `window.Notification`, destructuring and
    `new Notification`;
  - the retirement script's comment said it reloads nothing, though EHR reloads
    on a worker change;
  - several doc statements and citations were corrected, including D6 on CSP
    and the apex redirect, which must answer `/service-worker.js` rather than
    redirect it;
  - B15 gained the migration it needs, a named transport, the idempotency
    refusals and a decision item, E21.
  Real-browser check (Chromium 141, built portal): the password field matches
  the field beside it in weight and height on the patient (600, 46 px),
  administrator (700, 38 px) and provider (400, 40 px) sign-in pages, with no
  sideways scroll at 320 px.
- **Evidence.** Each behaviour change has a test that failed first. At the
  branch head every gate passes:
  - `audit:boundaries`, `typecheck` and `lint`;
  - `npm test`: 147 files, 1878 tests. One of three full runs failed two OCR
    focus tests (`OcrFields`, `OcrFocus`), which pass alone and in the other two
    runs. This branch does not touch them or `staff/focus.ts`. The same test
    failed once in CI on Health-id #51. A suspected cause, not reproduced:
    `useFocusById` clears its request with `setRequest(null)`, which can drop a
    newer request; it is left for its own change;
  - both builds: each contains `service-worker.js` and its icons, and the
    portal's also contains `health-id.webmanifest`;
  - `npm audit`: 0 vulnerabilities.
- **Not verified.** Firefox, Safari and iOS, screen readers, installation on a
  real device, and anything deployed or against a live hid-system.

## 2026-10-15: Google's script loader left out of a build without a client ID

A review against hid-system `main` `94889fd` found that this branch's portal
build kept Google Identity Services (`accounts.google.com/gsi/client`,
`google.accounts.id`) with no `VITE_HID_GOOGLE_CLIENT_ID`. The branch had
moved the Google check into `googleClient()`, a function the bundler cannot
fold, so `GoogleButton` and its loader stayed in the bundle. hid-system's
staging step (`infra/cloudflare/scripts/health-id-artifact.mjs`) refuses any
build that carries them, and Google sign-in is off at launch.

- Each condition that renders `GoogleButton` (sign-in, enrollment, the Settings
  link card) tests `import.meta.env.VITE_HID_GOOGLE_CLIENT_ID` inline as well,
  as `main` did. A blank ID still counts as none at run time.
- **Evidence.** Failing first: the build without a client ID carried the loader
  in `assets/index-CzvMHzDs.js` (the rules of Health-id #55's
  `audit:launch-build`, Google only). After the change it carries none, and a
  build with a client ID still carries it. Gates: `typecheck`, `lint`,
  `audit:boundaries`, `npm test` (147 files, 1878 tests) and
  `build:patient-web` pass.
- **Still refused by staging.** This branch's build also contains
  `service-worker.js`, `health-id.webmanifest` and `icons/`, which the staging
  step refuses (ADR-052: the portal registers no service worker and is not
  installable). The PWA part waits on the owner's decision and that hid-system
  change (D6), as recorded above.

## 2026-10-16: Clinician sign-up references follow hid-system's renumber (ADR-066)

hid-system `main` `60b4d12` merged #90 (migration 0095, ADR-064: Novu receives
the patient's verified email) and #91 (0096, ADR-065: patient record release).
The clinician sign-up backend, D-Eminence/hid-system#87, was renumbered on top:
migration `0098_clinician_self_signup.sql`, decision record ADR-066, release
row P37 and staging row S4z. Its routes and answers did not change.

- Every Health-id reference to the clinician decision record now says ADR-066
  (code comments, tests, the console's "no clinician queue" message, and the
  docs other than this log's history). ADR-064 now names hid-system's Novu
  change, so the old references would have pointed at the wrong record.
- The clinician control note names 0098, and the test reasons name P37.
- OPEN-QUESTIONS and BACKEND_OWNER_HANDOFF §12 record that #87 is pushed and
  open, not merged or deployed.
- No behaviour changed: only text and comments.

## 2026-10-16: Fixes to the newly merged features, with Health-id #68 merged in

Branch `claude/recent-features-fixes`, from `main` `4113531`. It reviews what
merged today: #59 (the new sign-in and sign-up pages, the "Set up your
facility" redesign, Plan & billing, the navigation fix, the Blog and Earn with
Health ID), #60 (one Turnstile check per page, the password Show toggle and the
installable portal) and #61 (the staging pipeline, support and patient chat,
imported records and hospital chat). The review was made against hid-system
`main` `51047e2` and re-checked at `585ef8d`.

Health-id #68 ("Clean up Earn with Health ID", `origin/claude/earn-cleanup`
`214a23d`) is another contributor's open PR. It is not edited: it is merged
into this branch (`ac3d7b1`), and the referral fixes sit on top of it.

- **Staging refused every portal build (blocker).** #60 left
  `<meta name="theme-color">` in `apps/patient-web/index.html`.
  - **Why it was refused.** hid-system's staging step allow-lists the shell
    (`health-id-artifact.mjs`, `inspectIndexHtml`): a meta may only be a
    charset, or a viewport or robots name. So the step refused the build for
    www and admin in every environment, and none of the new sign-in and
    sign-up pages could reach production.
  - **Fix.** The tag is removed. `audit:launch-build` now also runs that shell
    allow-list, copied from `51047e2`. It depends only on the HTML and the
    file list, not on the host, as the script's header used to claim.
  - **Check.** Main's build was refused for this one reason. A production-shaped
    build of this branch is ACCEPTED (21 files) for www and admin by
    hid-system `main`'s own `inspectHealthIdBuild`. That build used
    `VITE_HID_ENVIRONMENT=production`, the host's own origin, a `0x` Turnstile
    key and no Google client ID.
- **Charts called routes hid-system main does not serve (major and minor).**
  - **What happened.** #61 mounted imported medical history and "Ask about this
    patient" on every chart for `ehr.note.read`. On `main`, ehr-api answers
    `GET /ehr/patients/:id/imported-records` and `/ehr/patients/:id/chat*` with
    404. So each production chart showed "Cannot GET /api/v1/ehr/patients/…"
    in an alert, and an assistant that could not load.
  - **Fix.** Each feature is now mounted only when its build flag is exactly
    `true`: `VITE_HID_IMPORTED_RECORDS_ENABLED` or
    `VITE_HID_STAFF_PATIENT_CHAT_ENABLED` (`staff/stagingOnlyFeatures.ts`).
    No launch build sets either, and the build compiles each check to `false`.
  - **Registry.** The registry now records record chat, support chat and
    imported records as `proposed`, not served by `main`.
- **Referrals were invisible in the console (major).** The admin list returns
  each request's phone, role, organization type, message and source, but the
  console showed none of them. A referral therefore read like the referrer
  booking a demo. Demo requests now mark a referral, and show the phone and
  role, the facility type, and the message with its lines. An ordinary
  request's notes now show too.
- **Referral form (PR #68 and older, minor).**
  - **Stale security token.** Back or Change removed step 2's Turnstile widget
    but kept its token, so Send went out with a token that could have expired.
    The shared widget now clears its token when it is removed.
  - **Widget too wide on phones.** The widget measured 300px in a 238px slot at
    a 320px screen. It now uses the compact widget below 300px, as the portal
    does.
  - **Email check looser than the backend's.** It now follows validator's
    `isEmail`, as hid-system's `@IsEmail()` does. 300,000 generated addresses
    gave the same answer as hid-system's own validator. The demo form and
    facility completion's start use the same check.
  - **Refused fields.** A `400 VALIDATION_FAILED` now marks and focuses the
    referral field it names.
  - **Facility type.** The referral now sends it as `organizationType`.
- **Evidence.** Every change has a tests-only commit that failed against the
  code before it, then the fix. Gates at the head:
  - `audit:boundaries`, `typecheck` and `lint` pass;
  - `npx vitest run`: 204 files, 2687 tests;
  - `build:patient-web` passes;
  - `audit:launch-build` passes (22 files);
  - `build:public-web` passes. It was run in an export of the branch with real
    `node_modules`, because Turbopack refuses this checkout's `node_modules`,
    which link outside the workspace.
- **Not verified.** There was no browser run: the compact widget and the
  console's layout were checked in jsdom and against the CSS. The staging
  pipeline's builds were not run, and nothing was deployed.
- **Observed, not changed.** The portal's `publicEnvironment.ts` does not read
  `VITE_HID_PATIENT_CHAT_ENABLED`, `VITE_HID_SUPPORT_CHAT_ENABLED` or
  `VITE_HID_SUPPORT_CONTACT`. So patient chat and support chat are off in every
  portal build, staging included, whatever `config/staging.json` says. This
  fails closed; see OPEN-QUESTIONS.

## 2026-10-17: main's CI flake, and hid-system's merges checked against Health-id

- **CI on `main`.** The run for #69's merge (`cf99479`, run 38983273017) failed once, in `FieldProblemsPerForm.test.tsx` ("a refusal in one case's review form does not follow to the next case loaded"): a `waitFor` of the default one second, on a slow runner. The same test passed on #69's own run, and 6 of 6 times locally with the CPU loaded, so it is a timing limit, not a regression. Its two waits now allow five seconds.
- **hid-system merged** #80, #83, #87, #88, #94 and #95 into `main` (`41542fc`). The clinician sign-up routes in Health-id's registry (17 applicant routes and 5 console routes) match the backend's controllers by method and path. Record chat and imported history are served under a different contract from the one #61 was built for; OPEN-QUESTIONS has the differences.
- Not run: a browser, a live Identity, and the staging pipeline's builds on this change.

## 2026-10-17: patient record chat and imported history follow hid-system main

- **Why.** hid-system `main` serves both under different routes and shapes from the staging branches #61 was built for (#94, ADR-067, 0099; #95, ADR-068, 0100). The earlier entry records the differences.
- **Chat.** New contract and client for availability, the notice, the idempotency key, the four answer statuses with blocks, sources and coverage, and history (read, clear). New screen pieces `ChatAnswer`, `chatErrors` and `chatNotice`. The old chat contract moved to `stagingChat.ts` and its screen to `StagingChat.tsx`, unchanged, for the hospital chat. Nothing was deleted.
- **Imported history.** Paged patient and staff reads, the patient's sharing choice, and a staff view mounted for `ehr.imported-history.read` under direct care. The old `/imported-records` parser and attachment code stay for the staging routes.
- **Registry and boundaries.** Six served routes are `surface-verified`; the staging-only routes stay `proposed`, with a note that they are served by hid-system staging branches and not `main` (`41542fc`).
- **Flags.** `VITE_HID_PATIENT_CHAT_ENABLED` is now read.
- **Tests.** About 70 new cases (`Chat`, `ImportedHistoryServed`, `publicEnvironment`, `patient-record-chat`) and updated ones; the old chat test is kept as `StagingChat.test.tsx`.
- **Not verified.** No browser run and no live backend; the chat notice text is a draft for the owner or DPO.

## 2026-10-17: staff "Ask about this patient" follows hid-system main (ADR-069)

- **Why.** hid-system main now serves it (0101), on the record chat module of #95; the staging branch's embedding design was not ported. Health-id's chart used the staging contract (`ready | preparing`, no notice, no key).
- **Change.** `StaffRecordChat` and its API calls (`recordChatAvailability`, `recordChat`, `recordChatHistory`, `clearRecordChatHistory`), a clinician notice draft, `staffAskFailure` and `staffClearFailure`, and the chart gate (`ehr.record-chat.use`, direct care). The registry marks three routes served; availability may carry `withheld`. The old screen is kept as `StagingStaffPatientChat` with its test, unmounted. Nothing was deleted.
- **Tests.** About 40 new cases (component, API, contract and registry, chart gating).
- **Not verified.** No browser run and no live backend; the notice text is a draft.


## 2026-10-24: facility self sign-up on Novu (P4)

- **Why.** The owner said yes to facility self sign-up (D14): a hospital, laboratory or pharmacy signs itself up through "Set up your facility", with no administrator approving it first, and finishes by setting a password, not an authenticator. Novu (the production backend) gains main's provider-enrollment routes, closed by the platform control `provider_self_service_enabled`; support reviews each new facility within a working day ("alert + daily review").
- **The link.** "Set up your facility" on a staff product host (ehr, lab, pharmacy, migrate, outreach, admin) opens the main site's `/provider/enroll`, because Identity accepts the `provider-enrollment` check on app.* and staging.* only; the page itself, opened on a product host, links there too (`providerEnrollmentHref`).
- **The page on a Novu build.** Three steps (Organization, Email confirmation, Password); availability is asked on opening and a closed sign-up says so with support's address; refusals are said by code; any status of 500 or more, or the gateway's `UPSTREAM_UNAVAILABLE`, is "temporarily unavailable" after availability is asked again (the gateway replaces every 502, 503 and 504 body, so the closed gate is a 423); recovery at activation; a 35 s start; "Send a new code" after `resendAfterSeconds`; where staff sign in next time; and what each product's administrator really gets (the Provider Portal; no clinical, Laboratory, Pharmacy or migration workspace and no staff accounts yet). A main-v1 build keeps its authenticator step.
- **Console.** "New facility sign-ups" (`/admin/self-service-facilities`, Novu only) lists them for support, with "Mark reviewed" (a note, If-Match) and links to suspend the facility and disable its administrator through the existing pages.
- **Registry.** The availability read and the two console routes are `proposed` (Novu only); the three enrollment routes' notes say what Novu answers.
- **Not verified.** No browser run and no live Identity: the backend is not deployed. Component, API and contract tests only.
