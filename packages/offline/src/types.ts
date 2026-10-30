/**
 * Types the core adds around the frozen contract (contracts.ts).
 *
 * contracts.ts fixes what every caller relies on. These are the extra seams an
 * app needs to wire the runtime in: the transport it sends through, the build
 * variables it passes in, the one-time choice of amendment A5, and the hooks
 * for the HTTP client and for activity. The real runtime (createOfflineRuntime)
 * and the fake (testing.ts) both implement OfflineCore.
 */

import type {
  Connectivity,
  PatientIndexEntry,
  Json,
  OfflineRuntime,
  PolicyReason,
  ResponseMeta,
  StaffSessionSnapshot,
} from './contracts'

/** The raw build variables, passed in by the app. The core never reads `import.meta.env` itself. */
export interface OfflineEnv {
  /** VITE_HID_OFFLINE_MODE: `off`, `pilot` or `on`. Anything else is `off`. */
  readonly mode?: string | null
  /** VITE_HID_OFFLINE_FACILITIES: comma-separated facility UUIDs. */
  readonly facilities?: string | null
  /** VITE_HID_OFFLINE_HOSTS: comma-separated app hosts (`ehr`, `ocr`). */
  readonly hosts?: string | null
  /** VITE_HID_OFFLINE_DEBUG: `true` only in staging builds. */
  readonly debug?: string | null
}

/** One request the core asks the app's staff transport to make. */
export interface SendSpec {
  readonly method: 'GET' | 'POST' | 'PATCH' | 'PUT'
  readonly path: string
  readonly body?: Json
  readonly headers?: Readonly<Record<string, string>>
  readonly timeoutMs?: number
  readonly signal?: AbortSignal
  /** `none` for the public ping; everything else carries the session. */
  readonly auth?: 'required' | 'none'
}

export interface SendResult {
  readonly status: number
  readonly body: unknown
  /** The response `Date` header, when the browser exposes it. */
  readonly date: string | null
}

/**
 * A refused or failed request, as the core needs to classify it (§2.8). The
 * app's adapter turns its transport errors into this shape; see
 * `transportFromApiClient` in http.ts.
 */
export class TransportError extends Error {
  readonly status: number | null
  readonly code: string | null
  /** The response content type started with `application/problem+json`. */
  readonly problem: boolean
  readonly networkError: boolean
  /** From `Retry-After` or the problem's `retryAfter`, in milliseconds from now. */
  readonly retryAfterMs: number | null
  readonly body: unknown

  constructor(init: {
    status: number | null; code?: string | null; problem?: boolean; networkError?: boolean
    retryAfterMs?: number | null; body?: unknown; message?: string
  }) {
    super(init.message ?? (init.networkError ? 'network error' : `status ${init.status ?? 'none'}`))
    this.name = 'TransportError'
    this.status = init.status
    this.code = init.code ?? null
    this.problem = init.problem ?? false
    this.networkError = init.networkError ?? false
    this.retryAfterMs = init.retryAfterMs ?? null
    this.body = init.body
  }
}

export function isTransportError(error: unknown): error is TransportError {
  return error instanceof TransportError
}

/** The app's staff transport. Resolves for 2xx; rejects with TransportError otherwise. */
export type OfflineTransport = (spec: SendSpec) => Promise<SendResult>

/**
 * What the app should do after sign-in (amendment A5). Ask the runtime with
 * `offer(session)` once the staff session is ready, then call `attachSession`.
 *
 * - `unavailable`: say nothing (or the reason in the sync panel); call
 *   `attachSession(s, { optIn: false })`, which drops the in-memory key.
 * - `ask`: show the one-time choice "Keep an offline copy on this device
 *   (personal devices only)". Accept: `attachSession(s, { optIn: true })`.
 *   Decline: `attachSession(s, { optIn: false })`; nothing is written.
 * - `existing`: this account already has a vault for this facility here;
 *   `attachSession(s, { optIn: false })` opens it without asking again.
 * - `paused`: vaults exist on this device but this tab has no key (an online
 *   reload). Show "Offline use is paused on this tab: Unlock" and call
 *   `unlockLocked(password)` when the person unlocks.
 */
export type OfflineOffer =
  | { kind: 'unavailable'; reason: PolicyReason }
  | { kind: 'ask' }
  | { kind: 'existing' }
  | { kind: 'paused' }

/** The runtime as the app sees it: the frozen contract plus the wiring seams. */
export interface OfflineCore extends OfflineRuntime {
  /** What to show after sign-in (A5). Never writes anything. */
  offer(session: StaffSessionSnapshot): Promise<OfflineOffer>
  /** Wire into `ApiClientOptions.onResponseMeta`: feeds the clock, lease and connectivity. */
  onResponseMeta(meta: ResponseMeta): void
  /** The staff session is `ready` and not behind the lock overlay. The engine sends only then. */
  setSessionReady(ready: boolean): void
  /** Keydown, pointerdown, touchstart or wheel. Resets the 5-minute idle lock. */
  noteActivity(): void
  /** Page visibility changed. Hidden for 5 minutes locks. */
  noteVisibility(hidden: boolean): void
  connectivity(): Connectivity
  /** True when no command is `sending` in this origin's outbox (amendment A7; asks other tabs too). */
  updateSafe(): Promise<boolean>
  /**
   * Add or refresh a patient in the sealed offline index (100 per vault, least
   * recently opened dropped first). The contract's PatientIndex is read-only, so
   * the app calls this after an online `lookupPatient` or chart open.
   */
  rememberPatient(entry: PatientEntryInput): Promise<void>
  /**
   * Seal a file into the vault for an `ehr.document.upload` command (JPEG and
   * PNG are re-encoded first, which strips EXIF and GPS). Put the result in the
   * command input as `media`. Chunks are deleted once the upload is applied.
   */
  stageMedia(file: Blob, o: { index: number }): Promise<StagedMedia>
  /** A sign-out happened offline: send `/auth/logout` first on the next online load, then call `logoutSent()`. */
  logoutPending(): Promise<boolean>
  logoutSent(): Promise<void>
  /** Stop timers, listeners and the sender. The store is left as it is. */
  dispose(): void
}

export type PatientEntryInput = Pick<PatientIndexEntry, 'patientId' | 'displayName' | 'hidCode' | 'grantExpiresAt'>

/**
 * `commands.save` rejects with this when nothing was saved or the server
 * definitively refused the first attempt (§2.8 save path):
 * - `too-long`: the body is over 8000 bytes. Show "Too long to save; split it".
 * - `refused`: the first attempt got 400, 403, 404, 409 or 412, so nothing was
 *   applied; the command is removed and `cause` goes to the form as today.
 * - `unavailable`: no unlocked vault (send online instead).
 */
export class SaveRefused extends Error {
  readonly reason: 'too-long' | 'refused' | 'unavailable'
  override readonly cause: TransportError | null
  readonly bytes: number | null

  constructor(reason: SaveRefused['reason'], o: { cause?: TransportError | null; bytes?: number | null } = {}) {
    super(reason === 'too-long' ? 'Too long to save; split it' : reason === 'refused' ? 'The server refused this change' : 'Offline saving is not available')
    this.name = 'SaveRefused'
    this.reason = reason
    this.cause = o.cause ?? null
    this.bytes = o.bytes ?? null
  }
}

/**
 * CC4 safety hold (§2.9) for prescriptions. The app supplies it: `capture`
 * runs at save with what the form saw; `current` runs online just before the
 * first send. When the hashes differ (or there was nothing to compare), the
 * prescription is held for review. Without a probe, every prescription saved
 * offline or from data older than 15 minutes is held.
 */
export interface SafetyProbe {
  capture(input: Json): Promise<{ allergiesSha256: string; encounterRxSha256: string; seenAt: string } | null>
  current(input: Json, resolved: Record<string, string>): Promise<{ allergiesSha256: string; encounterRxSha256: string }>
}

/** PUT to a presigned storage URL (wrap `uploadPresignedObject` from @hid/http). */
export type MediaUploader = (o: { url: string; body: Blob; requiredHeaders: Readonly<Record<string, string>> }) => Promise<void>

/** Redacted diagnostics: codes and counts only, never content. */
export type OfflineReport =
  | { kind: 'defect'; op: string; status: number | null; code: string | null }
  | { kind: 'engine-error'; op: string; message: string }
  | { kind: 'audit-rejected'; dropped: number; code: string }
  | { kind: 'audit-refused'; status: number; code: string; events: number }
  | { kind: 'wipe'; reason: string }
  | { kind: 'storage'; message: string }

/** A file staged for an offline upload (Migrate capture, EHR documents). */
export interface StagedMedia {
  blobId: string
  mediaType: 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/tiff'
  sizeBytes: number
  sha256Hex: string
  fileName: string
}
