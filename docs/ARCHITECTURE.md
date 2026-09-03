# Health ID frontend architecture

This repository is the frontend layer of the Health ID platform. It is a
consumer of the existing backend, and it contains no backend code.

Everything below is grounded in the Health ID codebase as it exists at the
frozen successor release `dfd07792a25dd9af9ec79972da350b0bda4bbcf7`. Where the
existing system does not answer a question, the question is recorded in
[OPEN-QUESTIONS.md](./OPEN-QUESTIONS.md) rather than answered by assumption.

---

## 1. What already exists

Read from the current `hid-unified` repository before any of this was designed:

| Area | Current state |
| --- | --- |
| Application | One React 18 + TypeScript SPA built with Vite, serving landing, patient, hospital/staff, admin, outreach and migrate in a single route table |
| Styling | Hand-written CSS (`src/index.css`) plus a 31 KB `components/ui.tsx`. No Tailwind |
| API surface | 60 Deno edge functions under `<supabase-url>/functions/v1/*` |
| Transport | `src/lib/hidApi.ts` (78 KB) — `edgeRequest()` builds `${VITE_SUPABASE_URL}/functions/v1/<fn>`, attaching `apikey` and `Authorization: Bearer <token>` |
| Error contract | `supabase/functions/_shared/http.ts` returns `{ code, message, requestId, retryable, status }` and sets `X-Request-ID` / `X-Response-Time-Ms` |
| Auth | Supabase GoTrue: password, OTP, Google ID token, TOTP MFA (`aal1`/`aal2`). Roles `patient` / `clinician` / `org_admin` / `platform_admin` |
| CORS | Allowlist of `healthidentitydirectory.com`, `www.`, `localhost:3000`, overridable via `HID_ALLOWED_ORIGIN` |
| Deployment | GitHub Actions → Vercel (preview + production), Cloudflare for DNS/CDN and Turnstile |
| Testing | None. No test runner, no linter. CI runs `npm audit`, two contract-verification scripts, and a build |

Three things in the current frontend conflict with the target architecture and
are called out here so they are fixed deliberately rather than carried forward:

1. **Identifying data in `localStorage`.** `src/lib/auth.ts` persists
   `hid_patient_session` (`hidCode`, `phone`, `fullName`) and `hid_staff_session`.
2. **Seven direct database reads from the browser.** `supabase.from()` against
   `hid_outreach_campaigns`, `hid_outreach_workers`, `hid_outreach_invites`,
   `hid_public_product_prices` and `notifications`, bypassing the API boundary.
3. **A mixed repository.** `hid-unified` contains both the SPA and
   `supabase/functions` + `supabase/migrations`.

---

## 2. Target shape

```
Browser
  → Cloudflare
  → Health ID Gateway/API
  → Health ID backend services
  → database / infrastructure
```

The browser addresses exactly one host: the Gateway base URL for its
environment. It never learns the topology behind it. `scripts/check-boundaries.mjs`
fails the build if a database driver, cloud SDK or Supabase client appears in
any manifest.

### Repository layout

```
hid-frontend/
├── apps/
│   ├── public-web/       Next.js  — public site
│   └── patient-web/      Vite     — patient application
├── packages/
│   ├── config/           environment resolution + public-env guard
│   ├── contracts/        endpoint registry, domain vocabulary, app boundaries
│   ├── http/             the transport layer (the only place fetch is called)
│   ├── api/              typed service modules bound to an application
│   ├── auth/             principals, session state, route guards
│   ├── observability/    PHI-safe logging and redaction
│   └── ui/               design tokens and shared primitives
├── scripts/              repository-level architecture checks
└── docs/
```

`staff-web`, `ehr-web`, `lab-web`, `pharmacy-web`, `ocr-web`, `outreach-web` and
`admin-web` are **declared** in `packages/contracts/src/boundaries.ts` but not
scaffolded. Their boundaries, service grants and PHI classification exist and
are enforced; the applications are built when their contracts are settled. Two
applications are built here because two are enough to prove both framework
lanes and every shared package end to end — nine empty shells would prove less.

---

## 3. Framework choice, per application

**Next.js is not applied uniformly, and neither is Vite.** The workload decides.

| | Next.js | Vite |
| --- | --- | --- |
| Applications | `public-web` | `patient-web`, and the remaining authenticated applications |
| Why | Public pages must be fast, crawlable and cacheable at the edge; server rendering and static generation earn their keep | Every screen renders one signed-in person's data. There is nothing to pre-render, nothing to cache at the edge, and no crawler to serve |

Adding a server-rendering tier to an authenticated application would put a hop
that handles PHI into the path without giving a patient anything in return. The
existing operational application is already React + Vite + TypeScript, so this
is also the choice that does not require rewriting what works.

TypeScript is the primary language throughout; `strict` plus
`noUncheckedIndexedAccess` in `tsconfig.base.json`.

---

## 4. The API layer

No component, hook, page or route calls `fetch`. The chain is:

```
component → service module (@hid/api) → API client (@hid/http) → Gateway
```

**`@hid/http`** owns transport: base URL joining, `Authorization`, correlation
ids (`X-Request-ID: hid_web_<uuid>`), the error envelope, timeouts,
cancellation, retry policy and in-flight deduplication of identical GETs.

Decisions worth stating:

- **Retries are narrow.** Only idempotent methods, only when the backend marked
  the failure retryable, and `Retry-After` always wins over local backoff.
  `records-create` is never retried automatically — a duplicated clinical record
  is worse than a failed request. Making writes retry-safe needs an idempotency
  key contract, which does not exist yet (OPEN-QUESTIONS Q12).
- **Cancellation is first class.** Every service method takes a `signal`, so a
  screen that unmounts stops a response it should no longer receive.
- **`cache: 'no-store'`, `credentials: 'omit'`.** Clinical responses never enter
  the HTTP cache, and the client sends bearer tokens rather than cookies.
- **401 is a session event, not an error to swallow.** `onUnauthorized` clears
  session state; the rejection still reaches the caller.

**`@hid/api`** turns endpoints into service modules. Each call is checked
against the registry (does this endpoint exist? does it accept this method?) and
against the calling application's boundary.

### Types stop where knowledge stops

`packages/contracts/src/registry.ts` records all 59 endpoints with their methods
and authorisation class — **verified** by reading the backend source. Request and
response *shapes* were not verified endpoint by endpoint, so every service method
returns `UnverifiedPayload` (`unknown`).

That is deliberate. Narrowing `unknown` is mildly annoying at a call site;
shipping a confidently wrong `PatientProfile` interface creates a second
interpretation of the system that is much more expensive to unpick later. The
path to real types is step 8 of the integration sequence: observe the response
in staging, agree the contract, add a parser, replace the return type.

---

## 5. Authentication

Health ID has three identities and this frontend keeps them separate. There is
no generic `User`.

```ts
type AuthPrincipal = PatientPrincipal | StaffPrincipal | PlatformPrincipal
```

A principal carries `subjectId`, `appRole`, `assuranceLevel`, and for staff
`staffRole` and `organizationId`. It carries **no** name, Health ID code, phone
number or clinical data — a test enforces the allowed field list. Display data is
fetched when a screen needs it and lives as long as that screen does.

- **Tokens live in memory**, in the session store's closure. A token in
  `localStorage` is readable by any script that reaches the page and outlives the
  tab that earned it.
- **One value persists**: `hid.portal-hint`, an enum of `patient | staff |
  platform`, so a returning user lands on the right sign-in screen. It identifies
  nobody.
- **No new auth provider is introduced.** The provider integration point is
  marked in `apps/patient-web/src/session.tsx` and left unbuilt pending
  OPEN-QUESTIONS Q4.

Until a session can be restored, the application resolves to **anonymous**.
Failing closed is the only safe default.

---

## 6. Routing and authorisation

> Frontend routing is user experience. Backend authorisation is security.

`evaluateAccess()` returns `allow`, `pending`, `sign-in-required`,
`mfa-required`, `wrong-portal` or `not-permitted`. `pending` matters: redirecting
while session state is still unknown bounces a signed-in patient to sign-in on
every page load.

A guard decides what to *render*. It never decides what a person is *allowed to
do*, and no server-side check is ever skipped because a guard passed.

---

## 7. Application boundaries

Boundaries are code, not a diagram. `APP_BOUNDARIES` grants each application a
set of backend services, and `createHidApi` returns **only those services**:

```ts
const api = createHidApi({ app: 'patient-web', client })
api.admin.getOverview()
//  ^^^^^ Property 'admin' does not exist
```

This is a compile error, verified by `@ts-expect-error` directives that `tsc`
confirms are used. A second runtime check inside every service call covers
dynamic callers and anything that cast its way past the types.

`public-web` is granted exactly one service — `platform` — so the public site
cannot reach anything clinical even by mistake.

`lab` and `pharmacy` are granted to their applications but have **no endpoints**,
so nothing can be called. No mock stands in for them (OPEN-QUESTIONS Q5).

---

## 8. Environments

Configuration is environment-based and validated at build time. No API URL is
hard-coded anywhere.

| | Next.js | Vite |
| --- | --- | --- |
| Prefix | `NEXT_PUBLIC_HID_` | `VITE_HID_` |
| Required | `ENVIRONMENT`, `API_BASE_URL`, `APP_ORIGIN` | same |

- **Fails closed.** A build with no `API_BASE_URL` fails; there is no default
  gateway address. Verified: removing it makes `next build` exit non-zero.
- **https outside local**, enforced.
- **Public-only.** `assertPublicEnvironment` rejects any key naming a secret,
  credential or internal endpoint (`SERVICE_ROLE`, `AWS_`, `POSTGRES`,
  `SUPABASE_URL`, …) and any value shaped like a credential.
- Development never points at production. `handlesRealData` is false only for
  `local`.

---

## 9. PHI handling

| Rule | How it is held |
| --- | --- |
| Not in storage | Session in memory; lint bans `localStorage`/`sessionStorage`/`indexedDB` outside `@hid/auth` |
| Not in logs | `@hid/observability` redacts by field name and value shape before anything reaches a sink; lint bans `console` outside the logger |
| Not in URLs | `redactUrl()` masks Health ID codes and UUIDs in paths and strips sensitive query parameters |
| Not in error messages | `ErrorState` renders only the backend's sanitised message; an unrecognised error shows a generic string |
| Not in the HTTP cache | `cache: 'no-store'` on every request |
| Minimised in memory | Responses live in component state and are cancelled on unmount |

---

## 10. Testing

`npm run check` runs typecheck, lint and tests. Current state: **119 tests
passing**, both applications building.

Covered: environment resolution and the secret guard, PHI redaction and logging,
the API client (construction, auth, envelopes, errors, cancellation, timeouts,
retries, deduplication), the endpoint registry, application boundaries, session
and persistence rules, access decisions, and route-guard rendering in jsdom.

Not covered, and not claimed: **no integration has been tested against staging
or production.** Nothing in this repository has spoken to a real Health ID
environment.

---

## 11. Deployment

Independently deployable per application, behind Cloudflare, against the
established AWS backend. No Amplify, API Gateway, CloudFront, second backend or
new database is introduced.

The existing pipeline deploys to Vercel with Cloudflare in front; whether that
continues for these applications is OPEN-QUESTIONS Q10.

---

## 12. Migrating the existing application

Suggested order, once the open questions are settled:

1. Split `hid-unified`: frontend here, `supabase/**` stays in the backend repo.
2. Move `hidApi.ts` callers onto `@hid/api`, endpoint by endpoint, deleting the
   god file as it empties.
3. Replace `hid_patient_session` / `hid_staff_session` with the in-memory store —
   this removes identifying data from `localStorage`.
4. Replace the seven direct `supabase.from()` reads with endpoints (Q7, Q8, Q9).
5. Lift landing, patient, staff, admin, outreach and migrate into their own
   applications behind the boundaries already declared.
6. Adopt Tailwind per application; port `components/ui.tsx` into `@hid/ui`
   incrementally rather than in one pass.
