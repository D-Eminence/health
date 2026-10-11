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
