# Phase 4 Stage 3: Frontend Admin Consolidation

Branch: `phase-4-stage-3-admin-consolidation`, from `main` at `37e6ec7`
(`37e6ec78b7ede5528431f918c31ac105791190a6`, the merge of Stage 2B, PR
D-Eminence/Health-id#13). Backend contract: hid-system `phase-3-patient-safety` at
`46fabe6` (Stage 2A, PR D-Eminence/hid-system#19), read from a checkout at
`7cbbf98` (same tree). This stage changes no backend code, dependency, lockfile,
deployment or infrastructure.

## Starting baseline

At `37e6ec7` the platform admin was `apps/patient-web/src/admin`, with the
Stage 2B security wiring. This stage leaves Stage 2B unchanged, apart from a
one-line fix to the session warning (see the session warning row below):

- MFA sign-in and enrolment;
- step-up;
- two-person approvals;
- session management;
- the governed export;
- session-end notices.

The other admin pages sat in one `Pages.tsx` module with a flat navigation list
in `App.tsx`. Their capabilities were:

- **Overview:** printed every key the backend returned.
- **Facilities, users and identity reviews:** showed only the first 50 rows,
  with no filters or paging.
- **Audit:** had no filters.
- **Applications:** a read-only table.
- **Integrations:** could only enable, pause, test and select routes.
- **Demo requests:** listed 50 requests with no filters.

## Architecture

- **One admin application.** `apps/patient-web/src/admin` is the only platform
  admin UI in this repository. It is lazily loaded under `/admin/*` in the
  unified portal. Health-id has no `apps/admin`.
- **One navigation map.** `navigation.ts` defines six sections:
  - Platform;
  - Organizations;
  - People and access;
  - Security;
  - Operations;
  - Commercial.

  Each item has a path, a description and a permission rule. The sidebar, the
  mobile navigation, the overview's area list and the route guard all read this
  map, so an area cannot be linked without the check that guards its route.
  Sub-pages such as `/admin/facilities/:id` are guarded by their area.
- **Routing.** `App.tsx` wraps every area in `Area`. If the actor's permissions
  do not allow the area, it renders "Access denied" before any data request.
  - Unknown admin paths show "Page not found".
  - The browser tab is named after the area.
  - Session restore, refresh, sign-out, and the expired and revoked notices
    are unchanged from Stage 2B.
  - Platform admin depends only on the platform session. It never sends
    `X-Facility-ID` and needs no facility membership. Facility audit uses the
    backend's `facilityId` query filter.
- **One module per area:**
  - `Dashboard.tsx`;
  - `Organizations.tsx` (applications);
  - `Facilities.tsx`;
  - `Principals.tsx`;
  - `Approvals.tsx`;
  - `Audit.tsx`;
  - `Integrations.tsx`;
  - `Pages.tsx`, for the smaller identity review, service health, pricing,
    demo request and controls pages;
  - `SecurityPage.tsx`, for your own security.
- **Shared helpers in `ui.tsx`:**
  - `Pager`.
  - `useUrlFilters`, which keeps non-personal filters in the URL.
  - `useResource`. A reload of the same query keeps the rows on screen with a
    "Refreshing" status, so row actions keep their confirmation; a new query
    starts empty.
- **No second security implementation.** Every change goes through the Stage 2
  `useGovernedSubmit` and `ActionForm`, which provide:
  - one idempotency key per submission;
  - a single repeat after `STEP_UP_REQUIRED`;
  - `If-Match` versions;
  - reasons.

## Completed work

| Area | What the console now does | Backend contract |
| --- | --- | --- |
| Navigation and routing | Grouped navigation. Permission-guarded routes, including sub-pages. Not-found and access-denied pages, the tab title, and deep links that survive a reload. | `GET /admin/session` permissions |
| Overview | The six backend totals, each linked to its filtered area. Waiting-work tiles (pending approvals, open applications, new demo requests, integration health), each shown only with its read permission and computed from that area's own list. Since Stage 4B a count shows "N+" only when the backend reports another page (`nextCursor`), never from a fixed cap. Also the viewer's areas and the unavailable capabilities. | `GET /admin/overview`, `/admin/approvals`, `/admin/organization-applications`, `/admin/demo-requests`, `/admin/integrations` |
| Applications | Status filter in the URL, plus registry and profile evidence side by side. Verify CAC, approve (new organization, or linked to an existing one through a facility search) and reject. Each needs step-up and `If-Match`, approve and reject need a reason, and refusals are explained. | `/admin/organization-applications` (list, `verify-cac`, `approve`, `reject`) |
| Facilities | Status and name-or-code filters, and paging, all in the URL. A linkable facility page with its status action, its platform changes (Stage 4B: audit by target, with reasons) and the facility-scoped audit. Malformed links are refused without a request. | `GET /admin/facilities`, `GET /admin/facilities/:id`, `POST …/status`, `GET /admin/audit/events?resourceType=facility&resourceId=` and `?facilityId=` |
| Users and roles | Search with a status filter and paging. Shows the subject, creation date, inactive memberships, authenticator enrolment (Stage 4B) and a link to the user's audit activity. The Stage 2 controls: status, roles, Super Admin elevation, MFA reset (offered only for an enrolled administrator since Stage 4B), sessions and export. The search term stays out of the URL. | `/admin/principals` (`mfaEnrolled`) and the Stage 2A commands |
| Approvals | Stage 2B decisions, including the fix where each Approve or Reject button sends its own decision. Since Stage 4B, cursor paging ("Load more requests") with no cap. | `/admin/approvals` (`limit`, `cursor`, `nextCursor`) |
| Audit | Actor, action, outcome, facility, target type and ID (Stage 4B), correlation and time filters, kept in the URL. Columns for target, scope (platform, or a facility link), purpose and reason. Cursor paging. Missing fields show "Not recorded" or "System"; nothing is invented. | `GET /admin/audit/events` (`ListPlatformAuditDto`) |
| Identity review | Read-only, with a status filter, paging and an opened date. | `GET /admin/identity/reviews` |
| Integrations | Capabilities, the routes using each provider, credential state only, the last test, operation gates, and allow-listed non-secret settings. Governed settings editing. A per-provider change history. Route changes offer only valid providers and can remove a fallback. | `/admin/integrations` (list, `:provider/audit`, `:provider/configuration`, enable, pause, test, selection, fallback) |
| Pricing | Unchanged, except that the "saved" confirmation now survives the refresh. | `/admin/pricing` |
| Demo requests | Status and product filters in the URL. Since Stage 4B, cursor paging ("Load more requests") replaces the 100-row cap. | `GET /admin/demo-requests` (`limit`, `cursor`, `nextCursor`) |
| Service health | Service checks, delivery metrics and the delivery failure list. | `/admin/operations/services`, `/admin/operations/events` |
| Session warning (Stage 2B fix) | The idle-expiry warning now shows a session window recorded between its render and its subscription. Before, such a window was missed until the 15-second tick. | `App.tsx` (`SessionWarning`) |
| Refusal messages | The backend's 409 refusals now get their own messages. Previously they were reported as "This item changed". The codes covered are unchanged settings or pricing, infrastructure-controlled or external configuration, missing credentials, unsupported or repeated tests, and resources that no longer exist. | `problems.ts` |

## Retained legacy code

hid-system `apps/admin` (`@hid/admin`) was not changed, because it is in the
backend repository. At `46fabe6` it is still part of that repository's root
`build` and `test` scripts. Cloudflare worker `hid-admin`
(`infra/cloudflare/workers/hid-admin/wrangler.json`) routes it to
`admin.healthidentitydirectory.com` and `admin.staging.healthidentitydirectory.com`.

It signs in through staff `POST /auth/login`. Since Stage 2A, admin endpoints
need the separate MFA-verified platform session, so this app is legacy and
cannot administer the Stage 2A backend. The Health-id portal claims the same
production hostname (`PLATFORM_ADMIN_HOSTNAME` in
`apps/patient-web/src/productHostname.ts`). Deciding which app serves that
hostname, and retiring the legacy one, belongs to the backend and infrastructure
owners.

Nothing in Health-id imports, builds or references the legacy app. Inside
Health-id, no admin code was kept for compatibility: the old `Guard` and the
flat navigation were removed.

## Gap report

| Capability | Status | Evidence | Next action |
| --- | --- | --- | --- |
| Platform sign-in, MFA, recovery, step-up, session expiry and revocation | Existing and complete | Stage 2B, unchanged. The Stage 2B browser run passed again on this branch. | None in the frontend |
| Two-person approvals | Existing and complete | `Approvals.tsx`, unchanged. `Approvals.test.tsx` checks that each button sends its own decision. | None |
| Users and roles (support lookup) | Existing and complete | `Principals.tsx`; tests and browser run | None |
| Facilities, list and detail | Existing and complete | `Facilities.tsx`; tests and browser run (status change with step-up) | None |
| Organization applications | Existing and complete | `Organizations.tsx`; tests and browser run (reject, approve, verify refusal) | None |
| Audit search | Existing and complete | `Audit.tsx`; all `ListPlatformAuditDto` filters are wired | None |
| Identity review (read-only) | Existing and complete | Decisions happen in the facility workflow by design | None |
| Integrations | Existing and complete | `Integrations.tsx`; tests and browser run (settings, unchanged refusal, history, fallback removal) | None |
| Pricing | Existing and complete | `Pages.tsx` | None |
| Demo requests | Existing and complete | `Pages.tsx`; filters | None |
| Service health | Existing and complete | `Pages.tsx` | None |
| Dashboard | Existing and complete | Uses only backend totals and list counts; no invented metrics | None |
| Platform controls | Existing but incomplete (backend defects; fix merged, not deployed) | Two defects at hid-system `46fabe6`, both from migration 0039. (1) `runtime-grants.sql` never grants `EXECUTE` on `platform.admin_list_controls()` or `platform.admin_set_control(text,boolean,bigint,text)` to the Identity runtime, so `GET /admin/controls` returns 500. (2) `admin_set_control` fails on every call with `42702` (its output columns shadow `control_key` and `row_version`), so `POST /admin/controls` would return 500 even with the grant. Until the fix is deployed, the page shows a safe error with a reference. The fix, D-Eminence/hid-system#20, adds the grant and migration 0071 with SQL and runtime regression tests. It reached hid-system `main` through D-Eminence/hid-system#18 (`3dd5176`) and is not deployed. With that fix applied locally, the browser run lists all 6 controls and pauses and restores one with step-up. | Backend owner: deploy hid-system `main` |
| Demo requests beyond 100 | Done in Stage 4B | hid-system Stage 4A cursor (D-Eminence/hid-system#24); "Load more requests" | None (no total; see open questions) |
| Approvals beyond 200 | Done in Stage 4B | hid-system Stage 4A cursor; "Load more requests"; overview "N+" from `nextCursor` | None |
| Facility audit of platform actions | Done in Stage 4B | hid-system Stage 4A target filter; "Platform changes to this facility" | None |
| Per-user MFA state | Done in Stage 4B | hid-system Stage 4A `mfaEnrolled`; Authenticator column; reset offered only when enrolled | None |
| Organization directory | Missing backend | No admin endpoint lists or opens organizations. Organizations appear through facilities and applications. | Backend: an organization list and detail contract |
| Support cases, tickets and notes | Missing backend | No contract. Support is account lookup, status and session revocation. | Product and backend decision |
| Security event metrics | Missing backend | No aggregate endpoint. Filter Audit by outcome instead. | Backend: an aggregate endpoint, if wanted |
| Legal holds and session-event review | Missing backend | Stage 2A finding S7 | Backend |
| Billing, subscriptions and invoices | Missing backend | No contract | Product and backend |
| Expired versus revoked session codes | Done in Stage 4B | hid-system Stage 4A `PLATFORM_SESSION_EXPIRED`/`PLATFORM_SESSION_REVOKED` and `STEP_UP_EXPIRED`; the sign-in notice states the server's reason, and the step-up dialog opens for either step-up code | None |
| Authenticator QR code | Deferred | Needs a vetted encoder or dependency (Stage 2B) | Decide an approach |
| Integration credential rotation | Deferred (by design) | The backend always answers `INTEGRATION_CREDENTIAL_ROTATION_EXTERNAL`. Credentials stay in deployment configuration, and the UI shows their state only. | None unless policy changes |
| Legacy hid-system admin app and hostname | Deferred (backend and infrastructure) | See "Retained legacy code" | Retire it and route the hostname to the portal |

**Missing frontend:** none. Every admin endpoint the backend serves is wired.
Two endpoints are deliberately unused:

- `GET /admin/integrations/:provider`, because the list returns the same data;
- the credential-reference command, which the backend always refuses.

**Incomplete capabilities:** platform controls (backend defects; the fix,
D-Eminence/hid-system#20, is on hid-system `main` but not deployed). The demo
request, approval and facility-audit limits were closed in Stage 4B (below).

## Security boundaries

- **The backend decides.** It authorizes every request; navigation visibility
  only hides what the actor cannot use. Denied areas render no data and make
  no request.
- **Stage 2 is reused, not reimplemented.**
  - Step-up, idempotency, `If-Match`, reasons, two-person approval and session
    handling are the Stage 2B code.
  - Commands send what the backend's high-risk policy requires. For example,
    application review sends `If-Match` without an idempotency key, and
    integration settings send both.
- **No secrets.**
  - Credentials are shown as a state only.
  - Integration settings are shown only for the allow-listed public keys, even
    if a response carried more.
  - Nothing is written to web storage.
  - The browser run checked that the page text holds no secret material.
- **Privacy.**
  - Users and roles shows identity and lifecycle data only, never clinical
    records.
  - The user search term (which may be a name or email address) is kept out of
    the URL.
  - URLs hold only statuses, pseudonymous subjects (such as
    `org-onboarding:<uuid>`), record IDs, product codes, facility names or
    codes, and times.

## Tests

- **Unit and component tests (Vitest).** The admin suite has 17 files and 108
  tests; the full suite has 50 files and 361 tests. New this stage:
  - `navigation.test.ts`: role visibility and sub-page guarding;
  - `Dashboard.test.tsx`: totals, permission-gated counts, caps and partial
    failure;
  - `Facilities.test.tsx`: URL filters, paging, step-up with one idempotency
    key, the confirmation kept after refresh, and the detail page;
  - `Organizations.test.tsx`: filter, evidence, reject with step-up, approve
    into an existing organization, verify refusal and permissions;
  - `Integrations.test.tsx`: no secret display, settings, the unchanged
    refusal, lazy history, and route choices including fallback removal;
  - `AdminLists.test.tsx`: audit filters and fields, users and roles search
    and paging without the URL, demo filters and cap, delivery failures and
    review paging;
  - `ui.test.tsx`: reloads keep rows; new queries start empty.

  `App.test.tsx` also gained tests for:
  - forbidden deep links without requests;
  - not-found;
  - the tab title;
  - overview requests limited to permitted areas;
  - a regression test for the session warning's subscription gap. That gap
    made the existing warning tests fail under full-suite load.

  `problems.test.ts` gained the new refusal messages.
- **Mutation checks.** Each of the following was broken on purpose and its
  test failed:
  - the route guard;
  - the settings allow-list;
  - the reload behaviour.
- **Browser runs (local, not committed).** Chromium against the hid-system
  Stage 2A Identity API, served in-process against a copy of a migrated
  database with synthetic organizations, facilities, applications and demo
  requests:
  - **Stage 3 run:** overview, facilities, facility detail, applications,
    audit, users and roles, integrations, demo requests, the other areas, the
    controls defect, and the support-admin scope. All passed; the only
    browser errors were the expected `INTEGRATION_PAUSED` refusal and the
    controls 500s.
  - **The same Stage 3 run against hid-system#20**, with migrations through
    0071 and the fixed grants. All passed with no browser errors. The Platform
    controls page listed all 6 controls, then paused and restored
    `outreach_portal_enabled` with step-up, recording two control events.
  - **Stage 2B security run, repeated on this branch:** enrolment, step-up
    retry, self-approval refusal, two-person approval, export, revocation,
    recovery-code sign-in, expiry and sign-out. All passed, with no browser
    errors.
- **Repository gates:** boundary audit, typecheck, lint, the full test suite,
  and the patient-web and public-web builds (see the pull request).

## Known limitations

- Platform controls cannot load or change anything until the hid-system#20 fix
  (on hid-system `main` since D-Eminence/hid-system#18) is deployed.
- Closed in Stage 4B: the approval and demo request caps, facility platform
  changes, per-user MFA state and the session-end reason (backend Stage 4A, not
  deployed).
- The browser runs used a local synthetic database. There is still no staging
  environment ([open questions](./OPEN-QUESTIONS.md)).
- The legacy hid-system admin app still claims the production admin hostname
  in its Cloudflare configuration.

## Next stage

1. **Backend:** deploy hid-system `main` (the platform controls fix,
   D-Eminence/hid-system#20, and Stage 4A, D-Eminence/hid-system#24). Audit
   by target, per-user MFA state, cursors and distinct session-end codes were
   built in Stage 4A and wired here in Stage 4B.
2. **Backend and infrastructure:** retire hid-system `apps/admin` and route
   `admin.healthidentitydirectory.com` to the Health-id portal (with
   same-origin `/api/v1`).
3. **Product:** decide on the organization directory, support cases, security
   metrics, legal holds and billing. Then build backend contracts before any
   UI.
4. **Staging:** deploy hid-system `main` (Stage 2A and 4A) with this
   frontend, then repeat the browser runs there.

## Stage 4B: backend contract wiring

Branch `phase-4-stage-4b-admin-contracts`, against hid-system Stage 4A
(D-Eminence/hid-system#24, merged into hid-system `main` at `deb6fba`;
`docs/PHASE_4_STAGE_4A_ADMIN_CONTRACTS.md` there).

| Surface | Change |
| --- | --- |
| Facility detail | "Platform changes to this facility": the newest audit events whose target is the facility (`resourceType=facility&resourceId=`), with reasons and a link to the same search in Audit. "Activity inside this facility" keeps the facility-scoped events. Both reload with the facility, after a status change or Refresh. |
| Audit | Target type and target ID filters, kept in the URL. A target ID needs a type, and both follow the backend's patterns before any request. |
| Users and roles | An Authenticator column (Enrolled, Not set up, or Not reported by an older backend). The authenticator reset request is not offered for an administrator the backend reports as not enrolled. |
| Approvals, demo requests | Cursor paging: the first page, then "Load more requests" with the backend's opaque `nextCursor` for the same filters. A filter change or reload starts again from the first page; a page still loading for the previous list is cancelled and never added to the new one. A refused cursor (`ADMIN_INVALID_CURSOR`) is explained. A demo request's status change is confirmed at the top of the page, so the confirmation stays when the reload removes a row loaded with "Load more". The "200+" and "newest 100" cap notices are gone. |
| Overview | New demo requests read one page of up to 100, pending approvals the backend's default page of 50. The count shows "N+" only when the backend reports another page. |
| Session end | `401 PLATFORM_SESSION_EXPIRED` or `PLATFORM_SESSION_REVOKED` ends the session with the server's reason. That includes the reason a refused refresh gives, which the shared client would otherwise drop, the reason given when the console is reloaded or opened in a new tab, and a session found ended when signing out. The expiry reading is kept only for a generic `401 AUTHENTICATION_REQUIRED`, and a first visit gets no notice. Each code also has its own message. |
| Step-up | The dialog opens for `STEP_UP_REQUIRED` and `STEP_UP_EXPIRED`, saying when the last confirmation is too old, and repeats the same submission once with the same idempotency key. |

Tests: 26 new or updated component and API tests fail against `main`
(`d5ce01c`) and pass on this branch. An adversarial review of the first
version (`5897534`) confirmed five defects, fixed here; 15 tests fail without
those fixes:

- the server's session-end reason was dropped on a reload or in a new tab;
- signing out of a revoked session replaced the revoked notice;
- a "Load more" page that arrived after a filter change or reload was added
  to the new list, with a cursor for the old filters;
- the facility's platform changes did not reload after a status change;
- the console could not run against the Identity build before Stage 4A
  (below).

The same review found demo-request confirmations lost when a later-page row
was changed (fixed as above) and stale wording about hid-system `main`
(corrected). It also reported that a hand-edited link with spaces around a
target filter is sent untrimmed; that is unchanged, because the backend's
`400` is shown and "Apply filters" trims the values.

Release: deploy this console together with, or before, the hid-system Stage 4A
Identity build (hid-system `docs/PHASE_4_STAGE_4A_ADMIN_CONTRACTS.md` §7). The
Stage 3 console does not open the step-up dialog on `STEP_UP_EXPIRED`, so with
the new backend its high-risk actions would be refused after the first
five-minute window. This console also works with the Identity build before
Stage 4A, with less:

- approvals send only `status`, which that build requires, and show its single
  page of at most 200;
- demo requests show the newest 50, with no further page;
- principals show the authenticator as "Not reported" and keep the reset
  request offered, as in Stage 3;
- the facility's platform changes and the Audit target filters are refused
  (`400`) until Stage 4A is deployed; the rest of each page works;
- a session end gets the generic message, as in Stage 3.
