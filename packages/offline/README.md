# @hid/offline

The UI-agnostic offline core for Health ID: an encrypted vault in the browser, a read cache, an outbox that sends
saved changes at most once, receipts, an offline audit trail and staged media. EHR and Migrate use it now; the patient
portal and the rebuilt Health ID Hospital EHR can use it later. The frozen contract is
[`docs/OFFLINE-CONTRACT.md`](../../docs/OFFLINE-CONTRACT.md) and [`src/contracts.ts`](src/contracts.ts).

## Entry points

| Import | What |
|---|---|
| `@hid/offline` | `createOfflineRuntime`, `transportFromApiClient`, the contract types, `OfflineCore` and its seams (`src/types.ts`) |
| `@hid/offline/react` | `OfflineProvider`, `useOffline`, `useSyncSummary`, `useCachedRead`, `usePending`, `useReview` |
| `@hid/offline/testing` | `createFakeOfflineRuntime` (in memory, same interface, scripted server, virtual clock) and `createMemoryLocks` |

## Wiring it into an app

```ts
const runtime = createOfflineRuntime({
  appHost: 'ehr',                                   // or 'ocr' for Migrate
  env: { mode: import.meta.env.VITE_HID_OFFLINE_MODE, facilities: import.meta.env.VITE_HID_OFFLINE_FACILITIES,
         hosts: import.meta.env.VITE_HID_OFFLINE_HOSTS, debug: import.meta.env.VITE_HID_OFFLINE_DEBUG },
  transport: transportFromApiClient(staffClient),
  upload: o => uploadPresignedObject({ url: o.url, body: o.body, requiredHeaders: o.requiredHeaders }),
})
// The HTTP client feeds the trusted clock, the lease and connectivity:
createApiClient({ ..., onResponseMeta: meta => runtime.onResponseMeta(meta) })
```

Sign-in (amendment A5):

1. On submit, `runtime.prepareFromSignIn(email, password)`. When the mode is not `off`, the key is derived in memory
   while the server sign-in runs. Nothing is written.
2. Once the staff session is ready, `await runtime.offer(session)`:
   - `ask`: show "Keep an offline copy on this device (personal devices only)", then
     `attachSession(session, { optIn: accepted, online: true })`;
   - `existing`: `attachSession(session, { optIn: false, online: true })` opens the vault without asking again;
   - `paused` (an online reload, no password in this tab): show "Offline use is paused on this tab: Unlock" and call
     `unlockLocked(password)` when the person unlocks;
   - `unavailable`: `attachSession(session, { optIn: false, online: true })` drops the key; nothing is written.
3. `runtime.setSessionReady(status === 'ready' && lock === null)` whenever the staff session changes. The outbox only
   sends while this is true.
4. On an offline cold start with `await runtime.hasVaults()`, show the offline sign-in and call `unlockOffline`.
5. On load, if `await runtime.logoutPending()`, send `/auth/logout` first, then `runtime.logoutSent()`.

Wrap the app in `<OfflineProvider runtime={runtime}>`: it reports keydown, pointerdown, touchstart, wheel and page
visibility for the 5-minute lock.

## What is stored, and how

One IndexedDB database per origin, `health-id-offline` version 1 (contract §2.4), opened only by `src/store.ts`.
A device that never opts in has no database.

| Store | Plaintext (non-identifying) | Sealed |
|---|---|---|
| `meta` | device id, device salt, PBKDF2 iterations, failed-unlock count | nothing |
| `vaults` | vault id, app host, key wraps, lease times, counters, flags, pending counts | header (the staff session snapshot), DK |
| `cache` | HMAC tag, HMAC patient tag, kind, size, times | the cached value, DK |
| `outbox` | seq, HMAC lane tag, state, attempts, next attempt, size | the command (input, frozen request, receipt), QK |
| `audit` | seq, state, size | the offline audit event, QK |
| `media` | blob id, chunk number and count, size | 1 MiB chunk, QK, media AAD |
| `receipts` | command id, applied time | the receipt, QK |

Never stored: the password, PIN, TOTP, recovery codes, tokens, cookies, break-glass or emergency reads, document bytes
downloaded from the server, and any name, email, HID or patient id in plaintext (the storage-scan test checks this).
Nothing is written to `localStorage`, `sessionStorage` or Cache Storage.

Keys (`src/crypto.ts`, the only key-handling file): a KEK from PBKDF2-SHA-256 over the password (600,000 iterations,
calibrated down to no less than 310,000 on slow devices) wraps DK (cache), IK (tags) and QK (queue). QK is also
wrapped by a server escrow key so a password reset never loses unsent work. Keys are non-extractable once unwrapped.
Every record's AAD names its vault, store and primary key, so a record moved anywhere else fails to open.

## Threat limits

This protects a locked or stolen device and other accounts on the same browser profile. It does **not** protect
against malicious script running on the same origin while the vault is unlocked; that is the job of the CSP. JavaScript
cannot zero a string, so the password lives in memory until the key derivation finishes. A device whose clock is moved
back more than 5 minutes refuses offline unlock; expiry of a patient's access is judged by trusted time, which never runs
behind real time. Offline opens on a device that never comes back online are lost (the online reads that filled the
cache are still in the server's audit log).

## Adding an operation

1. Add the op name to `OpName` in `contracts.ts` (coordinator change) and to the server's operation table.
2. Write an `OpDefinition` in the app's registry (`apps/patient-web/src/staff/offline/registry.ts`):
   - `lane(input)`: the patient and the visit (`{ local: cmdId }` for a visit saved offline, `{ server: id }`,
     `'patient'` or `'media'`);
   - `refs(input)`: every id it needs, as `{ local }` or `{ server }` refs; a local ref makes it wait for that command;
   - `path` and `body`: the live DTO, built from `resolved` ids. Capture every timestamp at save time in the input,
     never in `body`, so the frozen body never changes. Use `{"$ref":"<cmdId>.rowVersion"}` for a version from a
     receipt;
   - `receipt(body)`: the resource type, id and row version from the 2xx answer;
   - for a PATCH: `intent(input)` (the fields that mean "already applied") and `reread(input, resolved)` (a fresh online
     read), so a 412 after an unknown outcome can be recognised as applied;
   - `safety: 'prescription'` for the CC4 hold; supply a `SafetyProbe` to the runtime to compare allergies and
     prescriptions at send time.
3. `runtime.commands.register([...])` at start-up.
4. Bodies over 8,000 bytes are refused at save with "Too long to save; split it".
5. Add a test with the fake (`@hid/offline/testing`) for the screen, and one with the real runtime for any new
   classification or lane behaviour.
