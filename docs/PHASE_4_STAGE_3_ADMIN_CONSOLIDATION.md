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
| Overview | The six backend totals, each linked to its filtered area. Waiting-work tiles (pending approvals, open applications, new demo requests, integration health), each shown only with its read permission and computed from that area's own list. Capped lists show "100+" or "200+". Also the viewer's areas and the unavailable capabilities. | `GET /admin/overview`, `/admin/approvals`, `/admin/organization-applications`, `/admin/demo-requests`, `/admin/integrations` |
| Applications | Status filter in the URL, plus registry and profile evidence side by side. Verify CAC, approve (new organization, or linked to an existing one through a facility search) and reject. Each needs step-up and `If-Match`, approve and reject need a reason, and refusals are explained. | `/admin/organization-applications` (list, `verify-cac`, `approve`, `reject`) |
| Facilities | Status and name-or-code filters, and paging, all in the URL. A linkable facility page with its status action and the facility-scoped audit. Malformed links are refused without a request. | `GET /admin/facilities`, `GET /admin/facilities/:id`, `POST …/status`, `GET /admin/audit/events?facilityId=` |
| Users and roles | Search with a status filter and paging. Shows the subject, creation date, inactive memberships and a link to the user's audit activity. The Stage 2 controls are moved unchanged: status, roles, Super Admin elevation, MFA reset, sessions and export. The search term stays out of the URL. | `/admin/principals` and the Stage 2A commands |
| Approvals | Unchanged from Stage 2B, including the fix where each Approve or Reject button sends its own decision. | `/admin/approvals` |
| Audit | Actor, action, outcome, facility, correlation and time filters, kept in the URL. Columns for target, scope (platform, or a facility link), purpose and reason. Cursor paging. Missing fields show "Not recorded" or "System"; nothing is invented. | `GET /admin/audit/events` (`ListPlatformAuditDto`) |
| Identity review | Read-only, with a status filter, paging and an opened date. | `GET /admin/identity/reviews` |
| Integrations | Capabilities, the routes using each provider, credential state only, the last test, operation gates, and allow-listed non-secret settings. Governed settings editing. A per-provider change history. Route changes offer only valid providers and can remove a fallback. | `/admin/integrations` (list, `:provider/audit`, `:provider/configuration`, enable, pause, test, selection, fallback) |
| Pricing | Unchanged, except that the "saved" confirmation now survives the refresh. | `/admin/pricing` |
| Demo requests | Status and product filters in the URL, and a note when the backend's 100-row cap is reached. | `GET /admin/demo-requests` |
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
| Platform controls | Existing but incomplete (backend defects; fix proposed) | Two defects at hid-system `46fabe6`, both from migration 0039. (1) `runtime-grants.sql` never grants `EXECUTE` on `platform.admin_list_controls()` or `platform.admin_set_control(text,boolean,bigint,text)` to the Identity runtime, so `GET /admin/controls` returns 500. (2) `admin_set_control` fails on every call with `42702` (its output columns shadow `control_key` and `row_version`), so `POST /admin/controls` would return 500 even with the grant. Until the fix is deployed, the page shows a safe error with a reference. The draft fix, D-Eminence/hid-system#20, adds the grant and migration 0071 with SQL and runtime regression tests. With that fix applied locally, the browser run lists all 6 controls and pauses and restores one with step-up. | Backend owner: review and merge hid-system#20, then deploy it |
| Demo requests beyond 100 | Existing but incomplete | The backend returns the newest 100 at most, with no cursor. The UI says so. | Backend: cursor or page |
| Approvals beyond 200 | Existing but incomplete | `listApprovals` uses `limit 200` with no cursor. The overview shows "200+". | Backend: cursor or page |
| Facility audit of platform actions | Existing but incomplete | Platform actions record the facility as the target, but audit has no target filter. The detail page lists facility-scoped events and says so. | Backend: a `resourceType`/`resourceId` filter on `/admin/audit/events` |
| Per-user MFA state | Missing backend | Principal rows carry no MFA enrolment. An MFA reset request for an unenrolled account is refused with `MFA_NOT_ENROLLED`. | Backend: add enrolment state to the principal list |
| Organization directory | Missing backend | No admin endpoint lists or opens organizations. Organizations appear through facilities and applications. | Backend: an organization list and detail contract |
| Support cases, tickets and notes | Missing backend | No contract. Support is account lookup, status and session revocation. | Product and backend decision |
| Security event metrics | Missing backend | No aggregate endpoint. Filter Audit by outcome instead. | Backend: an aggregate endpoint, if wanted |
| Legal holds and session-event review | Missing backend | Stage 2A finding S7 | Backend |
| Billing, subscriptions and invoices | Missing backend | No contract | Product and backend |
| Expired versus revoked session codes | Missing backend | Recorded in [open questions](./OPEN-QUESTIONS.md) | Backend: distinct codes |
| Authenticator QR code | Deferred | Needs a vetted encoder or dependency (Stage 2B) | Decide an approach |
| Integration credential rotation | Deferred (by design) | The backend always answers `INTEGRATION_CREDENTIAL_ROTATION_EXTERNAL`. Credentials stay in deployment configuration, and the UI shows their state only. | None unless policy changes |
| Legacy hid-system admin app and hostname | Deferred (backend and infrastructure) | See "Retained legacy code" | Retire it and route the hostname to the portal |

**Missing frontend:** none. Every admin endpoint the backend serves is wired.
Two endpoints are deliberately unused:

- `GET /admin/integrations/:provider`, because the list returns the same data;
- the credential-reference command, which the backend always refuses.

**Incomplete capabilities:** platform controls (backend defects; fix proposed in
D-Eminence/hid-system#20, not merged), and the demo request, approval and
facility-audit limits above.

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

- Platform controls cannot load or change anything until hid-system#20 (or an
  equivalent backend fix) is merged and deployed.
- The approval (200) and demo request (100) lists are capped by the backend.
- Facility status changes appear in Audit (filter by action), but not on the
  facility page, until the backend can filter by target.
- The browser runs used a local synthetic database. There is still no staging
  environment ([open questions](./OPEN-QUESTIONS.md)).
- The legacy hid-system admin app still claims the production admin hostname
  in its Cloudflare configuration.

## Next stage

1. **Backend:**
   - review and merge the platform controls fix (D-Eminence/hid-system#20);
   - audit filtering by target;
   - per-user MFA state;
   - cursors for demo requests and approvals;
   - distinct expired and revoked session codes.
2. **Backend and infrastructure:** retire hid-system `apps/admin` and route
   `admin.healthidentitydirectory.com` to the Health-id portal (with
   same-origin `/api/v1`).
3. **Product:** decide on the organization directory, support cases, security
   metrics, legal holds and billing. Then build backend contracts before any
   UI.
4. **Staging:** promote and deploy Stage 2A with this frontend, then repeat
   the browser runs there.
