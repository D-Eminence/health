# Offline-first contract (wave 1: EHR and Migrate)

This is the frozen engineering contract for the offline-first work. All three work streams build against it and against `packages/offline/src/contracts.ts`. Only the coordinator changes either file, by pull request into `offline/base`; propose changes in your issue.

Code references use two prefixes: `health:` is this repository; `hid:` is D-Eminence/hid-system branch `staging-novu-ci-20261005` (live).

## Coordinator amendments (these override anything below that disagrees)

**A1. There is no separate test backend.** `api.staging.healthidentitydirectory.com` has no server behind it, so the `*.staging.*` sites cannot be used for end-to-end tests. Every browser check in this document runs on the **production** hosts (`ehr.healthidentitydirectory.com`, `migrate.healthidentitydirectory.com`, `app.healthidentitydirectory.com`) inside the **sealed demo tenant** (Demo Hospital, Demo Laboratory, Demo Pharmacy, Demo Outreach, fictional patients; built by hid-system migration 0098). Demo facilities cannot reach real patients or real facilities. Wherever this document says "staging test facility", read "Demo Hospital"; wherever it says "staging test accounts", read "the demo logins the coordinator gives you privately". Never test with a real patient or a real facility.

**A2. Rollout shape.** Production ships with the offline block in `config/production.json` set to `mode: "pilot"` with **only the Demo Hospital facility** listed, so the first production release is usable by testers and invisible to every real facility. Real facilities are added only by a later config-only pull request, after the full test day. `config/staging.json` keeps `mode: "off"`.

**A4. Test cards run on production.** The Chrome-extension cards in section 2.15 run on the production hosts in Demo Hospital, not on staging builds. The debug panel (`VITE_HID_OFFLINE_DEBUG`) stays off in production, so testers simulate loss of connection with the browser's own switch (Developer tools, Network, Offline; or turning Wi-Fi off) and read state from the visible sync status. Automated tests (section 2.15 unit, integration and Playwright suites) run in CI as written.

**A5. Real facilities see nothing while the pilot runs.** In `pilot` mode the facility is unknown before sign-in, so:
- The sign-in page shows no offline checkbox. When the mode is not `off`, `prepareFromSignIn` still derives the KEK in memory during sign-in (invisible). After the session is ready, `attachSession` checks the facility: if it is in the pilot list and the device has no vault yet, the EHR shows a one-time choice "Keep an offline copy on this device (personal devices only)"; if the facility is not enabled, or the person declines, the KEK is dropped and nothing is written.
- `shell.ts` registers or updates the shell only after `attachSession` has opened a vault for an enabled facility. It then posts `{type:'HID_SHELL_ENABLE'}`.
- `/sw.js` precaches nothing at `install` and its `fetch` handler passes everything through unless a `health-id-shell-*` cache already exists. The first precache happens on `HID_SHELL_ENABLE`; on later `activate`, a worker that finds an older shell cache precaches its own build before deleting old generations. This keeps every existing push registration (patients on `app.`) behaving exactly as today.
- The Demo Hospital facility ID is `98d00002-0000-4000-8000-000000000001` (fixed by hid-system migration 0098). `config/production.json` gets `offline: { mode: "pilot", facilities: ["98d00002-0000-4000-8000-000000000001"], debug: false }`; `config/staging.json` gets `mode: "off"`.

**A6. Branches and pull requests.** The coordinator runs each stream as its own Claude Code session. Each session works on the branch its session gives it, starts from `offline/base` (health) or `staging-novu-ci-20261005` (hid-system), and opens a **draft** pull request into `offline/base` (health) or `staging-novu-ci-20261005` (hid-system). Stream A's `testing.ts` is merged into `offline/base` by the coordinator as soon as it is pushed, so Stream B can build on it. The Terraform escrow work (Stream C, D6) is held until the owner asks for it; C4 returns 503 until then.

**A3. Approved owner decisions.** D1 to D15 below were approved by the owner on 29 October 2026 ("Yes to D1-D15"). The pilot facility for testing is Demo Hospital; the first real pilot facility is named by the owner before it is switched on.

## Owner decisions (approved 29 October 2026)

| # | Decision |
|---|---|
| D1 | Encrypted offline safe in browsers allowed, opt-in per device, switched on facility by facility. |
| D2 | 8 h after the last connection, never more than 24 h after the last full sign-in; 100 patients per person per facility; 5-minute lock; 5 wrong passwords erase the readable copy; offline unlock by password only after a full online sign-in on that device. |
| D3 | Consent stays the master rule: cached charts readable only while the patient's access lasts; changes checked on arrival and held, never lost, if access ended. |
| D4 | Access "for this visit": 1, 4, 8 or 12 h (default 8 h at offline facilities); the patient sees the length before approving. PIN stays at most 60 min. |
| D5 | Break-glass (emergency) records are never written to a device. |
| D6 | Server-held spare key for unsent work (escrow), one new secret applied by Terraform, before the first real pilot. |
| D7 | Migrate offline = capture and encrypted upload into EHR documents; OCR reading stays online. |
| D8 | Offline is opt-in at sign-in; not on shared computers. |
| D9 | Unsent work of someone removed from a facility stays locked on that device for 30 days, then is deleted. |
| D10 | Patient notice and NDPA/DPIA addendum before the first real pilot. |
| D11 | CSP report-only first, enforced after 48 h without problems. |
| D12 | Pilot facility for testing: Demo Hospital (sealed). First real pilot facility named by the owner later. Lost devices: facility admin, then the owner. |
| D13 | Wave 2: patients opt in per phone, 7-day window, Google-only patients set an offline passcode of at least 8 characters. |
| D14 | Wave 3: pharmacy dispensing stays online until a claim safeguard exists; lab results entered offline are drafts only. |
| D15 | If something goes wrong, switch offline off; never roll the website back past the first offline release. |

# Engineering specification

## 2.0 Fix ledger: judge findings, and what this design does

| # | Finding (verified) | Resolution here |
|---|---|---|
| F1 | OCR job creation needs a `healthcare-operations` grant (`hid:services/ocr-api/src/ocr/dto/create-ocr-job.dto.ts:26`). The portal only gets `direct-care` grants (`health:docs/OPEN-QUESTIONS.md` "OCR purpose of use"). | Wave-1 Migrate is **capture plus encrypted upload into EHR documents only**. These are `direct-care` writes. No OCR operation is in the registry. |
| F2 | Consent is checked at sync, and live grants are short (PIN 5–60, DB-enforced, `0075…sql:69`; break-glass ≤ 240; access requests 5–1440, `0003…sql:76`). Writes get stranded. | Visit-length access requests (D4: portal change plus patient card shows the length). "Held for access" state with same-key resend after re-consent. Capture-time authorization is deferred (RLS `ehr.context_allows` uses now(), `0005…sql:24-44`, so it needs a migration and a security review). |
| F3 | Authorization runs before the idempotency replay (`hid:…/shared/clinical.repository.ts:54-77` before `:108`). | **BE C1: receipt lookup** (owner-scoped RLS, no consent, no migration). An "Outcome unknown, don't enter again" UI state. Lookup happens before any non-transient refusal of a command that was ever sent. |
| F4 | A queue sealed only by the password is destroyed by a password reset. | The queue key **QK** is wrapped twice: by the password KEK and by a server escrow key (**BE C4**: stateless HKDF from one new secret, no table). |
| F5 | The break-glass summary was written to disk. | `emergencyRecords`, and any read under `emergency` purpose or a `breakGlass: true` authorization, is **memory only**. |
| F6 | The body was not frozen; a replay gives 409 `IDEMPOTENCY_KEY_REUSED` (`requestDigest = sha256(op + "\n" + stableJson(payload))`, `hid:services/ehr-api/src/common/idempotency.ts`). | All timestamps are captured at save. Method, path, body and headers are frozen in one IndexedDB transaction before the first send and never recomputed. |
| F7 | Guard-rail work was under-budgeted. | Stream C owns explicit changes to `eslint.config.js:19-50`, `scripts/check-launch-build.mjs` (`WORKER_REFUSALS`, `inspectServiceWorker`, chunk rule), `docs/ARCHITECTURE.md:898-946`, `pushWorker.test.ts` and `launchBuildShell.test.ts` (§2.13). |
| F8 (security) | Not shippable in days: device keys, signed envelopes, hash chain, snapshot API, security-definer change. | **Dropped.** Per-vault sequence numbers give gap detection. Reads fill from audited online reads. There is no snapshot endpoint and no SQL change. |
| F9 (clinical) | Migration 0098 plus security-definer consent at action time, and server parking, in wave 1. | **Dropped from wave 1.** Keyed PATCH (A1) is kept as a code-only stretch (it reuses `ehr.idempotency_keys`). Parking moves to a later migration. |
| F10 | Production has **no CSP** (`health:infra/cloudflare/src/frontend-worker.mjs:40-42`). | CSP report-only in wave 1, enforced after 48 h (D11). |

## 2.1 Facts the design rests on

- Every EHR clinical table has FORCE row-level security calling `ehr.context_allows`, which calls `identity.has_active_consent_grant` at the current time (`0005…sql:24-44, 304-…`).
- `ehr.idempotency_keys`:
  - unique on `(facility_id, created_by, operation, idempotency_key)`; rows are never deleted (`0004…sql:366-394, 524`);
  - RLS is owner-only (`0005…sql:408-414`);
  - `executeCreate` replays a completed key with the stored resource, ignoring `expires_at` (`clinical.repository.ts:108-155`).
- Upload-intent replays with the same key return the same document and a **fresh** 300-second presigned URL (`hid:services/ehr-api/src/documents/document.service.ts:49-127`). Media types: pdf, jpeg, png, tiff. Maximum 52,428,800 bytes.
- PATCH routes take no key: encounters, notes, diagnoses, prescriptions, lab requests (their controllers). 412 means `VERSION_CONFLICT`.
- `audit.events` (`0003…sql:210-279`):
  - `event_id uuid unique default …` can be set by the caller;
  - it has `occurred_at` and `recorded_at`, with the check `recorded_at >= occurred_at`, plus `source_system` and `source_event_id`;
  - table-level `grant insert … to hid_audit_writer` (`runtime-grants.sql:435`);
  - the patient access log maps `ehr.record.read` to "viewed" (`0093…sql:715-724`).
- The browser calls the same origin `/api/v1/*`. The Worker forwards all headers except a fixed deny-list (`frontend-worker.mjs:183-220`). The gateway (nginx) passes request headers through.
- The WAF refuses request bodies over 8 KB with a 403 that is not problem+json (`health:apps/patient-web/src/profileParity.ts:22-28`, `EDGE_BODY_MAX_BYTES = 8000`).
- The transport never retries non-idempotent methods (`health:packages/http/src/retry.ts`).
- The staff client is `createRegisteredBrowserClient` (`staff/api.ts:1202`), so every new path must be in `packages/contracts/src/registry.ts`.
- `keyHeaders()` makes a fresh UUID when no key is passed (`staff/api.ts:1389`). Upload intent passes none.
- Staff login accepts 6+ character passwords (legacy). New passwords are 12–256 (`hid:services/identity-api/src/auth/password-hash.ts:12-15`).
- `ehr-api` `/health` is not under `/api/v1`, so the browser cannot reach it (gateway). A ping route is needed.
- Platform control keys are fixed by a CHECK constraint (`0039`, `0086`). A new kill-switch key needs a migration, so the wave-1 flag is config-based.
- Config is turned into per-app `VITE_HID_*` variables in `scripts/build-staging.py`, with a strict shape check in `scripts/staging_release.py`.

## 2.2 Components and seams

```
health:
  packages/offline/                    @hid/offline (new workspace package; UI-agnostic, reused by the future blue EHR)
    src/contracts.ts                   FROZEN Day 0 by coordinator (§2.16)
    src/store.ts                       ONLY file allowed to touch indexedDB
    src/crypto.ts                      ONLY file allowed subtle.deriveKey/wrapKey/unwrapKey/generateKey/importKey/exportKey
    src/vault.ts  clock.ts  lease.ts  policy.ts  cache.ts  receipts.ts  audit.ts  media.ts
    src/outbox/{engine.ts,freeze.ts,lanes.ts,classify.ts,backoff.ts}
    src/connectivity.ts  broadcast.ts  storageHealth.ts
    src/react.tsx                      OfflineProvider + hooks
    src/testing.ts                     in-memory fake runtime (same interface) for UI tests
  packages/http/src/client.ts          + ApiClientOptions.onResponseMeta (no new fetch)
  apps/patient-web/src/staff/offline/  Stream B: registry.ts (EHR/Migrate ops), ehrReads.ts, ehrCommands.ts,
                                       documentCommands.ts, screens and components
  apps/patient-web/src/offline/shell.ts  Stream C: registers /sw.js for the shell, update channel
  apps/patient-web/public/sw.js        Stream C: push handlers unchanged + shell install/activate/fetch/message
hid (ehr-api):  src/offline/{offline.module.ts, offline.controller.ts, offline.service.ts, dto/*}  (Stream C)
```

## 2.3 Policy, feature flag, kill switch

**Config** (`health:config/{staging,production}.json`, new block; validated in `scripts/staging_release.py`, passed per app in `scripts/build-staging.py`):
```json
"offline": { "mode": "off", "hosts": ["ehr", "ocr"], "facilities": [], "debug": false }
```
This produces Vite variables, read by name in `publicEnvironment.ts`:
- `VITE_HID_OFFLINE_MODE` (`off|pilot|on`);
- `VITE_HID_OFFLINE_FACILITIES` (comma-separated UUIDs);
- `VITE_HID_OFFLINE_HOSTS` (set only for apps in `hosts`; every other app is built with mode `off`);
- `VITE_HID_OFFLINE_DEBUG` (`true` is allowed only in `staging.json`; the launch check refuses it in production).

**Effective policy (client)** is enabled only when all of these hold:
```
mode != 'off' && appHost in hosts && (mode == 'on' || session.facilityId in facilities)
  && user ticked "Keep an offline copy on this device" (or an existing vault for this account+facility unlocked)
  && the password typed at sign-in has length >= 12
```
Otherwise the reason is shown in the sync panel. For a short password: "Change your password to 12+ characters to use offline".

**Kill switch.** Release a config with `mode: "off"` (or remove the facility) through the normal frontend pipeline. On the next online load the client:
1. refuses offline unlock;
2. stops filling the cache;
3. wipes every vault's readable cache and the shell caches;
4. keeps **sending** pending commands online until empty, then deletes the vaults.

Pending clinical work is never discarded by the kill switch.

Emergency levers that need no release:
- platform control `uploads_enabled=false` pauses the media lane (409 is transient);
- `provider_portal_enabled=false` stops all staff portals.

Rollback rule (D15): do not roll back to a pre-offline release. If forced, pending work stays sealed on devices until roll-forward.

## 2.4 Device storage format (IndexedDB)

One database per origin: `health-id-offline`, `version 1` (`ehr.` and `migrate.` are separate origins, each with its own database). All binary values are stored as `Uint8Array` or `ArrayBuffer`. Envelopes:

```ts
type Envelope = { v: 1; k: 'dk' | 'qk'; iv: Uint8Array /*12*/; ct: ArrayBuffer /*ciphertext+16B tag*/ }
```

| Store | Primary key | Plaintext fields (must be non-identifying) | Sealed payload |
|---|---|---|---|
| `meta` | `'device'` | `{v, deviceId(uuid), deviceSalt(16B), kdf:{alg:'PBKDF2-SHA256', iterations, calibratedAt}, failedUnlocks, lastFailureAt}` | none |
| `vaults` | `vaultId` (uuid) | `{v, vaultId, appHost, createdAt, wraps:{dk:Wrap, ik:Wrap, qkPw:Wrap, qkEsc?:Wrap&{keyVersion}}, lease:{signedInAt, lastServerContactAt, leaseUntil, serverOffsetMs, lastWallSeen}, counters:{cmdSeq, auditSeq}, flags:{logoutPending, escrow:boolean, killed}, pending:{commands, audit, mediaBytes}, header: Envelope(dk)}` | header: `{accountId, membershipId, email, displayName, facilityId, facilityName, permissions[], session: StaffSessionSnapshot}` |
| `cache` | `[vaultId, tag]` | `{pt (patient tag, indexed), kind:'session'\|'index'\|'grant'\|'read', bytes, savedAt}` | the cached value |
| `outbox` | `[vaultId, seq]` | `{laneTag, state, priority, attempts, nextAttemptAt, dependsOn:number[], everSent, updatedAt, bytes}` | `Command` (QK) |
| `audit` | `[vaultId, seq]` | `{state:'pending'\|'acked', bytes}` | `OfflineAuditEvent` (QK) |
| `media` | `[vaultId, blobId, chunkNo]` | `{chunkCount, bytes}` | 1 MiB chunk (QK) |
| `receipts` | `[vaultId, commandId]` | `{appliedAt}` | `Receipt` (QK); kept 30 days |

**Tags and caps**
- `tag = b64url(HMAC-SHA256(IK, logicalKey))`.
- `pt = b64url(HMAC-SHA256(IK, 'patient|' + patientId))`.
- `laneTag = b64url(HMAC-SHA256(IK, lane))`.
- Logical keys: `session`, `index|patients`, `grant|<patientId>`, `read|<method>|<sha256(stableJson(args))>`.
- At most **5 vaults per origin**. A 6th evicts the oldest vault with nothing pending. If every vault has pending work, offline is refused on this device.

**Never stored anywhere:**
- the password, PIN, TOTP, recovery codes, tokens, cookies, invitation links;
- break-glass or emergency reads;
- document bytes from the server;
- email, HID, names or patient IDs in plaintext;
- any `localStorage` or `sessionStorage` key beyond today's portal hint.

**Schema migration table (client)**

| DB version | Change | Upgrade rule |
|---|---|---|
| 1 | Stores above | Created fresh |
| 2+ (future) | Additive stores or indexes only | `onupgradeneeded` must never touch `outbox`, `audit` or `media` records. An unknown newer `v` on a record leaves it unread and kept. A downgrade (older app) refuses to open a higher DB version and shows "Update Health ID". |

## 2.5 Cryptography

**Keys**

| Key | Type | Purpose | Wrapped by |
|---|---|---|---|
| **DK** | AES-GCM-256 | cache and header (disposable data) | KEK_pw |
| **IK** | HMAC-SHA-256 | tags | KEK_pw |
| **QK** | AES-GCM-256 | outbox, audit, media, receipts (must survive a password reset) | KEK_pw **and** ESC_v |

**Generation and unwrapping**
- Keys are generated with `generateKey(…, extractable: true)` inside `crypto.ts` only.
- They are immediately `wrapKey('raw', …, {name:'AES-GCM', iv, additionalData})` and then dropped.
- Each unlock uses `unwrapKey(…, extractable: false)`, so raw key bytes never reach JS after creation.

**KEK_pw (staff)**
```
salt = SHA-256( "hid-offline-kek/v1" ‖ 0x00 ‖ deviceSalt ‖ 0x00 ‖ UTF8(trim(email).toLowerCase()) )
KEK  = PBKDF2(hash=SHA-256, iterations=meta.kdf.iterations, salt) → AES-GCM-256, non-extractable, usages [wrapKey, unwrapKey]
```
- One derivation per unlock, then trial-unwrap of each vault's `dk` wrap (cheap). No email tag is stored.
- **Iterations:** 600,000 by default. Calibrated once per device: time 50,000 iterations and project. If 600,000 would take more than 2.5 s, use `max(310000, round10k(600000 × 2.5 / projected))`. The value is stored in `meta.kdf`.
- Offline is enabled only if the typed password has length ≥ 12.
- `prepareFromSignIn` starts the derivation while the server sign-in runs. It keeps no reference to the password string afterwards (JS cannot zero strings; this is documented).
- The KEK stays in memory only while unlocked, to open sibling vaults on a facility switch. It is dropped on lock.

**ESC_v (escrow, BE C4)**
- The server returns 32 bytes: `HKDF-SHA256(ikm = OFFLINE_ESCROW_KEY_v, salt = "hid-offline-escrow/v1", info = accountId|membershipId|facilityId|vaultId)`.
- The client imports it non-extractable, wraps QK with it, and never stores it.
- After a password reset, the next online sign-in:
  1. fails the `dk` unwrap;
  2. fetches ESC;
  3. unwraps QK;
  4. generates a new DK and IK (the cache is wiped);
  5. re-wraps everything under the new KEK.

**AAD (UTF-8)**
- Key wraps: `hid-offline/v1|wrap|<vaultId>|<dk|ik|qk>|<pw|esc:<v>>`.
- Records: `hid-offline/v1|<vaultId>|<store>|<primaryKeyJoinedBy'|'>`.
- Media chunks: `hid-offline/v1|<vaultId>|media|<blobId>|<chunkNo>|<chunkCount>|<fileSha256Hex>`. This stops swapping, reordering and truncation.

**IVs:** 96-bit random per encryption. Message counts are far below 2³².

**Media:** JPEG and PNG are re-encoded through `createImageBitmap` and `OffscreenCanvas` (strips EXIF and GPS; longest side ≤ 3000 px; JPEG quality 0.85). PDF and TIFF are kept as they are. SHA-256 is computed **after** re-encoding.

**Honest limit:** this protects a locked or stolen device and other accounts on the same profile. It does not protect against malicious same-origin script while unlocked; that is the CSP's job.

## 2.6 Unlock, lock, lease, clock, wipe

**Trusted clock**
- Each authenticated response passes through `onResponseMeta`: `offset = Date(header) + rtt/2 − Date.now()`.
- The anchor is held in tab memory: `{serverMs, perf0}`.
- `trustedNow = max(serverMs + (performance.now() − perf0), Date.now() + offset)`. Taking the max means a lease can never look longer than it is.
- Clock states:
  - `anchored`: this tab has seen a server `Date`.
  - `wall`: no anchor; use `Date.now() + storedOffset`.
  - `suspect`: the wall clock is more than 5 minutes behind `vault.lease.lastWallSeen` or behind the anchor.
- `lastWallSeen` is updated every 60 s while unlocked.

**Lease**
- `leaseUntil = min(lastServerContactAt + 8 h, signedInAt + 24 h)`.
- `lastServerContactAt` moves forward on every authenticated 2xx.
- Offline unlock is refused if `trustedNow ≥ leaseUntil` or the clock is `suspect`.

**Unlock paths**

| Situation | Behaviour |
|---|---|
| Online sign-in | KEK derived in parallel. After MFA and a ready session, `attachSession` opens the vault (or creates it if opted in and enabled), fetches escrow, registers the shell. |
| Online reload with a valid cookie | Works exactly as today (online). A quiet banner says "Offline use is paused on this tab: Unlock". Writes go straight online until the user unlocks. |
| Offline cold start (`auth/session` gives a network error or 502 `API_ORIGIN_UNAVAILABLE`) and a vault exists | **Offline sign-in** screen (email and password). Success restores the sealed `StaffSession` with `mode:'offline'`. Today this path ends in `error` (`staff/App.tsx:301-330`). |
| Idle ≥ 5 min (no keydown, pointerdown, touchstart or wheel) or hidden ≥ 5 min | Lock: keys are dropped in **all tabs** (BroadcastChannel `health-id-offline`). Forms stay mounted under the existing inert lock overlay. The password is needed to reopen. |
| Hidden 60 s–5 min | Live behaviour: a server check when online. Offline, it reopens with no password. |
| Connectivity returns while working offline | Background `refresh()`. A 401 that cannot be refreshed locks the vault and asks for an online sign-in. A missing facility (membership ended) wipes the cache, and the queue becomes `held_membership`. |

**Wipe triggers.** These wipe the *cache* only (DK data and the header). Outbox, audit, media and receipts are kept.
- Sign-out: online, or offline with `logoutPending = true`. On the next online load, `/auth/logout` is sent first (`signOutStaffSession`).
- 5 consecutive failed offline unlocks on the device (all vaults' caches).
- Lease expiry.
- Membership ended or account disabled.
- Kill switch.
- Per patient: grant expiry by trusted clock, `closeGrant`, an online 403 `CONSENT_REQUIRED` on that patient, a `breakGlass` authorization, LRU eviction past 100.

A vault with nothing pending after sign-out is deleted entirely.

## 2.7 Read cache

**Allowlist (wave 1)** in `staff/offline/ehrReads.ts`:
- `lookupPatient` (only the HID already in the index), `consentStatus`;
- `encounters` (first 2 pages), `encounter`, `records` (each kind, page 1);
- `noteRevisions`, `vitalCorrections`;
- `documents` (metadata);
- `reportedHealthProfile`;
- `labReleasedResultsForOrder` (direct-care only).

**Never cached:**
- `emergencyRecords`, anything with purpose `emergency` or `breakGlass: true`;
- `importedRecords`, `importedAttachment`, `documentDownload`;
- shares, chat, staff, audit, billing, order-route and incoming lists.

**Readable only when all of these hold:** unlocked ∧ `trustedNow < leaseUntil` ∧ clock ≠ suspect ∧ `grant.readAllowed` ∧ `trustedNow < grant.expiresAt`. The grant comes from `consentStatus` or the `lookupPatient` authorization.

**Network first**
- Wait 4 s. On timeout, network error, 502, 503 or 504, show the readable cached copy with `<CachedNotice savedAt>` ("Saved copy from 10:42 on this device").
- The request continues for up to the transport's 15 s and refreshes the view if it returns.
- A successful online answer replaces the cached value, sealed.

**"Keep available offline" (chart button, online only)**
- Fetches `consentStatus`, the latest 3 encounters, each with the 5 record kinds (page 1), `reportedHealthProfile` and document metadata.
- Concurrency 2. All are normal audited reads.
- No automatic bulk prefetch.

**Caps:** 2 MB per patient; 50 MB total cache per vault (LRU).

**Pending overlay:** record lists merge this lane's pending commands as rows labelled "Saved on this device, not sent yet". They are never written into the cache as server truth.

**Offline open audit:** one `OfflineAuditEvent` per patient section open. The same patient and section within 10 minutes is merged (this matches the server's 10-minute grouping).

## 2.8 Command protocol

**Key:** `Idempotency-Key: off1.<uuid-v4>` (41 characters; matches `^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$`). It is fixed for the command's life.

**Extra headers on every replayed write** (BE C3 records them; they are never required):
- `X-HID-Offline-Command: off1.<uuid>`
- `X-HID-Captured-At: <ISO-8601 UTC ms>`
- `X-HID-Clock: anchored|wall|suspect`

**Registry (wave 1).** `E = /api/v1/ehr/patients/{patientId}/encounters`. All bodies are the live DTOs (same shape the live `staffApi` sends). Every body is ≤ 8000 bytes, checked at save.

| op | Method and path | Version field | Class on conflict | Notes |
|---|---|---|---|---|
| `ehr.encounter.create` | POST `E` | — | CC3 | Opens lane `f:p:local:<cmdId>`; `startedAt` is captured at save |
| `ehr.note.create` | POST `E/{eid}/clinical-notes` | — | CC3 | |
| `ehr.vital.create` | POST `E/{eid}/vitals` | — | CC3 | `recordedAt` captured at save |
| `ehr.diagnosis.create` | POST `E/{eid}/diagnoses` | — | CC3 | |
| `ehr.prescription.create` | POST `E/{eid}/prescriptions` | — | CC3, **CC4 safety hold** | |
| `ehr.lab-request.create` | POST `E/{eid}/lab-requests` | — | CC3 | |
| `ehr.note.revise` | POST `E/{eid}/clinical-notes/{nid}/revisions` | `expectedRowVersion` | CC2 | |
| `ehr.vital.correct` | POST `E/{eid}/vitals/{vid}/corrections` | `expectedRowVersion` | CC2 | |
| `ehr.prescription.to-pharmacy` | POST `E/{eid}/prescriptions/{id}/pharmacy-work-item` | `expectedRowVersion` | CC2/CC3 | "Not at the pharmacy yet" |
| `ehr.lab-request.to-lab` | POST `E/{eid}/lab-requests/{id}/lab-work-item` | `expectedRowVersion` | CC2/CC3 | "Not at the lab yet" |
| `ehr.encounter.update` | PATCH `E/{eid}` | `expectedRowVersion` | CC2 (412 re-read check) | Key sent (A1-ready) |
| `ehr.note.update` | PATCH `E/{eid}/clinical-notes/{nid}` | `expectedRowVersion` | CC2 | Server stamps `signed_at` |
| `ehr.diagnosis.update` | PATCH `E/{eid}/diagnoses/{id}` | `expectedRowVersion` | CC2 | |
| `identity.grant.close` | POST `/api/v1/identity/consent-grants/{gid}/close` | — | "already closed" counts as applied | Declared naturally idempotent; the patient is removed locally first |
| `ehr.document.upload` | composite: POST `/api/v1/ehr/documents/upload-intents` (keyed) → PUT presigned → POST `/api/v1/ehr/documents/{id}/complete` | — | CC3/CC5 | Media lane. Safe file name `scan-YYYYMMDD-HHmm-<n>.<ext>` (no patient names). An expired URL means replaying the intent with the same key for a fresh URL. Chunks are deleted once applied. |

Prescription and lab-request status PATCH stay ONLINE in wave 1 (downstream versions; `OPEN-QUESTIONS.md` "Lab request changes after Lab accepts").

**Command record (sealed with QK)**
```ts
interface Command {
  v: 1; id: string; key: `off1.${string}`; op: OpName; opVersion: 1
  scope: { accountId: string; membershipId: string; facilityId: string; patientId: string; purpose: 'direct-care' }
  input: Json                                   // what the form produced
  refs: Record<string, { local: string } | { server: string }>   // e.g. encounterId
  frozen?: { method: 'POST' | 'PATCH' | 'PUT'; path: string; body: Json; bytes: number; headers: Record<string,string>; frozenAt: string }
  intent?: Record<string, Json>                 // PATCH: fields that define "already applied"
  dependsOn: string[]; lane: string; priority: 0 | 1 | 2   // 0 clinical, 1 audit, 2 media
  capturedAt: string; clock: ClockState
  safety?: { allergiesSha256: string; encounterRxSha256: string; seenAt: string }
  grantAtCapture?: { expiresAt: string; grantId?: string }
  state: 'queued'|'sending'|'applied'|'held_access'|'held_session'|'held_membership'|'review'|'discarded'
  everSent: boolean; attempts: number; nextAttemptAt: number
  lastProblem?: { status: number; code?: string; problem: boolean; at: string }
  receipt?: Receipt; review?: { class: ConflictClass; openedAt: string }
  supersedes?: string                           // id of the command this one replaces after review
}
interface Receipt { commandId: string; resourceType: string; resourceId: string; rowVersion?: number;
  status: number; replay: boolean; serverDate: string; via: 'response' | 'lookup' | 'reread' }
```

**Save path (same code online and offline when the policy is enabled)**
1. Validate with the same rules as the form. Check bytes ≤ 8000; if over, show inline "Too long to save; split it".
2. In **one IndexedDB transaction**: put the outbox record (`queued`). Only then does the UI say "Saved on this device".
3. If online, the engine sends at once, and the UI waits up to **8 s**:
   - **2xx:** show as saved, exactly like today.
   - **Definitive refusal on the first attempt** (400, 403, 404, 409, 412 with no earlier send): nothing was applied, because DTO validation and authorization run before any write. The command is removed and the error goes to the form as today (`useFieldProblems`).
   - **Still unknown:** "Saved on this device, sending…".
4. Edit or cancel is allowed only while `everSent = false`, in one transaction. After that, a change is a new command (a revision, correction or update).

**Engine**
- **One sender per vault:** `navigator.locks.request('health-id-offline:send:<vaultId>')`. Other tabs only add commands and listen.
- **Eligible:** state `queued`, or `sending` with an unknown outcome; every `dependsOn` is `applied`; it is the lowest unfinished `seq` in its lane; `nextAttemptAt ≤ now`; the staff session is ready (status `ready`, lock `null`); connectivity is not `offline`.
- **Concurrency:** up to 3 clinical lanes at once. Media runs one at a time and only while clinical lanes are idle; it pauses when `navigator.connection.saveData` is set.
- **Freeze:**
  1. resolve refs and `{"$ref":"<cmdId>.id|rowVersion"}` placeholders from receipts;
  2. run the safety hold (CC4) for prescriptions saved offline or from cached data older than 15 min;
  3. write `frozen`, `everSent = true`, `attempts++` in one transaction;
  4. send through the staff transport (`client.request`; `NO_RAW_FETCH` stays).
- **Backoff:** full jitter, `min(300 s, 2 s × 2^(attempts−1)) × random()`. `Retry-After` and `HidApiError.retryAt` win. Reset when connectivity returns. No attempt limit for transient failures. After 30 minutes the item shows "Still trying".

**Failure classification (status + problem code + content type)**

| Answer | Class | Action |
|---|---|---|
| 2xx | applied | Store the receipt from the body (`id`, `rowVersion`), update the overlay |
| network error, timeout, 408, 425, 429, 5xx (incl. Worker 502 `API_ORIGIN_UNAVAILABLE`, 503 audit unavailable), 409 `REQUEST_IN_PROGRESS`, document 409 `CONFLICT` (in progress or uploads disabled) | transient | Back off and replay the same frozen request |
| 401; 403 `STAFF_MFA_REQUIRED` | session | Pause the vault (`held_session`), prompt sign-in. Do not copy hid `classifySyncFailure` (`hid:packages/offline/src/index.ts:58-63`) |
| 403 problem+json `CONSENT_REQUIRED`, `ACCESS_DENIED`, `PERMISSION_DENIED` | access | Receipt check if sent before → `held_access` (CC5) |
| 403 **not** problem+json, 413 | edge | CC7 "Too long to send" (should be prevented at save) |
| 400 (`BAD_REQUEST`, `INVALID_CLINICAL_DATA`, `IDEMPOTENCY_KEY_REQUIRED`), 409 `IDEMPOTENCY_KEY_REUSED` | invalid | CC7, plus a redacted error report (a defect) |
| 409 `IDEMPOTENCY_RESULT_UNAVAILABLE` | applied, unreadable | Receipt check, then mark applied |
| 404 `*_NOT_FOUND` | missing | Receipt check, then CC3 |
| 412 `VERSION_CONFLICT` | version | For PATCH sent before: re-read; if `intent` matches the current state, applied (`via:'reread'`); otherwise CC2 |
| 409 `INVALID_*_TRANSITION`, `CLINICAL_CONFLICT`, `INVALID_CLINICAL_REFERENCE` | state | Receipt check if sent before, then CC3 |

**Receipt-check rule (fixes F3).** Before any non-transient refusal of a command whose earlier attempt had an unknown outcome:
- `POST /api/v1/ehr/offline/receipts/lookup {keys:[key]}` returns `completed` → applied (`via:'lookup'`);
- `processing` → transient;
- `unknown` → proceed with the class.

If the lookup itself is unreachable, the item stays "Sent, waiting for confirmation. Don't enter it again."

## 2.9 Conflict classes and review flow

Review is done by the **author only** in wave 1, because the queue lives in the author's vault. The server enforces current permission on whatever the author does next. The review drawer groups a blocked lane ("This visit and 4 entries could not be sent"). Every resolution needs a reason of at least 8 characters, except "Send now".

| Class | Trigger | What the author sees | Actions |
|---|---|---|---|
| CC1 Outcome unknown | Sent, no answer, lookup unreachable | "Sent, waiting for confirmation" | None. Re-entry is discouraged. |
| CC2 Version | 412 | Side by side: "Your change" (frozen body) and "Current record" (fresh online read) | **Apply on top** (new command, new key, new `expectedRowVersion`, `supersedes`); **Discard** |
| CC3 State | Parent closed, record entered in error, missing reference | What changed | **Attach to a new visit** (new commands); **Discard** |
| CC4 Safety hold | Patient-reported allergies or medications, or this visit's prescriptions, changed since capture | The new allergy and medication information next to the pending prescription | **Send as is (I have checked)**, which keeps the same key since it was never sent; **Edit** (allowed, never sent); **Discard** |
| CC5 Access | 403 consent after receipt check | "Access to this patient ended at 14:10" | **Ask for access again** (online flow; auto-resumes once `consentStatus.writeAllowed`, same key and body as a late entry); **Discard** |
| CC6 Session | 401 or MFA | Banner, no per-item review | Sign in |
| CC7 Cannot send | 400, edge, defect | Plain reason | **Edit as new** (allowed because nothing was applied); **Discard** |
| CC8 Membership ended | The session no longer lists the facility | "You no longer work at X. These N changes cannot be sent." | Kept sealed 30 days (D9) |

**Discard** sets state `discarded`. The frozen body is kept sealed on the device for 30 days ("Discarded on this device"). An audit event `ehr.offline.command.discarded` is sent with `{op, reason, bodySha256, capturedAt}`.

**Both versions are kept:**
- the server's version is the live record plus its `record_versions` history;
- the device's version is kept for 30 days, with its hash in server audit.

Server-side parking of the losing version needs a migration (§2.14).

## 2.10 Backend API contracts (ehr-api, code-only, no migration)

**Common to all four endpoints**
- Same-origin cookie session, staff context.
- Headers: `X-Facility-ID`, `X-Purpose-Of-Use: direct-care`, `X-CSRF-Token` on POST.
- Permission: any of `ehr.encounter.read` or `ehr.document.write` (add a small any-of guard if `@RequirePermissions` is all-of).
- `Cache-Control: no-store`.
- Problem+json errors, using the existing `problem.ts`.
- Register each path in `health:packages/contracts/src/registry.ts`, as `proposed` on Day 0 and `surface-verified` once released.

**C0. `GET /api/v1/ehr/offline/ping`** (`@Public @NoAudit`)
200: `{"service":"ehr-api","serverTime":"2026-10-29T10:42:00.123Z"}`. Used by the connectivity probe and the clock on the sign-in screen.

**C1. `POST /api/v1/ehr/offline/receipts/lookup`**
```json
{ "keys": ["off1.0b5c…", "off1.9e2f…"] }                        // 1..50, each matches the key regex
```
200:
```json
{ "receipts": [ { "key": "off1.0b5c…", "operation": "encounter.create", "state": "completed",
                  "resourceType": "encounter", "resourceId": "uuid", "responseStatus": 201,
                  "createdAt": "…", "completedAt": "…" } ],
  "unknown": ["off1.9e2f…"] }
```
- Reads `ehr.idempotency_keys` inside `withTransaction(context)`. The owner RLS limits rows to this account, membership and facility.
- No consent check. No patient ID or clinical content in the response.
- Errors: 400 `INVALID_KEYS`, 401, 403.
- Audit: `ehr.offline.receipts.lookup` with `{requested, found}`.
- Stream C lists, in `docs/INTERFACE_CONTRACT.md`, the `operation` string used by every keyed route in the registry (including the `pharmacy-work-item` and `lab-work-item` handoffs). A route that does not use this table is reported, and the client falls back to re-read for it.

**C2. `POST /api/v1/ehr/offline/audit-events`** (≤ 20 events per call, to stay under 8 KB)
```json
{ "vaultId": "uuid",
  "events": [ { "eventId": "uuid", "seq": 41, "action": "ehr.record.read", "patientId": "uuid",
                "section": "encounters", "resourceId": null, "occurredAt": "2026-10-29T09:12:03.120Z",
                "clock": "anchored", "grantExpiresAt": "2026-10-29T17:00:00Z" } ] }
```
- **Allowed actions:**
  - `ehr.record.read` (patient required);
  - `ehr.offline.unlock`;
  - `ehr.offline.wipe` (`section` = reason);
  - `ehr.offline.command.discarded` (patient required; `details` has `op`, `reason`, `bodySha256`, `capturedAt`).
- **Allowed sections:** `consent | encounters | encounter | clinical-notes | vitals | diagnoses | prescriptions | lab-requests | documents | note-revisions | vital-corrections | reported-health | lab-results | summary`.
- **Insert into `audit.events`:**
  - `event_id` = eventId;
  - `occurred_at` = clamp(occurredAt, now−26 h, now);
  - actor, membership and facility from context;
  - `resource_type` = `offline-chart-section` or `offline-session`;
  - `outcome` = `success`, `purpose_of_use` = `direct-care`, `provenance` = `application`;
  - `source_system` = `health-id-offline`, `source_event_id` = `<vaultId>:<seq>`;
  - `details` = `{offline:true, vaultId, seq, section, clock, deviceOccurredAt, clamped, grantExpiresAt}`.
- Uses `ON CONFLICT (event_id) DO NOTHING`. The ingest itself is never consent-gated.
- 200: `{"accepted":["…"],"duplicate":["…"],"rejected":[{"eventId":"…","code":"INVALID_ACTION|PATIENT_NOT_FOUND|INVALID_EVENT"}]}`.
- The client deletes an event once it is accepted or duplicate. A rejected event is kept for 7 days and then dropped with a local wipe-style report.

**C3. Offline headers.** `request-context.ts` parses `X-HID-Offline-Command`, `X-HID-Captured-At` and `X-HID-Clock`. If invalid they are ignored; they never cause a refusal. The values are added to `DataAccessContext.offline`. `ClinicalRepository.record()` and `DocumentService.auditEvent` merge `details.offline = {commandId, capturedAt, clock, capturedClamped}` into the existing write audits. A capture time outside [now−24 h, now+5 min] is recorded with `capturedClamped: true`.

**C4. `POST /api/v1/ehr/offline/escrow-key`**
```json
{ "vaultId": "uuid", "keyVersion": null }
```
- 200: `{"keyVersion":1,"key":"<b64url 32 bytes>","algorithm":"HKDF-SHA256"}`.
- 503 `OFFLINE_ESCROW_UNAVAILABLE` when `OFFLINE_ESCROW_ENABLED != true`.
- 404 `OFFLINE_ESCROW_VERSION_UNKNOWN`; 429 at more than 30 per hour per account.
- Secret source: `OFFLINE_ESCROW_KEYS` (JSON `{"1":"<b64url32>"}`). Terraform wiring follows the B6 web-push pattern: a runtime secret key, a `offline_escrow_enabled` tfvar and a guardrail. The previous version is kept 30 days after rotation.
- Audit: `ehr.offline.escrow-key.issue` (no patient).

**A1 (stretch, code-only, not a wave-1 dependency): keyed PATCH.**
- An optional `Idempotency-Key` on the encounter, note and diagnosis PATCH routes.
- Inside the existing `run()` transaction: insert into `ehr.idempotency_keys` (`operation` = `encounter.update` and so on), then on conflict compare the digest:
  - a different digest gives 409 `IDEMPOTENCY_KEY_REUSED`;
  - a completed key returns 200 with the current resource and the header `Idempotent-Replay: true`, skipping the 412 check.
- Without a key, behaviour is unchanged. The client already sends the key, so A1 needs no client change.

## 2.11 Audit reconciliation

- **Online reads that fill the cache** are audited by the server as today. The server always knows what reached a device.
- **Offline opens** are recorded locally (QK-sealed, monotonic `seq` per vault, never deleted before acknowledgement, surviving sign-out and wipe). C2 ingests them on reconnect. They appear in the patient's access log as "viewed", ordered by device time.
- **Replayed writes** get the normal create or update audit plus `details.offline` (C3). The record keeps both clinical time (`recordedAt`/`startedAt` from the device) and server `created_at`.
- **Gap detection:** per `details.vaultId`, the `seq` values must be contiguous. The coordinator's daily pilot query (staging and production read access as today):
```sql
select details->>'vaultId' vault, min((details->>'seq')::int), max((details->>'seq')::int), count(*)
from audit.events where source_system = 'health-id-offline' and recorded_at > now() - interval '1 day'
group by 1 having max((details->>'seq')::int) - min((details->>'seq')::int) + 1 <> count(*);
```
  Plus counts of `clamped` and `clock='suspect'` per facility, and `ehr.offline.command.discarded` reasons.
- **Residual risk:** offline re-opens on a device that never comes back are lost. The underlying online reads are still in the log.

## 2.12 Service worker, update, CSP

**`/sw.js`**
- Keeps the existing `push` and `notificationclick` handlers byte-for-byte.
- Adds `install`, `activate`, `fetch` and `message`.
- **Cache name:** `health-id-shell-<build>`. Never `hid-…`, because `/service-worker.js` deletes those caches.
- **Precache:** `index.html` (fetched with `cache:'reload'`) and every built `assets/*` file. The list is injected at build by a Vite plugin in `apps/patient-web/vite.config.ts` that replaces `self.__HID_SHELL__ = null`.

**Fetch rules**
- Same-origin `GET` only.
- **Never** handle `/api/`, `/sw.js` or `/service-worker.js`.
- `mode:'navigate'`: network first with a 4 s timeout, then the cached `/index.html`.
- `/assets/*`: cache first.
- Manifest and icons: cache first.
- Everything else passes through.

**Nothing user-specific is ever in Cache Storage.** The shell is identical for every user.

**Update**
- No automatic `skipWaiting`.
- The page shows "A new version of Health ID is ready". The **Update now** button is enabled only when no form is dirty (the `useUnsavedGuard` registry) and no command is `sending` in any tab (BroadcastChannel query).
- The click posts `{type:'HID_SKIP_WAITING'}`, then waits for `controllerchange` and reloads **that** tab.
- Other tabs show "Updated in another tab: reload when ready".
- `activate` deletes old `health-id-shell-*` caches only when no client is still on them; otherwise it keeps one previous generation.

**Registration:** `apps/patient-web/src/offline/shell.ts` registers `/sw.js` (`scope:'/'`, `updateViaCache:'none'`, the same as `pushDevice.ts:131`) only once the policy is enabled for this host. In mode `off`, it posts `HID_PURGE_SHELL` (delete shell caches). It never unregisters, because push may use the same registration.

**CSP** (Worker, HTML responses only, all apps): `Content-Security-Policy-Report-Only` with this starting set:
```
default-src 'self'; script-src 'self' https://static.cloudflareinsights.com https://challenges.cloudflare.com;
connect-src 'self' https://cloudflareinsights.com <document-storage-origin>; frame-src https://challenges.cloudflare.com;
img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; worker-src 'self'; manifest-src 'self';
object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'
```
- Add Google Identity Services on the `web` app only, and the Sentry ingest if a DSN is set.
- Violations are read from the console with the Chrome extension on every host (there is no report endpoint in wave 1).
- Enforce after 48 h clean (D11).

## 2.13 Guard-rail changes (all in the Stream C shell PR unless noted)

- **`eslint.config.js`:**
  - `NO_INDEXED_DB` is lifted only for `packages/offline/src/store.ts` (Stream A).
  - A new rule `NO_KEY_HANDLING` (`subtle.(deriveKey|deriveBits|wrapKey|unwrapKey|exportKey|importKey|generateKey)`) is lifted only for `packages/offline/src/crypto.ts` (Stream A).
  - `NO_SERVICE_WORKER` is also lifted for `apps/patient-web/src/offline/shell.ts`.
  - `NO_CACHE_STORAGE` is lifted for `apps/patient-web/public/sw.js` (add `caches` to its globals).
  - `NO_BROWSER_STORAGE` is unchanged.
- **`scripts/check-launch-build.mjs`:**
  - `WORKER_EVENTS` adds `install`, `activate`, `fetch`, `message`.
  - Replace the blanket fetch, `caches` and `.data` refusals with these rules:
    - sw.js must contain the literal `'/api/'` exclusion guard;
    - it must not contain `indexedDB`, `localStorage`, `sessionStorage`, `importScripts`, `XMLHttpRequest` or `WebSocket`;
    - `.data` is allowed only as `event.data?.type` inside the `message` listener;
    - caches are opened only with the `health-id-shell-` prefix;
    - the injected asset list must be a subset of the dist files.
  - The chunk rule: any chunk referencing `serviceWorker` registers only `/sw.js` (pushDevice and shell chunks).
  - Refuse `HID_OFFLINE_DEBUG` in production builds.
- **Tests:** update `pushWorker.test.ts` (push still reads nothing and stores nothing) and `launchBuildShell.test.ts` (new allowed shapes, plus new refusals: caching `/api/`, a `hid-` cache name, a missing exclusion).
- **`docs/ARCHITECTURE.md` PHI section** (`:898-946`): rewrite to describe the vault and shell exceptions, citing D1.
- **`frontend-worker.mjs`:** the CSP report-only header, with `worker-src` and `manifest-src` as the existing comment already asks.
- **Build config:** `scripts/build-staging.py`, `scripts/staging_release.py` and `scripts/test_staging_release.py` for the `offline` block.

## 2.14 Database migrations

**Wave 1: none.** This avoids the full cycle each of 0093–0097 took (runtime grants, PG16 proof, ledger, manifest, declaration).

Later work (each is a full migration cycle):

| Later migration | Adds | Wave |
|---|---|---|
| 0098 `offline_platform_control` | `offline_enabled` control key (server kill switch); optional PIN duration up to 240 min (if D3 is revisited) | 2 |
| 0099 `offline_parked_commands` | Server parking of refused commands with both versions and cross-staff review (target `CONFLICT-REVIEW.md`) | 2–3 |
| 0100 `pharmacy_offline_claims` | Claim or lease of a work item per device, so two devices cannot dispense the same item | 3+ |
| 0101 `consent_at_capture` | Security-definer and RLS change to authorize at clamped capture time within a server lease | Needs security review; not scheduled |

## 2.15 Test matrix (automated, plus Chrome-extension cards on staging)

**Automated (vitest)**
- crypto round-trips and AAD swap detection;
- KEK calibration;
- vault create, unlock, lock, wipe;
- lease and clock (rollback, forward jump, anchor);
- freeze immutability;
- every row of the classification table;
- receipt-check path;
- PATCH re-read;
- lanes, dependencies, head-of-line blocking;
- 8 KB guard;
- Web Lock single sender (two engines);
- outbox survives "restart" (new runtime on the same store);
- escrow re-wrap after a password change;
- break-glass never cached;
- no plaintext scan (serialize every store and search for patient name, HID, note text).

**Chrome-extension cards (staging).** Each staging build has `VITE_HID_OFFLINE_DEBUG=true`. Open the debug panel with `?offline-debug=1`. Network simulation offers Offline, Flapping (5 s) and Slow (+3 s). "Storage report" lists counts and runs a plaintext scan for strings you type.
- **T1** Sign in with the opt-in ticked. Open a chart, choose Keep offline, simulate Offline, reload. You get the offline sign-in, and the chart shows "Saved copy from".
- **T2** Save a visit, note, vitals and prescription offline. Restore the network. All are applied once, and there is no duplicate after a second reload.
- **T3** Go offline mid-save and mid-upload, then reconnect. No loss, no duplicate.
- **T4** Flapping for 2 minutes with 10 queued items. All end applied.
- **T5** Edit the same note on two browsers offline, then sync. The second gets CC2 and the review shows both versions.
- **T6** Allergy added on browser B while A has a pending prescription. A shows the CC4 hold.
- **T7** Grant expires while offline. The chart becomes unreadable and is removed from storage. The note is held (CC5). After re-request it is sent with the same key.
- **T8** Idle 5 minutes. The workspace locks and the password is required. A form in progress keeps its text.
- **T9** 5 wrong offline passwords. The cache is wiped and pending is kept (storage report).
- **T10** Sign out offline. On the next online load `/auth/logout` is sent first, and pending is still sent after sign-in.
- **T11** Device clock moved back 10 minutes. Offline unlock is refused.
- **T12** Storage report scan for the patient's name, HID and note text gives 0 plaintext matches.
- **T13** Emergency access. Nothing is cached (storage report).
- **T14** A note over 8 KB is refused at save with a split message.
- **T15** Migrate: photo of a page offline. EXIF is absent in the uploaded object (download and check online), and chunks are gone after apply.
- **T16** A new build is deployed while items are pending. The banner shows and Update is disabled until synced; no automatic reload.
- **T17** Kill switch config on staging. Cache and shell caches are wiped, and pending is still sent.
- **T18** CSP report-only. Collect console violations on `ehr.`, `migrate.` and `app.`.
- **T19** Facility removed from the pilot list. Treated as the kill switch for that facility.
- **T20** Audit: the facility audit page shows `ehr.record.read` with offline details, and the patient's "who opened my record" shows the views.

**Real-device cards** (a human toggles Wi-Fi):
- **R1** low-end Android: unlock in under 3 s;
- **R2** iPhone Safari installed to the Home Screen: `persist()` result shown;
- **R3** shared ward PC: two accounts, no cross-access.

## 2.16 Contracts file (coordinator commits on Day 0 to `offline/base`)

```ts
// packages/offline/src/contracts.ts — FROZEN. Change only by coordinator PR.
export const OFFLINE_SCHEMA = 1 as const
export const DB_NAME = 'health-id-offline'
export const CHANNEL = 'health-id-offline'
export const KEY_PREFIX = 'off1.'
export const LIMITS = {
  leaseMs: 8 * 3600_000, absoluteMs: 24 * 3600_000, idleLockMs: 5 * 60_000, hiddenRecheckMs: 60_000,
  maxPatients: 100, maxVaultsPerOrigin: 5, maxFailedUnlocks: 5, minPasswordLength: 12,
  maxBodyBytes: 8000, mediaFileMaxBytes: 20 * 1024 * 1024, mediaVaultMaxBytes: 250 * 1024 * 1024,
  chunkBytes: 1024 * 1024, cachePatientMaxBytes: 2 * 1024 * 1024, cacheVaultMaxBytes: 50 * 1024 * 1024,
  receiptKeepMs: 30 * 86400_000, discardedKeepMs: 30 * 86400_000, membershipEndedKeepMs: 30 * 86400_000,
  clockRollbackMs: 5 * 60_000, networkFirstMs: 4000, receiptWaitMs: 8000,
  backoffBaseMs: 2000, backoffCapMs: 300_000, clinicalLanes: 3, auditBatch: 20,
  pbkdf2Default: 600_000, pbkdf2Floor: 310_000, pbkdf2TargetMs: 2500,
} as const

export type OfflineMode = 'off' | 'pilot' | 'on'
export type PolicyReason = 'mode-off' | 'host-off' | 'facility-off' | 'not-opted-in' | 'password-too-short' | 'unsupported-browser'
export interface OfflinePolicy { mode: OfflineMode; enabled: boolean; reason?: PolicyReason }

export type ClockState = 'anchored' | 'wall' | 'suspect'
export type Connectivity = 'online' | 'slow' | 'reconnecting' | 'offline'
export type VaultStatus = 'none' | 'locked' | 'unlocked' | 'expired'
export type LockReason = 'idle' | 'hidden' | 'manual' | 'session' | 'lease' | 'clock'
export type WipeReason = 'sign-out' | 'failed-unlocks' | 'lease' | 'membership' | 'kill-switch' | 'account'
export interface SyncSummary {
  connectivity: Connectivity; vault: VaultStatus; leaseUntil: string | null; clock: ClockState
  pending: number; sending: number; attention: number; lastSyncAt: string | null; escrow: boolean
  storage: { usageBytes: number | null; quotaBytes: number | null; persisted: boolean | null; low: boolean }
}

export interface StaffSessionSnapshot { actorId: string; accountId: string; membershipId: string; email: string
  displayName: string; facilityId: string; facilityName: string; permissions: string[]; session: unknown }
export interface GrantState { patientId: string; readAllowed: boolean; writeAllowed: boolean; expiresAt: string | null
  grantId?: string | null; breakGlass: boolean; observedAt: string }
export interface PatientIndexEntry { patientId: string; displayName: string; hidCode: string; lastOpenedAt: string
  grantExpiresAt: string | null; pendingCount: number }

export type UnlockResult = { ok: true; summary: SyncSummary }
  | { ok: false; reason: 'wrong-credentials' | 'lease-expired' | 'clock-suspect' | 'no-vault' | 'wiped' }

export interface OfflineRuntime {
  policy(): OfflinePolicy
  prepareFromSignIn(email: string, password: string): void
  attachSession(s: StaffSessionSnapshot, o: { optIn: boolean; online: true }): Promise<SyncSummary>
  unlockOffline(email: string, password: string): Promise<UnlockResult>
  unlockLocked(password: string): Promise<UnlockResult>
  restoreSession(): StaffSessionSnapshot | null
  lock(reason: LockReason): void
  signOut(o: { online: boolean }): Promise<void>
  wipe(reason: WipeReason): Promise<void>
  hasVaults(): Promise<boolean>
  trustedNow(): { at: Date; clock: ClockState }
  summary(): SyncSummary
  subscribe(listener: () => void): () => void
  reads: CachedReads; commands: CommandQueue; audit: OfflineAudit; review: ReviewQueue; patients: PatientIndex
}

export interface CachedResult<T> { value: T; source: 'network' | 'cache'; savedAt: string | null }
export interface CachedReads {
  read<T>(spec: { method: string; args: readonly unknown[]; patientId: string; network: () => Promise<T>; emergency?: boolean }): Promise<CachedResult<T>>
  setGrant(g: GrantState): Promise<void>; dropPatient(patientId: string): Promise<void>
  keepOffline(patientId: string, fetchers: readonly (() => Promise<unknown>)[]): Promise<void>
}
export interface PatientIndex { list(): Promise<PatientIndexEntry[]>; search(q: string): Promise<PatientIndexEntry[]> }

export type OpName =
  | 'ehr.encounter.create' | 'ehr.note.create' | 'ehr.vital.create' | 'ehr.diagnosis.create'
  | 'ehr.prescription.create' | 'ehr.lab-request.create' | 'ehr.note.revise' | 'ehr.vital.correct'
  | 'ehr.prescription.to-pharmacy' | 'ehr.lab-request.to-lab' | 'ehr.encounter.update' | 'ehr.note.update'
  | 'ehr.diagnosis.update' | 'identity.grant.close' | 'ehr.document.upload'
export type Json = null | boolean | number | string | Json[] | { [k: string]: Json }
export type Ref = { local: string } | { server: string }
export interface OpDefinition<I = Json> {
  op: OpName; opVersion: 1; method: 'POST' | 'PATCH'; keyed: true | 'natural'
  lane(i: I): { patientId: string; visit: Ref | 'patient' | 'media' }
  refs(i: I): Record<string, Ref>
  path(i: I, resolved: Record<string, string>): string
  body(i: I, resolved: Record<string, string | number>): Json
  versionField?: 'expectedRowVersion' | 'expectedVersion'
  receipt(responseBody: unknown): { resourceType: string; resourceId: string; rowVersion?: number }
  intent?(i: I): Record<string, Json>
  reread?(i: I, resolved: Record<string, string>): Promise<unknown>
  safety?: 'prescription'
  media?: { blobId: string; mediaType: string; sizeBytes: number; sha256Hex: string; fileName: string }
}
export type CommandOutcome<V> = { kind: 'applied'; value: V; receipt: Receipt } | { kind: 'saved'; commandId: string }
export interface Receipt { commandId: string; resourceType: string; resourceId: string; rowVersion?: number
  status: number; replay: boolean; serverDate: string; via: 'response' | 'lookup' | 'reread' }
export interface CommandQueue {
  register(defs: readonly OpDefinition<any>[]): void   // eslint-disable-line @typescript-eslint/no-explicit-any
  save<V>(op: OpName, input: Json, o?: { awaitMs?: number; dependsOn?: string[] }): Promise<CommandOutcome<V>>
  edit(commandId: string, input: Json): Promise<void>      // only while never sent
  cancel(commandId: string): Promise<void>                  // only while never sent
  pendingFor(patientId: string, visit?: Ref): Promise<PendingView[]>
  syncNow(): void
}
export interface PendingView { commandId: string; op: OpName; state: string; capturedAt: string; label: string; input: Json }
export type ConflictClass = 'CC1' | 'CC2' | 'CC3' | 'CC4' | 'CC5' | 'CC6' | 'CC7' | 'CC8'
export interface ReviewQueue {
  list(): Promise<{ commandId: string; class: ConflictClass; laneBlocked: number; patientId: string; op: OpName }[]>
  resolve(commandId: string, action: 'apply-on-top' | 'new-visit' | 'send-as-is' | 'edit-as-new' | 'ask-access' | 'discard',
    o: { reason?: string; input?: Json }): Promise<void>
}
export interface OfflineAuditEvent { eventId: string; seq: number; action: 'ehr.record.read' | 'ehr.offline.unlock'
  | 'ehr.offline.wipe' | 'ehr.offline.command.discarded'; patientId: string | null; section: string | null
  resourceId: string | null; occurredAt: string; clock: ClockState; grantExpiresAt: string | null; details?: Json }
export interface OfflineAudit { recordOpen(patientId: string, section: string, resourceId?: string): void }

// HTTP (ehr-api, §2.10)
export const OFFLINE_PATHS = {
  ping: '/api/v1/ehr/offline/ping', receipts: '/api/v1/ehr/offline/receipts/lookup',
  audit: '/api/v1/ehr/offline/audit-events', escrow: '/api/v1/ehr/offline/escrow-key',
} as const
export const OFFLINE_HEADERS = { command: 'X-HID-Offline-Command', capturedAt: 'X-HID-Captured-At', clock: 'X-HID-Clock' } as const

// Transport hook (packages/http)
export interface ResponseMeta { method: string; path: string; status: number | null; date: string | null
  problem: boolean; code: string | null; networkError: boolean; authenticated: boolean }
```
