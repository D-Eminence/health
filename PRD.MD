# Health ID - Hospital EHR product requirements

## Controlling delivery target - frontend production readiness

Confirmed by the user on 2026-10-03: deliver a production-ready **frontend only**. This supersedes earlier descriptions of the final deliverable as merely a visual prototype or demo. Current simulated services remain development/test adapters until backend integration; they must stay clearly labelled.

Completion requires the agreed frontend screens and workflows, consistent shared components, desktop/tablet/mobile layouts, accessibility, validation, permission-aware presentation, loading/empty/error/success states, safe drafts/navigation, offline client behavior, integration contracts, performance checks and evidence-backed frontend acceptance. Selected-screen checks or passing tests alone do not establish complete frontend readiness.

Backend implementation, hosting infrastructure, real message/payment delivery, server security enforcement and operational hospital rollout are outside this delivery target. Document those dependencies in BACKEND-HANDOVER.md; do not count their implementation as unfinished frontend work. Client-side work needed to integrate with them remains in scope. A frontend-ready designation must not be presented as certification that the complete hospital system is safe for real patient use.

Read FRONTEND-READINESS.md for acceptance gates. Continue the remaining visual/state audit and agreed client workflows against these gates. No public deployment is authorized by this scope clarification.


Updated: 2026-10-03 (Africa/Lagos). Active implementation: connected frontend simulation with five-step facility registration and subscription lifecycle.

## Latest facility registration scope

### Staff and hospital profiles

Personal account settings are available at `/profile`, including name, Nigerian phone, display-only job title, biography and profile picture. Memberships and sign-in email are shown read-only; changing display details cannot grant permissions. Owner/Admin hospital identity editing is available within `/facility` for name, phone, contact email, address and picture/logo.

Pictures support PNG, JPEG, WebP and GIF up to 2 MB with preview, save, discard and removal. They persist in the existing local simulation and appear in the account header, staff directory or hospital sidebar as appropriate.

All password inputs use the shared accessible eye toggle, including sign-in, registration, recovery replacement, unverified-email changes and account password changes. Changing a password requires the current password, validates confirmation and invalidates all account sessions and outstanding codes. Password forms do not save drafts. Forgotten passwords use the existing simulated recovery-code flow.

New source: `src/profiles.tsx`; new regression suite: `tests/profiles.spec.js`. Reuse service validation and existing branding. Hospitals do not have shared passwords: password changes belong to individual accounts.

`FACILITY-ONBOARDING-SPEC.md` preserves the latest request. The user confirmed simulation-only architecture, trial after facility approval, 21 trial days, 21 grace days, and subscription access only for Hospital Owner, Hospital Admin and Billing Officer. `BACKEND-HANDOVER.md` records endpoint contracts, mappings, conflicts and defaults.

- Five registration steps precede email verification, facility approval and the existing operational setup. Invited staff use a separate short account screen.
- Pending/rejected/suspended new facilities have locked clinical modules. Authorized administrators can manage profile, documents and invitations. Rejections support resubmission.
- Trial starts once on approval. Dates, plan, status and history are persisted. Reminder defaults are 14/7/3/1 days. The configurable demo renewal duration is 30 days, not a commercial commitment.
- Subscription permissions are restricted to the three confirmed roles. Ordinary mock workspace responses exclude subscription fields and related audit entries for other roles, including Cashier.
- Grace retains entry access. After grace, clinical writes are blocked with neutral administrator messaging; existing records and separately authorized emergency history remain readable. Explicit simulated cancellation also makes clinical access read-only.
- Passwords are excluded from drafts and profiles. Server-only storage and trusted time require the future backend; this simulation uses fictional local records.
- Product selections record interest without activating deferred products. Prices remain unset. The supplied bachs.io reference remains unconfirmed and unconnected.
- New source: registration.tsx, facility-fields.ts, subscription.tsx, subscription-model.ts and nigeria.ts. Geographic attribution is in BACKEND-HANDOVER.md.
- Twelve tests passed across the hospital and facility suites. LOG.MD records the final checks.

## Authoritative request

`HOSPITAL-EHR-SPEC.md` is the exact user-supplied 34-section implementation request. Read that file with this PRD before making changes. It supersedes the previous visual-prototype scope. The original brand PRD is archived at `original/PRD-brand-redesign.md`.

## Fixed boundaries

- React and TypeScript, URL-based routes, one shared normalized domain model.
- IndexedDB for structured records, drafts, simulated credential verifiers and sessions; localStorage only for small preferences and session/challenge references.
- Persistent fictional workflows only. No backend, Supabase, server functions, real email, real payment processing or external medical integrations.
- Product context: Health ID - Hospital EHR. Preserve HID record identifiers and existing module references where appropriate.
- Keep existing Health ID branding and established components. Do not introduce a new design direction.
- Local preview remains http://localhost:4173. No public deployment.
- Supporting patient simulation is limited to consent decisions and released records; it is separate from hospital navigation.
- No marketing website, full consumer portal, outreach product, migration product, API portal or standalone pharmacy/lab onboarding.

## Implementation sequence

1. Shared typed entities, IndexedDB storage, transactional mock service, permission checks and routes.
2. Owner registration, verification, sign-in, simulated MFA and password recovery.
3. Persistent nine-step onboarding: Facility, Type, Departments, Branches, Staff, Roles, Billing, Review, Launch.
4. Invitations, memberships, institution/branch selection and permission boundaries.
5. Patient identities and local MRNs, appointments, visits, queues.
6. Triage, clinical notes, encounter signing and amendments.
7. Laboratory, radiology, pharmacy, billing and receipts.
8. Admissions, bed turnover, nursing and specialty workflows.
9. Claims, inventory/procurement, staff administration and support services.
10. Consent, emergency access, notifications, audit, reporting, recovery states and acceptance verification.

## Data and access rules

Every record has a stable ID, hospital and branch scope where relevant, timestamps and author. Relationships use IDs. Account identity, membership, patient identity and hospital MRN remain separate. A record mutation checks the current session, current active membership, branch, permissions, state transition and required data inside the service boundary before writing.

New hospital creators are owners; ownership is not clinical authority. Ordinary navigation only allows the authenticated account's actual memberships. Fictional account selection belongs to separate development controls and does not bypass credentials or MFA.

Generated codes have expiry, attempt limits, resend cooldown and invalidation. Password verifiers use a per-account salt; raw passwords must never be persisted or logged. These are explicitly local demonstrations, not production security.

Mutations must update shared records atomically, audit the action, issue meaningful notifications and reject duplicate operation identifiers. Storage or simulated failure must not report success. Drafts, routes, sessions and onboarding progress survive refresh.

Patient selection and local registration never grant external history. Normal external access requires a scoped patient decision; emergency access requires explicit permission, justification, acknowledgement, short expiry and category-view audit. Revocation and expiry remove external display access without deleting local drafts.

## Acceptance

The 15 cross-role journeys and additional enabled module lifecycles in section 33 of `HOSPITAL-EHR-SPEC.md` define acceptance. Evidence must include build/typecheck, service-boundary tests, browser journeys and actual persistent record assertions. Dashboard navigation alone is not acceptance.

Read `LOG.MD` for verified results and remaining gaps. Never call a module complete based only on a success message or a rendered form. Clearly disable and disclose unavailable operations.

## Source and handoff map

- `src/model.ts`: shared entity types.
- `src/storage.ts`: IndexedDB schema, atomic persistence, locking and failure injection.
- `src/service.ts`: authentication, configuration, permissions, mutations and audit.
- `src/catalog.ts`: module fields, lifecycle transitions and role permission templates.
- `src/app.tsx`: hydration, hash URL routes, guards and established application shell.
- `src/auth.tsx`, `src/admin.tsx`, `src/workflows.tsx`, `src/ui.tsx`: connected views and common components.
- `public/brand.css`, `public/redesign.css`, `public/application.css`: established styles and functional layouts.
- `original/redesign-v1-source/`: archived prototype; not bundled or routed.
- `tests/hospital.spec.js`: connected workflow verification.

Run `npm run typecheck`, `npm run build`, then `npm test` with the local server running. Edit TypeScript source, never the generated `public/app.js`. Record actual results and unresolved work in `LOG.MD` before handoff.


## Verified implementation baseline (2026-10-03)

The connected frontend baseline now has nine passing browser/service-boundary tests. Read `ACCEPTANCE.md` for the mapping to the 15 requested journeys and additional enabled lifecycles. The final `LOG.MD` entry records commands, corrections and current access instructions.

Keep these explicit limits visible: one service line per invoice and one medication per prescription; structured fictional specialty documentation; local simulated payer, recipient and platform decisions; no real medical integrations. These must not be described as production clinical capabilities.

Source is formatted with `npm run format`. `README.md` supersedes archived prototype access instructions. Any next phase must retain the supplied brand, persistent shared entities, permission enforcement and accurate evidence-based completion reporting.

## Offline version one — agreed scope, 2026-10-03

Authoritative briefs: OFFLINE-SPEC.md and PROFILE-PRESENCE-SPEC.md. Desktop, phone and tablet browsers; eight-hour offline access; at most 100 assigned/recent patients per user/facility (currently narrowed to the selected branch); five-minute inactivity lock. Sign-out clears the user cache and retains encrypted pending changes until authenticated sync. All clinical conflicts require review. Finance remains restricted to Hospital Owner, Hospital Admin and Billing Officer. Continue the existing component/service architecture and authentic Health ID brand.

Phase 1 implemented: AES-GCM encrypted IndexedDB snapshots/cache/outbox, password-unlocked scoped cache, status panel with health probes, local durable record queue, simulated idempotent sync receipts/retry, conflict preservation, safe service-worker shell cache, storage pressure notice, password-strength hints and center-cropped metadata-free profile images.

Phase 2 remains: clinical conflict resolution UI; duplicate-patient review; priority high-risk refresh; richer per-item status in clinical lists; dependency-aware media uploads; account/profile queue transport; session/privacy/presence settings and sounds; regulatory and credential review; full recovery hardening; manual image crop positioning. Preserve these requirements; do not mark the complete version-one brief delivered after Phase 1.

Phase 3 remains: real backend integration and encryption/key-management design, cross-device verification, complete failure matrix, mobile/tablet visual verification and deployment assessment. Local demonstration authority and encrypted device-held keys are not production server security.

## 2026-10-03 — Profile, security and presence phase implemented

The repeated additional-requirements brief is implemented in the existing React forms, service permission checks, shared PasswordInput, simulated code inbox and notification records. This entry supersedes the earlier profile/presence backlog items below the offline phase; the separate offline sync backlog remains open.

- Staff: adjustable square image crop (zoom and horizontal/vertical position), PNG re-encoding to remove source metadata, replace/remove/initials, personal display fields, language preference, sound preferences, pending-review professional credentials.
- Security: verified replacement email with current-password check; active sessions and revoke others; optional two-step sign-in through the existing code channel; simulated password/email change notices. Email/phone recovery returns neutral wording, enforces a local rolling request limit, requires an actually verified single-use recovery grant and invalidates sessions. Password changes/reset clear that user's local cache while retaining the encrypted record outbox.
- Invitations: redirect to My profile until the required password change; service checks also block workspace actions. Owner/Admin may initiate a simulated reset and review staff credentials; they never receive passwords.
- Facility: Owner/Admin-only identity, operations, departments/services/hours/beds and regulatory fields. Regulatory edits enter pending verification; non-regulatory edits save immediately. History records actor, changed fields and time. Existing trial dates remain unchanged by re-verification.
- Presence: same-facility avatars, status text in native assignment selectors, manual Online/Away/DND/Offline, optional status expiry, configurable idle period, 15-second heartbeat and 45-second timeout. Facility can disable presence or appearing offline. No presence history or colleague last-seen display.
- Sounds: original short synthesized tones, event choices, volume, quiet hours, clinical-view mute, interaction-only audio unlock, silent visual fallback, no reconnect backlog playback. Existing assignment and emergency-access notifications carry event metadata. Message/mention sounds are selectable for future events; no chat product was introduced.

Defaults used pending optional answers: all facility roles see presence; assignments/tasks audible, normal message/mention/alert tones off; critical clinical event tone under administrator override policy. Master mute, zero volume and patient-facing mute still take precedence. Language is a stored preference, not a newly translated interface. Preview security delivery and presence are local simulations; production transport remains in BACKEND-HANDOVER.md.

## 2026-10-03 — Shared feedback and overlay patterns

Source request: OVERLAY-SPEC.md. Runtime inventory and usage rules: UI-PATTERNS.md. Existing Button/Card/Form/Operation/ErrorBox/Badge/PasswordInput, onboarding stepper, subscription card, connection indicator and error boundaries remain the foundation. Added a shared toast host, Drawer/mobile sheet, confirmation/password dialog, Banner, Popover, Tooltip, Skeleton, EmptyState and navigation/unsaved-edit guard.

Applied to profile editing and saves; email reauthentication; staff access and invitation details/bulk actions; notification centre; record quick view, filters and document preview; subscription decisions and role-gated renewal notices; onboarding agreement decision/submission page; recovery confirmation; presence picker; passive connection summary and detailed sync drawer; aggregate sync completion; outage/sync/update banners. Ctrl/Cmd+K searches only authorized workspace destinations. Shared Form now links/focuses validation errors, distinguishes actual draft persistence from local editing and shows cancellable local attachment preparation.

Toasts use approved generic copy plus validated numeric counts; no freeform patient text or server errors. Maximum three, repeat merging, pause on hover/focus, persistent actionable errors and DND suppression. No independent toast sounds. Drawer decisions preserve mounted edits, suspend previous surfaces and never visually stack dialogs. Modal Cancel receives initial focus; destructive actions have outcome labels and confirmation words. Reduced-motion guards remain intact; overlays reserve space for the connection indicator.

This is a UI phase, not a backend rollout. Existing simulation boundaries and the separate offline transport/conflict/media backlog remain unchanged. Production finance data must be stripped server-side; the current workspace projection excludes subscription payloads for staff and the local simulation authority remains on the origin as documented.


## 2026-10-03 - Offline phase 2a: clinical conflict review

This supersedes the earlier "clinical conflict resolution UI remains" entry for the local-simulation scope. Reused the encrypted outbox, write lock, module permissions, shared Drawer/mobile sheet, Form and Banner. Current authorized clinical staff can review eligible conflicts created by colleagues in the selected hospital/branch. Ownership or administrative access alone grants no clinical review authority. Every record in a batch requires the reviewer's current view/edit permission; child records map to their existing clinical module. Unsupported/non-clinical or mixed-authority batches remain retained rather than gaining a permission bypass.

The review compares complete device and connected versions (including status), requires an explicit choice for every record and a 10-1,000-character reason, checks a fresh snapshot token and rejects changes since the review opened. The decision atomically persists both original snapshots, version history, selected records, encrypted queue completion, idempotency receipt and reviewer audit. Earlier work must complete first; later pending edits survive and are reviewed separately if divergent. Compatible later syncs retain the reviewed history. Record lists/details now show pending, conflict or received status.

Review forms keep their choices through connectivity loss. Submission requires a connection; changed session, branch or clinical access removes the open review's details. If cache refresh fails after a successful decision, the UI accurately reports the committed decision and the need to refresh the offline copy. Retrying does not duplicate the decision.

Next unfinished offline phases: duplicate-patient review; priority high-risk inbound refresh; resumable/dependency-aware media and account/profile transport; broader failure/device coverage; production integration. No real server sync or automatic clinical merging is claimed. See CONFLICT-REVIEW.md and BACKEND-HANDOVER.md.


## 2026-10-03 - Login presentation update

Compact auth logo (112px desktop, 104px smaller screens), aligned form column, clearer sign-in hierarchy, accessible 44px password eye control and dedicated recovery link. The shared password control isolates its input from the strength hint to keep the eye centred across auth/profile/lock surfaces. Existing Health ID assets and authentication behavior are preserved.


## 2026-10-03 - Shared workspace spacing rules

Keep sidebar wordmark at 112px (collapsed mark 24px). Do not reset margins on every direct child of .emr-main: components own their section spacing. Dashboard summary and workflow grid remain separated by 24px; workflow cards share internal spacing and align their action links. Tablet toolbars wrap instead of overflowing; summary tiles use two columns at narrow tablet widths. Shared list rows separate staff avatars from names.


## 2026-10-03 - Active UI simplification brief

Source: UI-SIMPLIFICATION-SPEC.md. Audit-first approval gate is explicit: finish the audit and wait for user approval before large restructuring. Audit and proposed matrix are now complete in UI-SIMPLIFICATION-AUDIT.md, UI-SCREEN-MAP.md, UI-MODULE-AUDIT.md and ROLE-PROVIDER-MATRIX.md/CSV. UI-RULES.md is a draft, not an implemented claim. No runtime changes or permission changes were made in this audit turn. Scope remains frontend production readiness only.
