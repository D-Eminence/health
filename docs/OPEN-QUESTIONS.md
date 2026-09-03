# Open questions

Every item here is something the existing Health ID system does not answer and
that this frontend therefore did **not** guess at. Each says what is needed, why
it blocks, and what the code does in the meantime.

Evidence is cited from the frozen release `dfd07792a25dd9af9ec79972da350b0bda4bbcf7`.

**Blocking staging integration:** Q1, Q2, Q3, Q4, Q11
**Blocking specific applications:** Q5, Q7, Q8, Q9
**Needs a decision, not blocking:** Q6, Q10, Q12

---

## Q1 — What is the Health ID Gateway, concretely? *(blocking)*

The target architecture is `Frontend → Cloudflare → Gateway/API → services`. The
frontend today calls `${VITE_SUPABASE_URL}/functions/v1/<name>` directly
(`src/lib/hidApi.ts`, `edgeRequest`), sending two headers:

```
apikey:        <Supabase anon key>
Authorization: Bearer <access token>
```

**Needed**

1. Gateway base URL for local, staging and production.
2. Whether the gateway requires any header beyond `Authorization` — specifically
   whether `apikey` is still expected from the browser, or injected at the edge.
3. Whether "Gateway" is a distinct service or the Supabase functions host fronted
   by Cloudflare. This changes nothing structurally but changes what we test.

**Meanwhile** `@hid/http` takes `baseUrl` from configuration with no default, and
exposes `getDefaultHeaders()` for whatever the gateway turns out to require. No
Supabase key is compiled into anything.

---

## Q2 — Path shape and versioning at the gateway *(blocking)*

Service modules build `<baseUrl>/<endpoint-name>`, e.g. `/patients-me`. That
matches the current function names, and works if `baseUrl` ends in
`/functions/v1`.

**Needed** — does the gateway preserve function names, or expose versioned REST
paths (`/v1/patients/me`)? The brief asks for API versioning; the current surface
has no version segment at all.

**Meanwhile** paths come from one registry file, so a change to the scheme is a
change to `packages/contracts/src/registry.ts` and nothing else.

---

## Q3 — Success response shapes *(blocking)*

The **error** envelope is consistent and verified
(`supabase/functions/_shared/http.ts`): `{ code, message, requestId, retryable,
status }` plus `X-Request-ID`. The client relies on it.

**Success** payloads are not consistent: some handlers wrap in `{ data: ... }`,
others return bare objects. Which endpoint does which was not verified, so no
response type has been written.

**Needed** — per endpoint: is the payload wrapped, and what is its shape? Sequence
matters most for `patients-me`, `patients-records`, `health-events`,
`staff-dashboard`, `notifications-list`.

**Meanwhile** `unwrapData()` handles both forms, and every service method returns
`UnverifiedPayload` (`unknown`). Grep `UnverifiedPayload` to find every contract
still to be settled.

---

## Q4 — Where does authentication happen? *(blocking — biggest gap)*

This is the one that most affects the plan.

Authentication today is **Supabase GoTrue, called directly from the browser**:

| Operation | Current call |
| --- | --- |
| Password / OTP sign-in | `supabase.auth.signInWithOtp`, `verifyOtp` |
| Google | `supabase.auth.signInWithIdToken` |
| MFA | `supabase.auth.mfa.enroll` / `challengeAndVerify` / `getAuthenticatorAssuranceLevel` |
| Session | `supabase.auth.getSession` — token refresh handled by the SDK |

The edge functions `patient-login` and `staff-login` exist, but token **issue**,
**refresh** and **MFA enrolment** are GoTrue operations, not endpoints.

If the browser must not talk to Supabase directly, then either:

- **(a)** the Gateway exposes sign-in, refresh and MFA, and those contracts need
  defining — a backend change requiring review under the frozen-release policy; or
- **(b)** GoTrue is the sanctioned identity provider and talking to it from the
  browser is an accepted exception to "no direct Supabase".

**This is a decision, not an implementation detail, and it is not ours to make.**

**Meanwhile** `@hid/auth` models principals, session state and guards with no
provider attached. `SessionProvider` marks the bootstrap point and resolves to
anonymous. Sign-in renders an explanatory screen rather than a form wired to a
provider chosen by default.

---

## Q5 — Lab and Pharmacy have no backend *(blocks those applications)*

The brief lists Lab and Pharmacy as applications. At the frozen release there
are **zero** `lab-*` or `pharmacy-*` endpoints among the 60 functions. They exist
only as marketing content (`features/commercial/catalog.ts`,
`features/providerProducts/data.ts`, `components/landing/ModuleTabs.tsx`) and as
values in the `HidStaffRole` union (`'lab'`, `'pharmacist'`).

**Needed** — do these services exist elsewhere, are they planned, or is the
intent to build the frontend against contracts yet to be designed?

**Meanwhile** both are declared in `SERVICES_WITHOUT_CONTRACTS`. Their
applications have boundaries but no service client, and `assertEndpointAllowed`
refuses any call. **No mock stands in for them** — a mock would become a second
interpretation of a system that has not been designed yet.

---

## Q6 — Are EHR and OCR separate applications? *(decision)*

The brief lists EHR and OCR as applications. Today EHR workflows live inside the
staff/hospital application, and OCR is `src/features/migrate` (the
`migration-*` endpoints, with `_shared/migration-ocr-adapter.ts` behind them).

**Needed** — separate deployables with their own boundaries, or modules within
`staff-web`? Both are declared as separate applications here, which is the more
conservative choice: splitting later is easier than unpicking a merge.

---

## Q7 — Public pricing has no endpoint *(blocks a public-web feature)*

`src/pages/Pricing.tsx` reads the `hid_public_product_prices` table directly
from the browser via PostgREST. There is no pricing endpoint.

**Needed** — a public pricing endpoint, or agreement that pricing is build-time
content in `public-web`.

**Meanwhile** `public-web` is granted only the `platform` service, so it has no
way to fetch pricing at all.

---

## Q8 — Realtime notifications *(blocks a patient/staff feature)*

`src/lib/notificationsRealtime.ts` and `accessRealtime.ts` open Supabase Realtime
websockets from the browser, and `patientNotifications.ts` reads the
`notifications` table directly.

**Needed** — a gateway-side realtime channel (SSE or WebSocket), or an accepted
exception, or a decision to poll `notifications-list`.

**Meanwhile** only `notifications-list` is in the registry. Nothing opens a socket.

---

## Q9 — Outreach reads five tables directly *(blocks outreach-web)*

`src/lib/outreachApi.ts` performs `supabase.from()` selects and inserts against
`hid_outreach_campaigns`, `hid_outreach_workers` and `hid_outreach_invites`.
The four `outreach-*` endpoints cover signup, OTP and join — not campaign,
worker or invite management.

**Needed** — endpoints for campaign listing/creation, worker registration and
invite create/consume.

**Meanwhile** `outreach-web` is declared but not built; only the four verified
endpoints are callable.

---

## Q10 — Deployment target *(decision)*

The existing pipeline deploys to **Vercel** (`.github/workflows/vercel-*.yml`,
project `prj_BrqBNZ4JXQQ78lNzvEM0nXYaOrq7`) with Cloudflare for DNS/CDN and
Turnstile. The brief specifies Cloudflare in front and forbids introducing new
infrastructure.

**Needed** — do these applications continue on Vercel behind Cloudflare, or move
to Cloudflare Pages/Workers? Both satisfy "behind Cloudflare"; they differ in
build configuration and preview flow.

**Meanwhile** nothing deployment-specific is committed. Both applications produce
standard build output.

---

## Q11 — CORS allowlist must be extended *(blocking, needs backend change)*

`supabase/functions/_shared/cors.ts` allows `https://healthidentitydirectory.com`,
`https://www.healthidentitydirectory.com` and `http://localhost:3000`, overridable
via the `HID_ALLOWED_ORIGIN` environment variable.

New origins — `http://localhost:3100` (public-web), `http://localhost:3200`
(patient-web), and every staging hostname — are **not** on that list. Requests
will fail preflight until they are.

**Needed** — `HID_ALLOWED_ORIGIN` updated per environment. This is configuration
rather than code, but it is a backend change and is recorded here for review
rather than made.

---

## Q12 — Idempotency keys for writes *(decision)*

`_shared/cors.ts` already allows the `x-idempotency-key` request header, which
suggests intent, but no endpoint contract for it was found.

**Needed** — do write endpoints honour it, and which ones? Without it, no write
can be safely retried.

**Meanwhile** `shouldRetry()` refuses every non-idempotent method. A failed
`records-create` surfaces to the user rather than being retried.

---

## Not a question — three things to fix in the existing frontend

Recorded because they conflict with the target architecture and should be closed
deliberately, not inherited:

1. **Identifying data in `localStorage`.** `src/lib/auth.ts` persists
   `hid_patient_session` = `{ hidCode, phone, fullName }` and `hid_staff_session`
   = `{ id, fullName, email, hospitalName, role }`.
2. **Seven direct browser→database calls**, listed in Q7, Q8 and Q9.
3. **Mixed repository.** `hid-unified` holds both the SPA and `supabase/**`.
   Splitting it is prerequisite to "the frontend is its own repository".
