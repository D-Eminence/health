# Phase 4 Stage 2B: Platform Admin Security (frontend)

Branch: `phase-4-stage-2-frontend-security` (base `main` at `1242f14`).
Backend contract: hid-system `phase-4-stage-2-backend-security` at `7cbbf98`
(PR D-Eminence/hid-system#19, `docs/PHASE_4_STAGE_2A_BACKEND_SECURITY.md`,
ADR-038). That backend is not merged or deployed yet; this UI needs it.

The admin UI in `apps/patient-web/src/admin` is only an interface. Whether a
session is valid, whether MFA or a fresh step-up is needed, who may approve, and
what an export may contain are decided by the backend on every request. The
browser keeps no assurance state: it reacts to the backend's responses and
problem codes. Secrets, recovery codes and exports exist only in component
memory and are never written to web storage.

## Sign-in (platform session)

1. **Password**: `POST /auth/admin/login` (`turnstileAction: admin-login`). A wrong
   password and an account without platform access get the same message, as
   the backend intends.
2. **`mfa_required`**: a 6-digit authenticator code, or one recovery code
   (`POST /auth/admin/mfa/verify`). The screen explains that email codes are not
   accepted for administrators and that recovery codes cannot confirm
   high-risk actions.
3. **`mfa_enrollment_required`** (new account, or after an approved MFA reset):
   **Begin setup** calls `mfa/enroll/start` only on request (the backend
   rate-limits it). The setup key is shown grouped for manual entry with an
   `otpauth://` link and its parameters. After `mfa/enroll/activate` the key is
   dropped from state, and the ten recovery codes are shown once with
   copy/download and a required "I have stored these" confirmation.
4. An expired or used-up challenge (`MFA_CHALLENGE_INVALID`) returns to the
   password step.

The platform client uses the `hid_access_admin_csrf` cookie and
`/auth/admin/refresh`. The admin app may no longer call the staff sign-in,
session, refresh or logout routes (`APP_ROUTE_GRANTS`).

## Session end and expiry

The backend returns the same `401 AUTHENTICATION_REQUIRED` for an expired and a
revoked platform session. The client records the idle and absolute expiry the
backend reports (sign-in, refresh and `GET /admin/mfa`) in memory only. When a
protected request is still refused after the client's one refresh, the
sign-in screen says:

- **expired** when that server-reported expiry has passed (15 minutes idle or
  the 8-hour limit);
- **ended before it expired** otherwise (revoked elsewhere, by another
  administrator, or MFA reset), with advice to report an unexpected end.

Two minutes before the reported idle expiry a banner offers **Stay signed in**,
which refreshes the session. Nothing refreshes on a timer. At the 8-hour limit
the banner says only a new sign-in will help.

## Step-up for high-risk actions

`StepUpProvider` wraps the signed-in workspace. When the backend refuses a
command with `403 STEP_UP_REQUIRED` (missing or older than 5 minutes; the backend
does not distinguish), a dialog explains that nothing has changed yet and asks
for an authenticator code (`POST /admin/mfa/step-up`). After the backend accepts
it, the same submission is repeated once:

- One idempotency key is created per user submission and reused for the
  repeat, so the backend sees one command. The dialog appears only after a
  refusal, so the first attempt did not run.
- Cancelling reports that the action was not carried out.
- A rejected or rate-limited code keeps the dialog open with the backend's
  reason, and an authenticator code is never resent automatically
  (`refreshOnUnauthorized`).
- If step-up is still required after confirming, the refusal is shown; there
  is no loop.
- Concurrent actions share one confirmation.

Every governed admin command (status, roles, sessions, facilities, pricing,
integrations, controls, approvals, export) goes through this path.

## Two-person approval

- **Users & roles** offers **Request Super Admin elevation** (instead of a
  one-step grant, which the backend refuses) and **Request authenticator
  reset**, each with a reason. Super Admin is not offered in the one-step
  grant list; revocation stays one-step with step-up.
- **Approvals** lists requests by status (pending by default; all, approved,
  rejected, cancelled, expired) with target, requester, reason, expiry and
  decision.
- Approve, Reject and, for the requester, Cancel each send their own
  decision, with `If-Match` and an idempotency key.
- The page explains the backend's rules for requesters, targets and
  non-Super-Admins but does not block them. The backend's
  `SELF_APPROVAL_DENIED`, `APPROVER_INELIGIBLE`, `MFA_REQUIRED`,
  `APPROVAL_EXPIRED`, `APPROVAL_NOT_PENDING` and `APPROVAL_CANCEL_DENIED`
  answers are shown as such.
- Expired requests are marked as never carried out.

## Sessions

**Security** shows the backend's MFA status:

- enrolment and last use;
- unused recovery codes, with a warning at three or fewer;
- how this session was verified, with a warning after a recovery-code sign-in;
- step-up validity, and idle and absolute expiry.

**Create new recovery codes** needs step-up and shows the new codes once.
Replacing a lost authenticator is explained as an approved reset followed by
enrolment at the next sign-in, the only path the backend supports.

**Your sessions** lists the backend's safe metadata (sign-in, last refresh,
expiry, MFA method, last step-up, source IP; never token material). You can
revoke another session, sign out all other sessions (partial failures are
reported), or sign out the current one.

On **Users & roles**, **Review sessions** lists another account's sessions.
Revoking one needs a reason and can mark it compromised, with a security
warning. **Revoke all sessions** is unchanged.

## Export

Shown only with `platform.principal.export`; the backend still decides. The
panel explains, before anything is sent:

- the file's personal-data content, and that it leaves Health ID's control;
- that step-up is required and why;
- that the reason is audited;
- the 5,000-row cap;
- the excluded fields.

The administrator chooses an optional search/status filter, gives a reason and
ticks a per-export confirmation. The CSV is fetched through the shared client's
`download` response type and saved without being retained. A failed export is
never retried automatically, because each one is audited.

The `X-HID-Export-*` headers report the row count, cap and truncation. The
backend does not list them in CORS `exposedHeaders`, so a cross-origin
deployment cannot read them. The production design is same-origin `/api/v1`,
where they are readable; otherwise the UI says the count was not shared.

## Shared changes

- `@hid/contracts`:
  - registers the Stage 2A routes with their backend permissions;
  - the export route requires `reason` and `platform.principal.export`;
  - JSON and download routes are enforced in both directions.
- `@hid/http`:
  - `responseType: 'download'` returns a `Blob` with readable headers, and
    errors are still parsed as problems;
  - `refreshOnUnauthorized` lets a request keep a code rejection from
    triggering a refresh and resend;
  - **de-duplicated reads are cancelled only when every caller cancels**. Before,
    the first caller's cancellation (for example React StrictMode's effect
    cleanup, or leaving and re-entering a page) cancelled the shared request
    for the next caller, and admin pages loaded on mount showed "could not be
    loaded" in development.

## Error codes

`problems.ts` maps each backend code to its own message:

| Area | Codes |
|---|---|
| MFA | `MFA_REQUIRED`, `MFA_INVALID_CODE` (also replay, by design), `MFA_CODE_REQUIRED`, `MFA_CHALLENGE_INVALID`, `MFA_RATE_LIMITED`, `MFA_UNAVAILABLE`, `MFA_NOT_ENROLLED` |
| Step-up and policy | `STEP_UP_REQUIRED`, `REASON_REQUIRED`, `IF_MATCH_REQUIRED`, `IDEMPOTENCY_*`, `HIGH_RISK_POLICY_MISSING` |
| Approval | `TWO_PERSON_APPROVAL_REQUIRED`, `SELF_APPROVAL_DENIED`, `APPROVER_INELIGIBLE`, `APPROVAL_CANCEL_DENIED`, `APPROVAL_NOT_PENDING`, `APPROVAL_ALREADY_PENDING`, `APPROVAL_EXPIRED`, `TARGET_INELIGIBLE` |
| Session | `AUTHENTICATION_REQUIRED`, `PLATFORM_SESSION_REQUIRED`, `PLATFORM_SESSION_SCOPE_DENIED`, `CSRF_VALIDATION_FAILED`, `ORIGIN_DENIED` |
| Availability | `PLATFORM_PORTAL_DISABLED`, `PLATFORM_MAINTENANCE` |

A screen may explain a code more precisely: on the export panel
`PERMISSION_DENIED` reads as "Exports are restricted to Super Admins with the
export permission".

## Verification

- **Unit and component tests**:
  - sign-in, enrolment and recovery codes;
  - step-up confirmation, retry, cancel, rate limiting and shared
    confirmation;
  - approvals, including each button sending its own decision;
  - the Security page;
  - principal export, requests and session revocation;
  - expired, revoked and warning states;
  - API contracts and error mapping;
  - transport download, refresh opt-out and de-duplication cancellation;
  - route grants.
- **Browser end-to-end** (local, synthetic, not committed): Chromium drove this
  UI through the Vite same-origin `/api/v1` proxy against the hid-system Stage
  2A Identity API at `7cbbf98`. The API ran as its exact runtime database role
  on a copy of the synthetic rehearsal database. Results:
  - enrolment gives only the three platform cookies and empty web storage;
  - a step-up-confirmed account suspension ran exactly once (`row_version` +1);
  - the requester's own approval was refused, and a second Super Admin's
    approval granted the role once;
  - the export downloaded RFC 4180 CSV with readable headers;
  - revocation by another administrator showed the revoked notice;
  - recovery-code sign-in worked and was shown as such;
  - an idle-expired session showed the expired notice;
  - sign-out cleared the platform cookies;
  - no console errors.

## Remaining

- **QR code**: enrolment uses the setup key and `otpauth://` link. A QR image
  needs a vetted encoder or dependency, which this stage did not add.
- **Backend contract gaps**:
  - no distinct codes for expired versus revoked sessions or expired versus
    missing step-up;
  - export headers not CORS-exposed;
  - no endpoint for a principal's MFA enrolment status, so the reset request
    relies on `MFA_NOT_ENROLLED`.
- **Policy decisions** (from Stage 2A):
  - two-person approval for Super Admin revocation;
  - trust on first use at enrolment;
  - forcing a password reset with an MFA reset;
  - the legacy `platform_admin` role.
- **Deployment**: merge and deploy the Stage 2A backend with
  `MFA_SECRET_KEY_B64`. Until then platform sign-in fails, because the staff
  sign-in route is no longer granted to the admin app.
