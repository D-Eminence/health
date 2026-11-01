# One staff sign-in: OpenID Connect, a server per product (draft)

Status: draft. The frontend half is in this branch, behind the build switch `VITE_HID_CENTRAL_SIGN_IN` (off). Nothing changes for anyone while the switch is off.

Owner decisions (1 Nov 2026): one sign-in through `auth.` with OpenID Connect; a separate server-side session on each product site; no cookie shared across the whole domain. identity-api uses the certified `oidc-provider`, and the product side the certified `openid-client`. The coordinator builds the `auth.` server; this branch is the product side's page half, and this note the contract between them.

The target: one sign-in at `auth.` for the staff products (`ehr.`, `lab.`, `pharmacy.`, `outreach.`, `migrate.`). A person signed in on one product opens another without a sign-in screen, and comes back to the page they asked for. It follows hid-system `CODEX.md` §38: server-managed sessions behind each product's own server (backend-for-frontend), host-only cookies.

## 1. What the code does today

**Production (`novu-v1`)**
- Each host's edge worker proxies `/api/*` to the Novu gateway on that host's own origin (`infra/cloudflare/src/frontend-worker.mjs`, `proxyApi`).
- Session cookies therefore come back host-only on each product host. Each site signs in on its own.
- Novu's identity-api is in neither this repo nor hid-system.

**hid-system (`main-v1`)**
- There is one API host per deployment (`api.`, `api.staging.`), with an exact-origin CORS list.
- Its cookies are host-only on that API host, with `SameSite=Strict`:
  - the access token at `/`;
  - the refresh token at `/api/v1/auth`;
  - a readable CSRF cookie, derived from the refresh token.
- Staff and patients share one cookie name. A client-kind check on refresh keeps them apart.
- Platform admin has its own cookies (`/api/v1/auth/admin`) and its own second factor.

**This frontend**
- Each product host has its own `/provider/sign-in`, and `app.` sends staff to `ehr.`.
- Each host sends its own Turnstile action.
- The page a sign-in may return to comes from an exact list (`staffReturnPath`): never a record below a page, never a query.
- `productSites.ts` holds the fixed host table.
- Session changes reach other tabs on the same origin only (`BroadcastChannel`).

## 2. Why not one `Domain=.healthidentitydirectory.com` cookie

Checked against the code above:
- **It reaches staging.** Staging lives under the same root (`staging.`, `lab.staging.`, …), so production staff tokens would be sent to staging's servers.
- **Every subdomain gets it, and can overwrite it:** the public site, any host a third party runs, any future subdomain.
- **Staff and patients share one cookie name.** A patient signing in on `app.` would replace a staff session on `ehr.`.
- **`admin.` would receive the clinical staff session.**
- **One facility choice for every product.** Choosing a facility on `lab.` would change it on `ehr.`.
- **§38 asks for host-only cookies.** Choosing the shared cookie needs a recorded owner decision overriding it.

Production already gives each product its own host-only session through its own `/api` proxy. OIDC adds `auth.` on top of that without widening any cookie.

## 3. The flow

1. **A product finds no session.** For example, `lab.` at `/provider/audit`. Its page leaves for its own server, on the same origin:
   `/api/v1/auth/oidc/start?return_to=/provider/audit`
2. **The product's server starts the request.**
   - It checks `return_to` (section 5).
   - It creates `state`, `nonce` and a PKCE verifier, and keeps them server-side against `state`, together with `return_to` and the attempt. They last 10 minutes at most and are used once.
   - It redirects to:
     `https://auth.<root>/authorize?response_type=code&client_id=lab&redirect_uri=https://lab.<root>/api/v1/auth/oidc/callback&scope=openid&state=…&nonce=…&code_challenge=…&code_challenge_method=S256&prompt=none`
3. **`auth.` answers.**
   - It requires an exact match on the client and its registered callback.
   - With its session: it issues a one-time code (about 60 seconds) to that callback.
   - Without a session, on a silent attempt: it sends `error=login_required` to the callback.
   - Otherwise: it keeps the request server-side and redirects to `/signin?request=<opaque id>`.
4. **The product's callback finishes.**
   - On `login_required` after the silent attempt, it creates a new `state` and tries again interactively, once.
   - On a code, it:
     - exchanges the code on the back channel, with client authentication;
     - verifies the ID token (`iss`, `aud`, `exp`, `nonce`);
     - maps `sub` to the staff principal;
     - sets the product's own host-only session, as today;
     - redirects to the stored `return_to`.
5. **Sign-in on `auth.`.** The person signs in at `auth./signin` with password, Turnstile and their second factor. The page then goes to `/api/v1/auth/oidc/authorize/continue?request=<id>`, on the same origin, which issues the code to the client's callback.
6. **Sign-out.** The product ends its own session and calls `auth.`'s end-session endpoint. `auth.` then tells every product server through OIDC back-channel logout.

The silent handoff (requirement 3) is step 2's `prompt=none` with a full-page redirect: two quick redirects, no screen. A hidden iframe can't do this, because browsers block the cookies it would need.

## 4. Contract: the endpoints this page relies on

| Host | Endpoint | Purpose |
|---|---|---|
| each product | `GET /api/v1/auth/oidc/start?return_to=<path>` | starts the flow (step 2) |
| each product | `GET /api/v1/auth/oidc/callback` | fixed, registered callback (step 4) |
| each product | `POST /api/v1/auth/oidc/backchannel-logout` | drops this product's sessions for a subject |
| auth. | `GET /authorize`, `POST /token`, `/.well-known/openid-configuration`, JWKS, end-session | the OpenID provider |
| auth. | `GET /signin?request=<id>` | this frontend's page (`staff/CentralSignIn.tsx`) |
| auth. | `GET /api/v1/auth/oidc/authorize/continue?request=<id>` | continues the request once signed in (step 5) |
| auth. | the staff sign-in API, as today | password, Turnstile, second factor |

## 5. Rules for the servers

- **`return_to`** must be:
  - a path on that host, with exactly one leading slash;
  - free of `//`, backslashes, control characters, whitespace, `?`, `#`, `%`, and `.` or `..` segments;
  - on the exact staff return list;
  - a page that host serves.

  Anything else means the product's own page. The value is kept server-side against `state` and never echoed from a query into a `Location` header. (`safeReturnPath` in `authHandoff.ts` is the same rule, and its tests list the refused cases.)
- **No free-form address.** `auth.` never takes a redirect address from a query: each client's callback is registered and matched exactly.
- **The request id** is opaque, at least 128 random bits, single use, and short-lived. Bind it to `auth.`'s browser session, so a request id can't be planted on someone else (login CSRF).
- **Cookies.**
  - `auth.`'s session: `__Host-` prefix, `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, no `Domain`.
  - Product sessions stay as they are: host-only.
- **CSRF tokens and Origin checks stay.** All subdomains are the same site, so `SameSite` alone protects nothing between them.
- **Signing in isn't permission.** Each product still applies its own role and facility checks, and keeps its own facility choice. In the EHR, which is the whole hospital system, department staff see only their own module's part of a patient's record and clinical staff the whole record; the patient's permission (consent, PIN or emergency access) is still required (owner, 1 Nov).
- **Time limits.** Idle and absolute timeouts apply. Break-glass and admin work ask the person to sign in again (`max_age` / `acr`).
- **`admin.`** is not part of it: either its own client with a required second factor, or its own sign-in as today. It never gets the staff session.
- **Patients (`app.`)** are not part of it.
- **Turnstile.** `auth.` needs its own accepted action. Product hosts no longer show a password form.
- **Libraries.** identity-api uses the certified `oidc-provider`; each product's server uses the certified `openid-client` for the authorization-code flow with PKCE, the token exchange, ID-token checks and back-channel logout (owner, 1 Nov).
- **HSTS** with `includeSubDomains` on the root.

## 6. What this branch holds (frontend)

- `apps/patient-web/src/authHandoff.ts`:
  - the switch;
  - `signInStartHref`: the product's own start address, on the same origin, naming only a page;
  - `safeReturnPath`;
  - `authorizationRequest` and `afterCentralSignInHref`: on `auth.`, an opaque id only, never an address from a query.
- `staff/App.tsx` Gate: with the switch on, on the five staff hosts, a signed-out visitor goes to the product's start address. The join page keeps its own sign-in, because its invitation waits in the page.
- `staff/CentralSignIn.tsx` and its mount in `App.tsx`: `auth.`'s `/signin`.
  - With a session, it continues at once.
  - Otherwise it shows the blue staff sign-in, then continues.
  - Any other address on `auth.` opens `/signin`.
- `BlueSignIn` gains `leavesAfterSignIn`, so the page around it takes the person on.
- Tests:
  - `__tests__/authHandoff.test.ts`: the rules, and attempts to send a person elsewhere;
  - `__tests__/sites/centralSignIn.test.tsx`: both flows, and the switch off.

## 7. Open decisions

- **The product side's server endpoints** (start, callback, back-channel logout) and each product's session: who builds them, and in which service. Production's product APIs run on Novu, outside both repos.
- **hid-system `main-v1` has one API host.** "A server per product" there needs per-host proxies, as production's edge already has.
- **Other tabs on other products.** They learn of a sign-out at their next request (a 401), and when the tab comes back into view (the existing recheck). A cross-origin push would need more.
- **How exact the return is.** Requirement 4 asks for the precise page. Today's rule returns to the page only, never a record or a query in an address. A return to a record would need the full path kept server-side against `state`, never in the URL. That's the owner's call.
- **Edge and DNS (coordinator).** `auth.` needs its own deployment: host, edge worker and certificate. The coordinator builds the edge; nothing here changes `infra/cloudflare/src/frontend-worker.mjs`.
- **No hand-off of the department pages.** The EHR keeps the laboratory, pharmacy, Migrate and outreach pages in its workspace, and they also run as their own sites (owner, 1 Nov): the switch changes only how sign-in happens.
