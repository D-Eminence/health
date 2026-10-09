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

This log records implementation scope, not a release sign-off. The reference
[gap map](./HEALTH_ID_COMPLETE_FRONTEND_GAP_MAP.md) is a baseline audit rather
than a live completion tracker.
