// packages/offline/src/contracts.ts — FROZEN. Change only by coordinator PR.
export const OFFLINE_SCHEMA = 1 as const
export const DB_NAME = 'health-id-offline'
export const CHANNEL = 'health-id-offline'

// Update-safe query on CHANNEL (coordinator amendment A7). The shell asks before activating a waiting
// service worker; every tab whose outbox has a command in state `sending` answers `safe:false`.
// No answer within 500 ms means nothing is sending.
export interface UpdateSafeQuery { type: 'update-safe-query'; id: string }
export interface UpdateSafeAnswer { type: 'update-safe'; id: string; safe: boolean }
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
export type PolicyReason = 'mode-off' | 'host-off' | 'facility-off' | 'not-opted-in' | 'password-too-short' | 'unsupported-browser' | 'device-full'
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
