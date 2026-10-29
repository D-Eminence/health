/**
 * An in-memory fake of the offline runtime for UI tests (Stream B and later
 * apps). It implements the same OfflineCore interface as the real runtime but
 * keeps everything in memory, sends through a scripted fake server, and runs on
 * a virtual clock, so tests are deterministic and need no IndexedDB, crypto or
 * timers.
 *
 * Controls simulate: offline, flapping, slow, 412, 403 (problem or edge),
 * receipt-found, a clock rollback, grant expiry and a CC4 safety change.
 *
 * Not for production: nothing here is encrypted. Import it from
 * `@hid/offline/testing` in tests only.
 */

import {
  KEY_PREFIX,
  LIMITS,
  type CachedResult,
  type ClockState,
  type CommandOutcome,
  type ConflictClass,
  type Connectivity,
  type GrantState,
  type Json,
  type LockReason,
  type OfflineAuditEvent,
  type OfflinePolicy,
  type OpDefinition,
  type OpName,
  type PatientIndexEntry,
  type PendingView,
  type Receipt,
  type Ref,
  type ResponseMeta,
  type StaffSessionSnapshot,
  type SyncSummary,
  type UnlockResult,
  type VaultStatus,
  type WipeReason,
} from './contracts'
import { classify, isDefinitiveFirstRefusal, needsReceiptCheck } from './outbox/classify'
import { freeze, resolveRefs, sizeAtSave, stableJson, type Frozen, type ResolvedRef } from './outbox/freeze'
import { evaluatePolicy, facilityAllowed, parseOfflineEnv, passwordLongEnough } from './policy'
import {
  SaveRefused,
  TransportError,
  type OfflineCore,
  type OfflineEnv,
  type OfflineOffer,
  type PatientEntryInput,
  type StagedMedia,
} from './types'

export const DEMO_HOSPITAL_FACILITY_ID = '98d00002-0000-4000-8000-000000000001'

export interface FakeRequest {
  readonly commandId: string
  readonly op: OpName
  readonly method: string
  readonly path: string
  /** The body exactly as it would go on the wire (`JSON.stringify` of the frozen body). */
  readonly bodyText: string
  readonly headers: Readonly<Record<string, string>>
  readonly attempt: number
}

export interface FakeResponse {
  readonly status: number | null
  readonly body?: unknown
  readonly code?: string
  /** Defaults to true for 4xx and 5xx, so a bare 403 is a problem+json 403. Pass false for the WAF's edge 403. */
  readonly problem?: boolean
  readonly networkError?: boolean
  readonly retryAfterMs?: number
}

export interface FakeCommand {
  readonly id: string
  readonly key: `off1.${string}`
  readonly op: OpName
  readonly state: string
  readonly attempts: number
  readonly everSent: boolean
  readonly input: Json
  readonly frozen: Frozen | null
  readonly receipt: Receipt | null
  readonly review: ConflictClass | null
  readonly patientId: string
  readonly lane: string
}

export interface FakeControls {
  /** Connectivity as the runtime reports it. `offline` stops sending and makes reads use the saved copy. */
  setConnectivity(c: Connectivity): void
  /** Shorthand: online, offline, flapping (every other send fails with a network error) or slow. */
  simulate(mode: 'online' | 'offline' | 'flapping' | 'slow'): void
  /** Queue answers for the next sends, in order. */
  respondNext(...responses: FakeResponse[]): void
  /** The answer for any send with nothing queued. Return undefined for the default 201. */
  respondWith(handler: (request: FakeRequest) => FakeResponse | undefined): void
  /** Shorthands for the common refusals. */
  conflictNext(): void
  forbidNext(o?: { problem?: boolean; code?: string }): void
  /** C1 lookups report `completed` for every key that was sent before. */
  receiptFound(on: boolean): void
  /** C1 lookups fail (unreachable), so a sent-before refusal stays CC1. */
  receiptsUnreachable(on: boolean): void
  /** Move the device's wall clock back (positive) or forward (negative). Over 5 minutes back is `suspect`. */
  rollbackClock(ms: number): void
  /** Advance virtual time. Idle and lease expiry are checked. */
  advance(ms: number): Promise<void>
  /** The next prescription save sees changed allergies or medications (CC4). */
  safetyChanged(on: boolean): void
  /** Make a vault exist for an account without a sign-in (offline cold start tests). */
  seedVault(s: StaffSessionSnapshot, password: string): void
  /** Run the sender until nothing more can be sent now. */
  flush(): Promise<void>
  readonly requests: readonly FakeRequest[]
  commands(): FakeCommand[]
  auditEvents(): OfflineAuditEvent[]
  /** Patient ids with a saved copy in the open vault. */
  cachedPatients(): string[]
  logoutPending(): boolean
  /** Files staged with stageMedia and not yet applied. */
  stagedMedia(): string[]
  failedUnlocks(): number
  now(): number
}

export interface FakeOptions {
  readonly appHost?: string
  /** Defaults to pilot mode with Demo Hospital on `ehr` and `ocr`. */
  readonly env?: OfflineEnv
  /** Virtual start time. Defaults to 2026-10-29T09:00:00Z. */
  readonly startAt?: number
  readonly connectivity?: Connectivity
}

interface CacheEntry { value: unknown; savedAt: number; method: string }
interface FakeVault {
  vaultId: string
  session: StaffSessionSnapshot
  passwordProof: string
  signedInAt: number
  lastServerContactAt: number
  logoutPending: boolean
  cache: Map<string, Map<string, CacheEntry>>
  grants: Map<string, GrantState>
  index: Map<string, PatientIndexEntry>
  commands: CommandRec[]
  audit: OfflineAuditEvent[]
  auditSeq: number
  cmdSeq: number
}
interface CommandRec {
  seq: number
  /** A review successor's place in its lane (its original's), as the real engine. */
  orderSeq?: number
  id: string
  key: `off1.${string}`
  op: OpName
  input: Json
  scope: { accountId: string; membershipId: string; facilityId: string; patientId: string; purpose: 'direct-care' }
  lane: string
  dependsOn: string[]
  capturedAt: string
  clock: ClockState
  state: 'queued' | 'sending' | 'applied' | 'held_access' | 'held_session' | 'held_membership' | 'review' | 'discarded'
  everSent: boolean
  attempts: number
  nextAttemptAt: number
  frozen: Frozen | null
  receipt: Receipt | null
  review: ConflictClass | null
  awaitingAccess: boolean
  supersedes?: string
  value?: unknown
}

const ALLOWED_ACTIONS: Record<ConflictClass, readonly string[]> = {
  CC1: [], CC2: ['apply-on-top', 'discard'], CC3: ['new-visit', 'edit-as-new', 'discard'], CC4: ['send-as-is', 'discard'],
  CC5: ['ask-access', 'discard'], CC6: [], CC7: ['edit-as-new', 'discard'], CC8: [],
}
const DEFAULT_ENV: OfflineEnv = { mode: 'pilot', facilities: DEMO_HOSPITAL_FACILITY_ID, hosts: 'ehr,ocr', debug: 'false' }
const UNFINISHED = new Set(['queued', 'sending', 'held_access', 'held_session', 'held_membership', 'review'])

function laneOf(def: OpDefinition<Json>, input: Json, commandId: string): { patientId: string; lane: string } {
  const l = def.lane(input)
  if (l.visit === 'media') return { patientId: l.patientId, lane: `m:${l.patientId}` }
  if (l.visit === 'patient') return { patientId: l.patientId, lane: `p:${l.patientId}` }
  if (def.op === 'ehr.encounter.create') return { patientId: l.patientId, lane: `f:p:local:${commandId}` }
  const v: Ref = l.visit
  return { patientId: l.patientId, lane: 'local' in v ? `f:p:local:${v.local}` : `f:p:${v.server}` }
}

export function createFakeOfflineRuntime(options: FakeOptions = {}): { runtime: OfflineCore; controls: FakeControls } {
  const appHost = options.appHost ?? 'ehr'
  const config = parseOfflineEnv(options.env ?? DEFAULT_ENV)
  let clockNow = options.startAt ?? Date.parse('2026-10-29T09:00:00.000Z')
  let wallSkew = 0
  let conn: Connectivity = options.connectivity ?? 'online'
  let flapping = false
  let flapToggle = false
  let sessionReady = true
  let prepared: { email: string; passwordProof: string; passwordOk: boolean } | null = null
  let open: FakeVault | null = null
  let status: VaultStatus = 'none'
  let lastActivity = clockNow
  let hiddenSince: number | null = null
  let failedUnlocks = 0
  let receiptsFound = false
  let receiptsDown = false
  let safety = false
  let lastSyncAt: number | null = null
  let lastPolicy: OfflinePolicy = evaluatePolicy(config, { appHost })
  const vaults: FakeVault[] = []
  const defs = new Map<OpName, OpDefinition<Json>>()
  const queued: FakeResponse[] = []
  let handler: ((r: FakeRequest) => FakeResponse | undefined) | null = null
  const requests: FakeRequest[] = []
  const listeners = new Set<() => void>()
  const staged = new Map<string, Blob>()

  let summaryMemo: SyncSummary | null = null
  const notify = () => { summaryMemo = null; for (const l of [...listeners]) l() }
  const iso = (ms: number) => new Date(ms).toISOString()
  const proof = (email: string, password: string) => `${email.trim().toLowerCase()}\u0000${password}`
  const wall = () => clockNow - wallSkew
  const clockState = (): ClockState => (wallSkew > LIMITS.clockRollbackMs ? 'suspect' : 'anchored')
  const leaseUntil = (v: FakeVault) => Math.min(v.lastServerContactAt + LIMITS.leaseMs, v.signedInAt + LIMITS.absoluteMs)

  function sendable(): boolean {
    return status === 'unlocked' && open !== null && sessionReady && conn !== 'offline'
  }

  function findVault(accountId: string, facilityId: string): FakeVault | undefined {
    return vaults.find(v => v.session.accountId === accountId && v.session.facilityId === facilityId)
  }

  function pendingCount(v: FakeVault | null): number {
    return v ? v.commands.filter(c => UNFINISHED.has(c.state)).length : 0
  }

  function newVault(s: StaffSessionSnapshot, passwordProof: string): FakeVault | null {
    if (vaults.length >= LIMITS.maxVaultsPerOrigin) {
      const idle = vaults.filter(v => pendingCount(v) === 0 && v !== open)
      if (idle.length === 0) return null
      vaults.splice(vaults.indexOf(idle[0]!), 1)
    }
    const v: FakeVault = {
      vaultId: crypto.randomUUID(), session: s, passwordProof, signedInAt: clockNow, lastServerContactAt: clockNow,
      logoutPending: false, cache: new Map(), grants: new Map(), index: new Map(), commands: [], audit: [], auditSeq: 0, cmdSeq: 0,
    }
    vaults.push(v)
    return v
  }

  function wipeCache(v: FakeVault) {
    v.cache.clear()
    v.grants.clear()
    v.index.clear()
  }

  function pushAudit(v: FakeVault, e: Omit<OfflineAuditEvent, 'eventId' | 'seq' | 'occurredAt' | 'clock'>) {
    v.auditSeq += 1
    v.audit.push({ eventId: crypto.randomUUID(), seq: v.auditSeq, occurredAt: iso(wall()), clock: clockState(), ...e })
  }

  function readable(v: FakeVault, patientId: string): boolean {
    if (status !== 'unlocked' || clockState() === 'suspect' || clockNow >= leaseUntil(v)) return false
    const g = v.grants.get(patientId)
    if (!g || !g.readAllowed || g.breakGlass) return false
    return g.expiresAt === null || clockNow < Date.parse(g.expiresAt)
  }

  function expireGrants(v: FakeVault) {
    for (const [pid, g] of v.grants) {
      if (g.expiresAt !== null && clockNow >= Date.parse(g.expiresAt)) {
        v.cache.delete(pid)
        v.index.delete(pid)
        v.grants.delete(pid)
      }
    }
  }

  function summary(): SyncSummary {
    summaryMemo ??= computeSummary()
    return summaryMemo
  }

  function computeSummary(): SyncSummary {
    const v = open
    return {
      connectivity: conn,
      vault: status,
      leaseUntil: v ? iso(leaseUntil(v)) : null,
      clock: clockState(),
      pending: pendingCount(v),
      sending: v ? v.commands.filter(c => c.state === 'sending').length : 0,
      attention: v ? v.commands.filter(c => c.state === 'review' || c.state === 'held_access' || c.state === 'held_membership').length : 0,
      lastSyncAt: lastSyncAt === null ? null : iso(lastSyncAt),
      escrow: v !== null,
      storage: { usageBytes: null, quotaBytes: null, persisted: true, low: false },
    }
  }

  function receiptLookup(c: CommandRec): ResolvedRef | null {
    const dep = open?.commands.find(x => x.id === c.id)
    return dep?.receipt ? { id: dep.receipt.resourceId, ...(dep.receipt.rowVersion !== undefined ? { rowVersion: dep.receipt.rowVersion } : {}) } : null
  }

  function lookupById(id: string): ResolvedRef | null {
    const dep = open?.commands.find(x => x.id === id)
    return dep ? receiptLookup(dep) : null
  }

  function answerFor(req: FakeRequest): FakeResponse {
    if (flapping) {
      flapToggle = !flapToggle
      if (flapToggle) return { status: null, networkError: true }
    }
    const next = queued.shift()
    if (next) return next
    return handler?.(req) ?? { status: 201, body: { id: crypto.randomUUID(), rowVersion: 1 } }
  }

  function makeReceipt(c: CommandRec, def: OpDefinition<Json>, status: number, body: unknown, via: Receipt['via']): Receipt {
    let r: { resourceType: string; resourceId: string; rowVersion?: number }
    try { r = def.receipt(body) } catch { r = { resourceType: def.op, resourceId: crypto.randomUUID() } }
    return { commandId: c.id, ...r, status, replay: via !== 'response', serverDate: iso(clockNow), via }
  }

  function toReview(c: CommandRec, cls: ConflictClass) {
    c.state = cls === 'CC5' ? 'held_access' : cls === 'CC6' ? 'held_session' : cls === 'CC8' ? 'held_membership' : 'review'
    c.review = cls
  }

  /** One attempt for one command. Returns the definitive first refusal, if any, for `save`. */
  async function attempt(c: CommandRec): Promise<TransportError | null> {
    const def = defs.get(c.op)!
    if (def.safety === 'prescription' && safety && !c.everSent && c.review === null) {
      toReview(c, 'CC4')
      return null
    }
    if (!c.frozen) {
      const resolved = resolveRefs(def.refs(c.input), lookupById)
      if (!resolved) return null
      const frozen = freeze({
        def, input: c.input, key: c.key, facilityId: c.scope.facilityId, capturedAt: c.capturedAt, clock: c.clock,
        resolved, lookup: lookupById, frozenAt: iso(clockNow),
      })
      if (!frozen) return null
      c.frozen = frozen
    }
    const sentBefore = c.everSent
    c.everSent = true
    c.attempts += 1
    c.state = 'sending'
    const req: FakeRequest = {
      commandId: c.id, op: c.op, method: c.frozen.method, path: c.frozen.path,
      bodyText: JSON.stringify(c.frozen.body), headers: { ...c.frozen.headers }, attempt: c.attempts,
    }
    requests.push(req)
    const res = answerFor(req)
    const problem = res.problem ?? (res.status !== null && res.status >= 400)
    const answer = { status: res.status, code: res.code ?? null, problem, networkError: res.networkError ?? false, path: c.frozen.path }
    const cls = classify(answer)
    if (cls === 'applied') {
      c.state = 'applied'
      c.receipt = makeReceipt(c, def, res.status!, res.body, 'response')
      c.value = res.body
      c.review = null
      lastSyncAt = clockNow
      if (open) open.lastServerContactAt = clockNow
      return null
    }
    if (cls === 'transient') {
      c.state = 'sending'
      c.nextAttemptAt = clockNow + (res.retryAfterMs ?? 0)
      return null
    }
    const firstRefusal = !sentBefore && isDefinitiveFirstRefusal(answer)
      ? new TransportError({ status: res.status, code: res.code ?? null, problem, body: res.body }) : null
    if (needsReceiptCheck(cls, sentBefore) && !firstRefusal) {
      if (receiptsDown) { c.state = 'sending'; c.review = 'CC1'; return null }
      if (receiptsFound || cls === 'applied-unreadable') {
        c.state = 'applied'
        c.receipt = makeReceipt(c, def, 201, { id: crypto.randomUUID() }, 'lookup')
        c.review = null
        return null
      }
    }
    if (cls === 'version' && def.method === 'PATCH' && def.reread && def.intent) {
      const resolved = resolveRefs(def.refs(c.input), lookupById)
      const current = resolved ? await def.reread(c.input, resolved.ids) : null
      const intent = def.intent(c.input)
      if (current && typeof current === 'object' && Object.entries(intent).every(([k, v]) =>
        stableJson((current as Record<string, unknown>)[k]) === stableJson(v))) {
        c.state = 'applied'
        c.receipt = makeReceipt(c, def, 200, current, 'reread')
        return null
      }
    }
    const map: Record<string, ConflictClass> = {
      session: 'CC6', access: 'CC5', edge: 'CC7', invalid: 'CC7', missing: 'CC3', state: 'CC3', version: 'CC2', 'applied-unreadable': 'CC1',
    }
    toReview(c, map[cls] ?? 'CC7')
    // Nothing was applied: a waiting save removes it and hands the error to the form; otherwise it stays in review.
    return firstRefusal
  }

  function eligible(v: FakeVault): CommandRec[] {
    const heads = new Map<string, CommandRec>()
    for (const c of [...v.commands].sort((a, b) => (a.orderSeq ?? a.seq) - (b.orderSeq ?? b.seq) || a.seq - b.seq)) {
      if (!UNFINISHED.has(c.state)) continue
      if (!heads.has(c.lane)) heads.set(c.lane, c)
    }
    if (v.commands.some(c => c.state === 'held_session')) return []
    return [...heads.values()].filter(c =>
      (c.state === 'queued' || (c.state === 'sending' && c.review === null)) && c.nextAttemptAt <= clockNow
      && c.dependsOn.every(id => v.commands.find(x => x.id === id)?.state === 'applied'))
  }

  async function flush(): Promise<void> {
    for (let guard = 0; guard < 1000; guard += 1) {
      if (!sendable() || !open) break
      const ready = eligible(open)
      if (ready.length === 0) break
      let progressed = false
      for (const c of ready) {
        const before = `${c.state}|${c.attempts}`
        await attempt(c)
        if (`${c.state}|${c.attempts}` !== before && c.state !== 'sending') progressed = true
        if (!sendable()) break
      }
      if (!progressed) break
    }
    notify()
  }

  function requireOpen(): FakeVault {
    if (status !== 'unlocked' || !open) throw new SaveRefused('unavailable')
    return open
  }

  function pendingViews(v: FakeVault, filter: (c: CommandRec) => boolean): PendingView[] {
    return v.commands.filter(c => UNFINISHED.has(c.state) && filter(c)).map(c => ({
      commandId: c.id, op: c.op, state: c.state, capturedAt: c.capturedAt, input: c.input,
      label: c.state === 'sending' && c.everSent ? 'Sent, waiting for confirmation' : 'Saved on this device, not sent yet',
    }))
  }

  async function saveCommand(op: OpName, input: Json, o: { awaitMs?: number; dependsOn?: string[]; supersedes?: string } = {}): Promise<CommandOutcome<unknown>> {
    const v = requireOpen()
    const def = defs.get(op)
    if (!def) throw new Error(`Unregistered offline op ${op}`)
    const bytes = sizeAtSave(def, input)
    if (bytes > LIMITS.maxBodyBytes) throw new SaveRefused('too-long', { bytes })
    const id = crypto.randomUUID()
    const { patientId, lane } = laneOf(def, input, id)
    const prior = o.supersedes ? v.commands.find(c => c.id === o.supersedes) : undefined
    const local = Object.values(def.refs(input)).flatMap(r => ('local' in r ? [r.local] : []))
    v.cmdSeq += 1
    const c: CommandRec = {
      seq: v.cmdSeq, id, key: `${KEY_PREFIX}${crypto.randomUUID()}` as `off1.${string}`, op, input,
      scope: { accountId: v.session.accountId, membershipId: v.session.membershipId, facilityId: v.session.facilityId, patientId, purpose: 'direct-care' },
      lane, dependsOn: [...new Set([...(o.dependsOn ?? []), ...local])], capturedAt: iso(wall()), clock: clockState(),
      state: 'queued', everSent: false, attempts: 0, nextAttemptAt: 0, frozen: null, receipt: null, review: null, awaitingAccess: false,
      ...(o.supersedes ? { supersedes: o.supersedes } : {}),
      ...(prior && prior.lane === lane ? { orderSeq: prior.orderSeq ?? prior.seq } : {}),
    }
    v.commands.push(c)
    notify()
    if (sendable() && (o.awaitMs ?? LIMITS.receiptWaitMs) > 0 && eligible(v).includes(c)) {
      const refused = await attempt(c)
      if (refused) {
        v.commands.splice(v.commands.indexOf(c), 1)
        notify()
        throw new SaveRefused('refused', { cause: refused })
      }
      if (c.state === 'applied' && c.receipt) {
        void flush()
        return { kind: 'applied', value: c.value, receipt: c.receipt }
      }
    }
    notify()
    void flush()
    return { kind: 'saved', commandId: id }
  }

  function discard(v: FakeVault, c: CommandRec, reason: string) {
    c.state = 'discarded'
    pushAudit(v, {
      action: 'ehr.offline.command.discarded', patientId: c.scope.patientId, section: null, resourceId: null, grantExpiresAt: null,
      details: { op: c.op, reason, bodySha256: c.frozen ? `fake-${c.frozen.bytes}` : 'none', capturedAt: c.capturedAt },
    })
  }

  function checkTimers() {
    if (status === 'unlocked') {
      if (clockNow - lastActivity >= LIMITS.idleLockMs) runtime.lock('idle')
      else if (hiddenSince !== null && clockNow - hiddenSince >= LIMITS.idleLockMs) runtime.lock('hidden')
    }
    if (open && clockNow >= leaseUntil(open) && conn === 'offline') {
      wipeCache(open)
      status = 'expired'
    }
    if (open) expireGrants(open)
  }

  const runtime: OfflineCore = {
    policy: () => lastPolicy,

    prepareFromSignIn(email, password) {
      if (config.mode === 'off') { prepared = null; return }
      prepared = { email: email.trim().toLowerCase(), passwordProof: proof(email, password), passwordOk: passwordLongEnough(password) }
    },

    async offer(s): Promise<OfflineOffer> {
      const reason = facilityAllowed(config, appHost, s.facilityId)
      if (reason) return { kind: 'unavailable', reason }
      const existing = findVault(s.accountId, s.facilityId)
      if (!prepared) return vaults.length > 0 ? { kind: 'paused' } : { kind: 'unavailable', reason: 'not-opted-in' }
      if (existing && existing.passwordProof === prepared.passwordProof) return { kind: 'existing' }
      if (!prepared.passwordOk) return { kind: 'unavailable', reason: 'password-too-short' }
      if (vaults.length >= LIMITS.maxVaultsPerOrigin && vaults.every(v => pendingCount(v) > 0)) return { kind: 'unavailable', reason: 'device-full' }
      return { kind: 'ask' }
    },

    async attachSession(s, o) {
      const reason = facilityAllowed(config, appHost, s.facilityId)
      const key = prepared
      prepared = null
      if (reason || !key) {
        lastPolicy = evaluatePolicy(config, { appHost, facilityId: s.facilityId, optedIn: key ? o.optIn : null })
        if (!reason && vaults.length > 0) status = 'locked'
        notify()
        return summary()
      }
      let v = findVault(s.accountId, s.facilityId)
      if (v && v.passwordProof !== key.passwordProof) {
        // Password changed online: the escrow re-wrap keeps the queue, the cache is new.
        wipeCache(v)
        v.passwordProof = key.passwordProof
      }
      let full = false
      if (!v && o.optIn && key.passwordOk) {
        v = newVault(s, key.passwordProof) ?? undefined
        full = !v
      }
      if (!v) {
        lastPolicy = full ? { mode: config.mode, enabled: false, reason: 'device-full' }
          : evaluatePolicy(config, { appHost, facilityId: s.facilityId, optedIn: o.optIn, passwordOk: key.passwordOk })
        status = 'none'
        notify()
        return summary()
      }
      v.session = s
      v.signedInAt = clockNow
      v.lastServerContactAt = clockNow
      v.logoutPending = false
      open = v
      status = 'unlocked'
      lastActivity = clockNow
      lastPolicy = { mode: config.mode, enabled: true }
      for (const c of v.commands) if (c.state === 'held_session') { c.state = c.everSent ? 'sending' : 'queued'; c.review = null }
      notify()
      void flush()
      return summary()
    },

    async unlockOffline(email, password): Promise<UnlockResult> {
      const p = proof(email, password)
      if (vaults.length === 0) return { ok: false, reason: 'no-vault' }
      if (clockState() === 'suspect') return { ok: false, reason: 'clock-suspect' }
      const v = vaults.find(x => x.passwordProof === p)
      if (!v) {
        failedUnlocks += 1
        if (failedUnlocks >= LIMITS.maxFailedUnlocks) {
          for (const x of vaults) wipeCache(x)
          failedUnlocks = 0
          notify()
          return { ok: false, reason: 'wiped' }
        }
        return { ok: false, reason: 'wrong-credentials' }
      }
      failedUnlocks = 0
      if (clockNow >= leaseUntil(v)) { wipeCache(v); return { ok: false, reason: 'lease-expired' } }
      // As the real runtime: a facility no longer enabled (kill switch, left the pilot) never opens offline.
      if (facilityAllowed(config, appHost, v.session.facilityId)) return { ok: false, reason: 'no-vault' }
      open = v
      status = 'unlocked'
      lastPolicy = { mode: config.mode, enabled: true }
      lastActivity = clockNow
      pushAudit(v, { action: 'ehr.offline.unlock', patientId: null, section: null, resourceId: null, grantExpiresAt: null })
      notify()
      return { ok: true, summary: summary() }
    },

    async unlockLocked(password) {
      const target = open ?? vaults[0]
      if (!target) return { ok: false, reason: 'no-vault' }
      return runtime.unlockOffline(target.session.email, password)
    },

    restoreSession: () => (status === 'unlocked' && open ? open.session : null),

    lock(_reason: LockReason) {
      if (status !== 'unlocked') return
      status = 'locked'
      notify()
    },

    async signOut(o) {
      const v = open
      if (v) {
        wipeCache(v)
        if (!o.online) v.logoutPending = true
        if (o.online && pendingCount(v) === 0 && v.audit.length === 0) vaults.splice(vaults.indexOf(v), 1)
      }
      open = null
      status = vaults.length > 0 ? 'locked' : 'none'
      notify()
    },

    async wipe(reason: WipeReason) {
      if (reason === 'membership' && open) {
        for (const c of open.commands) if (UNFINISHED.has(c.state)) { c.state = 'held_membership'; c.review = 'CC8' }
      }
      for (const v of reason === 'failed-unlocks' || reason === 'kill-switch' ? vaults : open ? [open] : []) {
        wipeCache(v)
        pushAudit(v, { action: 'ehr.offline.wipe', patientId: null, section: reason, resourceId: null, grantExpiresAt: null })
      }
      if (reason !== 'sign-out' && status === 'unlocked' && reason !== 'membership') status = reason === 'lease' ? 'expired' : status
      notify()
    },

    hasVaults: async () => vaults.length > 0,
    trustedNow: () => ({ at: new Date(clockNow), clock: clockState() }),
    summary,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },

    onResponseMeta(meta: ResponseMeta) {
      if (meta.networkError) return
      if (open && meta.authenticated && meta.status !== null && meta.status >= 200 && meta.status < 300) open.lastServerContactAt = clockNow
    },
    setSessionReady(ready) {
      sessionReady = ready
      if (ready) void flush()
    },
    noteActivity() { lastActivity = clockNow },
    noteVisibility(hidden) { hiddenSince = hidden ? clockNow : null },
    connectivity: () => conn,
    updateSafe: async () => !(open?.commands.some(c => c.state === 'sending') ?? false),
    dispose() { listeners.clear() },

    async stageMedia(file: Blob, o: { index: number }): Promise<StagedMedia> {
      requireOpen()
      const type = file.type as StagedMedia['mediaType']
      if (!['application/pdf', 'image/jpeg', 'image/png', 'image/tiff'].includes(type)) throw new Error('Only PDF, JPEG, PNG and TIFF files can be kept for upload.')
      const blobId = crypto.randomUUID()
      staged.set(blobId, file)
      const d = new Date(clockNow)
      const p = (n: number) => String(n).padStart(2, '0')
      const ext = type === 'application/pdf' ? 'pdf' : type === 'image/jpeg' ? 'jpg' : type === 'image/png' ? 'png' : 'tiff'
      return {
        blobId, mediaType: type, sizeBytes: file.size, sha256Hex: `fake-${blobId}`,
        fileName: `scan-${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}-${o.index}.${ext}`,
      }
    },
    logoutPending: async () => vaults.some(v => v.logoutPending),
    async logoutSent() { for (const v of vaults) v.logoutPending = false },

    async rememberPatient(e: PatientEntryInput) {
      const v = open
      if (!v || status !== 'unlocked') return
      v.index.set(e.patientId, {
        patientId: e.patientId, displayName: e.displayName, hidCode: e.hidCode, grantExpiresAt: e.grantExpiresAt,
        lastOpenedAt: iso(clockNow), pendingCount: pendingCount(v),
      })
      if (v.index.size > LIMITS.maxPatients) {
        const oldest = [...v.index.values()].sort((a, b) => a.lastOpenedAt.localeCompare(b.lastOpenedAt))[0]!
        await runtime.reads.dropPatient(oldest.patientId)
      }
    },

    reads: {
      async read<T>(spec: { method: string; args: readonly unknown[]; patientId: string; network: () => Promise<T>; emergency?: boolean }): Promise<CachedResult<T>> {
        const key = `${spec.method}|${stableJson(spec.args)}`
        const v = open
        if (spec.emergency) return { value: await spec.network(), source: 'network', savedAt: null }
        const cached = (): CachedResult<T> | null => {
          if (!v || !readable(v, spec.patientId)) return null
          const hit = v.cache.get(spec.patientId)?.get(key)
          return hit ? { value: hit.value as T, source: 'cache', savedAt: iso(hit.savedAt) } : null
        }
        if (conn === 'offline') {
          const hit = cached()
          if (hit) return hit
          throw new TransportError({ status: null, networkError: true })
        }
        try {
          const value = await spec.network()
          const g = v?.grants.get(spec.patientId)
          if (v && status === 'unlocked' && g && g.readAllowed && !g.breakGlass) {
            const m = v.cache.get(spec.patientId) ?? new Map<string, CacheEntry>()
            m.set(key, { value, savedAt: clockNow, method: spec.method })
            v.cache.set(spec.patientId, m)
          }
          return { value, source: 'network', savedAt: null }
        } catch (error) {
          const transient = !(error instanceof TransportError) || error.networkError
            || error.status === 502 || error.status === 503 || error.status === 504
          if (error instanceof TransportError && error.status === 403 && error.code === 'CONSENT_REQUIRED') await runtime.reads.dropPatient(spec.patientId)
          const hit = transient ? cached() : null
          if (hit) return hit
          throw error
        }
      },
      async setGrant(g: GrantState) {
        const v = open
        if (!v) return
        if (g.breakGlass || !g.readAllowed) {
          await runtime.reads.dropPatient(g.patientId)
        } else {
          v.grants.set(g.patientId, g)
        }
        if (g.writeAllowed) {
          for (const c of v.commands) {
            if (c.state === 'held_access' && c.scope.patientId === g.patientId && c.awaitingAccess) {
              c.state = c.everSent ? 'sending' : 'queued'
              c.review = null
              c.awaitingAccess = false
            }
          }
          void flush()
        }
        notify()
      },
      async dropPatient(patientId) {
        const v = open
        if (!v) return
        v.cache.delete(patientId)
        v.grants.delete(patientId)
        v.index.delete(patientId)
        notify()
      },
      async keepOffline(_patientId, fetchers) {
        const queue = [...fetchers]
        const worker = async () => { for (let f = queue.shift(); f; f = queue.shift()) await f() }
        await Promise.all([worker(), worker()])
      },
    },

    commands: {
      register(list) { for (const d of list) defs.set(d.op, d as OpDefinition<Json>) },
      save: <V>(op: OpName, input: Json, o?: { awaitMs?: number; dependsOn?: string[] }) => saveCommand(op, input, o) as Promise<CommandOutcome<V>>,
      async edit(commandId, input) {
        const v = requireOpen()
        const c = v.commands.find(x => x.id === commandId)
        if (!c || c.everSent) throw new Error('This entry has already been sent; save a change as a new entry.')
        const def = defs.get(c.op)!
        const bytes = sizeAtSave(def, input)
        if (bytes > LIMITS.maxBodyBytes) throw new SaveRefused('too-long', { bytes })
        c.input = input
        c.frozen = null
        if (c.review === 'CC4') { c.review = null; c.state = 'queued' }
        notify()
      },
      async cancel(commandId) {
        const v = requireOpen()
        const c = v.commands.find(x => x.id === commandId)
        if (!c || c.everSent) throw new Error('This entry has already been sent and cannot be cancelled.')
        v.commands.splice(v.commands.indexOf(c), 1)
        notify()
      },
      async pendingFor(patientId, visit) {
        const v = open
        if (!v || status !== 'unlocked') return []
        const lane = visit ? ('local' in visit ? `f:p:local:${visit.local}` : `f:p:${visit.server}`) : null
        return pendingViews(v, c => c.scope.patientId === patientId && (lane === null || c.lane === lane))
      },
      syncNow() { for (const c of open?.commands ?? []) c.nextAttemptAt = 0; void flush() },
    },

    review: {
      async list() {
        const v = open
        if (!v) return []
        return v.commands.filter(c => c.review !== null && (c.state === 'review' || c.state === 'held_access' || c.state === 'held_membership' || c.state === 'sending'))
          .map(c => ({
            commandId: c.id, class: c.review!, patientId: c.scope.patientId, op: c.op,
            laneBlocked: v.commands.filter(x => x.lane === c.lane && x.seq > c.seq && UNFINISHED.has(x.state)).length,
          }))
      },
      async resolve(commandId, action, o) {
        const v = requireOpen()
        const c = v.commands.find(x => x.id === commandId)
        if (!c) throw new Error('No such entry')
        const reason = (o.reason ?? '').trim()
        if (!c.review || !ALLOWED_ACTIONS[c.review].includes(action)) throw new Error('That action is not available for this entry.')
        if (action !== 'send-as-is' && reason.length < 8) throw new Error('Give a reason of at least 8 characters.')
        if (reason.length > 500) throw new Error('Keep the reason under 500 characters.')
        switch (action) {
          case 'send-as-is':
            if (c.review !== 'CC4') throw new Error('Only a safety hold can be sent as is.')
            c.review = null
            c.state = 'queued'
            safety = false
            break
          case 'ask-access':
            c.awaitingAccess = true
            break
          case 'discard':
            discard(v, c, reason)
            break
          case 'apply-on-top':
          case 'new-visit':
          case 'edit-as-new': {
            if (o.input === undefined) throw new Error('A new entry needs its input.')
            discard(v, c, reason)
            await saveCommand(c.op, o.input, { awaitMs: 0, supersedes: c.id })
            break
          }
        }
        notify()
        void flush()
      },
    },

    audit: {
      recordOpen(patientId, section, resourceId) {
        const v = open
        if (!v || status !== 'unlocked') return
        const recent = v.audit.find(e => e.action === 'ehr.record.read' && e.patientId === patientId && e.section === section
          && clockNow - Date.parse(e.occurredAt) - wallSkew < 10 * 60_000)
        if (recent) return
        pushAudit(v, {
          action: 'ehr.record.read', patientId, section, resourceId: resourceId ?? null,
          grantExpiresAt: v.grants.get(patientId)?.expiresAt ?? null,
        })
      },
    },

    patients: {
      async list() {
        const v = open
        if (!v || status !== 'unlocked') return []
        return [...v.index.values()].filter(e => readable(v, e.patientId))
          .map(e => ({ ...e, pendingCount: v.commands.filter(c => c.scope.patientId === e.patientId && UNFINISHED.has(c.state)).length }))
          .sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt))
      },
      async search(q) {
        const needle = q.trim().toLowerCase()
        return (await runtime.patients.list()).filter(e => e.displayName.toLowerCase().includes(needle) || e.hidCode.toLowerCase().includes(needle))
      },
    },
  }

  const controls: FakeControls = {
    setConnectivity(c) {
      conn = c
      if (c !== 'offline') void flush()
      notify()
    },
    simulate(mode) {
      flapping = mode === 'flapping'
      controls.setConnectivity(mode === 'offline' ? 'offline' : mode === 'slow' ? 'slow' : 'online')
    },
    respondNext(...responses) { queued.push(...responses) },
    respondWith(h) { handler = h },
    conflictNext() { queued.push({ status: 412, code: 'VERSION_CONFLICT' }) },
    forbidNext(o = {}) {
      const problem = o.problem ?? true
      queued.push({ status: 403, problem, ...(problem ? { code: o.code ?? 'CONSENT_REQUIRED' } : {}) })
    },
    receiptFound(on) { receiptsFound = on },
    receiptsUnreachable(on) { receiptsDown = on },
    rollbackClock(ms) { wallSkew = ms; notify() },
    async advance(ms) {
      clockNow += ms
      checkTimers()
      notify()
      await flush()
    },
    safetyChanged(on) { safety = on },
    seedVault(s, password) {
      const v = findVault(s.accountId, s.facilityId) ?? newVault(s, proof(s.email, password))
      if (v) v.passwordProof = proof(s.email, password)
      if (status === 'none') status = 'locked'
    },
    flush,
    requests,
    commands: () => (open?.commands ?? vaults.flatMap(v => v.commands)).map(c => ({
      id: c.id, key: c.key, op: c.op, state: c.state, attempts: c.attempts, everSent: c.everSent, input: c.input,
      frozen: c.frozen, receipt: c.receipt, review: c.review, patientId: c.scope.patientId, lane: c.lane,
    })),
    auditEvents: () => [...(open?.audit ?? [])],
    cachedPatients: () => [...(open?.cache.keys() ?? [])],
    logoutPending: () => vaults.some(v => v.logoutPending),
    stagedMedia: () => [...staged.keys()],
    failedUnlocks: () => failedUnlocks,
    now: () => clockNow,
  }

  return { runtime, controls }
}

/**
 * An in-memory Web Locks stand-in (exclusive locks, FIFO waiters, AbortSignal)
 * for tests that run two runtimes against one store.
 */
export function createMemoryLocks(): { request<T>(name: string, options: { signal?: AbortSignal }, callback: () => Promise<T>): Promise<T>; held(name: string): boolean } {
  const queues = new Map<string, (() => void)[]>()
  const busy = new Set<string>()
  const release = (name: string) => {
    const next = queues.get(name)?.shift()
    if (next) next()
    else busy.delete(name)
  }
  return {
    held: name => busy.has(name),
    request<T>(name: string, options: { signal?: AbortSignal }, callback: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const run = () => {
          busy.add(name)
          callback().then(resolve, reject).finally(() => release(name))
        }
        if (options.signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return }
        if (!busy.has(name)) { run(); return }
        const list = queues.get(name) ?? []
        const waiter = () => { options.signal?.removeEventListener('abort', onAbort); run() }
        const onAbort = () => {
          const l = queues.get(name)
          if (l) queues.set(name, l.filter(w => w !== waiter))
          reject(new DOMException('Aborted', 'AbortError'))
        }
        options.signal?.addEventListener('abort', onAbort, { once: true })
        list.push(waiter)
        queues.set(name, list)
      })
    },
  }
}
