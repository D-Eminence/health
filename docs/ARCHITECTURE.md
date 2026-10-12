# Frontend architecture

This document describes the code in this repository and the `hid-system`
gateway/API, first audited at commit `c4b5445` and most recently checked
against `main` at `54f79d2`. It supersedes the earlier plan based on
the historical `hid-unified` Supabase functions. `hid-1.0`, `Dashboard.zip` and
`HID.html` informed visual and workflow coverage; their local fixtures do not
define API behavior. The [gap map](./HEALTH_ID_COMPLETE_FRONTEND_GAP_MAP.md)
records that baseline audit and should not be read as today's completion list.

## Deployment shape

```text
Public browser  → public-web origin → /api/v1 → hid-system gateway → services
Portal browser  → one portal origin → /api/v1 → hid-system gateway → services
```

`apps/public-web` is the Next.js public website. It owns the audience pages,
product descriptions, pricing and demo request flow. `apps/patient-web` is the
Vite authenticated portal. All signed-in workspaces share **one portal origin**:

| URL prefix | Workspace | Main implemented areas |
| --- | --- | --- |
| `/`, `/sign-in`, `/enroll`, `/recover` | Patient | Enrollment, session/recovery, profile and NIN re-verification, records, access, notifications, settings |
| `/provider/*`, `/provider/recover` | Provider | Session/facility selection, patient lookup and access, registration-case review, clinical work, laboratory, pharmacy, OCR, outreach, facility audit and recovery |
| `/admin/*`, `/admin/recover` | Platform | MFA sign-in and enrolment; overview (backend totals and waiting work); organization applications (verify, approve, reject); facilities (filters, paging and a linkable detail page); users and roles (with export, session review and two-person requests); approvals; identity reviews; audit (backend filters); my security (MFA, recovery codes, sessions); service health; integrations (settings, history, routes); platform controls; pricing; demo requests; and recovery |

Each area restores the shared backend cookie session and applies its own
permission checks. The backend remains the
authority for access control. Unsupported modules from the reference material
are not represented by local fixture data or simulated mutations. The public site's
`/provider/apply` page sends providers to the portal's `/provider/enroll`,
which uses the self-service provider-enrollment routes. A form that submits
`POST /api/v1/identity/organization-applications` exists
(`ProviderApplicationForm`), but no page uses it. At hid-system `main`
(`54f79d2`) that route's five-argument database call matches migration
`0052_authoritative_cac_identity.sql`; no live submission has been run.

The public site can link to a separately hosted portal through
`NEXT_PUBLIC_HID_PORTAL_ORIGIN`. That variable names the one portal origin for
patients, providers and admins; it does not imply separate provider or admin
deployments. Production routing and hostnames still need to be configured and
verified. Local development uses ports 3100 and 3200 for the two apps, with
`/api/v1/*` forwarded to the local gateway on port 3000. Both apps use their own
origin as the browser API base URL. The Vite/Next development proxies do not
configure a production proxy.

## Request and contract path

```text
screen → area API module → registered browser client → @hid/http → /api/v1
```

`packages/contracts/src/registry.ts` records audited gateway routes and
methods. The browser client in `packages/api` rejects unknown routes and
backend-internal endpoints; app-scoped route checks apply the declared service
grants. `packages/api` also contains typed service modules for shared use.
`packages/http` owns URL construction, request timeout/cancellation, limited
read retries, no-store requests, CSRF/cookie handling, correlation IDs and
Problem Details error parsing. Neither route registration nor a frontend guard
grants permission: the backend checks the current principal, facility and
permission on every protected request.

The public pricing page reads `GET /api/v1/commercial/pricing`, and the demo form
submits to `POST /api/v1/commercial/demo-requests` with Turnstile and an
idempotency key. A `null` price is a quote, not an amount that the frontend can
invent. Patient, provider and admin requests use the actual Identity, EHR,
Access, Lab, Pharmacy, OCR, Outreach and Admin endpoints registered for their
routes. The laboratory workspace covers work items, accession, specimen
custody, analytical execution, result revisions, verification, release and
history. The clinical workspace can create active EHR lab requests and hand
active prescriptions to Pharmacy. See [open questions](./OPEN-QUESTIONS.md)
for contract limits and backend defects.

Break-glass access is audited by Identity. EHR has a dedicated emergency
summary route for completed encounters and signed notes. Its ordinary
encounter and related clinical routes require `direct-care`, so an emergency
grant does not open the detailed chart; that policy gap is tracked in
[open questions](./OPEN-QUESTIONS.md).

The frontend does not call a database directly. `scripts/check-boundaries.mjs`
checks repository imports and forbidden dependencies, and ESLint restricts
direct network calls outside the transport layer. The public browser still
loads the approved Turnstile and optional Google identity scripts for those
flows; they are not gateway business APIs.

## Authentication and patient data

`hid-system` issues HttpOnly, host-only, SameSite Strict access and refresh
cookies. The browser client sends `credentials: 'include'`, reads the separate
CSRF cookie and sends `X-CSRF-Token` on mutations. It does not put access tokens
in the browser's local storage or attach a bearer header for cookie sessions.
The client can call the refresh endpoint before treating a protected 401 as a
signed-out session. Session state is restored from the backend; the browser
cannot inspect the HttpOnly cookie to decide who is signed in.

The patient and provider portals share these cookies on one origin. On
`POST /auth/refresh` and `POST /auth/logout`, and on no other call, the cookie
client names its application in `X-HID-Client` (`patient-web` or `staff-web`,
the client's own `clientId`; a caller cannot change it). hid-system #39 then
refuses the other portal's sign-in with `403 SESSION_CLIENT_MISMATCH`, rotating
and ending nothing, and each portal ends only its own session.

Staff requests include `X-Facility-ID` and `X-Purpose-Of-Use` with the selected
facility context. The selected facility must belong to the authenticated
session; the backend checks the header on each request. Admin routes use their
own platform permissions and are platform-scoped: the admin client never sends
`X-Facility-ID`, and the backend binds no facility to them even if one is sent.
`apps/patient-web/src/admin` is the authoritative Platform Admin UI. Since
Stage 3, one navigation map (`navigation.ts`) drives the sidebar, the overview
and the route guard, so an area and its sub-pages render, and request data,
only for the permissions that list it. The `apps/admin` app in hid-system is
legacy: it uses staff sign-in, which the Stage 2A admin endpoints no longer
accept, yet hid-system still builds it and routes `admin.healthidentitydirectory.com`
to it in Cloudflare (see
[Phase 4 Stage 3](./PHASE_4_STAGE_3_ADMIN_CONSOLIDATION.md)). UI permission gates
hide unavailable actions and render access errors, but do not replace server
authorization. Since Stage 2B the admin UI signs in to the separate MFA-verified
platform session (`/auth/admin/*`, `hid_access_admin*` cookies) and answers the
backend's `STEP_UP_REQUIRED` with an authenticator confirmation before repeating
the same command once; see
[Phase 4 Stage 2B](./PHASE_4_STAGE_2B_FRONTEND_SECURITY.md).

Clinical responses use `cache: 'no-store'`; screens show loading, empty and
error states for backend reads. `@hid/observability` handles redaction for
diagnostics, and public variables are checked for secret-like names and values.
Clinical request/response bodies are not intended for logs, public URLs or
browser persistence. Provider facility selection is held in portal memory and
sent as `X-Facility-ID` on scoped calls. Choosing a facility in the list only
proposes it; Switch facility confirms it. The backend's `/auth/facility` response
does not persist the selection, so after a reload the portal shows the facility
`/auth/session` resolves: the primary one, else the first by name.

## Production requirements

Because the session cookies are host-only and SameSite Strict, the portal's
production origin must forward its own `/api/v1/*` requests to the gateway.
That forwarding must preserve cookies, CSRF and request headers. A direct
cross-origin call to the gateway is not an equivalent session deployment. The
public site also needs a production `/api/v1/*` route for pricing and demo
requests; its Next.js rewrite is development-only.

This portal is not deployed. hid-system's Cloudflare configuration
(`infra/cloudflare/workers/*/wrangler.json` at `522fb2e`) serves `www` and
`staging` with hid-system's own `apps/web`, and each product host with its own
hid-system app. The provider recovery links on product hosts point to
`/provider/recover` on www. hid-system's own `apps/web` has the same fixed route
since D-Eminence/hid-system#41 (merged into hid-system `main` at `63201b1`, not
yet released), so the links work with today's hosting once a release carries
it, or once this portal serves www.

The backend's current Turnstile service permits all three general login
actions (`patient-login`, `staff-login`, `admin-login`) together, and
enrollment and patient and staff recovery, only on
`www.healthidentitydirectory.com` or `staging.healthidentitydirectory.com`.
Each staff product host accepts only its own login action (`lab-login`,
`pharmacy-login`, `ocr-login` on `migrate`, `outreach-login`); `ehr` accepts
`ehr-login` and `staff-login`. Staff sign-in sends the current host's action,
and `staff-login` on `ehr` and elsewhere (`staffLoginAction` in
`apps/patient-web/src/productHostname.ts`). The `admin` host accepts
`admin-login` and `admin-reset`. The admin approval message sends a new
administrator to `/provider/recover` on `www` (or `staging`) to set a password,
and the provider sign-in page on a staff product host (`ehr`, `lab`,
`pharmacy`, `migrate`, `outreach`) or the admin site links "Forgot your
password?" to the same page and says resets are done on the main site
(`staffRecoveryHref` in `productHostname.ts`). Opened directly on one of those
hosts, `/provider/recover` shows that notice and link instead of a reset form.
The address is one of three fixed values and carries no return address; after
a reset, the recovery page's sign-in link stays on the main site.
Hosting patient sign-in, enrollment or patient and staff recovery on another
hostname requires a backend Turnstile allowlist/configuration change. No staging environment exists yet, and no live
end-to-end acceptance has been run. Backend defects and deployment decisions
are listed in [open questions](./OPEN-QUESTIONS.md).

## Repository and verification

| Path | Role |
| --- | --- |
| `apps/public-web` | Public website and commercial API flow |
| `apps/patient-web` | Unified authenticated portal with patient, provider and admin route groups |
| `packages/config` | Public environment parsing and validation |
| `packages/contracts` | Audited route registry, permissions and app boundaries |
| `packages/http` | Gateway transport and uploads |
| `packages/api` | Service clients and browser route guards |
| `packages/auth` | Principal and access models |
| `packages/observability` | Redacted diagnostics |
| `packages/ui` | Shared tokens and components |

The root scripts provide `typecheck`, `lint`, `test`, `audit:boundaries`,
`build:public-web` and `build:patient-web`. These are local code checks. A
successful build or mocked test does not establish that the backend routes,
cookies, Turnstile actions or real credentials work in a deployed environment.
