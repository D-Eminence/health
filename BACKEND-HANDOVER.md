# Facility onboarding and subscription — backend handover

Updated 2026-10-03, Africa/Lagos. This document describes **future backend contracts**, not deployed endpoints. The current deliverable remains a local fictional simulation as explicitly chosen by the user.

## Confirmed decisions

- Subscription visibility: Hospital Owner, Hospital Admin, Billing Officer only. Cashier, Medical Director, Platform Super Admin and every other role are excluded from facility subscription data in ordinary workspaces.
- Trial begins on facility verification approval, not email verification or registration.
- Trial: 21 days. Grace: 21 days. Durations are configurable; persisted dates are not reset by repeat approvals.
- Keep the established components, services, React state, hash routes, local upload handling, typography, blue tokens, logo and split clinical photo layout. No new runtime dependency was added.
- Local simulation only. No real payment or external medical integration.

## Implemented frontend contracts

- `src/registration.tsx`: five-step registration, summary edits, draft resume, separate agreements, pending/rejected facility profile and re-submission.
- `src/facility-fields.ts`: shared fields, step validation, Nigerian phone formats, State/LGA validation, document constraints and password stripping.
- `src/subscription-model.ts`: configurable policy, time/status derivation and exact-role scope.
- `src/subscription.tsx`: authorized countdown, plan/renewal page, history and separate development controls.
- `src/service.ts`: validates submissions, saves drafts, performs verification and starts trial once, enforces write restrictions, filters subscription responses, renews/cancels and schedules reminders.
- `workspaceData()` removes subscription/config/reminder fields and subscription audit entries from unauthorized ordinary workspace data. `subscriptionDetails()` and mutations independently enforce permission checks. Raw IndexedDB still belongs to the local device owner; these functions are not a real server boundary.

Account email verification remains separate from facility verification. The existing nine-step **operational setup** remains available after facility approval, including branches, staff, roles and patient-billing configuration. The new five-step flow captures registration and regulatory identity first.

The role-at-facility selection is a self-declaration. New facility creators receive the existing Hospital Owner membership, which carries administrative responsibility but no clinical signing or prescribing authority. Selecting Medical Director does not grant that clinical role. Invitations preserve their assigned membership and use the short staff account path.

## Future endpoints

Profile additions also need authenticated server equivalents: `GET/PATCH /account/profile`, `POST/DELETE /account/profile-picture`, `POST /account/password-change`, and `PATCH /facilities/:id/identity` with hospital image upload/removal. Account operations must derive the target account from the session; never trust a client account ID or accept role/permission changes in a profile payload. Password changes must verify the current credential, rehash securely and invalidate sessions/recovery codes atomically. Hospital identity changes require the existing facility-edit permission. Store scanned images privately with size/type limits. The preview implements these operations only through local mock services.

All routes below are proposals under `/api`; the current static preview server implements none of them. Reuse the existing entity IDs and service rules. Every request must validate active authenticated account, institution membership, permissions, branch scope and record version on the server.

| Endpoint | Purpose and important checks |
| --- | --- |
| `POST /facility-drafts` | Create a server-side draft, issue an opaque resume reference tied to a verified account or protected pre-registration session. Rate limit abuse. |
| `GET /facility-drafts/:id` | Restore authorized draft and completed steps. Never return password/verifier fields. |
| `PATCH /facility-drafts/:id/steps/:step` | Validate and save one step; return keyed errors. Enforce optimistic version checking and idempotency keys. |
| `POST /facility-drafts/:id/documents` | Stream an authorized image/PDF upload; check size, type and content; scan and store privately. Return document ID and metadata, not a public URL. |
| `GET /facility-documents/:id` | Authorize owner/admin/reviewer, audit access, return a short-lived signed download or streamed content. |
| `DELETE /facility-drafts/:id/documents/:documentId` | Replace/remove a draft document with ownership checks and retention policy. |
| `POST /facility-drafts/:id/submit` | Validate all fields/agreements, create account and facility atomically, preserve agreement versions/timestamps, transition submitted → pending_verification. Do not start trial or take payment. |
| `GET /facilities/:id/verification` | Return authorized status, reason and review history, with applicant/reviewer scopes. |
| `PATCH /facilities/:id/profile` | Save profile and replacement documents; validate revision and re-review policy for approved information. |
| `POST /facilities/:id/resubmit` | Revalidate a rejected profile, record history and return to pending_verification. Suspensions require reviewer resolution. |
| `POST /facilities/:id/verification-decisions` | Platform reviewer only. Require reason. Approve/reject/suspend. On first approval atomically write trial start/end from authoritative UTC server time. |
| `GET /facilities/:id/subscription` | Dedicated subscription.view permission and exact approved roles. Return sanitized plan, effective status, UTC period dates, serverNow and server-derived days remaining. Other roles receive 403; never include this data in general staff payloads. |
| `GET /subscription-plans` | Authorized plan catalogue, approved prices/currency/tax terms and billing basis. No live prices are defined in this simulation. |
| `POST /facilities/:id/subscription/checkout` | Authorized subscription.edit permission, idempotent checkout and allowed provider. Real implementation blocked until provider and pricing are confirmed. Never accept client-supplied price or trust browser success. |
| `POST /payment-webhooks/:provider` | Verify provider signatures, deduplicate events, reconcile payment amounts/currency/facility, extend periods atomically and audit. Provider-specific contract remains unknown. |
| `POST /facilities/:id/subscription/cancel` | Authorized cancellation with confirmed effective date and history; preserve access-to-care policy. |
| `GET /facilities/:id/subscription/reminders` | Return only reminders for the requesting account's authorized facility subscription role. |
| `POST /subscription/reminder-jobs` | Internal scheduler only; server clock, configurable intervals, unique `(facility, periodEnd, threshold, recipient, channel)` keys, retries and delivery records. Never expose as an unauthenticated client trigger. |

Existing account registration, verification, MFA, recovery, invitations and clinical service methods also need authenticated server equivalents before production use. Do not ship frontend-only permissions as access control.

## State and timing policy

Registration drafts are `draft`. Submission records `submitted`, then `pending_verification`. Reviewer states are `verified`, `rejected` with reason, and `suspended`. Pending/rejected/suspended new facilities cannot access clinical modules; authorized administrators can manage profile/documents and staff invitations.

A subscription stores nullable trial start/end before approval, optional paid/demo period end, current plan, current status, grace length and action history. Effective statuses are trialing, active, expiring_soon, grace_period, expired and cancelled. The final three days use the more prominent token-based visual state. Renewal period defaults to **30 demo days**, configurable in Simulation controls; this is not an agreed commercial plan.

Time comes from the local mock service clock (normal device time unless explicitly advanced through development controls). The simulation cannot meet a trusted-server-clock guarantee. Production must use the server/database clock for both response countdowns and mutation enforcement. Client countdown rendering may interpolate only from authenticated server time.

In-app reminders use configurable defaults of 14, 7, 3 and 1 days. The nearest reached threshold is emitted once per period, including catch-up after reopening. The same logic applies to trial and renewal end dates. Local reminder checks run while the app is open and when simulation time advances; no background delivery occurs while the app is closed. There are no existing email/SMS channels, so none are connected.

## Explicit defaults and unresolved choices

1. **Expiry default:** full entry access continues during grace. After grace, existing records stay readable, including emergency care; new clinical entries are rejected with neutral administrator-contact wording. Authorized emergency external-history access remains subject to its own grant rules. This applies to subscription expiry, not an independent facility suspension or membership revocation.
2. **Cancellation default:** explicit cancellation takes immediate effect in the simulation after confirmation. Existing records remain readable. Confirm production cancellation/end-of-period policy separately.
3. **Plans/prices:** no amounts were supplied. The interface offers one explicitly fictional facility plan with “Price: not set” and a no-charge renewal action. Commercial pricing/basis remains unresolved.
4. **Provider:** the user supplied `bachs.io`. It could not be verified (web fetch unsupported; direct fetch returned 403). It is stored only as an unconnected configurable reference. No SDK, API assumptions, keys, checkout or real transactions were added.
5. **Draft privacy conflict:** server-only drafts conflict with the chosen frontend simulation. Only fictional information is permitted; drafts/documents remain in IndexedDB. Passwords are never persisted in drafts or profiles and must be re-entered after refresh. Actual server-side privacy requires the backend above.
6. **Verification:** review controls and licences are fictional; approval is not independent regulatory verification.
7. **Products/facility types:** registration records the requested type and product interests. Existing EHR types are mapped where necessary; stand-alone Pharmacy/Lab, Migrate, Outreach and API products are not built or activated.
8. **Existing local data:** pre-existing/sample hospitals remain usable without retroactively forcing verification. All new normal facility registrations require the complete new flow. The blank “new hospital” shortcut is disabled in the service.
9. **Agreements:** separate, initially unticked demonstration acknowledgements are provided. Production Terms/DPA/NDPA wording, versions, retention and consent policy require approved legal content; no compliance certification is claimed.

## Geographic data attribution

State/LGA names in `src/nigeria.ts` are adapted from [Open Admin Data — Nigeria Administrative Divisions](https://github.com/open-admin-data/nigeria-administrative-divisions), CC BY 4.0. Only 37 state/FCT names and 774 LGA names were retained; no coordinates or wards were imported. The source licence is saved at `references/nigeria-data-license.txt`. This lookup is for form selection and does not verify a facility's address.

## Offline simulation contracts (Phase 1 handover)

The implementation remains a local simulation. The encrypted `state` store represents mock authority; `cache` is the user/branch-scoped subset; `outbox` persists encrypted record batches; `remote` represents simulated server records and atomic idempotency receipts. The device-held nonextractable key also protects the mock authority and queue. Origin scripts can access that key: this is encryption at rest, not protection from malicious same-origin code, origin owners, or a compromised device. No genuine cross-device server sync is claimed. Password-derived keys protect the staff cache; queue encryption is independent so password rotation does not destroy pending work.

Required production endpoints:
- GET /health: authenticated reachability/server time, no cache.
- POST /offline/lease: signed identity/facility/branch/permission/entitlement lease, eight-hour expiry, device registration.
- GET /offline/patients?limit=100&cursor=...: authorized assigned/recent subset, revisions, tombstones and high-risk markers.
- POST /sync/batches: idempotency key, device timestamp, base revisions, ordered dependency IDs, atomic receipt and per-item results; recheck current permissions on server.
- GET /sync/changes?cursor=...: high-risk updates first, consistent cursor, tombstones, conflicts and authoritative server time.
- POST /sync/conflicts/:id/resolve: authorized reviewer, preserved versions, chosen/merged values and audit reason.
- POST /patients/duplicate-reviews: candidate matching and explicit authorized decision; never auto-merge clinical identity.
- POST /uploads and PUT /uploads/:id/parts: resumable media, integrity hash, retryable receipt and parent dependency.
- POST /sessions/heartbeat, GET /sessions, DELETE /sessions/:id: authenticated session inventory/revocation.
- PATCH /profile, POST /profile/contact-verifications, POST /credentials/reviews, POST /facility/reverification: review and notification contracts.
- PUT /presence and GET /presence: facility-scoped TTL, privacy settings, manual status expiry; no monitoring history.

The current service worker caches static app assets only. Health requests bypass it. It never invokes skipWaiting or forces a reload: close all preview tabs to activate an installed update. Clinical/outbox data is not evicted automatically. Current conflict batches remain blocked and retain both versions; reviewer resolution is a subsequent phase. Backoff is bounded; queue receipts support replay after interruption. Core record writes are queued; non-record account changes still modify mock local authority and need a separate production transport.

Remaining verification: sustained lossy/flapping network; interrupted media uploads and dependency ordering; nearly-full disk failures; wrong-clock bounds across device restart; deactivation/recovery permutations; waiting update with unsaved drafts; full phone/tablet accessibility review. Do not use this simulation for real patient records.

## Profile/presence additions — production contracts and fields

All new methods currently execute locally; no real email/SMS has been sent. Production endpoints must enforce identity, facility membership, permission and rate limits on the server, never trust the client snapshot.

Endpoints:
- PATCH /me/profile — allowlisted display name, phone, display department, title, bio, language; never assign access roles from display fields.
- POST /me/photo and DELETE /me/photo — validated decoded image, bounded dimensions/size, metadata stripping and server-controlled storage URL; crop is performed locally before upload.
- POST /me/email-change and POST /me/email-change/verify — current-password check, single-use challenge to the new email; notify both old and new destinations after confirmation.
- POST /auth/recovery and POST /auth/recovery/verify; POST /auth/password-reset — neutral identical responses, account/IP/device throttles, independently verified reset grant, single-use consumption, session/lease invalidation and notification.
- POST /staff/:membershipId/recovery — Owner/Admin only; issue to account's verified destination, never return a password.
- GET /me/sessions; DELETE /me/sessions/others; PATCH /me/two-factor — current-user inventory, device and last-active details, authenticated revocation, current-password confirmation for 2FA changes.
- PUT /me/credentials; POST /staff/:membershipId/credentials/review — pending/approved/rejected revisions, authorized non-self reviewer and audit history.
- PATCH /facilities/:id/profile and /presence-policy — Owner/Admin only, regulator-field diff triggers review; audit before/after revisions; renewal fields remain exact-finance-role gated.
- PUT /me/notification-preferences; PUT /presence; POST /presence/heartbeat; GET /presence?facilityId=... — current facility only; TTL, expiry and privacy policy; no monitoring/timekeeping archive.

Real-time channels (not implemented across devices in this preview): authenticated facility:<id>:presence snapshots/deltas and user:<id>:notifications via SSE or WebSocket; authorize each subscription and revoke it immediately on membership changes. Presence must contain only staff identifier, status, optional nonclinical status text and expiry. Server heartbeat timeout publishes Offline without exposing colleague last-seen. Notification events include stable ID, recipient, event type (message/mention/task/alert), critical flag set only by authorized workflow, timestamp and authorized route; never trust a client-supplied critical flag. Reconnection establishes a fresh cursor and must not replay sounds for the backlog.

Added data fields: Account.language/displayDepartment/pendingEmail/forcePasswordChange/mfaEnabled/credentials/preferences/securityNotices; Hospital.presencePolicy/profileHistory; Session.presence (status, text, expiry, heartbeat, activeAt) plus existing device/lastActive; Code.recoveryVerified distinct from used/replaced; notification.data.event/recipient/critical. Local broadcast/IndexedDB shares simulation state across same-origin tabs only. The rolling recovery request counter is a local demonstration, not production abuse protection. Browser-level tab mute is enforced by the browser; no reliable standard tab-muted detection API is assumed. Hidden tabs never play tones. Web Audio oscillator tones are original code-generated assets, with no third-party sound files or licences required.

Operational limits: no real email/SMS, cross-device presence or authenticated realtime server; no localization pack or chat module; offline account/profile changes remain local mock-authority mutations until the account transport is built. Do not interpret these as completed production integrations. The separate offline conflict-resolution/high-risk refresh/media/duplicate-review backlog still applies.


## 2026-10-03 - Conflict review contract (local phase 2a implemented)

The earlier statement that all reviewer resolution is pending is superseded for supported clinical batches. The preview now resolves them locally; the backend is still absent.

Required endpoints:
- GET /sync/conflicts?facilityId=...&branchId=...: authenticated, current role/branch-filtered review summaries, including colleague-created batches. Return only batches the clinician may review in full. Administrative ownership alone is insufficient.
- GET /sync/conflicts/:id: recheck clinical permissions and return immutable original/connected versions, status, timestamps and an opaque revision token. Do not place clinical details in URLs, telemetry or toast payloads.
- POST /sync/conflicts/:id/resolve: batch ID/idempotency key, revision token, complete record-to-version choices and review reason. Server-side transaction validates current authority, earlier dependencies and all revisions; preserves originals; appends clinical history and audit; updates the selected projection and receipt atomically. Return a conflict response when versions changed, with no partial writes. Repeated accepted requests return the original receipt.

Preserve later queued edits and their base revisions. If they conflict with the reviewed projection, require a separate decision. Never silently rebase them onto the review result. A client cache-write failure after acknowledgement must not undo or duplicate the server decision. Emit an authenticated change notification so other devices refresh the reviewed projection and pending flags.

Preview source: src/conflicts.ts, src/conflict-review.tsx, src/storage.ts commitReview, src/sync.ts. Complete original and selected snapshots are kept in the encrypted queue's resolution object; record versions keep data/status history; audit records capture reviewer, membership, facility/branch, reason, device time and simulated received time. Production must use trusted server revisions/time and server-enforced permissions instead of browser-owned mock authority. Freeform merging, duplicate identity merging, unsupported/non-clinical batch review and cross-device transport remain separate work.
