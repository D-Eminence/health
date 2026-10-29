Make Health ID — Hospital EHR work both online and offline, with a connectivity indicator that is purely informational and can never interrupt, block or break the user's work.

STEP 0: MATCH THE EXISTING SYSTEM
Before writing anything, inspect the codebase and reuse what is there: the data layer and API conventions, authentication and session handling, the permission system, the notification channels, the design tokens and component library, and any existing caching or offline behaviour. Do not introduce new patterns where one already exists. Choose whatever local persistence and sync approach best fits the way the system is already built, and tell me what you chose and why. If anything here conflicts with the existing architecture, follow the architecture and flag the conflict.

Use "Health ID" (never "HID") and "EHR" (never "EMR") in all user-facing text.

CORE PRINCIPLE
The app is offline-first. The interface always reads from and writes to local state first, and the network is a background concern. Losing or regaining connection must never cause an error screen, a lost entry, a logged-out user, a reload, or a frozen form.

CONNECTIVITY INDICATOR (informational only)
States:
- Online
- Slow connection (low bandwidth, high latency)
- Reconnecting
- Offline
- Syncing (with count of pending changes)
- Sync problem (needs attention)

Rules:
- Do not rely on the browser's online/offline flag alone. Confirm real reachability of the server with a lightweight health check, since a device can be "connected" with no working internet.
- Debounce and smooth state changes so unstable connections do not make the indicator flicker.
- The indicator must be passive: a small, unobtrusive element. No modal, no blocking toast, no page reload, no disabling of inputs. If the indicator component fails, the app must carry on as normal.
- Clicking it opens a small panel showing: connection state, time of last successful sync, number of changes waiting, what currently works offline, and a manual "Sync now" action.
- Use text or icon as well as colour, fully accessible, announced politely to screen readers, and never an alarming sound.
- Works on the login screen and every screen after it.

WHAT WORKS OFFLINE
Define this explicitly and tell me your proposed split before building. Starting proposal:

Available offline:
- Sign-in resume for users who already authenticated on this device (within a defined offline session window)
- View patients and records already cached on the device, with a visible "last updated" time
- Record visits, vitals, notes, and orders; register new patients; dispense and log lab results, all saved locally and queued
- Search within cached data
- Read the user's own profile and edit non-sensitive fields

Requires a connection (show a calm explanation and queue where safe):
- First-ever login on a device
- Password reset, email or phone verification, two-factor setup
- Uploading large documents and images (queue them and upload when connected)
- Cross-facility lookups, interoperability and external lab/pharmacy exchange (queue the request)
- Subscription and billing actions
- Anything needing a fresh authority check (for example verifying a new staff invitation)

LOCAL DATA AND SECURITY (healthcare data on a device is high risk)
- All locally stored data is encrypted at rest, scoped per user and per facility.
- Cache only what the user's role is permitted to see, and only the data likely to be needed (assigned patients, recent patients, today's appointments), not the whole database.
- Local data is cleared on sign-out, after repeated failed unlock attempts, and when an administrator deactivates the user. Deactivation takes effect on the device at next connection, and the offline session window limits exposure until then. Tell me the window you choose.
- Auto-lock on inactivity applies offline as well, with unlock requiring the user's credentials or the system's existing method.
- Note: an earlier instruction said not to keep personal data in browser storage. That rule applied to onboarding drafts. For this feature, encrypted local persistence is permitted only within the scope defined here. Reconcile the two and tell me how you did it.
- No sensitive data in logs, URLs, or analytics.

SYNC ENGINE
- Every offline change goes into a durable outbound queue that survives app close, refresh, crash, and device restart.
- Each queued change carries a client-generated unique ID, so retries are idempotent and a change is never applied twice.
- Sync in order where order matters, retry with backoff, and resume cleanly after interruption. A connection that drops mid-sync must leave data consistent.
- Record both the device timestamp and the server-received timestamp, and handle device clock drift. Clinical audit trails must show when something was actually entered and when it reached the server.
- Show per-item sync status where it matters (for example "Saved on this device, waiting to sync").
- Large or low-priority items (images, documents) sync after critical clinical data.

CONFLICTS (patient safety first)
- Clinical records are append-only and versioned. Never silently overwrite a clinical entry.
- If two people edit the same non-clinical field, use a clear rule (for example last write wins with history kept).
- If a conflict affects a clinical field (allergies, medications, diagnoses, orders), do not auto-resolve. Keep both versions, flag the record, and ask an authorised clinician to review.
- Duplicate patient creation offline is a real risk. On sync, detect likely duplicates and route them to a merge review instead of creating silent duplicates.
- Everything resolved or flagged is written to the audit log.

STALE DATA SAFETY
- Cached clinical data always shows its age. Allergy, medication and alert information that may be out of date should display a clear "last synced" marker.
- When the device reconnects, refresh high-risk data first (allergies, active medications, alerts) before lower-risk data.
- If a change made offline conflicts with newly arrived information (for example a new allergy was recorded elsewhere), notify the clinician promptly.

SUBSCRIPTION AND PRESENCE WHILE OFFLINE
- Subscription: trial and renewal status is derived from the server. A device that is offline must not lock staff out because it cannot confirm the subscription. Cache the last known entitlement with an expiry date, and keep working normally while it is within that window. All the earlier visibility rules still apply: only Owner, Admin and Finance roles ever see trial countdowns, renewal reminders or billing information. Staff must never see any hint of subscription state, including in the sync panel or error messages.
- An expired subscription must never block access to records needed for emergency care, online or offline.
- Presence: when offline, a user appears Offline to others after the heartbeat times out and returns to their previous state on reconnect. Sounds and notifications missed while offline appear in the notification list on reconnect without a burst of sounds.

SERVICE WORKER / APP SHELL
- The app must load and open with no connection after the first successful visit, including the sign-in screen for returning users.
- Handle app updates safely: never force a reload while there are unsynced changes or while a form is in progress. Show a gentle "update available" and apply it when safe.
- Handle storage limits gracefully: warn before the device runs out of space and prioritise clinical data over media.

FAILURE HANDLING
- No raw network error messages shown to users.
- A failed sync of one item must not block the rest of the queue.
- An item that repeatedly fails moves to a "needs attention" list with a plain-language reason and a retry action. It is never silently dropped.
- Never lose user input. Forms preserve their state through any connectivity change.

TESTING (include these as automated or documented tests)
- Go offline mid-form, mid-save, and mid-upload, then reconnect
- Rapidly flapping connection
- Slow and lossy network
- Two devices editing the same record offline, then syncing
- Offline duplicate patient registration
- Device clock set wrongly
- App closed and reopened with a full queue
- Session expiry and user deactivation while offline
- Storage nearly full
- App update released while changes are queued

OPEN QUESTIONS TO ASK ME BEFORE BUILDING
- Which modules must work offline in version 1, and which can follow later?
- How long may a device operate offline before it must reconnect (offline session window)?
- Which devices are in use: shared ward desktops, personal phones, tablets?
- How much patient data may be cached per device?
- Is there an existing definition of which fields are clinical and need conflict review?

DELIVERABLES
1. A summary of the existing architecture you found and the approach you chose for local persistence and sync
2. The connectivity indicator and its details panel
3. The local data layer, outbound queue and sync engine
4. Conflict handling and duplicate-patient review
5. Encryption, cache scope and data-clearing behaviour
6. App shell and safe update handling
7. The test plan above
8. A list of backend changes needed (idempotent endpoints, sync status, change feeds, conflict flags, server timestamps)
9. A phased rollout recommendation and a list of risks